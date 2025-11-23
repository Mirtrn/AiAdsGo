import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { generateAdCreative } from '@/lib/ad-creative-generator'
import { createAdCreative, type GeneratedAdCreativeData } from '@/lib/ad-creative'
import {
  evaluateCreativeAdStrength,
  type ComprehensiveAdStrengthResult
} from '@/lib/scoring'

/**
 * POST /api/offers/:id/generate-creatives
 * 为指定Offer生成AI创意（支持自动重试优化到EXCELLENT）
 *
 * 新增功能：
 * 1. 使用EXCELLENT标准的优化Prompt
 * 2. 自动评估Ad Strength
 * 3. 如果未达到EXCELLENT，自动重试（最多3次）
 * 4. 返回最佳结果
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const {
      maxRetries = 3, // 最大重试次数
      targetRating = 'EXCELLENT' // 目标评级
    } = body

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 验证Offer已完成抓取
    if (offer.scrape_status === 'failed') {
      return NextResponse.json(
        {
          error: 'Offer信息抓取失败，请重新抓取',
        },
        { status: 400 }
      )
    }

    console.log(`🎯 开始生成创意，目标评级: ${targetRating}, 最大重试: ${maxRetries}次`)
    console.time('⏱️ 总生成耗时')

    // 生成创意的核心函数（支持反馈优化）
    let bestCreative: GeneratedAdCreativeData | null = null
    let bestEvaluation: ComprehensiveAdStrengthResult | null = null
    let attempts = 0
    let retryHistory: Array<{
      attempt: number
      rating: string
      score: number
      suggestions: string[]
    }> = []

    // 关键词去重：收集已使用的非品牌关键词
    let usedKeywords: string[] = []
    const brandKeywords = [offer.brand.toLowerCase()] // 品牌词列表（可以重复）

    while (attempts < maxRetries) {
      attempts++
      console.log(`\n📝 第${attempts}次生成尝试...`)
      console.time(`⏱️ 第${attempts}次尝试耗时`)

      // 1. 生成创意（使用优化后的Prompt + 关键词去重）
      const creative = await generateAdCreative(
        parseInt(id, 10),
        parseInt(userId, 10),
        {
          skipCache: attempts > 1, // 第2次及以后跳过缓存，强制重新生成
          excludeKeywords: attempts > 1 ? usedKeywords : undefined // 第2次及以后传递已使用的关键词
        }
      )

      // 2. 检查是否有带metadata的资产
      const hasMetadata = creative.headlinesWithMetadata && creative.descriptionsWithMetadata

      if (!hasMetadata) {
        console.warn('⚠️ 创意缺少metadata，使用基础格式')
        // 转换为基础格式
        const headlinesWithMetadata = creative.headlines.map(text => ({
          text,
          length: text.length
        }))
        const descriptionsWithMetadata = creative.descriptions.map(text => ({
          text,
          length: text.length
        }))

        creative.headlinesWithMetadata = headlinesWithMetadata
        creative.descriptionsWithMetadata = descriptionsWithMetadata
      }

      // 3. 评估Ad Strength（传入品牌信息用于品牌搜索量维度）
      const evaluation = await evaluateCreativeAdStrength(
        creative.headlinesWithMetadata!,
        creative.descriptionsWithMetadata!,
        creative.keywords,
        {
          brandName: offer.brand,
          targetCountry: offer.target_country || 'US',
          targetLanguage: offer.target_language || 'en',
          userId
        }
      )

      console.log(`📊 评估结果: ${evaluation.finalRating} (${evaluation.finalScore}分)`)
      console.timeEnd(`⏱️ 第${attempts}次尝试耗时`)

      // 记录历史
      retryHistory.push({
        attempt: attempts,
        rating: evaluation.finalRating,
        score: evaluation.finalScore,
        suggestions: evaluation.combinedSuggestions
      })

      // 4. 如果是第一次，或者分数更高，更新最佳结果
      if (!bestEvaluation || evaluation.finalScore > bestEvaluation.finalScore) {
        bestCreative = creative
        bestEvaluation = evaluation
        console.log(`✅ 更新最佳结果: ${evaluation.finalRating} (${evaluation.finalScore}分)`)
      }

      // 4.1 收集当前创意的非品牌关键词（用于下次生成时避免重复）
      if (creative.keywords && creative.keywords.length > 0) {
        const nonBrandKeywords = creative.keywords.filter(kw => {
          const kwLower = kw.toLowerCase()
          // 排除品牌词（品牌名或包含品牌名的关键词）
          return !brandKeywords.some(brand => kwLower.includes(brand) || brand.includes(kwLower))
        })

        // 添加到已使用关键词列表（去重）
        usedKeywords = Array.from(new Set([...usedKeywords, ...nonBrandKeywords]))

        console.log(`📝 已收集 ${nonBrandKeywords.length} 个非品牌关键词（总计 ${usedKeywords.length} 个）`)
        if (usedKeywords.length > 0) {
          console.log(`   已使用关键词: ${usedKeywords.slice(0, 5).join(', ')}${usedKeywords.length > 5 ? '...' : ''}`)
        }
      }

      // 5. 如果达到目标评级，停止重试
      if (evaluation.finalRating === targetRating) {
        console.log(`🎉 达到目标评级 ${targetRating}，停止重试`)
        break
      }

      // 6. 如果还没达到最大重试次数，准备下一次重试
      if (attempts < maxRetries) {
        console.log(`💡 未达到${targetRating}，准备第${attempts + 1}次重试...`)
        console.log(`📋 改进建议:`)
        evaluation.combinedSuggestions.slice(0, 5).forEach(suggestion => {
          console.log(`   - ${suggestion}`)
        })

        // 等待1秒后重试（避免API rate limit）
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    // 7. 保存到数据库并返回最佳结果
    if (!bestCreative || !bestEvaluation) {
      throw new Error('生成创意失败')
    }

    console.log(`\n🎯 最终结果: ${bestEvaluation.finalRating} (${bestEvaluation.finalScore}分)`)
    console.log(`📊 总尝试次数: ${attempts}次`)
    console.timeEnd('⏱️ 总生成耗时')

    // 保存到数据库
    const savedCreative = createAdCreative(parseInt(userId, 10), parseInt(id, 10), {
      headlines: bestCreative.headlines,
      descriptions: bestCreative.descriptions,
      keywords: bestCreative.keywords,
      keywordsWithVolume: bestCreative.keywordsWithVolume,
      callouts: bestCreative.callouts,
      sitelinks: bestCreative.sitelinks,
      theme: bestCreative.theme,
      explanation: bestCreative.explanation,
      final_url: offer.final_url || offer.url,
      final_url_suffix: offer.final_url_suffix || undefined,
      // 传入Ad Strength评估的分数（而不是让createAdCreative重新计算）
      score: bestEvaluation.finalScore,
      score_breakdown: {
        relevance: bestEvaluation.localEvaluation.dimensions.relevance.score,
        quality: bestEvaluation.localEvaluation.dimensions.quality.score,
        engagement: bestEvaluation.localEvaluation.dimensions.completeness.score,
        diversity: bestEvaluation.localEvaluation.dimensions.diversity.score,
        clarity: bestEvaluation.localEvaluation.dimensions.compliance.score
      },
      generation_round: attempts // 传入实际的尝试次数
    })

    console.log(`✅ 广告创意已保存到数据库 (ID: ${savedCreative.id})`)

    return NextResponse.json({
      success: true,
      creative: {
        id: savedCreative.id,
        headlines: bestCreative.headlines,
        descriptions: bestCreative.descriptions,
        keywords: bestCreative.keywords,
        keywordsWithVolume: bestCreative.keywordsWithVolume,
        callouts: bestCreative.callouts,
        sitelinks: bestCreative.sitelinks,
        theme: bestCreative.theme,
        explanation: bestCreative.explanation,

        // Ad Strength元数据
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
    })
  } catch (error: any) {
    console.error('生成创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '生成创意失败',
      },
      { status: 500 }
    )
  }
}
