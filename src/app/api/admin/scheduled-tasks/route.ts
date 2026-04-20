import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/scheduled-tasks
 * 获取定时任务执行历史(仅管理员)
 * Query参数:
 * - type: backup | sync | all (默认 all)
 * - limit: 数量限制 (默认 50)
 */
export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户信息
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')

    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    if (userRole !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'all'
    const limit = parseInt(searchParams.get('limit') || '50')

    const db = await getDatabase()

    // 根据类型获取不同的任务日志
    let backups: any[] = []
    let syncLogs: any[] = []

    if (type === 'all' || type === 'backup') {
      // 🔧 修复(2025-12-11): 使用 AS 别名返回 camelCase 字段
      // 🔧 修复(2026-04-21): PostgreSQL 会把未加引号别名转为全小写，改用手动映射
      const rawBackups = await db.query(`
        SELECT
          id,
          backup_filename,
          backup_path,
          file_size_bytes,
          status,
          error_message,
          backup_type,
          created_at
        FROM backup_logs
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]) as any[]
      backups = rawBackups.map((r: any) => ({
        id: r.id,
        backupFilename: r.backup_filename,
        backupPath: r.backup_path,
        fileSizeBytes: r.file_size_bytes,
        status: r.status,
        errorMessage: r.error_message,
        backupType: r.backup_type,
        createdAt: r.created_at,
        taskType: 'backup',
      }))
    }

    if (type === 'all' || type === 'sync') {
      // 🔧 修复(2025-12-11): 使用 AS 别名返回 camelCase 字段
      // 🔧 修复(2026-04-21): PostgreSQL 会把未加引号别名转为全小写，改用手动映射
      const rawSyncLogs = await db.query(`
        SELECT
          sl.id,
          sl.user_id,
          sl.google_ads_account_id,
          sl.sync_type,
          sl.status,
          sl.record_count,
          sl.duration_ms,
          sl.error_message,
          sl.started_at,
          sl.completed_at,
          u.username,
          ga.customer_id
        FROM sync_logs sl
        LEFT JOIN users u ON sl.user_id = u.id
        LEFT JOIN google_ads_accounts ga ON sl.google_ads_account_id = ga.id
        ORDER BY sl.started_at DESC
        LIMIT $1
      `, [limit]) as any[]
      syncLogs = rawSyncLogs.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        googleAdsAccountId: r.google_ads_account_id,
        syncType: r.sync_type,
        status: r.status,
        recordCount: r.record_count,
        durationMs: r.duration_ms,
        errorMessage: r.error_message,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        username: r.username,
        customerId: r.customer_id,
        taskType: 'sync',
      }))
    }

    // 统计信息
    // 🔧 修复(2026-04-21): skipped 状态属于正常（云备份接管），计入成功率
    const backupStats = await db.queryOne(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('success', 'skipped') THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'success' THEN file_size_bytes ELSE 0 END) as total_size_bytes,
        MAX(created_at) as last_run
      FROM backup_logs
    `) as any

    const syncStats = await db.queryOne(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(record_count) as total_records,
        AVG(duration_ms) as avg_duration,
        MAX(started_at) as last_run
      FROM sync_logs
    `) as any

    // 定时任务配置信息
    const scheduledTasks = [
      {
        name: '数据同步',
        description: '从Google Ads同步广告数据',
        schedule: '每6小时 (0, 6, 12, 18点)',
        enabled: true,
      },
      {
        name: '数据库备份',
        description: '自动备份SQLite数据库',
        schedule: '每天凌晨2点',
        enabled: true,
      },
      {
        name: '链接/账号检查',
        description: '检查推广链接和账号状态',
        schedule: '每天凌晨2点',
        enabled: process.env.LINK_CHECK_ENABLED !== 'false',
      },
      {
        name: '数据清理',
        description: '清理90天前的旧数据',
        schedule: '每天凌晨3点',
        enabled: true,
      },
      {
        name: 'OpenClaw周报',
        description: '每周一发送上一周（周一~周日）汇总报表',
        schedule: '每周一上午9:10',
        enabled: process.env.OPENCLAW_WEEKLY_REPORT_ENABLED !== 'false',
      },
      {
        name: 'A/B测试监控',
        description: '监控A/B测试并自动优化',
        schedule: '每小时',
        enabled: true,
      },
    ]

    return NextResponse.json({
      success: true,
      data: {
        backups,
        syncLogs,
        stats: {
          backup: {
            total: backupStats.total || 0,
            success: backupStats.success || 0,
            failed: backupStats.failed || 0,
            totalSizeBytes: backupStats.total_size_bytes || 0,
            lastRun: backupStats.last_run,
          },
          sync: {
            total: syncStats.total || 0,
            success: syncStats.success || 0,
            failed: syncStats.failed || 0,
            totalRecords: syncStats.total_records || 0,
            avgDuration: Math.round(syncStats.avg_duration || 0),
            lastRun: syncStats.last_run,
          },
        },
        scheduledTasks,
      },
    })

  } catch (error) {
    console.error('获取定时任务历史失败:', error)
    return NextResponse.json(
      { error: '获取定时任务历史失败' },
      { status: 500 }
    )
  }
}
