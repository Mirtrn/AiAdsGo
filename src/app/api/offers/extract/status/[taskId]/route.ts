/**
 * GET /api/offers/extract/status/[taskId]
 *
 * 轮询查询 - 获取Offer提取任务状态
 *
 * 功能：
 * 1. 验证用户身份和任务所有权
 * 2. 返回任务当前状态、进度、结果
 * 3. 支持SSE失败后的fallback
 *
 * 返回格式：
 * {
 *   taskId: string
 *   status: 'pending' | 'running' | 'completed' | 'failed'
 *   stage: string | null
 *   progress: number (0-100)
 *   message: string | null
 *   result: object | null (completed时)
 *   error: object | null (failed时)
 *   createdAt: string
 *   updatedAt: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

interface OfferTask {
  id: string
  user_id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
  affiliate_link: string
  target_country: string
  result: string | null
  error: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const db = getDatabase()
  const { taskId } = params

  try {
    // 验证用户身份
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    // 查询任务
    const rows = await db.query<OfferTask>(
      'SELECT * FROM offer_tasks WHERE id = ? AND user_id = ?',
      [taskId, userIdNum]
    )

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: 'Not found', message: '任务不存在或无权访问' },
        { status: 404 }
      )
    }

    const task = rows[0]

    // 构造响应
    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      message: task.message,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error ? JSON.parse(task.error) : null,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      startedAt: task.started_at,
      completedAt: task.completed_at,
    })

  } catch (error: any) {
    console.error('Query task status failed:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '查询失败'
      },
      { status: 500 }
    )
  }
}
