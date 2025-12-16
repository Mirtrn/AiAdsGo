/**
 * POST /api/offers/:id/generate-creatives-queue
 *
 * 将广告创意生成任务加入队列
 * 返回taskId供前端轮询进度
 */

import { NextRequest } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { getQueueManager } from '@/lib/queue'
import { getDatabase } from '@/lib/db'
import type { AdCreativeTaskData } from '@/lib/queue/executors/ad-creative-executor'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params

  // 验证用户身份
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const body = await request.json()
  const {
    maxRetries = 3,
    targetRating = 'EXCELLENT',
    synthetic = false  // 🆕 是否生成综合创意
  } = body

  // 验证Offer存在
  const offer = await findOfferById(parseInt(id, 10), parseInt(userId, 10))
  if (!offer) {
    return new Response(JSON.stringify({ error: 'Offer不存在或无权访问' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (offer.scrape_status === 'failed') {
    return new Response(JSON.stringify({ error: 'Offer信息抓取失败，请重新抓取' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const db = getDatabase()
    const queue = getQueueManager()

    // 创建creative_tasks记录
    const taskId = crypto.randomUUID()
    await db.exec(
      `INSERT INTO creative_tasks (
        id, user_id, offer_id, status, stage, progress, message,
        max_retries, target_rating, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 'init', 0, '准备开始生成...', ?, ?, datetime('now'), datetime('now'))`,
      [taskId, parseInt(userId, 10), parseInt(id, 10), maxRetries, targetRating]
    )

    // 将任务加入队列
    const taskData: AdCreativeTaskData = {
      offerId: parseInt(id, 10),
      maxRetries,
      targetRating,
      synthetic  // 🆕 综合创意标记
    }

    await queue.enqueue('ad-creative', taskData, parseInt(userId, 10), {
      priority: 'high',
      taskId,
      maxRetries: 0  // 禁用队列重试，由执行器内部控制多轮生成
    })

    console.log(`🚀 创意生成任务已入队: ${taskId}`)

    return new Response(JSON.stringify({ taskId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error: any) {
    console.error('创意生成任务入队失败:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
