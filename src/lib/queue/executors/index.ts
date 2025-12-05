/**
 * 队列任务执行器注册
 *
 * 在队列系统初始化时注册所有任务执行器
 */

import type { UnifiedQueueManager } from '../unified-queue-manager'
import { createScrapeExecutor } from './scrape-executor'
import { createSyncExecutor } from './sync-executor'
import { createAIAnalysisExecutor } from './ai-analysis-executor'
import { createBackupExecutor } from './backup-executor'
import { createExportExecutor } from './export-executor'
import { createEmailExecutor } from './email-executor'
import { createLinkCheckExecutor } from './link-check-executor'
import { createCleanupExecutor } from './cleanup-executor'

/**
 * 注册所有任务执行器
 */
export function registerAllExecutors(queue: UnifiedQueueManager): void {
  console.log('📝 注册任务执行器...')

  // 注册 scrape 执行器
  queue.registerExecutor('scrape', createScrapeExecutor())
  console.log('   ✅ scrape 执行器已注册')

  // 注册 sync 执行器
  queue.registerExecutor('sync', createSyncExecutor())
  console.log('   ✅ sync 执行器已注册（Google Ads数据同步）')

  // 注册 ai-analysis 执行器
  queue.registerExecutor('ai-analysis', createAIAnalysisExecutor())
  console.log('   ✅ ai-analysis 执行器已注册（AI产品分析）')

  // 注册 backup 执行器
  queue.registerExecutor('backup', createBackupExecutor())
  console.log('   ✅ backup 执行器已注册（数据库备份）')

  // 注册 export 执行器
  queue.registerExecutor('export', createExportExecutor())
  console.log('   ✅ export 执行器已注册（数据导出）')

  // 注册 email 执行器
  queue.registerExecutor('email', createEmailExecutor())
  console.log('   ✅ email 执行器已注册（邮件发送）')

  // 注册 link-check 执行器
  queue.registerExecutor('link-check', createLinkCheckExecutor())
  console.log('   ✅ link-check 执行器已注册（链接可用性检查）')

  // 注册 cleanup 执行器
  queue.registerExecutor('cleanup', createCleanupExecutor())
  console.log('   ✅ cleanup 执行器已注册（数据清理）')

  console.log('📝 任务执行器注册完成')
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
