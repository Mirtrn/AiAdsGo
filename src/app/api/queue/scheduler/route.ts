/**
 * 调度器状态和控制API
 * GET /api/queue/scheduler - 获取调度器状态
 * POST /api/queue/scheduler/trigger - 手动触发调度器检查
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getUrlSwapScheduler } from '@/lib/queue/schedulers/url-swap-scheduler'
import { triggerAllUrlSwapTasks } from '@/lib/url-swap-scheduler'

/**
 * GET - 获取调度器状态
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

    const scheduler = getUrlSwapScheduler()
    const status = scheduler.getStatus()

    return NextResponse.json({
      success: true,
      data: {
        urlSwapScheduler: {
          isRunning: status.isRunning,
          checkIntervalMs: status.checkIntervalMs,
          checkIntervalMinutes: status.checkIntervalMs / 60 / 1000
        }
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
