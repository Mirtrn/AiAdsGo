import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateDailyReport } from '@/lib/openclaw/reports'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const date = request.nextUrl.searchParams.get('date') || undefined
  const report = await getOrCreateDailyReport(auth.user.userId, date)

  return NextResponse.json({ success: true, report })
}
