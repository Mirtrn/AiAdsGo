import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateDailyReport } from '@/lib/openclaw/reports'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import { getOpenclawSettingsMap } from '@/lib/openclaw/settings'

function parseBooleanQuery(value: string | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function normalizeAffiliateSyncMode(value: string | null | undefined): 'incremental' | 'realtime' {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'realtime' ? 'realtime' : 'incremental'
}

export async function GET(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const date = request.nextUrl.searchParams.get('date') || undefined
  const forceRealtimeFromQuery = (
    parseBooleanQuery(request.nextUrl.searchParams.get('force_realtime'))
    || parseBooleanQuery(request.nextUrl.searchParams.get('forceRealtime'))
    || parseBooleanQuery(request.nextUrl.searchParams.get('refresh'))
    || parseBooleanQuery(request.nextUrl.searchParams.get('realtime'))
  )

  let forceRefresh = forceRealtimeFromQuery
  let forceRefreshReason: 'query' | 'feishu_mode' | null = forceRealtimeFromQuery ? 'query' : null

  if (!forceRefresh && auth.authType === 'gateway-binding') {
    const channel = String(request.headers.get('x-openclaw-channel') || '').trim().toLowerCase()
    if (channel === 'feishu') {
      const settings = await getOpenclawSettingsMap(auth.userId)
      const syncMode = normalizeAffiliateSyncMode(settings.openclaw_affiliate_sync_mode)
      if (syncMode === 'realtime') {
        forceRefresh = true
        forceRefreshReason = 'feishu_mode'
      }
    }
  }

  const report = await getOrCreateDailyReport(auth.userId, date, { forceRefresh })

  return NextResponse.json({
    success: true,
    report,
    forceRefreshApplied: forceRefresh,
    forceRefreshReason,
  })
}
