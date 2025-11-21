/**
 * Sync Scheduler - Background service for automated data synchronization
 *
 * This service runs in the background and triggers automatic syncs based on
 * user configuration. It checks for pending syncs every minute and executes
 * them according to the configured interval.
 */

import { getDatabase } from './db'
import { dataSyncService } from './data-sync-service'

export interface SyncSchedulerConfig {
  checkIntervalMs: number // How often to check for pending syncs (default: 60000 = 1 minute)
  enabled: boolean // Master switch for scheduler
}

export class SyncScheduler {
  private static instance: SyncScheduler
  private checkInterval: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private config: SyncSchedulerConfig

  private constructor(config?: Partial<SyncSchedulerConfig>) {
    this.config = {
      checkIntervalMs: config?.checkIntervalMs || 60000, // 1 minute
      enabled: config?.enabled ?? true,
    }
  }

  static getInstance(config?: Partial<SyncSchedulerConfig>): SyncScheduler {
    if (!SyncScheduler.instance) {
      SyncScheduler.instance = new SyncScheduler(config)
    }
    return SyncScheduler.instance
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️  Sync scheduler is already running')
      return
    }

    if (!this.config.enabled) {
      console.log('⏸️  Sync scheduler is disabled')
      return
    }

    console.log('🚀 Starting sync scheduler...')
    this.isRunning = true

    // Initial check
    this.checkPendingSyncs()

    // Set up periodic check
    this.checkInterval = setInterval(() => {
      this.checkPendingSyncs()
    }, this.config.checkIntervalMs)

    console.log(
      `✅ Sync scheduler started (check interval: ${this.config.checkIntervalMs}ms)`
    )
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️  Sync scheduler is not running')
      return
    }

    console.log('🛑 Stopping sync scheduler...')

    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }

    this.isRunning = false
    console.log('✅ Sync scheduler stopped')
  }

  /**
   * Check for users with pending syncs and execute them
   */
  private async checkPendingSyncs() {
    if (!this.isRunning) {
      return
    }

    try {
      const db = getDatabase()
      const now = new Date().toISOString()

      // Find users with auto sync enabled and next sync time has passed
      const pendingSyncs = db
        .prepare(
          `
        SELECT
          sc.user_id,
          sc.sync_interval_hours,
          sc.max_retry_attempts,
          sc.retry_delay_minutes,
          sc.consecutive_failures,
          sc.notify_on_success,
          sc.notify_on_failure,
          sc.notification_email
        FROM sync_config sc
        WHERE sc.auto_sync_enabled = 1
          AND (
            sc.next_scheduled_sync_at IS NULL
            OR sc.next_scheduled_sync_at <= ?
          )
          AND (
            sc.consecutive_failures < sc.max_retry_attempts
            OR sc.max_retry_attempts = 0
          )
      `
        )
        .all(now) as Array<{
        user_id: number
        sync_interval_hours: number
        max_retry_attempts: number
        retry_delay_minutes: number
        consecutive_failures: number
        notify_on_success: number
        notify_on_failure: number
        notification_email: string | null
      }>

      if (pendingSyncs.length === 0) {
        // No pending syncs
        return
      }

      console.log(`📊 Found ${pendingSyncs.length} pending auto syncs`)

      // Execute syncs sequentially to avoid overloading
      for (const sync of pendingSyncs) {
        await this.executeSyncForUser(sync)
      }
    } catch (error) {
      console.error('❌ Error checking pending syncs:', error)
    }
  }

  /**
   * Execute sync for a specific user
   */
  private async executeSyncForUser(syncConfig: {
    user_id: number
    sync_interval_hours: number
    max_retry_attempts: number
    retry_delay_minutes: number
    consecutive_failures: number
    notify_on_success: number
    notify_on_failure: number
    notification_email: string | null
  }) {
    const { user_id, sync_interval_hours, consecutive_failures } = syncConfig
    const db = getDatabase()

    try {
      console.log(`🔄 Starting auto sync for user ${user_id}...`)

      // Execute sync
      const syncLog = await dataSyncService.syncPerformanceData(user_id, 'auto')

      console.log(
        `✅ Auto sync completed for user ${user_id}: ${syncLog.record_count} records in ${syncLog.duration_ms}ms`
      )

      // Calculate next sync time
      const nextSync = new Date()
      nextSync.setHours(nextSync.getHours() + sync_interval_hours)

      // Update config: reset failures, set next sync time
      db.prepare(
        `
        UPDATE sync_config
        SET
          last_auto_sync_at = ?,
          next_scheduled_sync_at = ?,
          consecutive_failures = 0,
          updated_at = datetime('now')
        WHERE user_id = ?
      `
      ).run(new Date().toISOString(), nextSync.toISOString(), user_id)

      // Send success notification if enabled
      if (syncConfig.notify_on_success && syncConfig.notification_email) {
        await this.sendNotification(
          syncConfig.notification_email,
          'success',
          syncLog.record_count,
          syncLog.duration_ms
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`❌ Auto sync failed for user ${user_id}:`, errorMessage)

      const newFailureCount = consecutive_failures + 1

      // Determine next retry time
      let nextRetryTime: string | null = null
      if (newFailureCount < syncConfig.max_retry_attempts) {
        const nextRetry = new Date()
        nextRetry.setMinutes(
          nextRetry.getMinutes() + syncConfig.retry_delay_minutes
        )
        nextRetryTime = nextRetry.toISOString()
        console.log(
          `⏱️  Will retry in ${syncConfig.retry_delay_minutes} minutes (attempt ${newFailureCount + 1}/${syncConfig.max_retry_attempts})`
        )
      } else {
        console.log(
          `⚠️  Max retry attempts (${syncConfig.max_retry_attempts}) reached, disabling auto sync`
        )
      }

      // Update config: increment failures, set next retry time
      db.prepare(
        `
        UPDATE sync_config
        SET
          consecutive_failures = ?,
          next_scheduled_sync_at = ?,
          updated_at = datetime('now')
        WHERE user_id = ?
      `
      ).run(newFailureCount, nextRetryTime, user_id)

      // Send failure notification if enabled
      if (syncConfig.notify_on_failure && syncConfig.notification_email) {
        await this.sendNotification(
          syncConfig.notification_email,
          'failure',
          0,
          0,
          errorMessage
        )
      }
    }
  }

  /**
   * Send notification email (placeholder - implement with your email service)
   */
  private async sendNotification(
    email: string,
    type: 'success' | 'failure',
    recordCount?: number,
    duration?: number,
    error?: string
  ) {
    // TODO: Implement email notification
    // For now, just log
    console.log(`📧 [Email Notification to ${email}]`)
    console.log(`   Type: ${type}`)
    if (type === 'success') {
      console.log(`   Records synced: ${recordCount}`)
      console.log(`   Duration: ${duration}ms`)
    } else {
      console.log(`   Error: ${error}`)
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkIntervalMs: this.config.checkIntervalMs,
      enabled: this.config.enabled,
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SyncSchedulerConfig>) {
    const wasRunning = this.isRunning

    if (wasRunning) {
      this.stop()
    }

    this.config = {
      ...this.config,
      ...config,
    }

    if (wasRunning && this.config.enabled) {
      this.start()
    }
  }
}

/**
 * Export singleton instance
 */
export const syncScheduler = SyncScheduler.getInstance()

/**
 * Initialize scheduler on server startup (call this in your server entry point)
 */
export function initializeSyncScheduler() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('🔧 Sync scheduler disabled in development mode')
    return
  }

  syncScheduler.start()
}
