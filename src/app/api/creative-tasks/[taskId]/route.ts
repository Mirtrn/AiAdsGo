/**
 * GET /api/creative-tasks/[taskId]
 *
 * 轮询查询 - 获取创意生成任务状态（用于SSE断开后的fallback）
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

interface CreativeTaskRow {
  id: string
  user_id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
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
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    const rows = await db.query<CreativeTaskRow>(
      'SELECT * FROM creative_tasks WHERE id = ? AND user_id = ?',
      [taskId, userIdNum]
    )

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: 'Not found', message: '任务不存在或无权访问' },
        { status: 404 }
      )
    }

    const task = rows[0]

    let errorMessage: string | null = null
    let errorDetails: any = null
    if (task.error) {
      try {
        errorDetails = JSON.parse(task.error)
        errorMessage = typeof errorDetails?.message === 'string' ? errorDetails.message : String(errorDetails)
      } catch {
        errorMessage = task.error
      }
    }

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      message: task.message,
      result: task.result ? JSON.parse(task.result) : null,
      error: errorMessage,
      errorDetails,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      startedAt: task.started_at,
      completedAt: task.completed_at,
    })
  } catch (error: any) {
    console.error('Query creative task status failed:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '查询失败'
      },
      { status: 500 }
    )
  }
}

