/**
 * 统一队列恢复模块
 *
 * 用于服务重启后恢复未完成的队列任务
 * 支持Redis和内存队列的任务恢复
 */

import type { Task, TaskStatus } from './types'

/**
 * 任务恢复状态枚举
 */
export type TaskRecoveryStatus = 'recoverable' | 'running' | 'completed' | 'failed'

/**
 * 任务恢复信息
 */
export interface TaskRecoveryInfo {
  taskId: string
  status: TaskRecoveryStatus
  reason: string
  recoveredAt: Date
  attempts: number
}

/**
 * 统一队列恢复管理器
 */
export class QueueRecoveryManager {
  private static instance: QueueRecoveryManager | null = null

  private constructor() {}

  public static getInstance(): QueueRecoveryManager {
    if (!QueueRecoveryManager.instance) {
      QueueRecoveryManager.instance = new QueueRecoveryManager()
    }
    return QueueRecoveryManager.instance
  }

  /**
   * 检查是否有待恢复的任务
   */
  public hasPendingRecovery(): boolean {
    return (
      globalThis.__queueRecoveryPending === true &&
      Array.isArray(globalThis.__queueRecoveryData) &&
      globalThis.__queueRecoveryData.length > 0
    )
  }

  /**
   * 执行队列恢复
   *
   * 在服务启动后首次调用，恢复未完成的任务
   */
  public async executeQueueRecovery(): Promise<{
    recovered: number
    failed: number
    details: TaskRecoveryInfo[]
  }> {
    if (!this.hasPendingRecovery()) {
      return { recovered: 0, failed: 0, details: [] }
    }

    console.log('🚀 开始统一队列恢复...')

    const recoveryData = globalThis.__queueRecoveryData || []
    globalThis.__queueRecoveryPending = false
    globalThis.__queueRecoveryData = undefined

    const results: TaskRecoveryInfo[] = []
    let recovered = 0
    let failed = 0

    for (const item of recoveryData) {
      try {
        // 根据任务类型执行恢复逻辑
        const info = await this.recoverTask(item)
        results.push(info)

        if (info.status === 'recoverable') {
          recovered++
        } else {
          failed++
        }
      } catch (error: any) {
        console.error(`⚠️ 恢复任务失败:`, error.message)
        results.push({
          taskId: item.id?.toString() || 'unknown',
          status: 'failed',
          reason: error.message,
          recoveredAt: new Date(),
          attempts: 1
        })
        failed++
      }
    }

    console.log(`✅ 统一队列恢复完成: 成功 ${recovered} 个，失败 ${failed} 个`)

    return { recovered, failed, details: results }
  }

  /**
   * 恢复单个任务
   */
  private async recoverTask(item: any): Promise<TaskRecoveryInfo> {
    const taskId = item.id?.toString() || 'unknown'
    const taskType = this.detectTaskType(item)
    const attempts = (item.retry_count || 0) + 1

    // 检查任务状态
    const status = await this.checkTaskStatus(item, taskType)

    // 只恢复 pending 和 running 状态的任务
    if (status !== 'running' && status !== 'recoverable') {
      return {
        taskId,
        status,
        reason: `任务状态不需要恢复: ${status}`,
        recoveredAt: new Date(),
        attempts
      }
    }

    // 实际执行恢复：直接使用 UnifiedQueueManager 重新入队
    try {
      await this.enqueueRecoveredTask(item, taskType)

      return {
        taskId,
        status: 'recoverable',
        reason: `成功恢复任务类型: ${taskType}`,
        recoveredAt: new Date(),
        attempts
      }
    } catch (error: any) {
      console.error(`⚠️ 恢复任务失败 ${taskType} #${taskId}:`, error.message)
      return {
        taskId,
        status: 'failed',
        reason: `恢复失败: ${error.message}`,
        recoveredAt: new Date(),
        attempts
      }
    }
  }

  /**
   * 将恢复的任务重新入队到 UnifiedQueueManager
   */
  private async enqueueRecoveredTask(item: any, taskType: string): Promise<void> {
    // 动态导入 UnifiedQueueManager 以避免循环依赖
    const { getQueueManager } = await import('./index')
    const queue = getQueueManager()

    // 确保队列已初始化
    if (!queue['adapter']?.isConnected?.()) {
      await queue.initialize()
    }

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

        console.log(`✅ 恢复 offer-extraction 任务: ${item.id}`)
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

        console.log(`✅ 恢复 ${taskType} 任务: ${item.id}`)
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

        console.log(`✅ 恢复 scrape 任务: Offer #${item.offer_id || item.id}`)
        break
      }

      default:
        throw new Error(`不支持的任务类型: ${taskType}`)
    }
  }

  /**
   * 检测任务类型
   */
  private detectTaskType(item: any): string {
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
   * 检查任务状态
   */
  private async checkTaskStatus(item: any, taskType: string): Promise<TaskRecoveryStatus> {
    try {
      // 根据任务类型和状态决定是否可恢复
      if (item.status === 'processing' || item.status === 'pending') {
        return 'running' // 正在处理中，恢复
      }

      if (item.status === 'completed' || item.status === 'failed') {
        return item.status // 已完成或失败，不恢复
      }

      return 'recoverable' // 默认可恢复
    } catch (error: any) {
      console.error(`检查任务状态失败:`, error.message)
      return 'recoverable' // 出错时默认恢复
    }
  }

  /**
   * 标记任务为需要恢复
   */
  public markTaskForRecovery(taskData: any): void {
    if (!globalThis.__queueRecoveryPending) {
      globalThis.__queueRecoveryPending = true
      globalThis.__queueRecoveryData = []
    }

    if (!Array.isArray(globalThis.__queueRecoveryData)) {
      globalThis.__queueRecoveryData = []
    }

    globalThis.__queueRecoveryData.push({
      id: taskData.id,
      task_type: taskData.task_type,
      status: taskData.status,
      retry_count: taskData.retry_count,
      url: taskData.url,
      offer_id: taskData.offer_id,
      user_id: taskData.user_id,
      data: taskData.data
    })
  }

  /**
   * 清除恢复标记
   */
  public clearRecoveryMark(): void {
    globalThis.__queueRecoveryPending = false
    globalThis.__queueRecoveryData = undefined
  }
}

// 导出单例
export const queueRecoveryManager = QueueRecoveryManager.getInstance()

// 导出全局恢复状态检查（供队列管理器使用）
export function hasQueueRecoveryPending(): boolean {
  return (
    (globalThis as any).__queueRecoveryPending === true &&
    Array.isArray((globalThis as any).__queueRecoveryData) &&
    (globalThis as any).__queueRecoveryData.length > 0
  )
}

export async function executeQueueRecovery(): Promise<{
  recovered: number
  failed: number
  details: TaskRecoveryInfo[]
}> {
  return queueRecoveryManager.executeQueueRecovery()
}

export function markTaskForRecovery(taskData: any): void {
  queueRecoveryManager.markTaskForRecovery(taskData)
}

export function clearRecoveryMark(): void {
  queueRecoveryManager.clearRecoveryMark()
}
