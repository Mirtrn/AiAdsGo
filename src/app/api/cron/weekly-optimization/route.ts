/**
 * POST /api/cron/weekly-optimization
 * 每周定时任务：为所有用户生成优化任务
 *
 * 调用方式：
 * 1. 本地测试：直接POST请求
 * 2. 生产环境：配置Vercel Cron或Cloud Scheduler
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateWeeklyOptimizationTasks, cleanupOldTasks } from '@/lib/optimization-tasks'

export async function POST(request: NextRequest) {
  try {
    // 验证Cron密钥（生产环境保护）
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('[Cron] Starting weekly optimization tasks generation...')

    // 生成优化任务
    const result = generateWeeklyOptimizationTasks()

    console.log('[Cron] Generated tasks:', result)

    // 清理过期任务
    const cleanedCount = cleanupOldTasks()

    console.log('[Cron] Cleaned up old tasks:', cleanedCount)

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      result: {
        totalUsers: result.totalUsers,
        totalTasks: result.totalTasks,
        cleanedTasks: cleanedCount
      },
      details: result.userTasks
    })

  } catch (error) {
    console.error('[Cron] Weekly optimization error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

// 允许GET请求用于健康检查
export async function GET() {
  return NextResponse.json({
    service: 'weekly-optimization-cron',
    status: 'healthy',
    schedule: 'Every Monday 00:00 UTC',
    timestamp: new Date().toISOString()
  })
}
