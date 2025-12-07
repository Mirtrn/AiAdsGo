/**
 * 队列恢复模块
 *
 * 用于服务重启后恢复未完成的任务
 * 这个模块独立于 instrumentation.ts，避免在构建时分析复杂依赖
 *
 * 🔄 统一架构：直接使用 UnifiedQueueManager 恢复所有任务类型
 */

import { getQueueManager } from './queue'

/**
 * 执行队列恢复（由API路由调用）
 *
 * 在首次API请求时调用此函数，安全地恢复队列任务
 */
export async function executeQueueRecoveryIfNeeded() {
  if (!global.__queueRecoveryPending || !global.__queueRecoveryData) {
    return
  }

  // 标记为已处理，避免重复恢复
  global.__queueRecoveryPending = false
  const tasksToRecover = global.__queueRecoveryData
  global.__queueRecoveryData = undefined

  console.log(`🚀 开始统一队列恢复 ${tasksToRecover.length} 个任务...`)

  const queue = getQueueManager()

  // 确保队列已初始化
  if (!queue['adapter']?.isConnected?.()) {
    await queue.initialize()
  }

  let recovered = 0
  let failed = 0

  for (const item of tasksToRecover) {
    try {
      const taskType = detectTaskType(item)
      await enqueueRecoveredTask(queue, item, taskType)
      recovered++
      console.log(`✅ 恢复 ${taskType} 任务: ${item.id}`)
    } catch (error: any) {
      console.error(`⚠️ 恢复任务失败 ${item.task_type || 'unknown'} #${item.id}:`, error.message)
      failed++
    }
  }

  console.log(`✅ 统一队列恢复完成: 成功 ${recovered} 个，失败 ${failed} 个`)
}

/**
 * 检测任务类型
 */
function detectTaskType(item: any): string {
  // 从 offers 表恢复的抓取任务
  if (item.offer_id || (item.url && !item.affiliate_link)) {
    return 'scrape'
  }

  // 从 offer_tasks 表恢复的Offer提取任务
  if (item.affiliate_link && item.target_country) {
    return 'offer-extraction'
  }

  // 从 batch_tasks 表恢复的批量任务
  if (item.total_count !== undefined && item.task_type) {
    return item.task_type // 'offer-creation', 'offer-scrape', 'offer-enhance'
  }

  // 使用显式task_type字段
  if (item.task_type) {
    return item.task_type
  }

  return 'unknown'
}

/**
 * 将恢复的任务重新入队到 UnifiedQueueManager
 */
async function enqueueRecoveredTask(queue: any, item: any, taskType: string): Promise<void> {
  // 根据任务类型构造入队数据
  switch (taskType) {
    case 'offer-extraction': {
      // Offer提取任务
      const taskData = {
        taskId: item.id,
        affiliateLink: item.affiliate_link,
        targetCountry: item.target_country,
        skipCache: item.skip_cache === 1,
        skipWarmup: item.skip_warmup === 1,
        batchId: item.batch_id || undefined
      }

      await queue.enqueue('offer-extraction', taskData, item.user_id, {
        priority: 'normal'
      })
      break
    }

    case 'offer-creation':
    case 'offer-scrape':
    case 'offer-enhance': {
      // 批量任务（batch_tasks）
      const taskData = {
        batchId: item.id,
        taskType: item.task_type,
        totalCount: item.total_count,
        completedCount: item.completed_count || 0,
        failedCount: item.failed_count || 0,
        sourceFile: item.source_file,
        metadata: item.metadata ? JSON.parse(item.metadata) : undefined
      }

      await queue.enqueue(taskType as any, taskData, item.user_id, {
        priority: 'normal'
      })
      break
    }

    case 'scrape': {
      // Offer抓取任务（旧逻辑，保留兼容）
      const taskData = {
        offerId: item.offer_id || item.id,
        url: item.url,
        brand: item.brand
      }

      await queue.enqueue('scrape', taskData, item.user_id, {
        priority: 'normal'
      })
      break
    }

    default:
      throw new Error(`不支持的任务类型: ${taskType}`)
  }
}
