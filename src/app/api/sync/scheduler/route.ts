import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { syncScheduler } from '@/lib/sync-scheduler'

/**
 * GET /api/sync/scheduler
 *
 * Get scheduler status
 * Requires admin privileges (future enhancement)
 */
export async function GET(request: NextRequest) {
  try {
    // Validate user (basic auth for now)
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const status = syncScheduler.getStatus()

    return NextResponse.json({
      success: true,
      status,
    })
  } catch (error: any) {
    console.error('Get scheduler status error:', error)
    return NextResponse.json(
      { error: error.message || '获取调度器状态失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/sync/scheduler
 *
 * Control scheduler (start/stop)
 * Requires admin privileges (future enhancement)
 *
 * Body: { action: 'start' | 'stop' }
 */
export async function POST(request: NextRequest) {
  try {
    // Validate user (basic auth for now)
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    if (!action || !['start', 'stop'].includes(action)) {
      return NextResponse.json(
        { error: 'action必须是start或stop' },
        { status: 400 }
      )
    }

    if (action === 'start') {
      syncScheduler.start()
    } else {
      syncScheduler.stop()
    }

    const status = syncScheduler.getStatus()

    return NextResponse.json({
      success: true,
      status,
      message: `调度器已${action === 'start' ? '启动' : '停止'}`,
    })
  } catch (error: any) {
    console.error('Control scheduler error:', error)
    return NextResponse.json(
      { error: error.message || '控制调度器失败' },
      { status: 500 }
    )
  }
}
