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
}

/**
 * Offer提取任务执行器
 */
export async function executeOfferExtraction(
  task: Task<OfferExtractionTaskData>
): Promise<any> {
  const { affiliateLink, targetCountry, skipCache = false, skipWarmup = false, productPrice, commissionPayout } = task.data
  const db = getDatabase()

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
      extractedHeadlines: aiAnalysisResult?.extractedHeadlines || null,
      extractedDescriptions: aiAnalysisResult?.extractedDescriptions || null,
      extractionMetadata: aiAnalysisResult?.extractionMetadata || null,
    }

    // ========== 🔥 修复（2025-12-08）：批量上传自动创建Offer记录 ==========
    // 检查是否是批量任务（有batch_id的offer_tasks）
    const taskRow = await db.queryOne<{ batch_id: string | null }>(`
      SELECT batch_id FROM offer_tasks WHERE id = ?
    `, [task.id])

    let createdOfferId: number | null = null

    if (taskRow?.batch_id) {
      // 这是批量上传任务，需要创建Offer记录
      console.log(`📦 批量任务，创建Offer记录: ${task.id}`)

      try {
        // 1. 创建基础Offer记录
        const offer = await createOffer(task.userId, {
          url: extractResult.data.finalUrl || affiliateLink,
          brand: extractResult.data.brand || '提取中...',
          target_country: targetCountry,
          affiliate_link: affiliateLink,
          final_url: extractResult.data.finalUrl || undefined,
          product_price: productPrice || extractResult.data.price || undefined,
          commission_payout: commissionPayout || undefined,
          // AI分析结果
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
          // 评论和竞品分析
          review_analysis: aiAnalysisResult?.reviewAnalysis ?
            JSON.stringify(aiAnalysisResult.reviewAnalysis) : undefined,
          competitor_analysis: aiAnalysisResult?.competitorAnalysis ?
            JSON.stringify(aiAnalysisResult.competitorAnalysis) : undefined,
          // 广告元素
          extracted_keywords: aiAnalysisResult?.extractedKeywords ?
            JSON.stringify(aiAnalysisResult.extractedKeywords) : undefined,
          extracted_headlines: aiAnalysisResult?.extractedHeadlines ?
            JSON.stringify(aiAnalysisResult.extractedHeadlines) : undefined,
          extracted_descriptions: aiAnalysisResult?.extractedDescriptions ?
            JSON.stringify(aiAnalysisResult.extractedDescriptions) : undefined,
          extraction_metadata: aiAnalysisResult?.extractionMetadata ?
            JSON.stringify(aiAnalysisResult.extractionMetadata) : undefined,
          // 🔥 页面类型标识（从extractResult中提取）
          page_type: extractResult.data.pageType || 'product',
        })

        createdOfferId = offer.id
        console.log(`✅ 批量任务Offer创建成功: offer_id=${offer.id}`)

        // 2. 更新Offer状态为completed（包含完整的scraped_data）
        await updateOfferScrapeStatus(offer.id, task.userId, 'completed', undefined, {
          brand: extractResult.data.brand || undefined,
          url: extractResult.data.finalUrl || undefined,
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
          extracted_headlines: aiAnalysisResult?.extractedHeadlines ?
            JSON.stringify(aiAnalysisResult.extractedHeadlines) : undefined,
          extracted_descriptions: aiAnalysisResult?.extractedDescriptions ?
            JSON.stringify(aiAnalysisResult.extractedDescriptions) : undefined,
          extraction_metadata: aiAnalysisResult?.extractionMetadata ?
            JSON.stringify(aiAnalysisResult.extractionMetadata) : undefined,
          extracted_at: new Date().toISOString(),
          scraped_data: JSON.stringify(extractResult.data),
        })

        console.log(`✅ 批量任务Offer状态更新完成: offer_id=${offer.id}`)
      } catch (offerError: any) {
        console.error(`❌ 批量任务创建Offer失败: ${task.id}:`, offerError.message)
        // 创建Offer失败不中断流程，任务本身的result仍然保存
      }
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
    `, [JSON.stringify(finalResult), createdOfferId, task.id])

    console.log(`✅ Offer提取任务完成: ${task.id}`)

    return finalResult
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
