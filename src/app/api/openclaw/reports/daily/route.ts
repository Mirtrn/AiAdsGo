import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getOrCreateDailyReport } from '@/lib/openclaw/reports'
import { isOpenclawEnabledForUser } from '@/lib/openclaw/request-auth'

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: auth.error || '未授权' }, { status: 401 })
  }

  const openclawEnabled = await isOpenclawEnabledForUser(auth.user.userId)
  if (!openclawEnabled) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启' }, { status: 403 })
  }

  const date = request.nextUrl.searchParams.get('date') || undefined
  const report = await getOrCreateDailyReport(auth.user.userId, date)

  return NextResponse.json({ success: true, report })
}
