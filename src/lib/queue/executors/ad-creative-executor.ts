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
  evaluateCreativeAdStrength,
  calculateLaunchScore
} from '@/lib/scoring'
import { findOfferById } from '@/lib/offers'
import { getDatabase } from '@/lib/db'

/**
 * 广告创意生成任务数据接口
 */
export interface AdCreativeTaskData {
  offerId: number
  maxRetries?: number
  targetRating?: 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'POOR'
}

/**
 * 广告创意生成任务执行器
 */
export async function executeAdCreativeGeneration(
  task: Task<AdCreativeTaskData>
): Promise<any> {
  const { offerId, maxRetries = 3, targetRating = 'EXCELLENT' } = task.data
  const db = getDatabase()

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

    let bestCreative: any = null
    let bestEvaluation: any = null
    let attempts = 0
    let retryHistory: Array<{
      attempt: number
      rating: string
      score: number
      suggestions: string[]
    }> = []

    let usedKeywords: string[] = []
    const brandKeywords = [offer.brand.toLowerCase()]

    // 多轮生成循环
    while (attempts < maxRetries) {
      attempts++
      const attemptBaseProgress = 10 + (attempts - 1) * 25

      // 更新进度：生成中
      await db.exec(`
        UPDATE creative_tasks
        SET stage = 'generating', progress = ?, message = ?, current_attempt = ?, updated_at = ${nowFunc}
        WHERE id = ?
      `, [attemptBaseProgress, `第${attempts}次生成: AI正在创作广告文案...`, attempts, task.id])

      // 1. 生成创意
      // 🔥 2025-12-12修复：始终跳过缓存，确保每次重新生成都产生新创意
      // 用户点击"重新生成"时期望获得不同的创意，不应使用缓存
      const creative = await generateAdCreative(
        offerId,
        task.userId,
        {
          skipCache: true,  // 始终跳过缓存
          excludeKeywords: attempts > 1 ? usedKeywords : undefined
        }
      )

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
      if (!bestEvaluation || evaluation.finalScore > bestEvaluation.finalScore) {
        bestCreative = creative
        bestEvaluation = evaluation
      }

      // 收集已使用关键词
      if (creative.keywords && creative.keywords.length > 0) {
        const nonBrandKeywords = creative.keywords.filter(kw => {
          const kwLower = kw.toLowerCase()
          return !brandKeywords.some(brand => kwLower.includes(brand) || brand.includes(kwLower))
        })
        usedKeywords = Array.from(new Set([...usedKeywords, ...nonBrandKeywords]))
      }

      // 检查是否达到目标
      if (evaluation.finalRating === targetRating) {
        break
      }

      if (attempts < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    // 检查最终结果
    if (!bestCreative || !bestEvaluation) {
      throw new Error('生成创意失败')
    }

    // 质量门检查
    const MINIMUM_SCORE = 70
    if (bestEvaluation.finalScore < MINIMUM_SCORE) {
      throw new Error(`创意质量未达标（${bestEvaluation.finalScore}分）`)
    }

    // 更新进度：保存中
    await db.exec(`
      UPDATE creative_tasks
      SET stage = 'saving', progress = 85, message = '正在保存创意到数据库...', updated_at = ${nowFunc}
      WHERE id = ?
    `, [task.id])

    // 保存到数据库
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
      final_url: offer.final_url || offer.url,
      final_url_suffix: offer.final_url_suffix || undefined,
      score: bestEvaluation.finalScore,
      score_breakdown: {
        relevance: bestEvaluation.localEvaluation.dimensions.relevance.score,
        quality: bestEvaluation.localEvaluation.dimensions.quality.score,
        engagement: bestEvaluation.localEvaluation.dimensions.completeness.score,
        diversity: bestEvaluation.localEvaluation.dimensions.diversity.score,
        clarity: bestEvaluation.localEvaluation.dimensions.compliance.score
      },
      generation_round: attempts,
      ai_model: bestCreative.ai_model
    })

    // 计算Launch Score
    const launchScore = await calculateLaunchScore(
      offer,
      savedCreative,
      task.userId
    )

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
      },
      launchScore: {
        score: launchScore.totalScore,
        analysis: launchScore.analysis,
        recommendations: launchScore.recommendations
      }
    }

    // 更新任务为完成状态
    await db.exec(`
      UPDATE creative_tasks
      SET
        status = 'completed',
        stage = 'complete',
        progress = 100,
        message = '生成完成',
        creative_id = ?,
        result = ?,
        optimization_history = ?,
        completed_at = ${nowFunc},
        updated_at = ${nowFunc}
      WHERE id = ?
    `, [savedCreative.id, JSON.stringify(finalResult), JSON.stringify(retryHistory), task.id])

    console.log(`✅ 创意生成任务完成: ${task.id}`)

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
