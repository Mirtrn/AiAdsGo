/**
 * POST /api/offers/extract/stream
 *
 * 合并API：创建Offer提取任务并订阅SSE进度流
 *
 * 流程：
 * 1. 创建offer_tasks记录
 * 2. 将任务加入UnifiedQueueManager
 * 3. 建立SSE流，轮询任务进度并实时推送
 *
 * 请求体：
 * - affiliate_link: 推广链接
 * - target_country: 目标国家
 *
 * SSE消息格式：
 * - { type: 'progress', data: { stage, status, message, timestamp, duration, details } }
 * - { type: 'complete', data: { success, finalUrl, brand, ... } }
 * - { type: 'error', data: { message, stage, details } }
 */

import { NextRequest } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import type { OfferExtractionTaskData } from '@/lib/queue/executors/offer-extraction-executor'

export const dynamic = 'force-dynamic'
export const maxDuration = 600 // 10分钟（与任务超时和SSE超时一致）

interface OfferTask {
  id: string
  user_id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
  result: string | null
  error: string | null
  updated_at: string
}

export async function POST(req: NextRequest) {
  const db = getDatabase()
  const queue = getQueueManager()

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  try {
    // 1. 验证用户身份
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return new Response('Unauthorized', { status: 401 })
    }
    const userIdNum = parseInt(userId, 10)

    // 2. 解析请求参数
    const body = await req.json()
    const { affiliate_link, target_country, skipCache, skipWarmup } = body

    // 参数验证
    if (!affiliate_link || typeof affiliate_link !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid affiliate_link' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!target_country || typeof target_country !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid target_country' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 3. 创建offer_tasks记录
    const taskId = crypto.randomUUID()
    await db.exec(
      `INSERT INTO offer_tasks (
        id, user_id, affiliate_link, target_country, status, stage, progress, message,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', 'resolving_link', 0, '准备开始提取...', ${nowFunc}, ${nowFunc})`,
      [taskId, userIdNum, affiliate_link, target_country]
    )

    // 4. 将任务加入队列
    const taskData: OfferExtractionTaskData = {
      affiliateLink: affiliate_link,
      targetCountry: target_country,
      skipCache: skipCache || false,
      skipWarmup: skipWarmup || false,
    }

    console.log(`📝 Created offer_task: ${taskId} for user ${userIdNum}`)
    const queueTaskId = await queue.enqueue('offer-extraction', taskData, userIdNum, {
      priority: 'normal',
      taskId,  // 关键：传递预定义的taskId，确保队列任务ID与offer_tasks记录ID一致
      maxRetries: 0,  // 禁用重试: Offer提取任务已经有详细进度,用户可重新提交
    })

    console.log(`🚀 Enqueued offer-extraction task: ${taskId}`)

    // 5. 创建SSE流
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
            // 优化3: 只查询必要字段,减少数据传输量
            const rows = await db.query<OfferTask>(
              'SELECT status, stage, progress, message, result, error, updated_at FROM offer_tasks WHERE id = ?',
              [taskId]
            )

            if (!rows || rows.length === 0) {
              sendSSE({
                type: 'error',
                data: {
                  message: 'Task not found',
                  stage: 'error',
                  details: {}
                }
              })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
              return
            }

            const task = rows[0]

            // 优化1: 智能轮询 - 任务完成/失败时立即停止轮询
            if (task.status === 'completed' || task.status === 'failed') {
              console.log(`🛑 任务${task.status}, 停止轮询: ${taskId}`)

              if (task.status === 'completed') {
                const result = task.result ? JSON.parse(task.result) : {}
                sendSSE({
                  type: 'complete',
                  data: result
                })
              } else {
                const error = task.error ? JSON.parse(task.error) : { message: task.message || '任务失败' }
                sendSSE({
                  type: 'error',
                  data: {
                    message: error.message || '任务失败',
                    stage: 'error',
                    details: error
                  }
                })
              }

              clearInterval(pollInterval)
              controller.close()
              isClosed = true
              return
            }

            // 只在updated_at变化时才推送
            if (task.updated_at === lastUpdatedAt) {
              return
            }

            lastUpdatedAt = task.updated_at

            // 推送进度更新 - 修复格式匹配前端期望
            if (task.status === 'running' || task.status === 'pending') {
              // 将stage转换为ProgressStage类型
              const stage = (task.stage as any) || 'resolving_link'
              // 根据status映射为ProgressStatus
              const status = task.status === 'pending' ? 'pending' : 'in_progress'

              sendSSE({
                type: 'progress',
                data: {
                  stage,
                  status,
                  message: task.message || '处理中...',
                  timestamp: Date.now(),
                  details: {}
                }
              })
            }
          } catch (error: any) {
            console.error('SSE polling error:', error)
            sendSSE({
              type: 'error',
              data: {
                message: error.message,
                stage: 'error',
                details: { stack: error.stack }
              }
            })
            clearInterval(pollInterval)
            controller.close()
            isClosed = true
          }
        }, 2000) // 每2秒轮询一次 (降低数据库查询压力)

        // 清理逻辑：客户端断开连接时
        req.signal.addEventListener('abort', () => {
          console.log(`🔌 Client disconnected from SSE: ${taskId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            controller.close()
            isClosed = true
          }
        })

        // 超时保护：10分钟后自动关闭（与任务超时时间一致）
        setTimeout(() => {
          console.log(`⏱️ SSE timeout for task: ${taskId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            sendSSE({
              type: 'error',
              data: {
                message: 'SSE timeout - task may still be running',
                stage: 'error',
                details: {}
              }
            })
            controller.close()
            isClosed = true
          }
        }, 600000) // 10分钟 = 600000ms
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
