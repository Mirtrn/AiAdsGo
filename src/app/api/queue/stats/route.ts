/**
 * 队列统计API
 * GET /api/queue/stats
 *
 * 返回队列管理器的实时统计信息
 */

import { NextRequest, NextResponse } from 'next/server'
import { getQueueManager } from '@/lib/scrape-queue-manager'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 获取队列统计信息
    const queueManager = getQueueManager()
    const stats = queueManager.getStats()

    // 如果提供了userId参数，只返回该用户的统计
    const searchParams = request.nextUrl.searchParams
    const filterUserId = searchParams.get('userId')

    if (filterUserId) {
      const uid = parseInt(filterUserId, 10)
      const userStats = stats.perUserStats.get(uid)

      return NextResponse.json({
        success: true,
        userId: uid,
        stats: userStats || {
          running: 0,
          queued: 0,
          completed: 0,
          failed: 0,
        },
        config: stats.config,
      })
    }

    // 返回全局统计
    return NextResponse.json({
      success: true,
      stats: {
        global: {
          running: stats.globalRunning,
          queued: stats.globalQueued,
          completed: stats.globalCompleted,
          failed: stats.globalFailed,
        },
        perUser: Array.from(stats.perUserStats.entries()).map(([userId, userStats]) => ({
          userId,
          ...userStats,
        })),
        config: stats.config,
      },
    })
  } catch (error: any) {
    console.error('[QueueStats] 获取队列统计失败:', error)
    return NextResponse.json(
      { error: error.message || '获取队列统计失败' },
      { status: 500 }
    )
  }
}
