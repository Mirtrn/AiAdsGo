/**
 * 数据同步定时调度器
 *
 * 集成到统一队列系统中的内置调度器
 * 功能：定时检查用户的同步配置，自动创建同步任务并入队
 *
 * 优势：
 * - 不需要外部 crontab
 * - 与队列系统生命周期绑定
 * - 统一管理和监控
 * - 支持动态配置
 */

import { getDatabase } from '../../db'
import { triggerDataSync } from '../../queue-triggers'
import { getGoogleAdsCredentialsFromDB } from '../../google-ads-api'

interface UserSyncConfig {
  user_id: number
  data_sync_enabled: string | boolean
  data_sync_interval_hours: string | number
  last_auto_sync_at: string | null
}

export class DataSyncScheduler {
  private intervalHandle: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private readonly CHECK_INTERVAL_MS = 60 * 60 * 1000  // 每小时检查一次

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      console.log('⚠️  数据同步调度器已在运行')
      return
    }

    console.log('🔄 启动数据同步调度器...')
    this.isRunning = true

    // 立即执行一次检查
    this.checkAndScheduleSync()

    // 设置定时检查（每小时）
    this.intervalHandle = setInterval(() => {
      this.checkAndScheduleSync()
    }, this.CHECK_INTERVAL_MS)

    console.log(`✅ 数据同步调度器已启动 (检查间隔: ${this.CHECK_INTERVAL_MS / 1000 / 60}分钟)`)
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    console.log('⏹️ 停止数据同步调度器...')

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }

    this.isRunning = false
    console.log('✅ 数据同步调度器已停止')
  }

  /**
   * 检查并调度同步任务
   */
  private async checkAndScheduleSync(): Promise<void> {
    try {
      console.log(`\n[${new Date().toISOString()}] 🔄 检查数据同步任务...`)

      const db = await getDatabase()
      const now = new Date()

      // 查询所有启用了自动同步的用户
      const configs = await db.query<UserSyncConfig>(
        `
        SELECT
          u.id AS user_id,
          COALESCE(s_enabled.value, 'true') AS data_sync_enabled,
          COALESCE(s_interval.value, '6') AS data_sync_interval_hours,
          (
            SELECT started_at
            FROM sync_logs
            WHERE user_id = u.id AND sync_type = 'auto'
            ORDER BY started_at DESC
            LIMIT 1
          ) AS last_auto_sync_at
        FROM users u
        LEFT JOIN system_settings s_enabled ON s_enabled.user_id = u.id
          AND s_enabled.category = 'system'
          AND s_enabled.key = 'data_sync_enabled'
        LEFT JOIN system_settings s_interval ON s_interval.user_id = u.id
          AND s_interval.category = 'system'
          AND s_interval.key = 'data_sync_interval_hours'
        WHERE COALESCE(s_enabled.value, 'true') = 'true'
        `
      )

      if (configs.length === 0) {
        console.log('  ℹ️  没有启用自动同步的用户')
        return
      }

      console.log(`  📊 找到 ${configs.length} 个启用自动同步的用户`)

      // 遍历用户，检查是否需要触发同步
      let triggeredCount = 0
      let skippedCount = 0
      for (const config of configs) {
        const userId = config.user_id
        const intervalHours = parseInt(String(config.data_sync_interval_hours)) || 6
        const lastSyncAt = config.last_auto_sync_at ? new Date(config.last_auto_sync_at) : null

        // 计算距离上次同步的小时数
        const hoursSinceLastSync = lastSyncAt
          ? (now.getTime() - lastSyncAt.getTime()) / (1000 * 60 * 60)
          : Infinity

        // 如果从未同步过，或者距离上次同步已超过间隔时间，触发同步
        if (hoursSinceLastSync >= intervalHours) {
          // 🔧 修复(2025-12-28): 验证用户是否配置了完整的 Google Ads 凭证
          try {
            await getGoogleAdsCredentialsFromDB(userId)
          } catch (credError) {
            console.log(
              `  ⚠️  用户 #${userId}: 未配置完整的 Google Ads 凭证，跳过自动同步`
            )
            skippedCount++
            continue
          }

          console.log(
            `  🔄 用户 #${userId}: 距离上次同步 ${lastSyncAt ? `${hoursSinceLastSync.toFixed(1)}小时` : '从未同步'}, 触发同步 (间隔: ${intervalHours}h)`
          )

          try {
            const taskId = await triggerDataSync(userId, {
              syncType: 'auto',
              priority: 'normal',
            })
            console.log(`     ✅ 同步任务已入队: ${taskId}`)
            triggeredCount++
          } catch (error) {
            console.error(`     ❌ 触发同步失败:`, error)
          }
        } else {
          const hoursUntilNext = intervalHours - hoursSinceLastSync
          console.log(
            `  ⏰ 用户 #${userId}: 距离下次同步还有 ${hoursUntilNext.toFixed(1)} 小时`
          )
        }
      }

      console.log(`\n✅ 检查完成: 触发了 ${triggeredCount}/${configs.length} 个同步任务${skippedCount > 0 ? `，跳过 ${skippedCount} 个未配置凭证的用户` : ''}`)
    } catch (error) {
      console.error('❌ 检查数据同步任务失败:', error)
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
let schedulerInstance: DataSyncScheduler | null = null

/**
 * 获取调度器单例
 */
export function getDataSyncScheduler(): DataSyncScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new DataSyncScheduler()
  }
  return schedulerInstance
}
