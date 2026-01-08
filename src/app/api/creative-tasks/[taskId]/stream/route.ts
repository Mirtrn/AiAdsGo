/**
 * GET /api/creative-tasks/[taskId]/stream
 *
 * SSE订阅 - 实时推送创意生成任务进度
 */

import { NextRequest } from 'next/server'
import { getDatabase } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 600  // 10分钟

interface CreativeTask {
  id: string
  user_id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
  current_attempt: number
  result: string | null
  error: string | null
  updated_at: string
}

export async function GET(
  req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const db = getDatabase()
  const { taskId } = params

  // 验证用户身份
  const userId = req.headers.get('x-user-id')
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }
  const userIdNum = parseInt(userId, 10)

  try {
    // 验证任务存在且属于当前用户
    const taskRows = await db.query<CreativeTask>(
      'SELECT * FROM creative_tasks WHERE id = ? AND user_id = ?',
      [taskId, userIdNum]
    )

    if (!taskRows || taskRows.length === 0) {
      return new Response('Task not found', { status: 404 })
    }

    // 创建SSE流
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let lastUpdatedAt: string | null = null
        let isClosed = false

        const sendSSE = (data: any) => {
          if (isClosed) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          } catch (error) {
            console.warn('SSE send failed:', error)
            isClosed = true
          }
        }

        // 轮询数据库获取进度
        const pollInterval = setInterval(async () => {
          try {
            const rows = await db.query<CreativeTask>(
              'SELECT * FROM creative_tasks WHERE id = ?',
              [taskId]
            )

            if (!rows || rows.length === 0) {
              sendSSE({
                type: 'error',
                error: 'Task not found',
                details: {}
              })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
              return
            }

            const task = rows[0]

            // 只在updated_at变化时才推送
            if (task.updated_at === lastUpdatedAt) {
              return
            }

            lastUpdatedAt = task.updated_at

            // 推送进度更新
            if (task.status === 'running' || task.status === 'pending') {
              const stage = (task.stage as any) || 'init'
              const status = task.status === 'pending' ? 'pending' : 'in_progress'

              sendSSE({
                type: 'progress',
                step: stage,
                progress: task.progress,
                message: task.message || '处理中...',
                details: {
                  attempt: task.current_attempt
                }
              })
            }

            // 任务完成
            if (task.status === 'completed') {
              const result = task.result ? JSON.parse(task.result) : {}
              sendSSE({
                type: 'result',
                ...result
              })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
            }

            // 任务失败
            if (task.status === 'failed') {
              const error = task.error ? JSON.parse(task.error) : { message: task.message || '任务失败' }
              sendSSE({
                type: 'error',
                error: error.message || '任务失败',
                details: error
              })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
            }
          } catch (error: any) {
            console.error('SSE polling error:', error)
            sendSSE({
              type: 'error',
              error: error.message,
              details: { stack: error.stack }
            })
            clearInterval(pollInterval)
            controller.close()
            isClosed = true
          }
        }, 1000) // 每1秒轮询一次

        // 清理逻辑：客户端断开连接时
        req.signal.addEventListener('abort', () => {
          console.log(`🔌 Client disconnected from SSE: ${taskId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            controller.close()
            isClosed = true
          }
        })

        // 超时保护：10分钟后自动关闭
        setTimeout(() => {
          console.log(`⏱️ SSE timeout for task: ${taskId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            sendSSE({
              type: 'error',
              error: 'SSE timeout',
              details: {}
            })
            controller.close()
            isClosed = true
          }
        }, 600000)
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error: any) {
    console.error('SSE initialization error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
