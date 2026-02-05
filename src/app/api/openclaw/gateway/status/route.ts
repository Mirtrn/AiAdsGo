import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getOpenclawGatewaySnapshot } from '@/lib/openclaw/gateway-ws'

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: auth.error || '未授权' }, { status: 401 })
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
