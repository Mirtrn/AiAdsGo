import { NextRequest, NextResponse } from 'next/server'
import { getOpenclawGatewaySnapshot } from '@/lib/openclaw/gateway-ws'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'
import { syncOpenclawConfig } from '@/lib/openclaw/config'

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const url = new URL(request.url)
  const force = url.searchParams.get('force') === '1'

  try {
    const snapshot = await getOpenclawGatewaySnapshot({ force })
    return NextResponse.json({ success: true, ...snapshot })
  } catch (error: any) {
    const firstError = error?.message || '获取 Gateway 状态失败'
    console.error('[openclaw] gateway status fetch failed:', firstError)

    if (force) {
      try {
        await syncOpenclawConfig({
          reason: 'gateway-status-repair',
          actorUserId: auth.user.userId,
        })

        const repairedSnapshot = await getOpenclawGatewaySnapshot({ force: true })
        return NextResponse.json({
          success: true,
          recovered: true,
          warnings: [firstError],
          ...repairedSnapshot,
        })
      } catch (retryError: any) {
        const retryMessage = retryError?.message || 'Gateway 修复重试失败'
        console.error('[openclaw] gateway status repair retry failed:', retryMessage)
        return NextResponse.json(
          {
            success: false,
            error: retryMessage,
            retryError: firstError,
          },
          { status: 502 }
        )
      }
    }

    return NextResponse.json(
      { success: false, error: firstError },
      { status: 502 }
    )
  }
}
