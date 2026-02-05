import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  const db = await getDatabase()
  const searchParams = request.nextUrl.searchParams
  const actionLimit = Math.min(Number(searchParams.get('limit') || 50), 200)

  const run = await db.queryOne<any>(
    `
      SELECT id, mode, status, run_date, config_json, stats_json, error_message, started_at, completed_at, created_at
      FROM openclaw_strategy_runs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [auth.userId]
  )

  const actions = await db.query<any>(
    `
      SELECT id, run_id, action_type, target_type, target_id, status, error_message, created_at
      FROM openclaw_strategy_actions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [auth.userId, actionLimit]
  )

  const asinStats = await db.query<{ status: string; count: number }>(
    `
      SELECT status, COUNT(*) as count
      FROM openclaw_asin_items
      WHERE user_id = ?
      GROUP BY status
    `,
    [auth.userId]
  )

  const stats = asinStats.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = Number(row.count) || 0
    return acc
  }, {})

  return NextResponse.json({
    success: true,
    run,
    actions,
    asinStats: stats,
  })
}
