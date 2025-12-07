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

/**
 * Offer提取任务数据接口
 */
export interface OfferExtractionTaskData {
  affiliateLink: string
  targetCountry: string
  skipCache?: boolean
  skipWarmup?: boolean
}

/**
 * Offer提取任务执行器
 */
export async function executeOfferExtraction(
  task: Task<OfferExtractionTaskData>
): Promise<any> {
  const { affiliateLink, targetCountry, skipCache = false, skipWarmup = false } = task.data
  const db = getDatabase()

  try {
    // 更新任务状态为运行中
    await db.exec(`
      UPDATE offer_tasks
      SET status = 'running', started_at = datetime('now'), message = '开始提取Offer信息'
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
          SET stage = ?, message = ?, progress = ?, updated_at = datetime('now')
          WHERE id = ?
        `, [stage, message, progress, task.id])

        console.log(`  📊 进度更新: ${task.id} - ${stage} (${progress}%) - ${message}`)
      },
    })

    // 检查提取是否成功
    if (!extractResult.success || !extractResult.data) {
      throw new Error(extractResult.error?.message || '提取失败')
    }

    // 更新任务为完成状态
    await db.exec(`
      UPDATE offer_tasks
      SET
        status = 'completed',
        progress = 100,
        message = '提取完成',
        result = ?,
        completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `, [JSON.stringify(extractResult.data), task.id])

    console.log(`✅ Offer提取任务完成: ${task.id}`)

    return extractResult.data
  } catch (error: any) {
    console.error(`❌ Offer提取任务失败: ${task.id}:`, error.message)

    // 更新任务为失败状态
    await db.exec(`
      UPDATE offer_tasks
      SET
        status = 'failed',
        message = ?,
        error = ?,
        completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `, [
      error.message,
      JSON.stringify({ message: error.message, stack: error.stack }),
      task.id
    ])

    throw error
  }
}
