/**
 * 广告创意生成任务执行器
 *
 * 功能：
 * 1. 调用核心generateAdCreative函数
 * 2. 将进度更新到creative_tasks表
 * 3. 支持SSE实时推送（通过数据库轮询）
 */

import type { Task } from '../types'
import { generateAdCreative } from '@/lib/ad-creative-gen'
import { createAdCreative } from '@/lib/ad-creative'
import {
  evaluateCreativeAdStrength
} from '@/lib/scoring'
import { findOfferById } from '@/lib/offers'
import { getDatabase } from '@/lib/db'
// 🆕 v4.10: 关键词池集成
import {
  getOrCreateKeywordPool,
  getAvailableBuckets,
  getBucketInfo,
  type BucketType,
  type OfferKeywordPool,
  type PoolKeywordData
} from '@/lib/offer-keyword-pool'

/**
 * 验证URL是否为有效的URL
 * 排除 null, undefined, "null", "null/" 等无效值
 */
function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return false
  if (url === 'null' || url === 'null/' || url === 'undefined') return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * 广告创意生成任务数据接口
 */
export interface AdCreativeTaskData {
  offerId: number
  maxRetries?: number
  targetRating?: 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'POOR'
  synthetic?: boolean  // 🔧 向后兼容：旧版“综合创意”标记（KISS-3类型方案中不再生成S桶）
}

/**
 * 广告创意生成任务执行器
 */
export async function executeAdCreativeGeneration(
  task: Task<AdCreativeTaskData>
): Promise<any> {
  const { offerId, maxRetries = 3, targetRating = 'EXCELLENT', synthetic = false } = task.data
  const db = getDatabase()
  const effectiveMaxRetries = Math.min(maxRetries, 2)

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  try {
    // 更新任务状态为运行中
    await db.exec(`
      UPDATE creative_tasks
      SET status = 'running', started_at = ${nowFunc}, message = '开始生成广告创意'
      WHERE id = ?
    `, [task.id])

    console.log(`🚀 开始执行创意生成任务: ${task.id}`)

    // 验证Offer存在
    const offer = await findOfferById(offerId, task.userId)
    if (!offer) {
      throw new Error('Offer不存在或无权访问')
    }

    if (offer.scrape_status === 'failed') {
      throw new Error('Offer信息抓取失败，请重新抓取')
    }

    // 🆕 v4.10: 获取或创建关键词池（复用已有数据，避免重复AI调用）
    let keywordPool: OfferKeywordPool | null = null
    let selectedBucket: BucketType | null = null
    let bucketInfo: { keywords: PoolKeywordData[]; intent: string; intentEn: string } | null = null

    try {
      // 更新进度：准备关键词池
      await db.exec(`
        UPDATE creative_tasks
        SET stage = 'preparing', progress = 5, message = '正在准备关键词池...', updated_at = ${nowFunc}
        WHERE id = ?
      `, [task.id])

      keywordPool = await getOrCreateKeywordPool(offerId, task.userId, false)

      // ✅ KISS-3类型：只生成 A / B(含C) / D(含S) 三种创意
      // synthetic=true 为旧版前端兼容：映射为 D 类型（不再单独生成S桶）
      if (synthetic) {
        console.warn(`⚠️ 检测到旧版 synthetic=true，已映射为桶D（不再生成S桶）`)
      }

      // 获取可用桶（未被占用的，已按KISS-3类型收敛）
      const availableBuckets = await getAvailableBuckets(offerId)

      if (availableBuckets.length > 0) {
        // 旧synthetic请求优先生成D（转化/价值导向）
        const preferred = synthetic && availableBuckets.includes('D') ? 'D' : availableBuckets[0]
        selectedBucket = preferred
        bucketInfo = getBucketInfo(keywordPool, selectedBucket)
        console.log(`📦 使用关键词池桶 ${selectedBucket} (${bucketInfo.intent}): ${bucketInfo.keywords.length} 个关键词`)
      } else {
        // ✅ KISS-3类型：三类创意都已生成，拒绝继续生成（避免用户看到>3套创意）
        throw new Error('该Offer已生成全部3种创意类型（A/B/D），无需继续生成。请删除某个类型后再生成。')
      }
    } catch (poolError: any) {
      // 🔥 统一架构(2025-12-16): 关键词池是必需的，失败直接抛错
      console.error(`❌ 关键词池创建失败: ${poolError.message}`)
      throw new Error(`关键词池创建失败，无法生成创意: ${poolError.message}`)
    }

    let bestCreative: any = null
    let bestEvaluation: any = null
    let attempts = 0
    let noImprovementStreak = 0
    let retryHistory: Array<{
      attempt: number
      rating: string
      score: number
      suggestions: string[]
    }> = []

    let usedKeywords: string[] = []
    const brandKeywords = offer.brand ? [offer.brand.toLowerCase()] : []

    // 多轮生成循环
    if (effectiveMaxRetries < maxRetries) {
      console.log(`ℹ️ 已限制最大生成轮次: ${maxRetries} → ${effectiveMaxRetries}`)
    }

    while (attempts < effectiveMaxRetries) {
      attempts++
      const attemptBaseProgress = 10 + (attempts - 1) * 25

      // 更新进度：生成中
      const bucketLabel = selectedBucket ? ` [桶${selectedBucket}]` : ''
      const progressMessage = `第${attempts}次生成${bucketLabel}: AI正在创作广告文案...`
      await db.exec(`
        UPDATE creative_tasks
        SET stage = 'generating', progress = ?, message = ?, current_attempt = ?, updated_at = ${nowFunc}
        WHERE id = ?
      `, [attemptBaseProgress, progressMessage, attempts, task.id])

      // 1. 生成创意
      // 🔥 2025-12-12修复：始终跳过缓存，确保每次重新生成都产生新创意
      // 🆕 v4.10: 传递关键词池信息，实现分层关键词策略
      const creative = await generateAdCreative(
        offerId,
        task.userId,
        {
          skipCache: true,  // 始终跳过缓存
          excludeKeywords: attempts > 1 ? usedKeywords : undefined,
          // 🆕 v4.10: 关键词池参数
          keywordPool: keywordPool || undefined,
          bucket: selectedBucket || undefined,
          bucketKeywords: bucketInfo?.keywords.map(kw => typeof kw === 'string' ? kw : kw.keyword),
          bucketIntent: bucketInfo?.intent,
          bucketIntentEn: bucketInfo?.intentEn
        }
      )

      // 🔧 修复(2026-01-21): 强制将创意关键词同步为桶关键词
      // 背景：generateAdCreative 内部会对关键词做多轮过滤，极端情况下会导致仅保留 1-3 个关键词
      // 但 KISS-3 类型创意必须使用关键词池桶的完整关键词集合，确保投放配置稳定一致
      const generatedKeywordsForExclusion: string[] = Array.isArray(creative.keywords)
        ? creative.keywords.slice()
        : []

      if (bucketInfo?.keywords && bucketInfo.keywords.length > 0) {
        const bucketKeywordsWithVolume = bucketInfo.keywords
          .map((kw: any) => {
            const keywordRaw = typeof kw === 'string' ? kw : kw?.keyword
            const keyword = typeof keywordRaw === 'string' ? keywordRaw.trim() : ''
            if (!keyword) return null

            if (typeof kw === 'string') {
              return {
                keyword,
                searchVolume: 0,
                matchType: 'PHRASE' as const,
                source: 'KEYWORD_POOL' as const
              }
            }

            return {
              keyword,
              searchVolume: typeof kw.searchVolume === 'number' ? kw.searchVolume : Number(kw.searchVolume) || 0,
              competition: kw.competition,
              competitionIndex: kw.competitionIndex,
              lowTopPageBid: kw.lowTopPageBid,
              highTopPageBid: kw.highTopPageBid,
              matchType: (kw.matchType as 'EXACT' | 'PHRASE' | 'BROAD' | undefined) || ('PHRASE' as const),
              source: 'KEYWORD_POOL' as const
            }
          })
          .filter((v): v is NonNullable<typeof v> => v !== null)
        const keywordLimit = selectedBucket === 'D' ? bucketKeywordsWithVolume.length : 30
        const limitedBucketKeywords = bucketKeywordsWithVolume.slice(0, keywordLimit)

        creative.keywords = limitedBucketKeywords.map((kw: any) => kw.keyword)
        creative.keywordsWithVolume = limitedBucketKeywords
      }

      // 更新进度：评估中
      await db.exec(`
        UPDATE creative_tasks
        SET stage = 'evaluating', progress = ?, message = ?, updated_at = ${nowFunc}
        WHERE id = ?
      `, [attemptBaseProgress + 10, `第${attempts}次生成: 评估创意质量...`, task.id])

      // 2. 检查metadata
      const hasMetadata = creative.headlinesWithMetadata && creative.descriptionsWithMetadata
      if (!hasMetadata) {
        creative.headlinesWithMetadata = creative.headlines.map(text => ({ text, length: text.length }))
        creative.descriptionsWithMetadata = creative.descriptions.map(text => ({ text, length: text.length }))
      }

      // 3. 评估Ad Strength
      const evaluation = await evaluateCreativeAdStrength(
        creative.headlinesWithMetadata!,
        creative.descriptionsWithMetadata!,
        creative.keywords,
        {
          brandName: offer.brand,
          targetCountry: offer.target_country || 'US',
          targetLanguage: offer.target_language || 'en',
          userId: task.userId
        }
      )

      // 更新进度：评估完成
      await db.exec(`
        UPDATE creative_tasks
        SET progress = ?, message = ?, updated_at = ${nowFunc}
        WHERE id = ?
      `, [attemptBaseProgress + 18, `第${attempts}次生成: ${evaluation.finalRating} (${evaluation.finalScore}分)`, task.id])

      retryHistory.push({
        attempt: attempts,
        rating: evaluation.finalRating,
        score: evaluation.finalScore,
        suggestions: evaluation.combinedSuggestions
      })

      // 更新最佳结果
      const ratingRank: Record<string, number> = {
        POOR: 0,
        AVERAGE: 1,
        GOOD: 2,
        EXCELLENT: 3
      }
      const currentRank = ratingRank[evaluation.finalRating] ?? 0
      const bestRank = bestEvaluation ? (ratingRank[bestEvaluation.finalRating] ?? 0) : -1
      const scoreImproved = !bestEvaluation || evaluation.finalScore > bestEvaluation.finalScore
      const ratingImproved = currentRank > bestRank

      if (!bestEvaluation || ratingImproved || scoreImproved) {
        bestCreative = creative
        bestEvaluation = evaluation
        noImprovementStreak = 0
      } else {
        noImprovementStreak += 1
      }

      // 收集已使用关键词
      if (generatedKeywordsForExclusion.length > 0) {
        const nonBrandKeywords = generatedKeywordsForExclusion.filter(kw => {
          if (!kw || typeof kw !== 'string') return false
          const kwLower = kw.toLowerCase()
          return !brandKeywords.some(brand => kwLower.includes(brand) || brand.includes(kwLower))
        })
        usedKeywords = Array.from(new Set([...usedKeywords, ...nonBrandKeywords]))
      }

      // 检查是否达到目标
      if (evaluation.finalRating === targetRating) {
        break
      }

      // 🔧 自适应提前停止：连续无提升且已达到 GOOD 时不再强求 EXCELLENT
      // 目的：避免第三轮无明显收益却显著拉长总时长
      if (
        attempts >= 2 &&
        noImprovementStreak >= 1 &&
        bestEvaluation?.finalRating === 'GOOD' &&
        targetRating === 'EXCELLENT'
      ) {
        console.log(`⚠️ 连续无提升，已达 GOOD，提前结束重试以缩短耗时`)
        break
      }

      if (attempts < effectiveMaxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    // 检查最终结果
    if (!bestCreative || !bestEvaluation) {
      throw new Error('生成创意失败')
    }

    // 🔧 修复(2025-12-22): 质量门检查改为警告而非失败
    // 即使质量未达标也允许保存，但标记为警告状态
    const MINIMUM_SCORE = 70
    const qualityWarning = bestEvaluation.finalScore < MINIMUM_SCORE
    if (qualityWarning) {
      console.warn(`⚠️ 创意质量未达标（${bestEvaluation.finalScore}分 < ${MINIMUM_SCORE}分），但仍保存创意`)
    }

    // 更新进度：保存中
    await db.exec(`
      UPDATE creative_tasks
      SET stage = 'saving', progress = 85, message = '正在保存创意到数据库...', updated_at = ${nowFunc}
      WHERE id = ?
    `, [task.id])

    // 保存到数据库（包含完整的7维度Ad Strength数据）
    const savedCreative = await createAdCreative(task.userId, offerId, {
      headlines: bestCreative.headlines,
      descriptions: bestCreative.descriptions,
      keywords: bestCreative.keywords,
      keywordsWithVolume: bestCreative.keywordsWithVolume,
      negativeKeywords: bestCreative.negativeKeywords,
      callouts: bestCreative.callouts,
      sitelinks: bestCreative.sitelinks,
      theme: bestCreative.theme,
      explanation: bestCreative.explanation,
      // 🔧 修复：使用isValidUrl验证final_url，避免"null/"字符串被当作有效URL
      // 确保 final_url 始终为 string 类型
      final_url: (() => {
        if (isValidUrl(offer.final_url)) return offer.final_url!
        if (isValidUrl(offer.url)) return offer.url!
        throw new Error('Offer缺少有效的URL（final_url和url均为无效值）')
      })(),
      final_url_suffix: offer.final_url_suffix || undefined,
      score: bestEvaluation.finalScore,
      score_breakdown: {
        relevance: bestEvaluation.localEvaluation.dimensions.relevance.score,
        quality: bestEvaluation.localEvaluation.dimensions.quality.score,
        engagement: bestEvaluation.localEvaluation.dimensions.completeness.score,
        diversity: bestEvaluation.localEvaluation.dimensions.diversity.score,
        clarity: bestEvaluation.localEvaluation.dimensions.compliance.score,
        // 🔧 修复：添加品牌搜索量和竞争定位维度
        brandSearchVolume: bestEvaluation.localEvaluation.dimensions.brandSearchVolume?.score || 0,
        competitivePositioning: bestEvaluation.localEvaluation.dimensions.competitivePositioning?.score || 0
      },
      generation_round: attempts,
      ai_model: bestCreative.ai_model,
      // 🔧 修复：传递完整的 adStrength 数据，确保刷新后雷达图显示正确
      adStrength: {
        rating: bestEvaluation.finalRating,
        score: bestEvaluation.finalScore,
        isExcellent: bestEvaluation.finalRating === 'EXCELLENT',
        dimensions: bestEvaluation.localEvaluation.dimensions,
        suggestions: bestEvaluation.combinedSuggestions
      },
      // 🆕 v4.10: 关键词桶信息
      keyword_bucket: selectedBucket || undefined,
      keyword_pool_id: keywordPool?.id || undefined,
      bucket_intent: bucketInfo?.intent || undefined
    })

    // 构建完整结果
    const finalResult = {
      success: true,
      creative: {
        id: savedCreative.id,
        headlines: bestCreative.headlines,
        descriptions: bestCreative.descriptions,
        keywords: bestCreative.keywords,
        keywordsWithVolume: bestCreative.keywordsWithVolume,
        negativeKeywords: bestCreative.negativeKeywords,
        callouts: bestCreative.callouts,
        sitelinks: bestCreative.sitelinks,
        theme: bestCreative.theme,
        explanation: bestCreative.explanation,
        headlinesWithMetadata: bestCreative.headlinesWithMetadata,
        descriptionsWithMetadata: bestCreative.descriptionsWithMetadata,
        qualityMetrics: bestCreative.qualityMetrics
      },
      adStrength: {
        rating: bestEvaluation.finalRating,
        score: bestEvaluation.finalScore,
        isExcellent: bestEvaluation.finalRating === 'EXCELLENT',
        dimensions: bestEvaluation.localEvaluation.dimensions,
        suggestions: bestEvaluation.combinedSuggestions
      },
      optimization: {
        attempts,
        targetRating,
        achieved: bestEvaluation.finalRating === targetRating,
        history: retryHistory
      },
      offer: {
        id: offer.id,
        brand: offer.brand,
        url: offer.url,
        affiliateLink: offer.affiliate_link
      }
    }

    // 更新任务为完成状态（带质量警告标记）
    await db.exec(`
      UPDATE creative_tasks
      SET
        status = 'completed',
        stage = 'complete',
        progress = 100,
        message = ?,
        creative_id = ?,
        result = ?,
        optimization_history = ?,
        completed_at = ${nowFunc},
        updated_at = ${nowFunc}
      WHERE id = ?
    `, [
      qualityWarning
        ? `⚠️ 生成完成（质量${bestEvaluation.finalScore}分，建议优化）`
        : '✅ 生成完成',
      savedCreative.id,
      JSON.stringify(finalResult),
      JSON.stringify(retryHistory),
      task.id
    ])

    if (qualityWarning) {
      console.log(`⚠️ 创意生成任务完成（质量警告）: ${task.id} - ${bestEvaluation.finalScore}分`)
    } else {
      console.log(`✅ 创意生成任务完成: ${task.id}`)
    }

    return finalResult
  } catch (error: any) {
    console.error(`❌ 创意生成任务失败: ${task.id}:`, error.message)

    // 🔧 PostgreSQL兼容性：在catch块中也需要使用正确的NOW函数
    const nowFuncErr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    // 更新任务为失败状态
    await db.exec(`
      UPDATE creative_tasks
      SET
        status = 'failed',
        message = ?,
        error = ?,
        completed_at = ${nowFuncErr},
        updated_at = ${nowFuncErr}
      WHERE id = ?
    `, [
      error.message,
      JSON.stringify({ message: error.message, stack: error.stack }),
      task.id
    ])

    throw error
  }
}
