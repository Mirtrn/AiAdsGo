import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { generateAdCreative } from '@/lib/ad-creative-gen'
import { createAdCreative, type GeneratedAdCreativeData } from '@/lib/ad-creative'
import {
  CREATIVE_BRAND_KEYWORD_RESERVE,
  CREATIVE_KEYWORD_MAX_COUNT,
  selectCreativeKeywords,
} from '@/lib/creative-keyword-selection'
import { getSearchTermFeedbackHints } from '@/lib/search-term-feedback-hints'
import {
  AD_CREATIVE_MAX_AUTO_RETRIES,
  AD_CREATIVE_REQUIRED_MIN_SCORE,
  evaluateCreativeForQuality,
  runCreativeGenerationQualityLoop
} from '@/lib/ad-creative-quality-loop'

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
      maxRetries = AD_CREATIVE_MAX_AUTO_RETRIES,
      targetRating: requestedTargetRating = 'GOOD'
    } = body
    const forcePublishRequested = body?.forcePublish === true || body?.force_publish === true
    const parsedOfferId = parseInt(id, 10)
    const parsedUserId = parseInt(userId, 10)

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(parsedOfferId, parsedUserId)

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

    // 读取近期搜索词反馈（轻量 hard/soft 提示）
    let searchTermFeedbackHints: {
      hardNegativeTerms?: string[]
      softSuppressTerms?: string[]
      highPerformingTerms?: string[]
    } | undefined
    try {
      const hints = await getSearchTermFeedbackHints({
        offerId: parsedOfferId,
        userId: parsedUserId
      })
      searchTermFeedbackHints = {
        hardNegativeTerms: hints.hardNegativeTerms,
        softSuppressTerms: hints.softSuppressTerms,
        highPerformingTerms: hints.highPerformingTerms
      }
      console.log(
        `🔁 搜索词反馈已加载: high=${hints.highPerformingTerms.length}, hard=${hints.hardNegativeTerms.length}, soft=${hints.softSuppressTerms.length}, rows=${hints.sourceRows}`
      )
    } catch (hintError: any) {
      console.warn(`⚠️ 搜索词反馈读取失败，继续默认生成: ${hintError?.message || 'unknown error'}`)
    }

    const normalizedMaxRetries = Math.max(
      0,
      Math.min(
        AD_CREATIVE_MAX_AUTO_RETRIES,
        Number.isFinite(Number(maxRetries)) ? Math.floor(Number(maxRetries)) : AD_CREATIVE_MAX_AUTO_RETRIES
      )
    )
    const enforcedTargetRating = 'GOOD'
    const offerAny = offer as any
    if (String(requestedTargetRating || '').toUpperCase() !== enforcedTargetRating) {
      console.warn(`⚠️ targetRating=${requestedTargetRating} 已忽略，统一使用最低阈值 GOOD`)
    }

    console.log(`🎯 开始生成创意，目标评级: ${enforcedTargetRating}, 自动重试上限: ${normalizedMaxRetries}次`)
    console.log(`📌 生成接口 forcePublish 参数: ${forcePublishRequested ? '已传入（本接口忽略）' : '未传入'}`)
    console.time('⏱️ 总生成耗时')

    let usedKeywords: string[] = []
    const brandKeywords = [String(offer.brand || '').toLowerCase()].filter(Boolean)

    const generationResult = await runCreativeGenerationQualityLoop<GeneratedAdCreativeData>({
      maxRetries: normalizedMaxRetries,
      delayMs: 1000,
      generate: async ({ attempt, retryFailureType }) => {
        const creative = await generateAdCreative(
          parsedOfferId,
          parsedUserId,
          {
            skipCache: attempt > 1,
            excludeKeywords: attempt > 1 ? usedKeywords : undefined,
            retryFailureType,
            searchTermFeedbackHints
          }
        )

        const prioritizedKeywords = selectCreativeKeywords({
          keywords: creative.keywords,
          keywordsWithVolume: creative.keywordsWithVolume as any,
          brandName: offer.brand || '',
          maxKeywords: CREATIVE_KEYWORD_MAX_COUNT,
          brandReserve: CREATIVE_BRAND_KEYWORD_RESERVE,
        })
        creative.keywords = prioritizedKeywords.keywords
        creative.keywordsWithVolume = prioritizedKeywords.keywordsWithVolume as any

        if (creative.keywords && creative.keywords.length > 0) {
          const nonBrandKeywords = creative.keywords.filter(kw => {
            const kwLower = kw.toLowerCase()
            return !brandKeywords.some(brand => kwLower.includes(brand) || brand.includes(kwLower))
          })
          usedKeywords = Array.from(new Set([...usedKeywords, ...nonBrandKeywords]))
        }

        return creative
      },
      evaluate: async (creative) => evaluateCreativeForQuality({
        creative,
        minimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
        adStrengthContext: {
          brandName: offer.brand,
          targetCountry: offer.target_country || 'US',
          targetLanguage: offer.target_language || 'en',
          userId: parsedUserId
        },
        ruleContext: {
          brandName: offer.brand,
          category: offer.category,
          productName: offer.product_name || offerAny.product_title || offerAny.name,
          productTitle: offerAny.product_title || offerAny.title,
          productDescription: offer.brand_description,
          uniqueSellingPoints: offer.unique_selling_points || offer.product_highlights,
          keywords: creative.keywords,
          targetLanguage: offer.target_language || 'en',
          bucket: null
        }
      })
    })

    const attempts = generationResult.attempts
    const bestCreative = generationResult.selectedCreative
    const selectedEvaluation = generationResult.selectedEvaluation
    const bestEvaluation = selectedEvaluation.adStrength
    const finalGateDecision = selectedEvaluation.rsaGate
    const finalRuleGateDecision = selectedEvaluation.ruleGate
    const qualityPassed = selectedEvaluation.passed
    const retryHistory = generationResult.history.map(item => ({
      ...item,
      gatePassed: item.passed,
      gateReasons: item.reasons
    }))

    console.log(`\n🎯 最终结果: ${bestEvaluation.finalRating} (${bestEvaluation.finalScore}分)`)
    console.log(`📊 总尝试次数: ${attempts}次`)
    console.timeEnd('⏱️ 总生成耗时')

    if (!qualityPassed) {
      console.warn(
        `⚠️ 连续重试仍未达到 GOOD 阈值，已按策略保存最佳结果: score=${bestEvaluation.finalScore}, failureType=${selectedEvaluation.failureType}`
      )
    } else {
      console.log(`✅ 创意质量达标: ${bestEvaluation.finalScore}分 ≥ ${AD_CREATIVE_REQUIRED_MIN_SCORE}分 且通过规则门禁`)
    }


    // 保存到数据库
    const savedCreative = await createAdCreative(parsedUserId, parsedOfferId, {
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
        clarity: bestEvaluation.localEvaluation.dimensions.compliance.score,
        brandSearchVolume: bestEvaluation.localEvaluation.dimensions.brandSearchVolume.score,
        competitivePositioning: bestEvaluation.localEvaluation.dimensions.competitivePositioning.score
      },
      generation_round: attempts, // 传入实际的尝试次数
      ai_model: bestCreative.ai_model // 传入实际使用的AI模型
    })

    console.log(`✅ 广告创意已保存到数据库 (ID: ${savedCreative.id})`)

    return NextResponse.json({
      success: true,
      forcePublish: false,
      forcedPublish: false,
      qualityGateBypassed: false,
      forcePublishIgnored: forcePublishRequested,
      finalPublishDecision: {
        status: 'PENDING_LAUNCH_SCORE_CHECK',
        stage: 'campaign_publish',
        hardBlockSource: 'launch_score'
      },
      qualityGate: {
        passed: qualityPassed,
        warning: !qualityPassed,
        reasons: selectedEvaluation.reasons,
        failureType: selectedEvaluation.failureType,
        rsaGatePassed: finalGateDecision.passed,
        ruleGatePassed: finalRuleGateDecision.passed,
        rsaQualityGate: bestEvaluation.rsaQualityGate,
        ruleGate: finalRuleGateDecision
      },
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
        rsaQualityGate: bestEvaluation.rsaQualityGate,
        dimensions: bestEvaluation.localEvaluation.dimensions,
        suggestions: bestEvaluation.combinedSuggestions
      },
      optimization: {
        attempts,
        targetRating: enforcedTargetRating,
        achieved: qualityPassed,
        qualityGatePassed: qualityPassed,
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
