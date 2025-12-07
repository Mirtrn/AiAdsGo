/**
 * POST /api/offers/extract
 *
 * 任务队列架构 - 创建Offer提取任务
 *
 * 流程：
 * 1. 验证用户身份
 * 2. 创建offer_tasks记录（状态：pending）
 * 3. 将任务加入UnifiedQueueManager
 * 4. 返回taskId给前端用于SSE订阅/轮询
 *
 * 客户端使用：
 * - SSE订阅：GET /api/offers/extract/stream/[taskId]
 * - 轮询查询：GET /api/offers/extract/status/[taskId]
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import type { OfferExtractionTaskData } from '@/lib/queue/executors/offer-extraction-executor'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const db = getDatabase()
  const queue = getQueueManager()

  // 确保队列已初始化
  if (!queue['adapter']?.isConnected?.()) {
    await queue.initialize()
  }

  try {
    // 1. 验证用户身份
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    // 2. 解析请求参数
    const body = await req.json()
    const { affiliate_link, target_country, skipCache, skipWarmup } = body

    // 参数验证
    if (!affiliate_link || typeof affiliate_link !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request', message: 'affiliate_link is required' },
        { status: 400 }
      )
    }

    if (!target_country || typeof target_country !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request', message: 'target_country is required' },
        { status: 400 }
      )
    }

    // 3. 创建offer_tasks记录
    const taskId = crypto.randomUUID()

    await db.exec(`
      INSERT INTO offer_tasks (
        id,
        user_id,
        status,
        affiliate_link,
        target_country,
        skip_cache,
        skip_warmup,
        created_at,
        updated_at
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      taskId,
      userIdNum,
      affiliate_link,
      target_country,
      (skipCache ?? false) ? 1 : 0,
      (skipWarmup ?? false) ? 1 : 0
    ])

    console.log(`📝 Created offer_task: ${taskId} for user ${userIdNum}`)

    // 4. 将任务加入队列
    const taskData: OfferExtractionTaskData = {
      affiliateLink: affiliate_link,
      targetCountry: target_country,
      skipCache: skipCache ?? false,
      skipWarmup: skipWarmup ?? false
    }

    await queue.enqueue(
      'offer-extraction',
      taskData,
      userIdNum,
      {
        priority: 'normal',
        requireProxy: true, // Offer提取需要代理IP
        maxRetries: 2 // AI密集型任务，重试次数较少
      }
    )

    console.log(`🚀 Enqueued offer-extraction task: ${taskId}`)

    // 5. 返回taskId
    return NextResponse.json({
      success: true,
      taskId,
      message: '任务已创建，开始处理'
    })

  } catch (error: any) {
    console.error('❌ Create offer extraction task failed:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '创建任务失败'
      },
      { status: 500 }
    )
  }
}
