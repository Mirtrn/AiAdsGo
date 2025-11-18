import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { dataSyncService } from '@/lib/data-sync-service'

/**
 * POST /api/sync/trigger
 * 手动触发数据同步
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 检查是否已经有同步任务在运行
    const currentStatus = dataSyncService.getSyncStatus(userId)
    if (currentStatus.isRunning) {
      return NextResponse.json(
        { error: '数据同步正在进行中，请稍后再试' },
        { status: 429 }
      )
    }

    // 异步执行同步任务（不阻塞请求）
    dataSyncService.syncPerformanceData(userId, 'manual').catch((error) => {
      console.error('数据同步失败:', error)
    })

    return NextResponse.json({
      success: true,
      message: '数据同步已启动',
      status: 'running',
    })
  } catch (error) {
    console.error('触发数据同步失败:', error)
    return NextResponse.json(
      {
        error: '触发数据同步失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
