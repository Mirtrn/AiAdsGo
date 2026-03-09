/**
 * 调度器健康检查 API
 * GET /api/queue/scheduler - 检查调度器健康状态（通过任务执行情况判断）
 * POST /api/queue/scheduler - 手动触发调度器检查
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { triggerAllUrlSwapTasks } from '@/lib/url-swap-scheduler'
import { getDatabase } from '@/lib/db'

/**
 * GET - 获取调度器健康状态
 *
 * 注意：调度器运行在独立的 scheduler 进程中，无法直接检查运行状态
 * 因此通过检查任务执行情况来判断调度器是否正常工作
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const isAdmin = authResult.user.role === 'admin'
    if (!isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const db = await getDatabase()

    // 检查所有调度器的健康状态
    const [urlSwapHealth, dataSyncHealth, affiliateSyncHealth, zombieCleanupHealth] = await Promise.all([
      checkUrlSwapSchedulerHealth(db),
      checkDataSyncSchedulerHealth(db),
      checkAffiliateSyncSchedulerHealth(db),
      checkZombieCleanupSchedulerHealth(db),
    ])

    return NextResponse.json({
      success: true,
      data: {
        urlSwapScheduler: urlSwapHealth,
        dataSyncScheduler: dataSyncHealth,
        affiliateSyncScheduler: affiliateSyncHealth,
        zombieCleanupScheduler: zombieCleanupHealth,
        note: '调度器运行在独立的 scheduler 进程中，此处显示的是通过任务执行情况推断的健康状态'
      }
    })
  } catch (error: any) {
    console.error('[Scheduler API] 获取调度器状态失败:', error)
    return NextResponse.json(
      { error: error.message || '获取调度器状态失败' },
      { status: 500 }
    )
  }
}

/**
 * 检查 URL Swap 调度器健康状态
 */
async function checkUrlSwapSchedulerHealth(db: Awaited<ReturnType<typeof getDatabase>>) {
  const now = new Date()

  // 1. 检查逾期任务数量
  const overdueQuery = db.type === 'postgres'
    ? `
      SELECT COUNT(*) as count
      FROM url_swap_tasks
      WHERE status = 'enabled'
        AND next_swap_at <= CURRENT_TIMESTAMP
        AND started_at <= CURRENT_TIMESTAMP
        AND is_deleted = FALSE
    `
    : `
      SELECT COUNT(*) as count
      FROM url_swap_tasks
      WHERE status = 'enabled'
        AND next_swap_at <= datetime('now')
        AND started_at <= datetime('now')
        AND is_deleted = 0
    `

  const overdueResult = await db.queryOne(overdueQuery) as { count: number } | undefined
  const overdueCount = Number(overdueResult?.count || 0)

  // 2. 检查最近 5 分钟内是否有任务被入队
  const recentQueueQuery = db.type === 'postgres'
    ? `
      SELECT COUNT(*) as count, MAX(created_at) as last_created_at
      FROM queue_tasks
      WHERE type = 'url-swap'
        AND created_at >= NOW() - INTERVAL '5 minutes'
    `
    : `
      SELECT COUNT(*) as count, MAX(created_at) as last_created_at
      FROM queue_tasks
      WHERE type = 'url-swap'
        AND created_at >= datetime('now', '-5 minutes')
    `

  const recentQueueResult = await db.queryOne(recentQueueQuery) as { count: number; last_created_at: string | null } | undefined
  const recentQueueCount = Number(recentQueueResult?.count || 0)
  const lastQueuedAt = recentQueueResult?.last_created_at

  // 3. 检查是否有启用的任务
  const enabledTasksQuery = `
    SELECT COUNT(*) as count
    FROM url_swap_tasks
    WHERE status = 'enabled'
      AND ${db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'}
  `
  const enabledTasksResult = await db.queryOne(enabledTasksQuery) as { count: number } | undefined
  const enabledTasksCount = Number(enabledTasksResult?.count || 0)

  // 判断健康状态
  let status: 'healthy' | 'warning' | 'error' = 'healthy'
  let message = '调度器运行正常'

  if (enabledTasksCount === 0) {
    status = 'healthy'
    message = '没有启用的换链接任务'
  } else if (overdueCount > 0) {
    if (overdueCount >= 10) {
      status = 'error'
      message = `有 ${overdueCount} 个任务逾期未执行，调度器可能未运行`
    } else {
      status = 'warning'
      message = `有 ${overdueCount} 个任务逾期未执行（可能刚启动或任务间隔较短）`
    }
  } else if (recentQueueCount === 0 && enabledTasksCount > 0) {
    status = 'warning'
    message = '最近 5 分钟没有任务入队，但可能是因为任务间隔较长'
  }

  return {
    status,
    message,
    metrics: {
      enabledTasks: enabledTasksCount,
      overdueTasks: overdueCount,
      recentQueuedTasks: recentQueueCount,
      lastQueuedAt,
      checkInterval: '每分钟',
      schedulerProcess: 'scheduler 进程'
    }
  }
}

/**
 * 检查数据同步调度器健康状态
 */
async function checkDataSyncSchedulerHealth(db: Awaited<ReturnType<typeof getDatabase>>) {
  // 检查最近 1 小时内是否有数据同步任务入队
  const recentQueueQuery = db.type === 'postgres'
    ? `
      SELECT COUNT(*) as count, MAX(created_at) as last_created_at
      FROM queue_tasks
      WHERE type = 'data-sync'
        AND created_at >= NOW() - INTERVAL '1 hour'
    `
    : `
      SELECT COUNT(*) as count, MAX(created_at) as last_created_at
      FROM queue_tasks
      WHERE type = 'data-sync'
        AND created_at >= datetime('now', '-1 hour')
    `

  const recentQueueResult = await db.queryOne(recentQueueQuery) as { count: number; last_created_at: string | null } | undefined
  const recentQueueCount = Number(recentQueueResult?.count || 0)
  const lastQueuedAt = recentQueueResult?.last_created_at

  // 检查是否有启用自动同步的用户
  const enabledUsersQuery = `
    SELECT COUNT(DISTINCT u.id) as count
    FROM users u
    WHERE COALESCE(
      (SELECT value FROM system_settings
       WHERE user_id = u.id AND category = 'system' AND key = 'data_sync_enabled' LIMIT 1),
      'true'
    ) = 'true'
  `
  const enabledUsersResult = await db.queryOne(enabledUsersQuery) as { count: number } | undefined
  const enabledUsersCount = Number(enabledUsersResult?.count || 0)

  let status: 'healthy' | 'warning' | 'error' = 'healthy'
  let message = '调度器运行正常'

  if (enabledUsersCount === 0) {
    status = 'healthy'
    message = '没有启用自动同步的用户'
  } else if (recentQueueCount === 0) {
    status = 'warning'
    message = '最近 1 小时没有任务入队（可能是因为同步间隔较长）'
  }

  return {
    status,
    message,
    metrics: {
      enabledUsers: enabledUsersCount,
      recentQueuedTasks: recentQueueCount,
      lastQueuedAt,
      checkInterval: '每小时',
      schedulerProcess: 'scheduler 进程'
    }
  }
}

/**
 * 检查联盟商品同步调度器健康状态
 */
async function checkAffiliateSyncSchedulerHealth(db: Awaited<ReturnType<typeof getDatabase>>) {
  // 检查最近 30 分钟内是否有联盟商品同步任务入队
  const recentQueueQuery = db.type === 'postgres'
    ? `
      SELECT COUNT(*) as count, MAX(created_at) as last_created_at
      FROM queue_tasks
      WHERE type = 'affiliate-product-sync'
        AND created_at >= NOW() - INTERVAL '30 minutes'
    `
    : `
      SELECT COUNT(*) as count, MAX(created_at) as last_created_at
      FROM queue_tasks
      WHERE type = 'affiliate-product-sync'
        AND created_at >= datetime('now', '-30 minutes')
    `

  const recentQueueResult = await db.queryOne(recentQueueQuery) as { count: number; last_created_at: string | null } | undefined
  const recentQueueCount = Number(recentQueueResult?.count || 0)
  const lastQueuedAt = recentQueueResult?.last_created_at

  // 检查是否有启用商品管理的用户
  const enabledUsersQuery = `
    SELECT COUNT(*) as count
    FROM users
    WHERE ${db.type === 'postgres' ? 'product_management_enabled = TRUE' : 'product_management_enabled = 1'}
  `
  const enabledUsersResult = await db.queryOne(enabledUsersQuery) as { count: number } | undefined
  const enabledUsersCount = Number(enabledUsersResult?.count || 0)

  let status: 'healthy' | 'warning' | 'error' = 'healthy'
  let message = '调度器运行正常'

  if (enabledUsersCount === 0) {
    status = 'healthy'
    message = '没有启用商品管理的用户'
  } else if (recentQueueCount === 0) {
    status = 'warning'
    message = '最近 30 分钟没有任务入队（可能是因为同步间隔较长）'
  }

  return {
    status,
    message,
    metrics: {
      enabledUsers: enabledUsersCount,
      recentQueuedTasks: recentQueueCount,
      lastQueuedAt,
      checkInterval: '每10分钟',
      schedulerProcess: 'scheduler 进程'
    }
  }
}

/**
 * 检查僵尸任务清理调度器健康状态
 */
async function checkZombieCleanupSchedulerHealth(db: Awaited<ReturnType<typeof getDatabase>>) {
  // 检查最近 2 小时内是否有僵尸任务被修复
  const recentFixedQuery = db.type === 'postgres'
    ? `
      SELECT COUNT(*) as count
      FROM affiliate_product_sync_runs
      WHERE status = 'failed'
        AND error_message LIKE '%僵尸任务%'
        AND updated_at >= NOW() - INTERVAL '2 hours'
    `
    : `
      SELECT COUNT(*) as count
      FROM affiliate_product_sync_runs
      WHERE status = 'failed'
        AND error_message LIKE '%僵尸任务%'
        AND updated_at >= datetime('now', '-2 hours')
    `

  const recentFixedResult = await db.queryOne(recentFixedQuery) as { count: number } | undefined
  const recentFixedCount = Number(recentFixedResult?.count || 0)

  // 检查当前是否有潜在的僵尸任务（运行超过2小时）
  const zombieQuery = db.type === 'postgres'
    ? `
      SELECT COUNT(*) as count
      FROM affiliate_product_sync_runs
      WHERE status = 'running'
        AND started_at < NOW() - INTERVAL '2 hours'
    `
    : `
      SELECT COUNT(*) as count
      FROM affiliate_product_sync_runs
      WHERE status = 'running'
        AND started_at < datetime('now', '-2 hours')
    `

  const zombieResult = await db.queryOne(zombieQuery) as { count: number } | undefined
  const zombieCount = Number(zombieResult?.count || 0)

  let status: 'healthy' | 'warning' | 'error' = 'healthy'
  let message = '调度器运行正常'

  if (zombieCount > 0) {
    status = 'warning'
    message = `发现 ${zombieCount} 个潜在僵尸任务，等待下次清理`
  } else if (recentFixedCount > 0) {
    status = 'healthy'
    message = `最近 2 小时修复了 ${recentFixedCount} 个僵尸任务`
  } else {
    status = 'healthy'
    message = '未发现僵尸任务'
  }

  return {
    status,
    message,
    metrics: {
      potentialZombieTasks: zombieCount,
      recentFixedTasks: recentFixedCount,
      checkInterval: '每小时',
      schedulerProcess: 'scheduler 进程'
    }
  }
}

/**
 * POST - 手动触发调度器检查
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const isAdmin = authResult.user.role === 'admin'
    if (!isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    console.log('[Scheduler API] 手动触发URL Swap调度器检查...')
    const result = await triggerAllUrlSwapTasks()

    return NextResponse.json({
      success: true,
      message: '调度器检查完成',
      data: {
        processed: result.processed,
        executed: result.executed,
        skipped: result.skipped,
        errors: result.errors
      }
    })
  } catch (error: any) {
    console.error('[Scheduler API] 手动触发调度器失败:', error)
    return NextResponse.json(
      { error: error.message || '手动触发调度器失败' },
      { status: 500 }
    )
  }
}
