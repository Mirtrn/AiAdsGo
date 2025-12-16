/**
 * 统一队列统计API
 * GET /api/queue/stats
 *
 * 返回统一队列管理器的实时统计信息
 * 支持Redis + 内存回退架构
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getQueueManager } from '@/lib/queue'

export async function GET(request: NextRequest) {
  try {
    // 验证身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const isAdmin = authResult.user.role === 'admin'

    // 获取统一队列管理器
    const queueManager = getQueueManager()
    const stats = await queueManager.getStats()
    const proxyStats = queueManager.getProxyStats()

    // 如果是普通用户，只返回该用户的数据
    if (!isAdmin) {
      const userStats = stats.byUser[userId] || {
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0
      }

      return NextResponse.json({
        success: true,
        data: {
          total: userStats.pending + userStats.running + userStats.completed + userStats.failed,
          pending: userStats.pending,
          running: userStats.running,
          completed: userStats.completed,
          failed: userStats.failed,
          userId,
          proxyAvailable: proxyStats.filter((p) => p.available).length,
          proxyTotal: proxyStats.length
        }
      })
    }

    // 🔥 获取当前配置（从队列管理器内存中读取）
    const currentConfig = queueManager.getConfig()

    // 🔥 获取用户信息（用于显示用户名）
    const { getDatabase } = await import('@/lib/db')
    const db = await getDatabase()

    const userIds = Object.keys(stats.byUser).map(id => parseInt(id))
    const userMap: Record<number, { username: string; email: string }> = {}

    if (userIds.length > 0) {
      const users = await db.query<{ id: number; username: string; email: string }>(
        `SELECT id, username, email FROM users WHERE id IN (${userIds.join(',')})`
      )
      users.forEach(user => {
        userMap[user.id] = { username: user.username, email: user.email }
      })
    }

    // 管理员返回全局统计（兼容旧格式）
    return NextResponse.json({
      success: true,
      stats: {
        global: {
          running: stats.running,
          queued: stats.pending,
          completed: stats.completed,
          failed: stats.failed
        },
        perUser: Object.entries(stats.byUser).map(([uid, userStats]) => {
          const numericUid = parseInt(uid)
          const userInfo = userMap[numericUid]
          return {
            userId: numericUid,
            username: userInfo?.username || `用户#${numericUid}`,
            email: userInfo?.email,
            running: userStats.running,
            queued: userStats.pending,
            completed: userStats.completed,
            failed: userStats.failed
          }
        }),
        byType: stats.byType,
        proxy: {
          total: proxyStats.length,
          available: proxyStats.filter((p) => p.available).length,
          failed: proxyStats.filter((p) => !p.available).length,
          details: proxyStats
        },
        // 🔥 修复：返回当前配置，前端需要此数据显示"当前生效配置"
        config: {
          globalConcurrency: currentConfig.globalConcurrency,
          perUserConcurrency: currentConfig.perUserConcurrency,
          perTypeConcurrency: currentConfig.perTypeConcurrency,  // 🔥 新增：任务类型并发限制
          maxQueueSize: currentConfig.maxQueueSize,
          taskTimeout: currentConfig.taskTimeout,
          enablePriority: true,  // 统一队列始终启用优先级
          defaultMaxRetries: currentConfig.defaultMaxRetries,
          retryDelay: currentConfig.retryDelay,
          storageType: process.env.REDIS_URL ? 'redis' : 'memory'
        }
      }
    })
  } catch (error: any) {
    console.error('[UnifiedQueueStats] 获取队列统计失败:', error)
    return NextResponse.json(
      { error: error.message || '获取队列统计失败' },
      { status: 500 }
    )
  }
}
