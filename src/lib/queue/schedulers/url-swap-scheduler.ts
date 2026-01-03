/**
 * URL Swap定时调度器
 *
 * 集成到统一队列系统中的内置调度器
 * 功能：定时检查待执行的换链接任务，自动创建队列任务并入队
 *
 * 优势：
 * - 不需要外部 crontab
 * - 与队列系统生命周期绑定
 * - 统一管理和监控
 * - 支持动态配置
 */

import { getDatabase } from '../../db'

interface UrlSwapTaskInfo {
  id: string
  user_id: number
  offer_id: number
  swap_interval_minutes: number
  next_swap_at: string
  started_at: string
  status: string
}

export class UrlSwapScheduler {
  private intervalHandle: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private readonly CHECK_INTERVAL_MS = 5 * 60 * 1000  // 每5分钟检查一次（与Cron间隔一致）

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      console.log('⚠️  URL Swap调度器已在运行')
      return
    }

    console.log('🔄 启动URL Swap调度器...')
    this.isRunning = true

    // 立即执行一次检查
    this.checkAndScheduleSwaps()

    // 设置定时检查（每5分钟）
    this.intervalHandle = setInterval(() => {
      this.checkAndScheduleSwaps()
    }, this.CHECK_INTERVAL_MS)

    console.log(`✅ URL Swap调度器已启动 (检查间隔: ${this.CHECK_INTERVAL_MS / 1000 / 60}分钟)`)
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    console.log('⏹️ 停止URL Swap调度器...')

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }

    this.isRunning = false
    console.log('✅ URL Swap调度器已停止')
  }

  /**
   * 检查并调度换链接任务
   * 使用动态导入避免循环依赖
   */
  private async checkAndScheduleSwaps(): Promise<void> {
    try {
      const now = new Date()
      console.log(`\n[${now.toISOString()}] 🔄 检查URL Swap任务...`)

      const db = await getDatabase()

      // 查询所有待执行的换链接任务
      // 条件：status='enabled', next_swap_at <= now, started_at <= now, is_deleted=false/0
      const query = db.type === 'postgres'
        ? `
          SELECT
            id,
            user_id,
            offer_id,
            swap_interval_minutes,
            next_swap_at,
            started_at,
            status
          FROM url_swap_tasks
          WHERE status = 'enabled'
            AND next_swap_at <= CURRENT_TIMESTAMP
            AND started_at <= CURRENT_TIMESTAMP
            AND is_deleted = FALSE
          ORDER BY next_swap_at ASC
        `
        : `
          SELECT
            id,
            user_id,
            offer_id,
            swap_interval_minutes,
            next_swap_at,
            started_at,
            status
          FROM url_swap_tasks
          WHERE status = 'enabled'
            AND next_swap_at <= datetime('now')
            AND started_at <= datetime('now')
            AND is_deleted = 0
          ORDER BY next_swap_at ASC
        `

      const tasks = await db.query<UrlSwapTaskInfo>(query)

      if (tasks.length === 0) {
        console.log('  ℹ️  没有待执行的换链接任务')
        return
      }

      console.log(`  📊 找到 ${tasks.length} 个待执行的换链接任务`)

      // 动态导入避免循环依赖
      const { triggerAllUrlSwapTasks } = await import('../../url-swap-scheduler')
      const result = await triggerAllUrlSwapTasks()

      console.log(`\n✅ URL Swap检查完成:`)
      console.log(`   - 已处理: ${result.processed}`)
      console.log(`   - 已入队: ${result.executed}`)
      console.log(`   - 已跳过: ${result.skipped}`)
      console.log(`   - 错误数: ${result.errors}`)
    } catch (error) {
      console.error('❌ 检查URL Swap任务失败:', error)
    }
  }

  /**
   * 获取调度器状态
   */
  getStatus(): { isRunning: boolean; checkIntervalMs: number } {
    return {
      isRunning: this.isRunning,
      checkIntervalMs: this.CHECK_INTERVAL_MS
    }
  }
}

/**
 * 单例实例
 */
let schedulerInstance: UrlSwapScheduler | null = null

/**
 * 获取调度器单例
 */
export function getUrlSwapScheduler(): UrlSwapScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new UrlSwapScheduler()
  }
  return schedulerInstance
}
