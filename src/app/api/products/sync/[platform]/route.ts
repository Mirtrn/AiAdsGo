import { NextRequest, NextResponse } from 'next/server'
import {
  ConfigRequiredError,
  checkAffiliatePlatformConfig,
  createAffiliateProductSyncRun,
  getLatestFailedAffiliateProductSyncRun,
  normalizeAffiliatePlatform,
  type SyncMode,
  updateAffiliateProductSyncRun,
} from '@/lib/affiliate-products'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'
import { getYeahPromosSessionState } from '@/lib/yeahpromos-session'

type RouteParams = {
  platform: string
}

type SyncStrategy = 'light' | 'full'

function resolveSyncMode(params: {
  platform: 'partnerboost' | 'yeahpromos'
  strategy?: string
}): { mode: SyncMode; strategy: SyncStrategy } {
  const strategyRaw = String(params.strategy || '').trim().toLowerCase()
  const strategy: SyncStrategy = strategyRaw === 'full' ? 'full' : strategyRaw === 'light' ? 'light' : (
    params.platform === 'partnerboost' ? 'light' : 'full'
  )

  return {
    mode: strategy === 'full' ? 'platform' : 'delta',
    strategy,
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  try {
    const userIdRaw = request.headers.get('x-user-id')
    if (!userIdRaw) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = Number(userIdRaw)
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const resolved = await params
    const platform = normalizeAffiliatePlatform(resolved.platform)
    if (!platform) {
      return NextResponse.json({ error: '不支持的平台' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const { mode } = resolveSyncMode({
      platform,
      strategy: body?.strategy,
    })

    const configCheck = await checkAffiliatePlatformConfig(userId, platform)
    if (!configCheck.configured) {
      throw new ConfigRequiredError(platform, configCheck.missingKeys)
    }

    if (platform === 'yeahpromos') {
      const session = await getYeahPromosSessionState(userId)
      if (!session.hasSession) {
        return NextResponse.json(
          {
            error: session.isExpired
              ? 'YeahPromos 登录态已过期，请在商品页重新完成手动登录态采集'
              : '请先在商品页完成 YeahPromos 手动登录态采集',
            code: 'YP_SESSION_REQUIRED',
            redirect: '/products',
          },
          { status: 400 }
        )
      }
    }

    const runId = await createAffiliateProductSyncRun({
      userId,
      platform,
      mode,
      triggerSource: 'manual',
      status: 'queued',
    })

    let resumedFromRunId: number | null = null
    if (mode === 'platform') {
      const latestFailedRun = await getLatestFailedAffiliateProductSyncRun({
        userId,
        platform,
        mode: 'platform',
        excludeRunId: runId,
      })

      if (latestFailedRun && latestFailedRun.cursor_page > 0) {
        const totalItems = Math.max(0, Number(latestFailedRun.total_items || 0))
        const createdCount = Math.max(0, Number(latestFailedRun.created_count || 0))
        const updatedCount = Math.max(0, Number(latestFailedRun.updated_count || 0))
        const processedBatches = Math.max(0, Number(latestFailedRun.processed_batches || 0))
        const cursorPage = Math.max(1, Number(latestFailedRun.cursor_page || 1))
        const cursorScope = String(latestFailedRun.cursor_scope || '').trim() || null

        await updateAffiliateProductSyncRun({
          runId,
          totalItems,
          createdCount,
          updatedCount,
          failedCount: 0,
          cursorPage,
          cursorScope,
          processedBatches,
          lastHeartbeatAt: null,
          errorMessage: null,
          completedAt: null,
        })
        resumedFromRunId = latestFailedRun.id
      }
    }

    const queue = getQueueManagerForTaskType('affiliate-product-sync')
    const taskId = await queue.enqueue(
      'affiliate-product-sync',
      {
        userId,
        platform,
        mode,
        runId,
        trigger: 'manual',
      },
      userId,
      {
        priority: 'normal',
        maxRetries: 1,
        parentRequestId: request.headers.get('x-request-id') || undefined,
      }
    )

    return NextResponse.json({
      success: true,
      runId,
      resumedFromRunId,
      taskId,
      message: '商品同步任务已提交',
    })
  } catch (error: any) {
    if (error instanceof ConfigRequiredError) {
      return NextResponse.json(
        {
          error: '请先在商品管理页完成联盟平台配置',
          code: error.code,
          platform: error.platform,
          missingKeys: error.missingKeys,
          redirect: '/products',
        },
        { status: 400 }
      )
    }

    console.error('[POST /api/products/sync/:platform] failed:', error)
    return NextResponse.json(
      { error: error?.message || '提交同步任务失败' },
      { status: 500 }
    )
  }
}
