import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

function parseJsonObject(value: unknown): Record<string, any> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, any>
        : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

export async function GET(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
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

  const latestKnowledge = await db.queryOne<any>(
    `
      SELECT report_date, summary_json, notes, created_at
      FROM openclaw_knowledge_base
      WHERE user_id = ?
      ORDER BY report_date DESC, created_at DESC
      LIMIT 1
    `,
    [auth.userId]
  )

  const knowledgeSummary = parseJsonObject(latestKnowledge?.summary_json)
  const strategySummary = parseJsonObject(knowledgeSummary.strategy)
  const strategyRecommendation = Object.keys(strategySummary).length > 0
    ? {
      guardLevel: strategySummary.guardLevel ?? null,
      publishFailureRate: strategySummary.publishFailureRate ?? null,
      nextMaxOffersPerRun: strategySummary.recommendedMaxOffersPerRun ?? null,
      nextDefaultBudget: strategySummary.recommendedDefaultBudget ?? null,
      nextMaxCpc: strategySummary.recommendedMaxCpc ?? null,
      recommendationSource: strategySummary.recommendationSource ?? null,
      recommendationNote: strategySummary.recommendationNote ?? null,
    }
    : null

  return NextResponse.json({
    success: true,
    run,
    actions,
    asinStats: stats,
    latestKnowledge,
    strategyRecommendation,
  })
}
