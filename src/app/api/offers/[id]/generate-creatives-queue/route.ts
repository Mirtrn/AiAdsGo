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
import { createError } from '@/lib/errors'
import { getGoogleAdsConfig } from '@/lib/keyword-planner'
import { getUserAuthType } from '@/lib/google-ads-oauth'
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

  // 🔧 修复(2025-12-26): 使用中心化授权方式判断
  const auth = await getUserAuthType(parseInt(userId, 10))

  // 2. 验证 Google Ads API 配置（支持 OAuth 和服务账号两种模式）
  try {
    const googleAdsConfig = await getGoogleAdsConfig(
      parseInt(userId, 10),
      auth.authType,
      auth.serviceAccountId
    )

    // OAuth 模式需要检查 refreshToken，服务账号模式需要检查 serviceAccountId
    const isConfigComplete = auth.authType === 'service_account'
      ? !!(googleAdsConfig?.developerToken && googleAdsConfig?.customerId)
      : !!(googleAdsConfig?.developerToken && googleAdsConfig?.refreshToken && googleAdsConfig?.customerId)

    if (!isConfigComplete) {
      console.warn(`[CreativeGeneration] User ${userId} has incomplete Google Ads config (authType: ${auth.authType})`)
      return new Response(
        JSON.stringify({
          error: '广告创意生成需要完整的 Google Ads API 配置',
          details: auth.authType === 'service_account'
            ? '请前往【设置】→【服务账号配置】页面检查服务账号配置，确保 Developer Token 和 MCC Customer ID 已正确配置。'
            : '请前往【设置】页面配置 Google Ads API 凭证（Developer Token、Refresh Token、Customer ID）以启用关键词搜索量查询功能。',
          missingFields: auth.authType === 'service_account'
            ? [
                !googleAdsConfig?.developerToken && 'Developer Token',
                !googleAdsConfig?.customerId && 'MCC Customer ID'
              ].filter(Boolean)
            : [
                !googleAdsConfig?.developerToken && 'Developer Token',
                !googleAdsConfig?.refreshToken && 'Refresh Token / OAuth',
                !googleAdsConfig?.customerId && 'Customer ID'
              ].filter(Boolean),
          authType: auth.authType
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }
  } catch (error: any) {
    console.error('[CreativeGeneration] Failed to check Google Ads config:', error)
    // 不阻止任务继续（允许降级运行，但会记录警告）
  }

  try {
    const db = getDatabase()

    // 🆕 检查是否已达到5次生成上限
    const existingCreatives = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM ad_creatives
       WHERE offer_id = ? AND user_id = ?`,
      [parseInt(id, 10), parseInt(userId, 10)]
    )

    const currentCount = existingCreatives[0]?.count || 0
    if (currentCount >= 5) {
      const error = createError.creativeQuotaExceeded({
        round: 1,
        current: currentCount,
        limit: 5
      })
      return new Response(JSON.stringify(error.toJSON()), {
        status: error.httpStatus,
        headers: { 'Content-Type': 'application/json' }
      })
    }

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
