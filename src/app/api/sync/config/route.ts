import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * Sync configuration interface
 */
export interface SyncConfig {
  id: number
  userId: number
  autoSyncEnabled: boolean
  syncIntervalHours: number
  maxRetryAttempts: number
  retryDelayMinutes: number
  notifyOnSuccess: boolean
  notifyOnFailure: boolean
  notificationEmail: string | null
  lastAutoSyncAt: string | null
  nextScheduledSyncAt: string | null
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
}

/**
 * GET /api/sync/config
 *
 * Get user's sync configuration
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Validate user
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const db = await getDatabase()

    // 2. Get sync config (create default if not exists)
    let config = await db.queryOne(
      `SELECT
        id,
        user_id as userId,
        auto_sync_enabled as autoSyncEnabled,
        sync_interval_hours as syncIntervalHours,
        max_retry_attempts as maxRetryAttempts,
        retry_delay_minutes as retryDelayMinutes,
        notify_on_success as notifyOnSuccess,
        notify_on_failure as notifyOnFailure,
        notification_email as notificationEmail,
        last_auto_sync_at as lastAutoSyncAt,
        next_scheduled_sync_at as nextScheduledSyncAt,
        consecutive_failures as consecutiveFailures,
        created_at as createdAt,
        updated_at as updatedAt
      FROM sync_config WHERE user_id = ?`,
      [userId]
    ) as SyncConfig | undefined

    if (!config) {
      // Create default config
      const result = await db.exec(
        `
          INSERT INTO sync_config (
            user_id, auto_sync_enabled, sync_interval_hours,
            max_retry_attempts, retry_delay_minutes,
            notify_on_success, notify_on_failure
          ) VALUES (?, 0, 6, 3, 15, 0, 1)
        `,
        [userId]
      )

      config = await db.queryOne(
        `SELECT
          id,
          user_id as userId,
          auto_sync_enabled as autoSyncEnabled,
          sync_interval_hours as syncIntervalHours,
          max_retry_attempts as maxRetryAttempts,
          retry_delay_minutes as retryDelayMinutes,
          notify_on_success as notifyOnSuccess,
          notify_on_failure as notifyOnFailure,
          notification_email as notificationEmail,
          last_auto_sync_at as lastAutoSyncAt,
          next_scheduled_sync_at as nextScheduledSyncAt,
          consecutive_failures as consecutiveFailures,
          created_at as createdAt,
          updated_at as updatedAt
        FROM sync_config WHERE id = ?`,
        [result.lastInsertRowid]
      ) as SyncConfig
    }

    // 3. Convert integer booleans to actual booleans
    const formattedConfig = {
      ...config,
      autoSyncEnabled: Boolean(config.autoSyncEnabled),
      notifyOnSuccess: Boolean(config.notifyOnSuccess),
      notifyOnFailure: Boolean(config.notifyOnFailure),
    }

    return NextResponse.json({
      success: true,
      config: formattedConfig,
    })
  } catch (error: any) {
    console.error('Get sync config error:', error)
    return NextResponse.json(
      { error: error.message || '获取同步配置失败' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/sync/config
 *
 * Update user's sync configuration
 */
export async function PUT(request: NextRequest) {
  try {
    // 1. Validate user
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const body = await request.json()

    // 2. Validate input
    const {
      auto_sync_enabled,
      sync_interval_hours,
      max_retry_attempts,
      retry_delay_minutes,
      notify_on_success,
      notify_on_failure,
      notification_email,
    } = body

    // Validation rules
    if (
      typeof auto_sync_enabled !== 'boolean' &&
      auto_sync_enabled !== undefined
    ) {
      return NextResponse.json(
        { error: 'auto_sync_enabled必须是布尔值' },
        { status: 400 }
      )
    }

    if (
      sync_interval_hours !== undefined &&
      (sync_interval_hours < 1 || sync_interval_hours > 24)
    ) {
      return NextResponse.json(
        { error: '同步间隔必须在1-24小时之间' },
        { status: 400 }
      )
    }

    if (
      max_retry_attempts !== undefined &&
      (max_retry_attempts < 0 || max_retry_attempts > 10)
    ) {
      return NextResponse.json(
        { error: '重试次数必须在0-10之间' },
        { status: 400 }
      )
    }

    if (
      retry_delay_minutes !== undefined &&
      (retry_delay_minutes < 5 || retry_delay_minutes > 120)
    ) {
      return NextResponse.json(
        { error: '重试延迟必须在5-120分钟之间' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 3. Build update query dynamically
    const updates: string[] = []
    const values: any[] = []

    if (auto_sync_enabled !== undefined) {
      updates.push('auto_sync_enabled = ?')
      values.push(auto_sync_enabled ? 1 : 0)

      // If enabling auto sync, calculate next sync time
      if (auto_sync_enabled) {
        const interval =
          sync_interval_hours !== undefined ? sync_interval_hours : 6
        const nextSync = new Date()
        nextSync.setHours(nextSync.getHours() + interval)

        updates.push('next_scheduled_sync_at = ?')
        values.push(nextSync.toISOString())
      } else {
        // If disabling, clear next sync time
        updates.push('next_scheduled_sync_at = NULL')
      }
    }

    if (sync_interval_hours !== undefined) {
      updates.push('sync_interval_hours = ?')
      values.push(sync_interval_hours)

      // Recalculate next sync time if auto sync is enabled
      const currentConfig = await db.queryOne(
        'SELECT auto_sync_enabled FROM sync_config WHERE user_id = ?',
        [userId]
      ) as { auto_sync_enabled: number } | undefined

      if (currentConfig?.auto_sync_enabled) {
        const nextSync = new Date()
        nextSync.setHours(nextSync.getHours() + sync_interval_hours)

        updates.push('next_scheduled_sync_at = ?')
        values.push(nextSync.toISOString())
      }
    }

    if (max_retry_attempts !== undefined) {
      updates.push('max_retry_attempts = ?')
      values.push(max_retry_attempts)
    }

    if (retry_delay_minutes !== undefined) {
      updates.push('retry_delay_minutes = ?')
      values.push(retry_delay_minutes)
    }

    if (notify_on_success !== undefined) {
      updates.push('notify_on_success = ?')
      values.push(notify_on_success ? 1 : 0)
    }

    if (notify_on_failure !== undefined) {
      updates.push('notify_on_failure = ?')
      values.push(notify_on_failure ? 1 : 0)
    }

    if (notification_email !== undefined) {
      updates.push('notification_email = ?')
      values.push(notification_email || null)
    }

    // Always update updated_at
    updates.push('updated_at = datetime("now")')

    if (updates.length === 0) {
      return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 })
    }

    // 4. Update config
    values.push(userId)
    const query = `UPDATE sync_config SET ${updates.join(', ')} WHERE user_id = ?`

    await db.exec(query, [...values])

    // 5. Get updated config
    const updatedConfig = await db.queryOne(
      `SELECT
        id,
        user_id as userId,
        auto_sync_enabled as autoSyncEnabled,
        sync_interval_hours as syncIntervalHours,
        max_retry_attempts as maxRetryAttempts,
        retry_delay_minutes as retryDelayMinutes,
        notify_on_success as notifyOnSuccess,
        notify_on_failure as notifyOnFailure,
        notification_email as notificationEmail,
        last_auto_sync_at as lastAutoSyncAt,
        next_scheduled_sync_at as nextScheduledSyncAt,
        consecutive_failures as consecutiveFailures,
        created_at as createdAt,
        updated_at as updatedAt
      FROM sync_config WHERE user_id = ?`,
      [userId]
    ) as SyncConfig

    const formattedConfig = {
      ...updatedConfig,
      autoSyncEnabled: Boolean(updatedConfig.autoSyncEnabled),
      notifyOnSuccess: Boolean(updatedConfig.notifyOnSuccess),
      notifyOnFailure: Boolean(updatedConfig.notifyOnFailure),
    }

    return NextResponse.json({
      success: true,
      config: formattedConfig,
      message: '同步配置已更新',
    })
  } catch (error: any) {
    console.error('Update sync config error:', error)
    return NextResponse.json(
      { error: error.message || '更新同步配置失败' },
      { status: 500 }
    )
  }
}
