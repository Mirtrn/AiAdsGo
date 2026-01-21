/**
 * Offer信息提取触发器
 * 异步提取推广链接的Final URL和品牌名称
 *
 * 用于批量导入时的后台处理，与手动创建的extract流程保持一致
 * 🔥 KISS优化：使用统一的extractOffer核心函数
 * ✨ 支持AI分析：产品分析、评论分析、竞品对比、广告元素提取
 */

import { updateOffer, updateOfferScrapeStatus } from './offers'
import { triggerOfferScraping, OfferScrapingPriority } from './offer-scraping'
import { normalizeBrandName } from './offer-utils'
import { extractOffer } from './offer-extraction-core'
import { executeAIAnalysis } from './ai-analysis-service'
import { getTargetLanguage } from './offer-utils'
// 【P0优化】导入增强的提取模块
import { extractKeywordsEnhanced } from './enhanced-keyword-extractor'
import { extractProductInfoEnhanced } from './enhanced-product-info-extractor'
import { analyzeReviewsEnhanced } from './enhanced-review-analyzer'
// 【P1优化】导入增强的标题和描述提取器
import { extractHeadlinesAndDescriptionsEnhanced } from './enhanced-headline-description-extractor'
// 【P2优化】导入增强的竞品分析器和本地化适配器
import { analyzeCompetitorsEnhanced } from './enhanced-competitor-analyzer'
import { adaptForLanguageAndRegionEnhanced } from './enhanced-localization-adapter'
// 【P3优化】导入增强的品牌识别器
import { identifyBrandEnhanced } from './enhanced-brand-identifier'

export interface OfferExtractionOptions {
  offerId: number
  userId: number
  affiliateLink: string
  targetCountry: string
  enableAI?: boolean  // 是否启用AI分析（默认false）
  enableReviewAnalysis?: boolean  // 是否启用评论分析（默认true）
  enableCompetitorAnalysis?: boolean  // 是否启用竞品分析（默认true）
  enableAdExtraction?: boolean  // 是否启用广告元素提取（默认true）
}

/**
 * 触发Offer信息提取（异步，不阻塞）
 *
 * 流程：
 * 1. 解析推广链接获取Final URL
 * 2. 抓取网页识别品牌名称
 * 3. （可选）AI分析：产品分析、评论分析、竞品对比、广告元素提取
 * 4. 更新Offer记录
 * 5. 触发后续的数据抓取（scraping）
 *
 * @param options - 提取选项
 */
export async function triggerOfferExtraction(
  options: OfferExtractionOptions
): Promise<void>
export async function triggerOfferExtraction(
  offerId: number,
  userId: number,
  affiliateLink: string,
  targetCountry: string,
  enableAI?: boolean
): Promise<void>
export async function triggerOfferExtraction(
  optionsOrOfferId: OfferExtractionOptions | number,
  userId?: number,
  affiliateLink?: string,
  targetCountry?: string,
  enableAI?: boolean
): Promise<void> {
  // 参数归一化
  let options: OfferExtractionOptions
  if (typeof optionsOrOfferId === 'object') {
    options = optionsOrOfferId
  } else {
    options = {
      offerId: optionsOrOfferId,
      userId: userId!,
      affiliateLink: affiliateLink!,
      targetCountry: targetCountry!,
      enableAI: enableAI || false,
    }
  }

  const {
    offerId,
    userId: uid,
    affiliateLink: aLink,
    targetCountry: tCountry,
    enableAI: aiEnabled = false,
    enableReviewAnalysis = true,
    enableCompetitorAnalysis = true,
    enableAdExtraction = true,
  } = options

  console.log(`[OfferExtraction] 开始异步提取 Offer #${offerId}${aiEnabled ? ' (启用AI分析)' : ''}`)

  try {
    // 更新状态为 in_progress
    updateOfferScrapeStatus(offerId, uid, 'in_progress')

    // 🔥 KISS优化：调用统一的核心提取函数
    const result = await extractOffer({
      affiliateLink: aLink,
      targetCountry: tCountry,
      userId: uid,
      skipCache: false, // 批量导入允许使用缓存（与旧逻辑一致）
      batchMode: false, // 非批量模式，允许正常重试
    })

    if (!result.success) {
      throw new Error(result.error?.message || '提取失败')
    }

    console.log(`[OfferExtraction] #${offerId} 提取完成: ${result.data!.finalUrl}`)

    // 规范化品牌名称（首字母大写）
    const normalizedBrandName = result.data!.brand
      ? normalizeBrandName(result.data!.brand)
      : `Offer_${offerId}`

    // ========== AI分析（可选）==========
    let aiAnalysisResult = null
    // 【P0优化】增强的提取结果
    let enhancedKeywords = null
    let enhancedProductInfo = null
    let enhancedReviewAnalysis = null
    let extractionQualityScore = 0
    // 【P1优化】增强的标题和描述
    let enhancedHeadlines: any = null
    let enhancedDescriptions: any = null
    // 【P2优化】竞品分析和本地化适配
    let competitorAnalysis: any = null
    let localizationAdapt: any = null
    // 【P3优化】品牌识别
    let brandAnalysis: any = null

    if (aiEnabled) {
      try {
        console.log(`[OfferExtraction] #${offerId} 开始AI分析...`)
        const startTime = Date.now()

        const targetLanguage = getTargetLanguage(tCountry)

        // ========== 阶段1: 基础AI分析（必须先执行）==========
        const phase1Start = Date.now()
        aiAnalysisResult = await executeAIAnalysis({
          extractResult: result.data!,
          targetCountry: tCountry,
          targetLanguage,
          userId: uid,
          enableReviewAnalysis,
          enableCompetitorAnalysis,
          enableAdExtraction,
        })
        const phase1Duration = ((Date.now() - phase1Start) / 1000).toFixed(2)
        console.log(`[OfferExtraction] #${offerId} ✅ 阶段1完成: 基础AI分析 (${phase1Duration}s)`)

        // ========== 阶段2: 并行执行所有增强分析 ==========
        const phase2Start = Date.now()
        console.log(`[OfferExtraction] #${offerId} 🚀 开始阶段2: 6个增强分析并行执行...`)

        const [
          keywordsResult,
          productInfoResult,
          reviewAnalysisResult,
          headlineDescResult,
          competitorResult,
          brandResult
        ] = await Promise.allSettled([
          // P0-1: 增强关键词提取
          extractKeywordsEnhanced({
            productName: result.data!.productName || normalizedBrandName,
            brandName: normalizedBrandName,
            category: aiAnalysisResult?.aiProductInfo?.category || 'General',
            description: result.data!.productDescription || '',
            features: aiAnalysisResult?.aiProductInfo?.productHighlights?.split(',').map(f => f.trim()) || [],
            useCases: [],
            targetAudience: aiAnalysisResult?.aiProductInfo?.targetAudience || '',
            competitors: [],
            targetCountry: tCountry,
            targetLanguage,
          }, uid),

          // P0-2: 增强产品信息提取
          extractProductInfoEnhanced({
            url: result.data!.finalUrl,
            pageTitle: result.data!.pageTitle || '',
            pageDescription: result.data!.productDescription || '',
            pageText: result.data!.productDescription || '',
            pageData: result.data!,
            targetCountry: tCountry,
            targetLanguage,
          }, uid),

          // P0-3: 增强评论分析
          analyzeReviewsEnhanced(
            (result.data as any)?.reviews || [],
            targetLanguage,
            uid
          ),

          // P1: 增强标题和描述提取
          extractHeadlinesAndDescriptionsEnhanced({
            productName: result.data!.productName || normalizedBrandName,
            brandName: normalizedBrandName,
            category: aiAnalysisResult?.aiProductInfo?.category || 'General',
            description: result.data!.productDescription || '',
            features: aiAnalysisResult?.aiProductInfo?.productHighlights?.split(',').map(f => f.trim()) || [],
            useCases: [],
            targetAudience: aiAnalysisResult?.aiProductInfo?.targetAudience || '',
            pricing: { current: 99.99 },
            reviews: (result.data as any)?.reviews || [],
            competitors: [],
            targetLanguage,
          }, uid),

          // P2-1: 增强竞品分析
          analyzeCompetitorsEnhanced({
            productName: result.data!.productName || normalizedBrandName,
            brandName: normalizedBrandName,
            category: aiAnalysisResult?.aiProductInfo?.category || 'General',
            description: result.data!.productDescription || '',
            features: aiAnalysisResult?.aiProductInfo?.productHighlights?.split(',').map(f => f.trim()) || [],
            pricing: { current: 99.99 },
            rating: 4.5,
            reviewCount: 1000,
            targetCountry: tCountry,
            targetLanguage,
          }, uid),

          // P3: 品牌识别
          identifyBrandEnhanced({
            brandName: normalizedBrandName,
            website: result.data!.finalUrl,
            description: result.data!.productDescription || '',
            products: [result.data!.productName || 'Product'],
            targetAudience: aiAnalysisResult?.aiProductInfo?.targetAudience || '',
            competitors: [],
            marketPosition: 'Mid-market',
            targetCountry: tCountry,
            targetLanguage,
          }, uid)
        ])

        const phase2Duration = ((Date.now() - phase2Start) / 1000).toFixed(2)
        console.log(`[OfferExtraction] #${offerId} ✅ 阶段2完成: 并行增强分析 (${phase2Duration}s)`)

        // 处理并行结果
        if (keywordsResult.status === 'fulfilled') {
          enhancedKeywords = keywordsResult.value
          console.log(`[OfferExtraction] #${offerId}   ✓ 增强关键词: ${enhancedKeywords?.length || 0}个`)
        } else {
          console.warn(`[OfferExtraction] #${offerId}   ✗ 增强关键词失败:`, keywordsResult.reason?.message)
        }

        if (productInfoResult.status === 'fulfilled') {
          enhancedProductInfo = productInfoResult.value
          console.log(`[OfferExtraction] #${offerId}   ✓ 增强产品信息`)
        } else {
          console.warn(`[OfferExtraction] #${offerId}   ✗ 增强产品信息失败:`, productInfoResult.reason?.message)
        }

        if (reviewAnalysisResult.status === 'fulfilled') {
          enhancedReviewAnalysis = reviewAnalysisResult.value
          console.log(`[OfferExtraction] #${offerId}   ✓ 增强评论分析`)
        } else {
          console.warn(`[OfferExtraction] #${offerId}   ✗ 增强评论分析失败:`, reviewAnalysisResult.reason?.message)
        }

        if (headlineDescResult.status === 'fulfilled') {
          const { headlines, descriptions } = headlineDescResult.value
          enhancedHeadlines = headlines
          enhancedDescriptions = descriptions
          console.log(`[OfferExtraction] #${offerId}   ✓ 增强标题描述: ${headlines.length}个标题, ${descriptions.length}个描述`)
        } else {
          console.warn(`[OfferExtraction] #${offerId}   ✗ 增强标题描述失败:`, headlineDescResult.reason?.message)
        }

        if (competitorResult.status === 'fulfilled') {
          competitorAnalysis = competitorResult.value
          console.log(`[OfferExtraction] #${offerId}   ✓ 增强竞品分析`)
        } else {
          console.warn(`[OfferExtraction] #${offerId}   ✗ 增强竞品分析失败:`, competitorResult.reason?.message)
        }

        if (brandResult.status === 'fulfilled') {
          brandAnalysis = brandResult.value
          console.log(`[OfferExtraction] #${offerId}   ✓ 品牌识别`)
        } else {
          console.warn(`[OfferExtraction] #${offerId}   ✗ 品牌识别失败:`, brandResult.reason?.message)
        }

        // ========== 阶段3: 本地化适配（依赖关键词）==========
        if (enhancedKeywords) {
          const phase3Start = Date.now()
          try {
            localizationAdapt = await adaptForLanguageAndRegionEnhanced({
              productName: result.data!.productName || normalizedBrandName,
              brandName: normalizedBrandName,
              category: aiAnalysisResult?.aiProductInfo?.category || 'General',
              description: result.data!.productDescription || '',
              keywords: enhancedKeywords?.map(k => k.keyword) || [],
              basePrice: 99.99,
              targetCountry: tCountry,
              targetLanguage,
            }, uid)
            const phase3Duration = ((Date.now() - phase3Start) / 1000).toFixed(2)
            console.log(`[OfferExtraction] #${offerId} ✅ 阶段3完成: 本地化适配 (${phase3Duration}s)`)
          } catch (localizationError: any) {
            console.warn(`[OfferExtraction] #${offerId} 阶段3失败: 本地化适配 -`, localizationError.message)
          }
        }

        // 计算提取质量评分
        if (enhancedKeywords || enhancedProductInfo || enhancedReviewAnalysis) {
          extractionQualityScore = calculateExtractionQualityScore({
            keywords: enhancedKeywords,
            productInfo: enhancedProductInfo,
            reviewAnalysis: enhancedReviewAnalysis,
          })
          console.log(`[OfferExtraction] #${offerId} 📊 提取质量评分: ${extractionQualityScore}/100`)
        }

        const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2)
        console.log(`[OfferExtraction] #${offerId} 🎉 AI分析全部完成！总耗时: ${totalDuration}s`)

      } catch (aiError: any) {
        console.error(`[OfferExtraction] #${offerId} AI分析失败（不影响主流程）:`, aiError.message)
      }
    }

    // ========== 更新Offer记录 ==========
    const updateData: any = {
      url: result.data!.finalUrl,
      brand: normalizedBrandName,
      final_url: result.data!.finalUrl,
      final_url_suffix: result.data!.finalUrlSuffix,
      // 🔥 注意：不直接使用 productDescription 作为 brand_description
      // 等待 AI 分析将其转换为合理的品牌描述
    }

    // 如果有AI分析结果，添加到更新数据中
    if (aiAnalysisResult?.aiAnalysisSuccess && aiAnalysisResult.aiProductInfo) {
      updateData.brand_description = aiAnalysisResult.aiProductInfo.brandDescription || undefined
      updateData.unique_selling_points = aiAnalysisResult.aiProductInfo.uniqueSellingPoints || undefined
      updateData.product_highlights = aiAnalysisResult.aiProductInfo.productHighlights || undefined
      updateData.target_audience = aiAnalysisResult.aiProductInfo.targetAudience || undefined
      updateData.category = aiAnalysisResult.aiProductInfo.category || undefined
    }

    // 🎯 P0优化（2025-12-07）：保存AI返回的完整数据
    if (aiAnalysisResult?.aiProductInfo) {
      const productInfo = aiAnalysisResult.aiProductInfo

      // 保存AI评论洞察（新增字段）
      if (productInfo.reviews) {
        updateData.ai_reviews = JSON.stringify(productInfo.reviews)
        console.log(`[OfferExtraction] #${offerId} 💾 保存AI评论洞察: rating=${productInfo.reviews.rating}, sentiment=${productInfo.reviews.sentiment}`)
      }

      // 保存AI竞争优势（新增字段）
      if (productInfo.competitiveEdges) {
        updateData.ai_competitive_edges = JSON.stringify(productInfo.competitiveEdges)
        console.log(`[OfferExtraction] #${offerId} 💾 保存AI竞争优势: badges=${productInfo.competitiveEdges.badges?.length || 0}`)
      }

      // 保存AI关键词（新增字段）
      if (productInfo.keywords && productInfo.keywords.length > 0) {
        updateData.ai_keywords = JSON.stringify(productInfo.keywords)
        console.log(`[OfferExtraction] #${offerId} 💾 保存AI关键词: ${productInfo.keywords.length}个`)
      }

      // 保存AI定价信息（复用existing pricing字段）
      if (productInfo.pricing) {
        updateData.pricing = JSON.stringify(productInfo.pricing)
        console.log(`[OfferExtraction] #${offerId} 💾 保存AI定价: ${productInfo.pricing.current}, competitiveness=${productInfo.pricing.competitiveness}`)
      }

      // 保存AI促销信息（复用existing promotions字段）
      if (productInfo.promotions) {
        updateData.promotions = JSON.stringify(productInfo.promotions)
        console.log(`[OfferExtraction] #${offerId} 💾 保存AI促销: active=${productInfo.promotions.active}, types=${productInfo.promotions.types?.length || 0}`)
      }

      // 🎯 v3.2优化（2025-12-08）：保存店铺/单品差异化分析字段
      const v32AnalysisData: Record<string, any> = {}

      // 店铺分析专用字段
      if (productInfo.storeQualityLevel) {
        v32AnalysisData.storeQualityLevel = productInfo.storeQualityLevel
      }
      if (productInfo.categoryDiversification) {
        v32AnalysisData.categoryDiversification = productInfo.categoryDiversification
      }
      if (productInfo.hotInsights) {
        v32AnalysisData.hotInsights = productInfo.hotInsights
      }

      // 单品分析专用字段
      if (productInfo.marketFit) {
        v32AnalysisData.marketFit = productInfo.marketFit
      }
      if (productInfo.credibilityLevel) {
        v32AnalysisData.credibilityLevel = productInfo.credibilityLevel
      }
      if (productInfo.categoryPosition) {
        v32AnalysisData.categoryPosition = productInfo.categoryPosition
      }

      // 页面类型
      if (productInfo.pageType) {
        updateData.page_type = productInfo.pageType
        v32AnalysisData.pageType = productInfo.pageType
      }

      // 如果有v3.2数据，保存到专用列
      if (Object.keys(v32AnalysisData).length > 0) {
        updateData.ai_analysis_v32 = JSON.stringify(v32AnalysisData)
        console.log(`[OfferExtraction] #${offerId} 💾 保存v3.2分析: pageType=${v32AnalysisData.pageType || 'unknown'}, fields=${Object.keys(v32AnalysisData).join(',')}`)
      }
    }

    // 保存评论分析结果（如果有）
    if (aiAnalysisResult?.reviewAnalysisSuccess && aiAnalysisResult.reviewAnalysis) {
      updateData.review_analysis = JSON.stringify(aiAnalysisResult.reviewAnalysis)
    }

    // 保存竞品分析结果（如果有）
    if (aiAnalysisResult?.competitorAnalysisSuccess && aiAnalysisResult.competitorAnalysis) {
      updateData.competitor_analysis = JSON.stringify(aiAnalysisResult.competitorAnalysis)
    }

    // 保存广告元素（如果有）
    if (aiAnalysisResult?.adExtractionSuccess) {
      updateData.extracted_keywords = JSON.stringify(aiAnalysisResult.extractedKeywords)
      updateData.extracted_headlines = JSON.stringify(aiAnalysisResult.extractedHeadlines)
      updateData.extracted_descriptions = JSON.stringify(aiAnalysisResult.extractedDescriptions)
    }

    // 【P0优化】保存增强的提取结果
    if (enhancedKeywords) {
      updateData.enhanced_keywords = JSON.stringify(enhancedKeywords)
    }
    if (enhancedProductInfo) {
      updateData.enhanced_product_info = JSON.stringify(enhancedProductInfo)
    }
    if (enhancedReviewAnalysis) {
      updateData.enhanced_review_analysis = JSON.stringify(enhancedReviewAnalysis)
    }
    if (extractionQualityScore > 0) {
      updateData.extraction_quality_score = extractionQualityScore
      updateData.extraction_enhanced_at = new Date().toISOString()
    }

    // 【P1优化】保存增强的标题和描述
    if (enhancedHeadlines) {
      updateData.enhanced_headlines = JSON.stringify(enhancedHeadlines)
    }
    if (enhancedDescriptions) {
      updateData.enhanced_descriptions = JSON.stringify(enhancedDescriptions)
    }

    // 【P2优化】保存竞品分析和本地化适配结果
    if (competitorAnalysis) {
      updateData.competitor_analysis = JSON.stringify(competitorAnalysis)
    }
    if (localizationAdapt) {
      updateData.localization_adapt = JSON.stringify(localizationAdapt)
    }

    // 【P3优化】保存品牌识别结果
    if (brandAnalysis) {
      updateData.brand_analysis = JSON.stringify(brandAnalysis)
    }

    updateOffer(offerId, uid, updateData)

    console.log(`[OfferExtraction] #${offerId} Offer记录已更新，品牌名: ${normalizedBrandName}`)

    // ========== 触发后续的数据抓取 ==========
    // 更新状态为 pending，让 scraping 流程继续
    updateOfferScrapeStatus(offerId, uid, 'pending')

    // 触发详细数据抓取（使用默认 NORMAL 优先级）
    // 🔥 新队列系统：异步调用，不阻塞提取流程
    triggerOfferScraping(
      offerId,
      uid,
      result.data!.finalUrl,
      normalizedBrandName,
      tCountry,
      OfferScrapingPriority.NORMAL
    ).catch(error => {
      console.error(`[OfferExtraction] 触发抓取失败 Offer #${offerId}:`, error.message)
    })

    console.log(`[OfferExtraction] #${offerId} 已触发后续数据抓取`)

  } catch (error: any) {
    console.error(`[OfferExtraction] #${offerId} 提取失败:`, error)

    // 更新状态为失败
    updateOfferScrapeStatus(offerId, uid, 'failed', error.message)

    // 即使提取失败，也尝试更新品牌名称为可识别的值
    try {
      updateOffer(offerId, uid, {
        brand: `提取失败_${offerId}`,
      })
    } catch (updateError) {
      console.error(`[OfferExtraction] #${offerId} 更新失败状态时出错:`, updateError)
    }
  }
}

/**
 * 【P0优化】计算提取质量评分
 * 基于增强的关键词、产品信息和评论分析的质量来计算总体评分
 */
function calculateExtractionQualityScore(data: {
  keywords: any
  productInfo: any
  reviewAnalysis: any
}): number {
  let score = 0
  let components = 0

  // 关键词质量评分（最多30分）
  if (data.keywords && Array.isArray(data.keywords)) {
    const keywordScore = Math.min(30, data.keywords.length * 1.5)
    score += keywordScore
    components++
  }

  // 产品信息质量评分（最多35分）
  if (data.productInfo) {
    let productScore = 0
    if (data.productInfo.name) productScore += 5
    if (data.productInfo.category) productScore += 5
    if (data.productInfo.description) productScore += 5
    if (data.productInfo.features) productScore += 5
    if (data.productInfo.specifications) productScore += 5
    // ❌ 已删除 pricing 字段检查（2025-12-04）
    if (data.productInfo.socialProof) productScore += 5
    score += Math.min(35, productScore)
    components++
  }

  // 评论分析质量评分（最多35分）
  if (data.reviewAnalysis) {
    let reviewScore = 0
    if (data.reviewAnalysis.sentiment) reviewScore += 5
    if (data.reviewAnalysis.keywords) reviewScore += 5
    if (data.reviewAnalysis.buyingReasons) reviewScore += 5
    if (data.reviewAnalysis.useCases) reviewScore += 5
    if (data.reviewAnalysis.painPoints) reviewScore += 5
    if (data.reviewAnalysis.userPersona) reviewScore += 5
    if (data.reviewAnalysis.competitorComparison) reviewScore += 5
    score += Math.min(35, reviewScore)
    components++
  }

  // 如果没有任何数据，返回0
  if (components === 0) {
    return 0
  }

  // 返回加权平均分
  return Math.round(score / components * 100 / 100 * 100) / 100
}
