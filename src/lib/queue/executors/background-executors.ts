/**
 * 后台队列执行器注册（非核心任务）
 *
 * 注意：该文件刻意只 import 非核心执行器，避免 background worker 进程加载
 * offer-extraction / AI / Playwright 等重依赖，从而降低内存占用与启动时间。
 */

import type { UnifiedQueueManager } from '../unified-queue-manager'
import { createClickFarmExecutor } from './click-farm-executor'
import { executeUrlSwapTask } from './url-swap-executor'

export function registerBackgroundExecutors(queue: UnifiedQueueManager): void {
  queue.registerExecutor('click-farm', createClickFarmExecutor())
  queue.registerExecutor('url-swap', executeUrlSwapTask)
}

