import type { TaskType } from './types'
import { isBackgroundTaskType } from './task-category'
import { getBackgroundQueueManager, getQueueManager } from './unified-queue-manager'
import type { UnifiedQueueManager } from './unified-queue-manager'

export function isBackgroundQueueSplitEnabled(): boolean {
  // 拆分队列依赖 Redis 做进程间共享；未配置 REDIS_URL 时退回单队列（避免内存队列跨进程丢任务）
  if (!process.env.REDIS_URL) return false
  const raw = process.env.QUEUE_SPLIT_BACKGROUND
  if (!raw) return false
  const value = raw.toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export function getQueueManagerForTaskType(type: TaskType): UnifiedQueueManager {
  if (isBackgroundTaskType(type) && isBackgroundQueueSplitEnabled()) {
    return getBackgroundQueueManager()
  }
  return getQueueManager()
}
