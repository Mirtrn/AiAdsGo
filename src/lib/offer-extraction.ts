/**
 * Offer信息提取触发器
 * 异步提取推广链接的Final URL和品牌名称
 *
 * 用于批量导入时的后台处理，与手动创建的extract流程保持一致
 * 🔥 KISS优化：使用统一的extractOffer核心函数
 * ✨ 支持AI分析：产品分析、评论分析、竞品对比、广告元素提取
 */

import { updateOffer, updateOfferScrapeStatus } from './offers'
import { triggerOfferScraping } from './offer-scraping'
import { normalizeBrandName } from './offer-utils'
import { extractOffer } from './offer-extraction-core'
import { executeAIAnalysis } from './ai-analysis-service'
import { getTargetLanguage } from './offer-utils'

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
    if (aiEnabled) {
      try {
        console.log(`[OfferExtraction] #${offerId} 开始AI分析...`)

        const targetLanguage = getTargetLanguage(tCountry)

        aiAnalysisResult = await executeAIAnalysis({
          extractResult: result.data!,
          targetCountry: tCountry,
          targetLanguage,
          userId: uid,
          enableReviewAnalysis,
          enableCompetitorAnalysis,
          enableAdExtraction,
        })

        console.log(`[OfferExtraction] #${offerId} AI分析完成`)
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
      brand_description: result.data!.productDescription || undefined,
    }

    // 如果有AI分析结果，添加到更新数据中
    if (aiAnalysisResult?.aiAnalysisSuccess && aiAnalysisResult.aiProductInfo) {
      updateData.brand_description = aiAnalysisResult.aiProductInfo.brandDescription || undefined
      updateData.unique_selling_points = aiAnalysisResult.aiProductInfo.uniqueSellingPoints || undefined
      updateData.product_highlights = aiAnalysisResult.aiProductInfo.productHighlights || undefined
      updateData.target_audience = aiAnalysisResult.aiProductInfo.targetAudience || undefined
      updateData.category = aiAnalysisResult.aiProductInfo.category || undefined
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

    updateOffer(offerId, uid, updateData)

    console.log(`[OfferExtraction] #${offerId} Offer记录已更新，品牌名: ${normalizedBrandName}`)

    // ========== 触发后续的数据抓取 ==========
    // 更新状态为 pending，让 scraping 流程继续
    updateOfferScrapeStatus(offerId, uid, 'pending')

    // 触发详细数据抓取
    triggerOfferScraping(
      offerId,
      uid,
      result.data!.finalUrl,
      normalizedBrandName
    )

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
