import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * Sync configuration interface
 */
export interface SyncConfig {
  id: number
  user_id: number
  auto_sync_enabled: boolean
  sync_interval_hours: number
  max_retry_attempts: number
  retry_delay_minutes: number
  notify_on_success: boolean
  notify_on_failure: boolean
  notification_email: string | null
  last_auto_sync_at: string | null
  next_scheduled_sync_at: string | null
  consecutive_failures: number
  created_at: string
  updated_at: string
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
    const db = getDatabase()

    // 2. Get sync config (create default if not exists)
    let config = db
      .prepare('SELECT * FROM sync_config WHERE user_id = ?')
      .get(userId) as SyncConfig | undefined

    if (!config) {
      // Create default config
      const result = db
        .prepare(
          `
          INSERT INTO sync_config (
            user_id, auto_sync_enabled, sync_interval_hours,
            max_retry_attempts, retry_delay_minutes,
            notify_on_success, notify_on_failure
          ) VALUES (?, 0, 6, 3, 15, 0, 1)
        `
        )
        .run(userId)

      config = db
        .prepare('SELECT * FROM sync_config WHERE id = ?')
        .get(result.lastInsertRowid) as SyncConfig
    }

    // 3. Convert integer booleans to actual booleans
    const formattedConfig = {
      ...config,
      auto_sync_enabled: Boolean(config.auto_sync_enabled),
      notify_on_success: Boolean(config.notify_on_success),
      notify_on_failure: Boolean(config.notify_on_failure),
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

    const db = getDatabase()

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
      const currentConfig = db
        .prepare('SELECT auto_sync_enabled FROM sync_config WHERE user_id = ?')
        .get(userId) as { auto_sync_enabled: number } | undefined

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

    db.prepare(query).run(...values)

    // 5. Get updated config
    const updatedConfig = db
      .prepare('SELECT * FROM sync_config WHERE user_id = ?')
      .get(userId) as SyncConfig

    const formattedConfig = {
      ...updatedConfig,
      auto_sync_enabled: Boolean(updatedConfig.auto_sync_enabled),
      notify_on_success: Boolean(updatedConfig.notify_on_success),
      notify_on_failure: Boolean(updatedConfig.notify_on_failure),
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
