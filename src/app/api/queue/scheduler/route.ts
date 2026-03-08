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

    // 检查换链接任务的健康状态
    const urlSwapHealth = await checkUrlSwapSchedulerHealth(db)

    return NextResponse.json({
      success: true,
      data: {
        urlSwapScheduler: urlSwapHealth,
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
