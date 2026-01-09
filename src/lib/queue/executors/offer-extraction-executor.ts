/**
 * Offer提取任务执行器
 *
 * 功能：
 * 1. 调用核心extractOffer函数
 * 2. 将进度更新到offer_tasks表
 * 3. 支持SSE实时推送（通过数据库轮询）
 */

import type { Task } from '../types'
import { extractOffer } from '@/lib/offer-extraction-core'
import { getDatabase } from '@/lib/db'
import { executeAIAnalysis } from '@/lib/ai-analysis-service'
import { getTargetLanguage } from '@/lib/offer-utils'
import { createOffer, updateOfferScrapeStatus } from '@/lib/offers'
import type { BrandSearchSupplement, SerpSitelink } from '@/lib/google-brand-search'

function mergeUniqueStrings(primary: string[] | null | undefined, secondary: string[] | null | undefined, limit: number): string[] | null {
  const out: string[] = []
  const seen = new Set<string>()
  for (const list of [primary, secondary]) {
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      if (typeof raw !== 'string') continue
      const v = raw.trim()
      if (!v) continue
      const key = v.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(v)
      if (out.length >= limit) return out
    }
  }
  return out.length > 0 ? out : null
}

function mergeUniqueSitelinks(primary: SerpSitelink[] | null | undefined, secondary: SerpSitelink[] | null | undefined, limit: number): SerpSitelink[] | null {
  const out: SerpSitelink[] = []
  const seen = new Set<string>()
  for (const list of [primary, secondary]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const text = item?.text?.trim()
      if (!text) continue
      const description = item?.description?.trim() || undefined
      const key = `${text.toLowerCase()}__${(description || '').toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text, description })
      if (out.length >= limit) return out
    }
  }
  return out.length > 0 ? out : null
}

/**
 * Offer提取任务数据接口
 */
export interface OfferExtractionTaskData {
  affiliateLink: string
  targetCountry: string
  skipCache?: boolean
  skipWarmup?: boolean
  // 🔥 新增：产品价格和佣金比例（用于批量上传创建Offer）
  productPrice?: string
  commissionPayout?: string
  // 🔥 新增：用户手动输入的品牌名（独立站Google搜索补充用）
  brandName?: string
}

/**
 * Offer提取任务执行器
 */
export async function executeOfferExtraction(
  task: Task<OfferExtractionTaskData>
): Promise<any> {
  const { affiliateLink, targetCountry, skipCache = false, skipWarmup = false, productPrice, commissionPayout, brandName } = task.data
  const db = getDatabase()

  // 🔥 2025-12-12调试：记录task.data中的targetCountry
  console.log(`📋 executeOfferExtraction: task.id=${task.id}, targetCountry="${targetCountry}", task.data=${JSON.stringify(task.data)}`)

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  try {
    // 更新任务状态为运行中
    await db.exec(`
      UPDATE offer_tasks
      SET status = 'running', started_at = ${nowFunc}, message = '开始提取Offer信息'
      WHERE id = ?
    `, [task.id])

    console.log(`🚀 开始执行Offer提取任务: ${task.id}`)

    // 调用核心提取函数
    const extractResult = await extractOffer({
      affiliateLink,
      targetCountry,
      userId: task.userId,
      skipCache,
      skipWarmup,
      brandNameInput: brandName,
      // 进度回调：更新到数据库
      progressCallback: async (stage, status, message, data, duration) => {
        // 计算进度百分比 - 必须包含所有ProgressStage阶段
        const progressMap: Record<string, number> = {
          proxy_warmup: 5,
          fetching_proxy: 10,
          resolving_link: 20,
          accessing_page: 35,
          extracting_brand: 50,
          scraping_products: 65,
          processing_data: 80,
          ai_analysis: 90,
          completed: 100,
          error: 0,
        }
        const progress = progressMap[stage] || 0

        // 更新数据库
        await db.exec(`
          UPDATE offer_tasks
          SET stage = ?, message = ?, progress = ?, updated_at = ${nowFunc}
          WHERE id = ?
        `, [stage, message, progress, task.id])

        console.log(`  📊 进度更新: ${task.id} - ${stage} (${progress}%) - ${message}`)
      },
    })

    // 检查提取是否成功
    if (!extractResult.success || !extractResult.data) {
      throw new Error(extractResult.error?.message || '提取失败')
    }

    // ========== 🔥 2025-12-16重构：提取完成后立即创建Offer（增量保存第一阶段）==========
    // 问题：之前等到SSE流程完全结束才创建Offer，如果AI分析失败或用户刷新页面，数据全部丢失
    // 修复：提取完成后立即创建Offer，AI分析结果后续增量更新
    let createdOfferId: number | null = null
    const taskRow = await db.queryOne<{ batch_id: string | null; offer_id: number | null }>(`
      SELECT batch_id, offer_id FROM offer_tasks WHERE id = ?
    `, [task.id])

    if (taskRow?.offer_id && !taskRow?.batch_id) {
      // 重建任务：已有Offer记录，更新基础数据
      createdOfferId = taskRow.offer_id
      console.log(`🔄 重建任务，更新现有Offer基础数据: taskId=${task.id}, offerId=${taskRow.offer_id}`)
      await updateOfferScrapeStatus(taskRow.offer_id, task.userId, 'in_progress', undefined, {
        brand: (extractResult.data.brand || brandName) || undefined,
        url: extractResult.data.finalUrl || undefined,
        // 🔥 2025-12-16修复：保存final_url_suffix到数据库
        final_url_suffix: extractResult.data.finalUrlSuffix || undefined,
        // 🔥 2025-12-16修复：保存product_name到数据库
        product_name: extractResult.data.productName || undefined,
        scraped_data: JSON.stringify(extractResult.data),
        page_type: extractResult.data.pageType || undefined,
      })
    } else if (taskRow?.batch_id) {
      // 批量任务：创建新Offer记录（基础数据）
      console.log(`📦 批量任务，创建Offer基础记录: ${task.id}`)
      const offer = await createOffer(task.userId, {
        url: extractResult.data.finalUrl || affiliateLink,
        brand: extractResult.data.brand || brandName || '提取中...',
        target_country: targetCountry,
        affiliate_link: affiliateLink,
        final_url: extractResult.data.finalUrl || undefined,
        // 🔥 2025-12-16修复：保存final_url_suffix到数据库
        final_url_suffix: extractResult.data.finalUrlSuffix || undefined,
        // 🔥 2025-12-16修复：保存product_name到数据库
        product_name: extractResult.data.productName || undefined,
        product_price: productPrice || extractResult.data.productPrice || undefined,
        commission_payout: commissionPayout || undefined,
        page_type: extractResult.data.pageType || 'product',
      })
      createdOfferId = offer.id
      // 保存scraped_data
      await updateOfferScrapeStatus(offer.id, task.userId, 'in_progress', undefined, {
        scraped_data: JSON.stringify(extractResult.data),
      })
      // 更新offer_tasks关联
      await db.exec(`UPDATE offer_tasks SET offer_id = ? WHERE id = ?`, [offer.id, task.id])
      console.log(`✅ 批量任务Offer基础创建成功: offer_id=${offer.id}`)
    } else {
      // 普通SSE任务：创建新Offer记录（基础数据）
      console.log(`🆕 普通SSE任务，创建Offer基础记录: ${task.id}`)
      const offer = await createOffer(task.userId, {
        url: extractResult.data.finalUrl || affiliateLink,
        brand: extractResult.data.brand || brandName || '提取中...',
        target_country: targetCountry,
        affiliate_link: affiliateLink,
        final_url: extractResult.data.finalUrl || undefined,
        // 🔥 2025-12-16修复：保存final_url_suffix到数据库
        final_url_suffix: extractResult.data.finalUrlSuffix || undefined,
        // 🔥 2025-12-16修复：保存product_name到数据库
        product_name: extractResult.data.productName || undefined,
        product_price: productPrice || extractResult.data.productPrice || undefined,
        commission_payout: commissionPayout || undefined,
        page_type: extractResult.data.pageType || 'product',
      })
      createdOfferId = offer.id
      // 保存scraped_data
      await updateOfferScrapeStatus(offer.id, task.userId, 'in_progress', undefined, {
        scraped_data: JSON.stringify(extractResult.data),
      })
      // 更新offer_tasks关联
      await db.exec(`UPDATE offer_tasks SET offer_id = ? WHERE id = ?`, [offer.id, task.id])
      console.log(`✅ 普通SSE任务Offer基础创建成功: offer_id=${offer.id}`)
    }

    // ========== 执行AI分析 ==========
    console.log(`🤖 开始AI分析: ${task.id}`)

    // 更新进度到ai_analysis阶段
    await db.exec(`
      UPDATE offer_tasks
      SET stage = 'ai_analysis', message = '正在进行AI分析...', progress = 90, updated_at = ${nowFunc}
      WHERE id = ?
    `, [task.id])

    let aiAnalysisResult = null
    try {
      const targetLanguage = getTargetLanguage(targetCountry)

      aiAnalysisResult = await executeAIAnalysis({
        extractResult: extractResult.data,
        targetCountry,
        targetLanguage,
        userId: task.userId,
        enableReviewAnalysis: true,
        enableCompetitorAnalysis: true,
        enableAdExtraction: true,
        // 🔥 修复（2025-12-08）：所有offer-extraction任务都启用Playwright深度抓取
        // 不再区分是否为批量任务，确保与手动创建流程(performScrapeAndAnalysis)完全一致
        // 抓取30条真实评论 + 5个真实竞品
        enablePlaywrightDeepScraping: true,
      })

      console.log(`✅ AI分析完成: ${task.id}`)
    } catch (aiError: any) {
      console.warn(`⚠️ AI分析失败（不影响流程）: ${task.id}:`, aiError.message)
      // AI分析失败不中断流程，继续保存基础数据
    }

    // 🔥 独立站增强：合并Google品牌词搜索补充数据到“已提取广告元素”维度中
    const brandSearchSupplement: BrandSearchSupplement | null =
      (extractResult.data as any)?.brandSearchSupplement || null

    const mergedExtractedHeadlines = mergeUniqueStrings(
      brandSearchSupplement?.extracted?.headlines || null,
      aiAnalysisResult?.extractedHeadlines || null,
      60
    )
    const mergedExtractedDescriptions = mergeUniqueStrings(
      brandSearchSupplement?.extracted?.descriptions || null,
      aiAnalysisResult?.extractedDescriptions || null,
      40
    )
    const mergedCallouts = mergeUniqueStrings(
      brandSearchSupplement?.extracted?.callouts || null,
      null,
      30
    )
    const mergedSitelinks = mergeUniqueSitelinks(
      brandSearchSupplement?.extracted?.sitelinks || null,
      null,
      20
    )

    const mergedExtractionMetadata = {
      ...(aiAnalysisResult?.extractionMetadata || {}),
      ...(brandSearchSupplement ? { brandSearchSupplement } : {}),
      ...(mergedCallouts ? { serpCallouts: mergedCallouts } : {}),
      ...(mergedSitelinks ? { serpSitelinks: mergedSitelinks } : {}),
    }

    // 合并AI分析结果到提取数据（展平结构，与前端期望匹配）
    const aiProductInfo = aiAnalysisResult?.aiProductInfo || {}
    const finalResult = {
      ...extractResult.data,
      // 🔥 展平AI分析结果到顶层（与CreateOfferModalV2.tsx期望的结构匹配）
      brandDescription: aiProductInfo.brandDescription || null,
      uniqueSellingPoints: aiProductInfo.uniqueSellingPoints || null,
      productHighlights: aiProductInfo.productHighlights || null,
      targetAudience: aiProductInfo.targetAudience || null,
      category: aiProductInfo.category || null,
      // P0评论深度分析和竞品分析
      reviewAnalysis: aiAnalysisResult?.reviewAnalysis || null,
      competitorAnalysis: aiAnalysisResult?.competitorAnalysis || null,
      // 广告元素提取
      extractedKeywords: aiAnalysisResult?.extractedKeywords || null,
      extractedHeadlines: mergedExtractedHeadlines,
      extractedDescriptions: mergedExtractedDescriptions,
      extractionMetadata: Object.keys(mergedExtractionMetadata).length > 0 ? mergedExtractionMetadata : null,
    }

    // ========== 🔥 2025-12-16重构：AI分析完成后更新Offer（增量保存第二阶段）==========
    // Offer已在提取完成后创建，这里只更新AI分析结果
    if (createdOfferId) {
      try {
        // 🔥 2026-01-04修复：将AI生成的关键词持久化到offers.ai_keywords
        // 关键词池生成依赖 ai_keywords / extracted_keywords；若不保存，独立站等场景可能出现“无可用关键词”
        const aiKeywordSeeds: string[] | null =
          Array.isArray((aiProductInfo as any)?.keywords) && (aiProductInfo as any).keywords.length > 0
            ? (aiProductInfo as any).keywords
            : (Array.isArray(aiAnalysisResult?.extractedKeywords) && aiAnalysisResult.extractedKeywords.length > 0
                ? aiAnalysisResult.extractedKeywords
                : null)

        await updateOfferScrapeStatus(createdOfferId, task.userId, 'completed', undefined, {
          brand: (extractResult.data.brand || brandName) || undefined,
          url: extractResult.data.finalUrl || undefined,
          // 🔥 2025-12-16修复：保存final_url_suffix到数据库
          final_url_suffix: extractResult.data.finalUrlSuffix || undefined,
          // 🔥 2025-12-16修复：保存product_name到数据库
          product_name: extractResult.data.productName || undefined,
          brand_description: aiProductInfo.brandDescription || undefined,
          unique_selling_points: aiProductInfo.uniqueSellingPoints ?
            (Array.isArray(aiProductInfo.uniqueSellingPoints)
              ? aiProductInfo.uniqueSellingPoints.join('\n')
              : String(aiProductInfo.uniqueSellingPoints)) : undefined,
          product_highlights: aiProductInfo.productHighlights ?
            (Array.isArray(aiProductInfo.productHighlights)
              ? aiProductInfo.productHighlights.join('\n')
              : String(aiProductInfo.productHighlights)) : undefined,
          target_audience: aiProductInfo.targetAudience || undefined,
          category: aiProductInfo.category || undefined,
          review_analysis: aiAnalysisResult?.reviewAnalysis ?
            JSON.stringify(aiAnalysisResult.reviewAnalysis) : undefined,
          competitor_analysis: aiAnalysisResult?.competitorAnalysis ?
            JSON.stringify(aiAnalysisResult.competitorAnalysis) : undefined,
          extracted_keywords: aiAnalysisResult?.extractedKeywords ?
            JSON.stringify(aiAnalysisResult.extractedKeywords) : undefined,
          extracted_headlines: mergedExtractedHeadlines ?
            JSON.stringify(mergedExtractedHeadlines) : undefined,
          extracted_descriptions: mergedExtractedDescriptions ?
            JSON.stringify(mergedExtractedDescriptions) : undefined,
          extraction_metadata: Object.keys(mergedExtractionMetadata).length > 0 ?
            JSON.stringify(mergedExtractionMetadata) : undefined,
          extracted_at: new Date().toISOString(),
          ai_keywords: aiKeywordSeeds ? JSON.stringify(aiKeywordSeeds) : undefined,
          scraped_data: JSON.stringify(extractResult.data),
          page_type: extractResult.data.pageType || undefined,
        })
        console.log(`✅ AI分析结果已更新到Offer: offer_id=${createdOfferId}`)
      } catch (offerError: any) {
        console.error(`❌ 更新Offer AI分析结果失败: ${task.id}:`, offerError.message)
        // 更新失败不中断流程
      }
    }

    // 🔥 2025-12-16修复：保存到数据库的result必须包含offerId，否则前端无法获取
    const resultWithOfferId = {
      ...finalResult,
      offerId: createdOfferId,
    }

    // 更新任务为完成状态（包含创建的offer_id）
    await db.exec(`
      UPDATE offer_tasks
      SET
        status = 'completed',
        progress = 100,
        message = '提取完成',
        result = ?,
        offer_id = ?,
        completed_at = ${nowFunc},
        updated_at = ${nowFunc}
      WHERE id = ?
    `, [JSON.stringify(resultWithOfferId), createdOfferId, task.id])

    console.log(`✅ Offer提取任务完成: ${task.id}, offerId=${createdOfferId}`)

    return resultWithOfferId
  } catch (error: any) {
    console.error(`❌ Offer提取任务失败: ${task.id}:`, error.message)

    // 更新任务为失败状态
    await db.exec(`
      UPDATE offer_tasks
      SET
        status = 'failed',
        message = ?,
        error = ?,
        completed_at = ${nowFunc},
        updated_at = ${nowFunc}
      WHERE id = ?
    `, [
      error.message,
      JSON.stringify({ message: error.message, stack: error.stack }),
      task.id
    ])

    throw error
  }
}
