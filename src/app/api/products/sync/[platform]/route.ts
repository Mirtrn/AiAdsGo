import { NextRequest, NextResponse } from 'next/server'
import {
  ConfigRequiredError,
  checkAffiliatePlatformConfig,
  createAffiliateProductSyncRun,
  normalizeAffiliatePlatform,
  type SyncMode,
} from '@/lib/affiliate-products'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import { isOpenclawEnabledForUser } from '@/lib/openclaw/request-auth'

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

    const openclawEnabled = await isOpenclawEnabledForUser(userId)
    if (!openclawEnabled) {
      return NextResponse.json({ error: 'OpenClaw 功能未开启' }, { status: 403 })
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

    const runId = await createAffiliateProductSyncRun({
      userId,
      platform,
      mode,
      triggerSource: 'manual',
      status: 'queued',
    })

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
      taskId,
      message: '商品同步任务已提交',
    })
  } catch (error: any) {
    if (error instanceof ConfigRequiredError) {
      return NextResponse.json(
        {
          error: '请先在 OpenClaw 配置该联盟平台参数',
          code: error.code,
          platform: error.platform,
          missingKeys: error.missingKeys,
          redirect: '/openclaw',
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
