/**
 * POST /api/offers/batch/generate-creatives-queue
 *
 * 批量将广告创意生成任务加入队列（每个Offer最多入队1个任务）
 *
 * 规则：
 * - 单次最多50个Offer
 * - 仅处理 scrape_status = 'completed' 的Offer；pending/in_progress/failed 跳过
 * - 若该Offer已存在 pending/running 的创意任务，则跳过
 * - 若该Offer已生成满3种类型（A/B/D），则跳过
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue'
import { getGoogleAdsConfig } from '@/lib/keyword-planner'
import { getUserAuthType } from '@/lib/google-ads-oauth'
import type { AdCreativeTaskData } from '@/lib/queue/executors/ad-creative-executor'
import { toDbJsonObjectField } from '@/lib/json-field'

export const maxDuration = 60

const requestSchema = z.object({
  offerIds: z.array(z.number().int().positive()).min(1).max(50),
})

type BucketType = 'A' | 'B' | 'D'

const normalizeBucket = (bucket: any): BucketType | null => {
  const upper = String(bucket || '').toUpperCase()
  if (upper === 'A') return 'A'
  if (upper === 'B' || upper === 'C') return 'B'
  if (upper === 'D' || upper === 'S') return 'D'
  return null
}

export async function POST(request: NextRequest) {
  const db = getDatabase()
  const queue = getQueueManager()
  const parentRequestId = request.headers.get('x-request-id') || undefined
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    const body = await request.json()
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'offerIds参数无效（1~50个数字ID）' },
        { status: 400 }
      )
    }

    const offerIds = Array.from(new Set(parsed.data.offerIds))
    if (offerIds.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request', message: '请选择Offer' },
        { status: 400 }
      )
    }
    if (offerIds.length > 50) {
      return NextResponse.json(
        { error: 'Too many offers', message: '单次最多支持50个Offer' },
        { status: 400 }
      )
    }

    // 统一校验 Google Ads API 配置（用户级），避免逐Offer失败
    const auth = await getUserAuthType(userIdNum)
    try {
      const googleAdsConfig = await getGoogleAdsConfig(
        userIdNum,
        auth.authType,
        auth.serviceAccountId
      )

      const isConfigComplete = auth.authType === 'service_account'
        ? !!(googleAdsConfig?.developerToken && googleAdsConfig?.customerId)
        : !!(googleAdsConfig?.developerToken && googleAdsConfig?.refreshToken && googleAdsConfig?.customerId)

      if (!isConfigComplete) {
        return NextResponse.json(
          {
            error: '广告创意生成需要完整的 Google Ads API 配置',
            details: auth.authType === 'service_account'
              ? '请前往【设置】→【服务账号配置】页面检查服务账号配置，确保 Developer Token 和 MCC Customer ID 已正确配置。'
              : '请前往【设置】页面配置 Google Ads API 凭证（Developer Token、Refresh Token、Customer ID）以启用关键词搜索量查询功能。',
            missingFields: auth.authType === 'service_account'
              ? [
                  !googleAdsConfig?.developerToken && 'Developer Token',
                  !googleAdsConfig?.customerId && 'MCC Customer ID',
                ].filter(Boolean)
              : [
                  !googleAdsConfig?.developerToken && 'Developer Token',
                  !googleAdsConfig?.refreshToken && 'Refresh Token / OAuth',
                  !googleAdsConfig?.customerId && 'Customer ID',
                ].filter(Boolean),
            authType: auth.authType,
          },
          { status: 400 }
        )
      }
    } catch (error: any) {
      console.error('[BatchCreativeGeneration] Failed to check Google Ads config:', error)
      // 不阻止任务继续（允许降级运行，但会记录警告）
    }

    // 1) 批量读取Offer状态（只处理当前用户且未删除）
    const placeholders = offerIds.map(() => '?').join(',')
    const notDeletedCondition = db.type === 'postgres'
      ? '(is_deleted = false OR is_deleted IS NULL)'
      : '(is_deleted = 0 OR is_deleted IS NULL)'

    const offers = await db.query<{ id: number; scrape_status: string | null }>(
      `SELECT id, scrape_status
       FROM offers
       WHERE user_id = ? AND id IN (${placeholders}) AND ${notDeletedCondition}`,
      [userIdNum, ...offerIds]
    )
    const offersById = new Map(offers.map(o => [o.id, o]))

    // 2) 查询是否已有 pending/running 的创意任务
    const activeTasks = await db.query<{ offer_id: number }>(
      `SELECT DISTINCT offer_id
       FROM creative_tasks
       WHERE user_id = ? AND offer_id IN (${placeholders}) AND status IN ('pending', 'running')`,
      [userIdNum, ...offerIds]
    )
    const offersWithActiveTask = new Set(activeTasks.map(t => t.offer_id))

    // 3) 聚合每个Offer已使用的KISS-3类型数量（A/B/D）
    const isDeletedCheck = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'
    const existingBuckets = await db.query<{ offer_id: number; keyword_bucket: string }>(
      `SELECT offer_id, keyword_bucket
       FROM ad_creatives
       WHERE user_id = ? AND offer_id IN (${placeholders}) AND keyword_bucket IS NOT NULL AND ${isDeletedCheck}`,
      [userIdNum, ...offerIds]
    )

    const usedTypesByOffer = new Map<number, Set<BucketType>>()
    for (const row of existingBuckets) {
      const type = normalizeBucket(row.keyword_bucket)
      if (!type) continue
      const set = usedTypesByOffer.get(row.offer_id) || new Set<BucketType>()
      set.add(type)
      usedTypesByOffer.set(row.offer_id, set)
    }

    // 4) 逐Offer入队（符合规则的才入队）
    const stats = {
      requested: offerIds.length,
      enqueued: 0,
      skipped: 0,
      failed: 0,
      skipReasons: {
        notFoundOrNoAccess: 0,
        scrapeNotReady: 0,
        taskAlreadyRunning: 0,
        quotaFull: 0,
      }
    }

    const taskIds: string[] = []

    for (const offerId of offerIds) {
      const offer = offersById.get(offerId)
      if (!offer) {
        stats.skipped++
        stats.skipReasons.notFoundOrNoAccess++
        continue
      }

      const scrapeStatus = String(offer.scrape_status || '').toLowerCase()
      if (scrapeStatus !== 'completed') {
        stats.skipped++
        stats.skipReasons.scrapeNotReady++
        continue
      }

      if (offersWithActiveTask.has(offerId)) {
        stats.skipped++
        stats.skipReasons.taskAlreadyRunning++
        continue
      }

      const usedTypes = usedTypesByOffer.get(offerId) || new Set<BucketType>()
      if (usedTypes.size >= 3) {
        stats.skipped++
        stats.skipReasons.quotaFull++
        continue
      }

      const taskId = crypto.randomUUID()
      try {
        await db.exec(
          `INSERT INTO creative_tasks (
            id, user_id, offer_id, status, stage, progress, message,
            max_retries, target_rating, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', 'init', 0, '准备开始生成...', ?, ?, ${nowFunc}, ${nowFunc})`,
          [taskId, userIdNum, offerId, 3, 'EXCELLENT']
        )

        const taskData: AdCreativeTaskData = {
          offerId,
          maxRetries: 3,
          targetRating: 'EXCELLENT',
          synthetic: false,
        }

        await queue.enqueue('ad-creative', taskData, userIdNum, {
          parentRequestId,
          priority: 'high',
          taskId,
          maxRetries: 0,
        })

        stats.enqueued++
        taskIds.push(taskId)
      } catch (error: any) {
        stats.failed++
        console.error(`[BatchCreativeGeneration] Enqueue failed (offerId=${offerId}):`, error?.message || error)
        // 不中断批量：尽力将任务标记为失败（若记录已插入）
        try {
          await db.exec(
            `UPDATE creative_tasks
             SET status = 'failed', message = ?, error = ?, completed_at = ${nowFunc}, updated_at = ${nowFunc}
             WHERE id = ? AND user_id = ?`,
            [
              error?.message || '任务入队失败',
              toDbJsonObjectField(
                { message: error?.message || String(error), stack: error?.stack },
                db.type,
                { message: error?.message || String(error) }
              ),
              taskId,
              userIdNum,
            ]
          )
        } catch (markError) {
          console.error('[BatchCreativeGeneration] Failed to mark task as failed:', markError)
        }
      }
    }

    return NextResponse.json({
      success: true,
      requestedCount: stats.requested,
      enqueuedCount: stats.enqueued,
      skippedCount: stats.skipped,
      failedCount: stats.failed,
      skipReasons: stats.skipReasons,
      taskIds,
    })
  } catch (error: any) {
    console.error('[BatchCreativeGeneration] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error?.message || '批量创建失败' },
      { status: 500 }
    )
  }
}
