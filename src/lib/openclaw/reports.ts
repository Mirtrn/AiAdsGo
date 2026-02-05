import { getDatabase } from '@/lib/db'
import { fetchAutoadsJson } from '@/lib/openclaw/autoads-client'
import { invokeOpenclawTool } from '@/lib/openclaw/gateway'
import { writeDailyReportToBitable, writeDailyReportToDoc } from '@/lib/openclaw/feishu-docs'

type DailyReportPayload = {
  date: string
  generatedAt: string
  summary?: any
  kpis?: any
  trends?: any
  roi?: any
  campaigns?: any
  budget?: any
  performance?: any
  actions?: any[]
  strategyActions?: any[]
  strategyRun?: any
  errors?: Array<{ source: string; message: string }>
}

const DEFAULT_TIMEZONE = process.env.TZ || 'Asia/Shanghai'
const reportInflight = new Map<string, Promise<DailyReportPayload>>()

function formatLocalDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

async function fetchWithGuard<T>(source: string, fn: () => Promise<T>, errors: DailyReportPayload['errors']) {
  try {
    return await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errors?.push({ source, message })
    return null
  }
}

export async function buildOpenclawDailyReport(userId: number, dateStr?: string): Promise<DailyReportPayload> {
  const reportDate = dateStr || formatLocalDate(new Date())
  const errors: DailyReportPayload['errors'] = []

  const [summary, kpis, trends, roi, campaigns, budget, performance] = await Promise.all([
    fetchWithGuard('dashboard.summary', () => fetchAutoadsJson({
      userId,
      path: '/api/dashboard/summary',
      query: { days: 30 },
    }), errors),
    fetchWithGuard('dashboard.kpis', () => fetchAutoadsJson({
      userId,
      path: '/api/dashboard/kpis',
      query: { days: 7 },
    }), errors),
    fetchWithGuard('dashboard.trends', () => fetchAutoadsJson({
      userId,
      path: '/api/dashboard/trends',
      query: { days: 30 },
    }), errors),
    fetchWithGuard('analytics.roi', () => fetchAutoadsJson({
      userId,
      path: '/api/analytics/roi',
      query: { start_date: reportDate, end_date: reportDate },
    }), errors),
    fetchWithGuard('dashboard.campaigns', () => fetchAutoadsJson({
      userId,
      path: '/api/dashboard/campaigns',
      query: { days: 30, pageSize: 5, sortBy: 'cost', sortOrder: 'desc' },
    }), errors),
    fetchWithGuard('analytics.budget', () => fetchAutoadsJson({
      userId,
      path: '/api/analytics/budget',
      query: { start_date: reportDate, end_date: reportDate },
    }), errors),
    fetchWithGuard('campaigns.performance', () => fetchAutoadsJson({
      userId,
      path: '/api/campaigns/performance',
      query: { daysBack: 7 },
    }), errors),
  ])

  const db = await getDatabase()
  const actions = await db.query<any>(
    `SELECT id, channel, sender_id, action, target_type, target_id, status, error_message, created_at
     FROM openclaw_action_logs
     WHERE user_id = ?
       AND DATE(created_at) = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId, reportDate]
  )

  const strategyActions = await db.query<any>(
    `SELECT id, action_type, target_type, target_id, status, error_message, created_at
     FROM openclaw_strategy_actions
     WHERE user_id = ?
       AND DATE(created_at) = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId, reportDate]
  )

  const strategyRun = await db.queryOne<any>(
    `SELECT id, mode, status, run_date, stats_json, error_message, started_at, completed_at, created_at
     FROM openclaw_strategy_runs
     WHERE user_id = ? AND run_date = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, reportDate]
  )

  return {
    date: reportDate,
    generatedAt: new Date().toISOString(),
    summary,
    kpis,
    trends,
    roi,
    campaigns,
    budget,
    performance,
    actions,
    strategyActions,
    strategyRun,
    errors: errors && errors.length > 0 ? errors : undefined,
  }
}

export async function getOrCreateDailyReport(userId: number, dateStr?: string): Promise<DailyReportPayload> {
  const reportDate = dateStr || formatLocalDate(new Date())
  const inflightKey = `${userId}:${reportDate}`

  const inflight = reportInflight.get(inflightKey)
  if (inflight) {
    return inflight
  }

  const task = (async () => {
    const db = await getDatabase()

    const existing = await db.queryOne<{ payload_json: string | null }>(
      'SELECT payload_json FROM openclaw_daily_reports WHERE user_id = ? AND report_date = ?',
      [userId, reportDate]
    )

    if (existing?.payload_json) {
      try {
        return JSON.parse(existing.payload_json) as DailyReportPayload
      } catch {
        // fall through to rebuild
      }
    }

    const report = await buildOpenclawDailyReport(userId, reportDate)
    const payloadJson = JSON.stringify(report)

    await db.exec(
      `INSERT INTO openclaw_daily_reports (user_id, report_date, payload_json, sent_status)
       VALUES (?, ?, ?, 'pending')
       ON CONFLICT(user_id, report_date)
       DO UPDATE SET payload_json = excluded.payload_json`,
      [userId, reportDate, payloadJson]
    )

    await db.exec(
      `INSERT INTO openclaw_knowledge_base (user_id, report_date, summary_json, notes)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, report_date)
       DO UPDATE SET summary_json = excluded.summary_json, notes = excluded.notes`,
      [
        userId,
        reportDate,
        JSON.stringify({
          summary: report.summary?.kpis,
          roi: report.roi?.data?.overall,
          budget: report.budget?.data?.overall,
          actions: (report.actions || []).length,
        }),
        null,
      ]
    )

    return report
  })()

  reportInflight.set(inflightKey, task)
  try {
    return await task
  } finally {
    reportInflight.delete(inflightKey)
  }
}

function formatReportMessage(report: DailyReportPayload): string {
  const summary = report.summary?.kpis
  const kpis = report.kpis?.data
  const roi = report.roi?.data?.overall
  const totalCost = roi ? Number(roi.totalCost) || 0 : 0
  const totalRevenue = roi ? Number(roi.totalRevenue) || 0 : 0
  const roas = totalCost > 0 ? totalRevenue / totalCost : 0
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim()

  const lines: string[] = []
  lines.push(`📊 OpenClaw 每日报表 ${report.date}`)
  if (summary) {
    lines.push(`- Offers: ${summary.totalOffers ?? 0} | Campaigns: ${summary.totalCampaigns ?? 0}`)
    lines.push(`- Clicks: ${summary.totalClicks ?? 0} | Cost: ${summary.totalCost ?? 0}`)
  }
  if (kpis?.current) {
    lines.push(`- Impressions: ${kpis.current.impressions ?? 0} | Conversions: ${kpis.current.conversions ?? 0}`)
  }
  if (roi) {
    lines.push(`- Revenue: ${totalRevenue} | Cost: ${totalCost} | Profit: ${roi.totalProfit ?? 0}`)
    lines.push(`- ROAS: ${roas.toFixed(2)}x | ROI: ${roi.roi ?? 0}%`)
  }
  if (report.budget?.data?.overall) {
    const overall = report.budget.data.overall
    lines.push(`- Budget: ${overall.totalBudget ?? 0} | Spent: ${overall.totalSpent ?? 0} | Remaining: ${overall.remaining ?? 0}`)
  }
  if (appUrl) {
    lines.push(`🔗 查看详情: ${appUrl}/openclaw`)
  }

  return lines.join('\n')
}

export async function sendDailyReportToFeishu(params: {
  userId: number
  target?: string
  date?: string
}): Promise<void> {
  const report = await getOrCreateDailyReport(params.userId, params.date)
  const message = formatReportMessage(report)
  let sentAny = false

  if (params.target) {
    await invokeOpenclawTool({
      tool: 'message',
      action: 'send',
      args: {
        channel: 'feishu',
        target: params.target,
        message,
      },
    })
    sentAny = true
  }

  try {
    await writeDailyReportToBitable(params.userId, report)
    sentAny = true
  } catch (error) {
    console.error('❌ 写入飞书多维表格失败:', error)
  }

  try {
    await writeDailyReportToDoc(params.userId, report)
    sentAny = true
  } catch (error) {
    console.error('❌ 写入飞书文档失败:', error)
  }

  const db = await getDatabase()
  await db.exec(
    `UPDATE openclaw_daily_reports
     SET sent_status = ?, sent_at = datetime('now')
     WHERE user_id = ? AND report_date = ?`,
    [sentAny ? 'sent' : 'failed', params.userId, report.date]
  )
}
