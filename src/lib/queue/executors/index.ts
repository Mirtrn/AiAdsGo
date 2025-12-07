/**
 * 队列任务执行器注册
 *
 * 在队列系统初始化时注册所有任务执行器
 */

import type { UnifiedQueueManager } from '../unified-queue-manager'
import { createScrapeExecutor, convertPriorityToEnum } from './scrape-executor'
import { createSyncExecutor } from './sync-executor'
import { createAIAnalysisExecutor } from './ai-analysis-executor'
import { createBackupExecutor } from './backup-executor'
import { createExportExecutor } from './export-executor'
import { createEmailExecutor } from './email-executor'
import { createLinkCheckExecutor } from './link-check-executor'
import { createCleanupExecutor } from './cleanup-executor'
import { executeOfferExtraction } from './offer-extraction-executor'
import { executeBatchCreation } from './batch-creation-executor'

/**
 * 注册所有任务执行器
 */
export function registerAllExecutors(queue: UnifiedQueueManager): void {
  // 注册 scrape 执行器
  queue.registerExecutor('scrape', createScrapeExecutor())

  // 注册 sync 执行器
  queue.registerExecutor('sync', createSyncExecutor())

  // 注册 ai-analysis 执行器
  queue.registerExecutor('ai-analysis', createAIAnalysisExecutor())

  // 注册 backup 执行器
  queue.registerExecutor('backup', createBackupExecutor())

  // 注册 export 执行器
  queue.registerExecutor('export', createExportExecutor())

  // 注册 email 执行器
  queue.registerExecutor('email', createEmailExecutor())

  // 注册 link-check 执行器
  queue.registerExecutor('link-check', createLinkCheckExecutor())

  // 注册 cleanup 执行器
  queue.registerExecutor('cleanup', createCleanupExecutor())

  // 注册 offer-extraction 执行器
  queue.registerExecutor('offer-extraction', executeOfferExtraction)

  // 注册 batch-offer-creation 执行器
  queue.registerExecutor('batch-offer-creation', executeBatchCreation)
}

export { createScrapeExecutor, convertPriorityToEnum } from './scrape-executor'
export { createSyncExecutor } from './sync-executor'
export { createAIAnalysisExecutor } from './ai-analysis-executor'
export { createBackupExecutor } from './backup-executor'
export { createExportExecutor } from './export-executor'
export { createEmailExecutor } from './email-executor'
export { createLinkCheckExecutor } from './link-check-executor'
export { createCleanupExecutor } from './cleanup-executor'
export type { ScrapeTaskData } from './scrape-executor'
export type { SyncTaskData } from './sync-executor'
export type { AIAnalysisTaskData } from './ai-analysis-executor'
export type { BackupTaskData } from './backup-executor'
export type { ExportTaskData } from './export-executor'
export type { EmailTaskData } from './email-executor'
export type { LinkCheckTaskData } from './link-check-executor'
export type { CleanupTaskData } from './cleanup-executor'
