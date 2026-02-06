import { NextRequest, NextResponse } from 'next/server'
import { getOpenclawGatewaySnapshot } from '@/lib/openclaw/gateway-ws'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

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
    return NextResponse.json(
      { success: false, error: error?.message || '获取 Gateway 状态失败' },
      { status: 502 }
    )
  }
}
