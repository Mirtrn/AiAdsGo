import { NextRequest, NextResponse } from 'next/server'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'
import { syncOpenclawConfig } from '@/lib/openclaw/config'
import { getOpenclawGatewaySnapshot } from '@/lib/openclaw/gateway-ws'

type GatewayStatusPayload = {
  success: boolean
  fetchedAt?: string
  health?: any | null
  skills?: any | null
  errors?: string[]
  error?: string
}

export async function POST(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可执行配置热加载' }, { status: 403 })
  }

  try {
    await syncOpenclawConfig({ reason: 'openclaw-manual-hot-reload' })
  } catch (error: any) {
    const message = error?.message || 'OpenClaw 配置同步失败'
    console.error('[openclaw] manual config hot reload sync failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }

  let gatewayStatus: GatewayStatusPayload
  try {
    const snapshot = await getOpenclawGatewaySnapshot({ force: true })
    gatewayStatus = { success: true, ...snapshot }
  } catch (error: any) {
    const message = error?.message || 'Gateway 状态获取失败'
    console.error('[openclaw] manual config hot reload status check failed:', message)
    gatewayStatus = {
      success: false,
      error: message,
    }
  }

  return NextResponse.json({
    success: true,
    reloadedAt: new Date().toISOString(),
    gatewayStatus,
    message: gatewayStatus.success
      ? '配置已同步并触发 Gateway 热加载'
      : '配置已同步，Gateway 状态暂不可用',
  })
}
