import { getDatabase } from '@/lib/db'
import { fetchAutoadsJson } from '@/lib/openclaw/autoads-client'
import { fetchAffiliateCommissionRevenue, type AffiliateCommissionRevenue } from '@/lib/openclaw/affiliate-revenue'
import { invokeOpenclawTool } from '@/lib/openclaw/gateway'
import { resolveUserFeishuAccountId } from '@/lib/openclaw/feishu-accounts'
import { writeDailyReportToBitable, writeDailyReportToDoc } from '@/lib/openclaw/feishu-docs'
import { toDbJsonObjectField } from '@/lib/json-field'

type DailyReportPayload = {
  date: string
  generatedAt: string
  summary?: any
  kpis?: any
  dailySnapshot?: DailyPerformanceSnapshot
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

type DailyPerformanceSnapshot = {
  impressions: number
  clicks: number
  cost: number
  conversions: number
}

type StrategyKnowledgeSummary = {
  runsTotal: number
  runsSuccess: number
  runsFailed: number
  runsSkipped: number
  mode: string
  reason: string | null
  adjustment: string
  guardLevel: string
  publishFailureRate: number
  offersConsidered: number
  campaignsPublished: number
  campaignsPaused: number
  publishSuccess: number
  publishFailed: number
  actionSuccess: number
  actionFailed: number
  circuitBreakTriggered: boolean
  circuitBreakPaused: number
  rankCandidateCount: number
  rankSelectedCount: number
  rankSelectedAverageScore: number
  recommendedMaxOffersPerRun: number
  recommendedDefaultBudget: number
  recommendedMaxCpc: number
  recommendationSource: 'effective_config' | 'failure_guard_after' | 'adaptive_after' | 'none'
  recommendationNote: string
  topPublishFailureReasons: string[]
}

const DEFAULT_TIMEZONE = process.env.TZ || 'Asia/Shanghai'
const reportInflight = new Map<string, Promise<DailyReportPayload>>()
const reportDeliveryInflight = new Map<string, Promise<void>>()

type DailyReportLoadOptions = {
  forceRefresh?: boolean
}

type SendDailyReportToFeishuParams = {
  userId: number
  target?: string
  date?: string
  deliveryTaskId?: string
}

function formatLocalDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function parseMaybeJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  if (typeof value === 'object') return value as T
  return fallback
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeCurrencyCode(value: unknown, fallback = 'USD'): string {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized) return fallback
  if (normalized === 'MIXED' || /^[A-Z]{3}$/.test(normalized)) {
    return normalized
  }
  return fallback
}

function formatMoney(value: unknown, currency: string): string {
  return `${roundTo2(toNumber(value, 0))} ${normalizeCurrencyCode(currency)}`
}

function asObject(value: unknown): Record<string, any> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, any>
}

function mergeRoiWithAffiliateRevenue(params: {
  roi: unknown
  summary: any
  affiliateRevenue: AffiliateCommissionRevenue
  errors: DailyReportPayload['errors']
}) {
  const roiRoot = asObject(params.roi) ? { ...(params.roi as Record<string, any>) } : {}
  const roiData = asObject(roiRoot.data) ? { ...(roiRoot.data as Record<string, any>) } : {}
  const roiOverall = asObject(roiData.overall)
    ? { ...(roiData.overall as Record<string, any>) }
    : {}

  const totalCost = roundTo2(toNumber(roiOverall.totalCost, toNumber(params.summary?.kpis?.totalCost, 0)))
  const hasAffiliateConfigured = params.affiliateRevenue.configuredPlatforms.length > 0
  const hasAffiliateData = params.affiliateRevenue.queriedPlatforms.length > 0
  const revenueAvailable = hasAffiliateConfigured && hasAffiliateData

  const totalRevenue = revenueAvailable
    ? roundTo2(params.affiliateRevenue.totalCommission)
    : null
  const totalProfit = revenueAvailable
    ? roundTo2((totalRevenue || 0) - totalCost)
    : null
  const roiPercent = revenueAvailable
    ? (totalCost > 0 ? roundTo2(((totalProfit || 0) / totalCost) * 100) : 0)
    : null
  const roas = revenueAvailable
    ? (totalCost > 0 ? roundTo2((totalRevenue || 0) / totalCost) : 0)
    : null

  for (const item of params.affiliateRevenue.errors) {
    params.errors?.push({
      source: `affiliate.${item.platform}`,
      message: item.message,
    })
  }

  roiData.overall = {
    ...roiOverall,
    totalCost,
    totalRevenue,
    totalProfit,
    roi: roiPercent,
    roas,
    revenueAvailable,
    revenueSource: revenueAvailable ? 'affiliate_commission' : 'unavailable',
    unavailableReason: revenueAvailable
      ? null
      : hasAffiliateConfigured
        ? 'affiliate_query_failed'
        : 'affiliate_not_configured',
    affiliateCommissionRevenue: roundTo2(params.affiliateRevenue.totalCommission),
    affiliateConfiguredPlatforms: params.affiliateRevenue.configuredPlatforms,
    affiliateQueriedPlatforms: params.affiliateRevenue.queriedPlatforms,
    affiliateBreakdown: params.affiliateRevenue.breakdown,
    affiliateAttribution: params.affiliateRevenue.attribution,
  }

  return {
    ...roiRoot,
    data: roiData,
  }
}

function getTopReasons(messages: unknown[], limit = 3): string[] {
  const counts = new Map<string, number>()
  for (const item of messages) {
    const text = String(item || '').trim()
    if (!text) continue
    const normalized = text.slice(0, 120)
    counts.set(normalized, (counts.get(normalized) || 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => `${reason} (${count})`)
}

function buildRecommendationNote(params: {
  guardLevel: string
  publishFailureRate: number
  reason: string | null
}): string {
  if (params.reason === 'publish_failure_stop_loss') {
    return '上一轮触发发布止损，明日建议先排查账号状态、素材合规与落地页可用性，再恢复投放。'
  }

  if (params.guardLevel === 'strong') {
    return `发布失败率 ${(params.publishFailureRate * 100).toFixed(1)}%，建议明日执行强防守：缩量、降CPC、低预算小步验证。`
  }

  if (params.guardLevel === 'mild') {
    return `发布失败率 ${(params.publishFailureRate * 100).toFixed(1)}%，建议明日执行温和防守：控制节奏并优先验证高质量创意与关键词。`
  }

  if (params.guardLevel === 'insufficient_data') {
    return '当前样本不足，明日建议保持小规模探索，优先积累有效发布与转化样本。'
  }

  return '发布链路稳定，明日建议按建议参数稳步放量，同时持续监控ROAS与失败原因。'
}

function formatRecommendationSourceLabel(
  source: StrategyKnowledgeSummary['recommendationSource']
): string {
  switch (source) {
    case 'effective_config':
      return '最终生效配置'
    case 'failure_guard_after':
      return '风控后参数'
    case 'adaptive_after':
      return '自适应后参数'
    default:
      return '无建议来源'
  }
}

function buildStrategyKnowledgeSummary(report: DailyReportPayload): StrategyKnowledgeSummary {
  const strategyActions = Array.isArray(report.strategyActions) ? report.strategyActions : []
  const strategyStats = parseMaybeJson<Record<string, any>>(report.strategyRun?.stats_json, {})
  const runStatus = String(report.strategyRun?.status || '').toLowerCase()

  const actionSuccess = strategyActions.filter(action => action?.status === 'success').length
  const actionFailed = strategyActions.filter(action => action?.status === 'failed').length

  const publishActions = strategyActions.filter(action => action?.action_type === 'publish_campaign')
  const publishSuccess = publishActions.filter(action => action?.status === 'success').length
  const publishFailedActions = publishActions.filter(action => action?.status === 'failed')

  const topPublishFailureReasons = getTopReasons(
    publishFailedActions.map(action => action?.error_message || '发布失败（无错误信息）')
  )

  const circuitBreak = parseMaybeJson<Record<string, any>>(strategyStats.circuitBreak, {})
  const rankModel = parseMaybeJson<Record<string, any>>(strategyStats.rankModel, {})
  const failureGuard = parseMaybeJson<Record<string, any>>(strategyStats.failureGuardInsight, {})
  const adaptiveInsight = parseMaybeJson<Record<string, any>>(strategyStats.adaptiveInsight, {})
  const effectiveConfig = parseMaybeJson<Record<string, any>>(strategyStats.effectiveConfig, {})
  const failureGuardAfter = parseMaybeJson<Record<string, any>>(failureGuard.after, {})
  const adaptiveAfter = parseMaybeJson<Record<string, any>>(adaptiveInsight.after, {})

  const hasEffectiveConfig = Object.prototype.hasOwnProperty.call(effectiveConfig, 'maxOffersPerRun')
  const hasFailureGuardAfter = Object.prototype.hasOwnProperty.call(failureGuardAfter, 'maxOffersPerRun')
  const hasAdaptiveAfter = Object.prototype.hasOwnProperty.call(adaptiveAfter, 'maxOffersPerRun')

  const recommendationSource: StrategyKnowledgeSummary['recommendationSource'] = hasEffectiveConfig
    ? 'effective_config'
    : (hasFailureGuardAfter ? 'failure_guard_after' : (hasAdaptiveAfter ? 'adaptive_after' : 'none'))

  const recommendedMaxOffersPerRun = toNumber(
    effectiveConfig.maxOffersPerRun,
    toNumber(failureGuardAfter.maxOffersPerRun, toNumber(adaptiveAfter.maxOffersPerRun, 0))
  )
  const recommendedDefaultBudget = toNumber(
    effectiveConfig.defaultBudget,
    toNumber(failureGuardAfter.defaultBudget, toNumber(adaptiveAfter.defaultBudget, 0))
  )
  const recommendedMaxCpc = toNumber(
    effectiveConfig.maxCpc,
    toNumber(failureGuardAfter.maxCpc, toNumber(adaptiveAfter.maxCpc, 0))
  )

  const reason = strategyStats.reason ? String(strategyStats.reason) : null
  const circuitBreakTriggered =
    reason === 'daily_spend_cap' ||
    reason === 'daily_spend_cap_circuit_break' ||
    toNumber(circuitBreak.paused, 0) > 0 ||
    toNumber(circuitBreak.attempted, 0) > 0

  return {
    runsTotal: report.strategyRun ? 1 : 0,
    runsSuccess: runStatus === 'completed' ? 1 : 0,
    runsFailed: runStatus === 'failed' ? 1 : 0,
    runsSkipped: runStatus === 'skipped' ? 1 : 0,
    mode: String(report.strategyRun?.mode || 'auto'),
    reason,
    adjustment: String(strategyStats?.adaptiveInsight?.adjustment || 'unknown'),
    guardLevel: String(failureGuard.guardLevel || 'none'),
    publishFailureRate: toNumber(failureGuard.publishFailureRate, 0),
    offersConsidered: toNumber(strategyStats.offersConsidered, 0),
    campaignsPublished: toNumber(strategyStats.campaignsPublished, 0),
    campaignsPaused: toNumber(strategyStats.campaignsPaused, 0),
    publishSuccess,
    publishFailed: Math.max(toNumber(strategyStats.publishFailed, 0), publishFailedActions.length),
    actionSuccess,
    actionFailed,
    circuitBreakTriggered,
    circuitBreakPaused: toNumber(circuitBreak.paused, 0),
    rankCandidateCount: toNumber(rankModel.candidateCount, 0),
    rankSelectedCount: toNumber(rankModel.selectedCount, 0),
    rankSelectedAverageScore: toNumber(rankModel.selectedAverageScore, 0),
    recommendedMaxOffersPerRun,
    recommendedDefaultBudget,
    recommendedMaxCpc,
    recommendationSource,
    recommendationNote: buildRecommendationNote({
      guardLevel: String(failureGuard.guardLevel || 'none'),
      publishFailureRate: toNumber(failureGuard.publishFailureRate, 0),
      reason,
    }),
    topPublishFailureReasons,
  }
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

  const [summary, kpis, trends, roi, campaigns, budget, performance, affiliateRevenue] = await Promise.all([
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
    fetchWithGuard('affiliate.commission', () => fetchAffiliateCommissionRevenue({
      userId,
      reportDate,
    }), errors),
  ])

  const normalizedRoi = mergeRoiWithAffiliateRevenue({
    roi,
    summary,
    affiliateRevenue: affiliateRevenue || {
      reportDate,
      configuredPlatforms: [],
      queriedPlatforms: [],
      totalCommission: 0,
      breakdown: [],
      errors: [],
      attribution: {
        attributedCommission: 0,
        unattributedCommission: 0,
        attributedOffers: 0,
        attributedCampaigns: 0,
        writtenRows: 0,
      },
    },
    errors,
  })

  const db = await getDatabase()
  const dailySnapshotRow = await db.queryOne<{
    impressions: number | null
    clicks: number | null
    cost: number | null
    conversions: number | null
  }>(
    `SELECT
       COALESCE(SUM(impressions), 0) as impressions,
       COALESCE(SUM(clicks), 0) as clicks,
       COALESCE(SUM(cost), 0) as cost,
       COALESCE(SUM(conversions), 0) as conversions
     FROM campaign_performance
     WHERE user_id = ?
       AND date = ?`,
    [userId, reportDate]
  )

  const dailySnapshot: DailyPerformanceSnapshot = {
    impressions: toNumber(dailySnapshotRow?.impressions, 0),
    clicks: toNumber(dailySnapshotRow?.clicks, 0),
    cost: roundTo2(toNumber(dailySnapshotRow?.cost, 0)),
    conversions: roundTo2(toNumber(dailySnapshotRow?.conversions, 0)),
  }

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
    dailySnapshot,
    trends,
    roi: normalizedRoi,
    campaigns,
    budget,
    performance,
    actions,
    strategyActions,
    strategyRun,
    errors: errors && errors.length > 0 ? errors : undefined,
  }
}

export async function getOrCreateDailyReport(
  userId: number,
  dateStr?: string,
  options?: DailyReportLoadOptions
): Promise<DailyReportPayload> {
  const reportDate = dateStr || formatLocalDate(new Date())
  const forceRefresh = options?.forceRefresh === true
  const inflightKey = `${userId}:${reportDate}:${forceRefresh ? 'refresh' : 'cache'}`

  const inflight = reportInflight.get(inflightKey)
  if (inflight) {
    return inflight
  }

  const task = (async () => {
    const db = await getDatabase()

    if (!forceRefresh) {
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

    const existingKnowledge = await db.queryOne<{ notes: string | null }>(
      'SELECT notes FROM openclaw_knowledge_base WHERE user_id = ? AND report_date = ? LIMIT 1',
      [userId, reportDate]
    )

    const strategySummary = buildStrategyKnowledgeSummary(report)

    await db.exec(
      `INSERT INTO openclaw_knowledge_base (user_id, report_date, summary_json, notes)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, report_date)
       DO UPDATE SET summary_json = excluded.summary_json, notes = excluded.notes`,
      [
        userId,
        reportDate,
        toDbJsonObjectField(
          {
            summary: report.summary?.kpis,
            roi: report.roi?.data?.overall,
            budget: report.budget?.data?.overall,
            actions: (report.actions || []).length,
            strategy: strategySummary,
          },
          db.type,
          {
            summary: report.summary?.kpis,
            roi: report.roi?.data?.overall,
            budget: report.budget?.data?.overall,
            actions: (report.actions || []).length,
            strategy: strategySummary,
          }
        ),
        existingKnowledge?.notes || '待人工复盘：请补充今日有效策略、失败原因、修正规则。',
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

export async function refreshOpenclawDailyReportSnapshot(params: {
  userId: number
  date?: string
}): Promise<DailyReportPayload> {
  return getOrCreateDailyReport(params.userId, params.date, { forceRefresh: true })
}

function formatReportMessage(report: DailyReportPayload): string {
  const summary = report.summary?.kpis
  const kpis = report.kpis?.data
  const dailySnapshot = asObject(report.dailySnapshot)
  const roiRoot = asObject(report.roi)
  const budgetRoot = asObject(report.budget)
  const roi = report.roi?.data?.overall
  const totalCost = roi ? Number(roi.totalCost) || 0 : 0
  const totalRevenueRaw = roi?.totalRevenue
  const totalRevenue = totalRevenueRaw === null || totalRevenueRaw === undefined
    ? null
    : Number(totalRevenueRaw)
  const revenueAvailable = roi?.revenueAvailable !== false
    && totalRevenue !== null
    && Number.isFinite(totalRevenue)
  const roas = revenueAvailable
    ? (roi?.roas !== undefined
      ? Number(roi.roas) || 0
      : (totalCost > 0 ? (totalRevenue || 0) / totalCost : 0))
    : null
  const affiliateBreakdown = Array.isArray(roi?.affiliateBreakdown)
    ? roi.affiliateBreakdown as Array<{ platform?: string; totalCommission?: number; records?: number; currency?: string }>
    : []
  const affiliateRecordCount = Math.max(
    affiliateBreakdown.reduce((sum, item) => sum + (Number(item.records) || 0), 0),
    toNumber(roi?.affiliateAttribution?.writtenRows, 0)
  )
  const roiCurrency = normalizeCurrencyCode(roiRoot?.currency, 'USD')
  const budgetCurrency = normalizeCurrencyCode(budgetRoot?.currency, roiCurrency)
  const affiliateCurrencies = affiliateBreakdown
    .map((item) => normalizeCurrencyCode(item.currency, ''))
    .filter(Boolean)
  const affiliateCurrency = affiliateCurrencies.length > 0
    ? (new Set(affiliateCurrencies).size === 1 ? affiliateCurrencies[0] : 'MIXED')
    : roiCurrency
  const profitCurrency = revenueAvailable && affiliateCurrency === roiCurrency
    ? roiCurrency
    : 'MIXED'
  const dailyImpressions = Math.round(
    toNumber(dailySnapshot?.impressions, toNumber(kpis?.current?.impressions, 0))
  )
  const dailyClicks = Math.round(
    toNumber(dailySnapshot?.clicks, toNumber(kpis?.current?.clicks, toNumber(summary?.totalClicks, 0)))
  )
  const dailyConversions = roundTo2(
    toNumber(dailySnapshot?.conversions, toNumber(roi?.conversions, 0))
  )
  const dailyCost = roi
    ? roundTo2(totalCost)
    : roundTo2(
      toNumber(dailySnapshot?.cost, toNumber(kpis?.current?.cost, toNumber(summary?.totalCost, 0)))
    )
  const dailyCostCurrency = roi ? roiCurrency : budgetCurrency
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim()

  const lines: string[] = []
  const strategySummary = buildStrategyKnowledgeSummary(report)

  lines.push(`📊 OpenClaw 每日报表（${report.date}）`)
  if (summary) {
    lines.push(`- 规模概览：Offer ${summary.totalOffers ?? 0} 个｜Campaign ${summary.totalCampaigns ?? 0} 个`)
  }
  lines.push(`- 投放消耗：点击 ${dailyClicks} 次｜花费 ${formatMoney(dailyCost, dailyCostCurrency)}`)
  lines.push(`- 当日表现：曝光 ${dailyImpressions}｜转化（Google Ads）${dailyConversions}｜联盟佣金记录 ${affiliateRecordCount}`)

  if (roi) {
    if (revenueAvailable) {
      lines.push(
        `- 佣金收入：${formatMoney(totalRevenue || 0, affiliateCurrency)}｜花费：${formatMoney(totalCost, roiCurrency)}｜利润：${formatMoney(roi.totalProfit, profitCurrency)}`
      )
      lines.push(`- ROAS：${(roas || 0).toFixed(2)}x｜ROI：${roi.roi ?? 0}%`)
      lines.push('- 收入来源：联盟佣金（PartnerBoost / YeahPromos）')

      if (affiliateBreakdown.length > 0) {
        const detail = affiliateBreakdown
          .map((item) => {
            const itemCurrency = normalizeCurrencyCode(item.currency, affiliateCurrency)
            return `${item.platform || '未知平台'}：${formatMoney(item.totalCommission, itemCurrency)}（记录 ${Number(item.records) || 0}）`
          })
          .join(' | ')
        lines.push(`- 联盟拆分：${detail}`)
      }
    } else {
      lines.push(`- 花费：${formatMoney(totalCost, roiCurrency)}`)
      lines.push('- 佣金收入：暂不可用（等待联盟平台返回）')
      lines.push('- ROAS：暂不可用｜ROI：暂不可用')
      lines.push('- 收入来源：严格联盟模式（不回退 AutoAds）')
    }
  }

  if (report.budget?.data?.overall) {
    const overall = report.budget.data.overall
    const budgetTotal = roundTo2(toNumber(overall.totalBudget, 0))
    const budgetSpent = roundTo2(toNumber(overall.totalSpent, 0))
    const budgetRemaining = roundTo2(
      toNumber(overall.remaining, budgetTotal - budgetSpent)
    )
    lines.push(
      `- 预算概览：预算 ${formatMoney(budgetTotal, budgetCurrency)}｜已花费 ${formatMoney(budgetSpent, budgetCurrency)}｜剩余 ${formatMoney(budgetRemaining, budgetCurrency)}`
    )
  }

  if (strategySummary.runsTotal > 0) {
    lines.push(
      `- 策略执行：模式 ${strategySummary.mode}｜调节 ${strategySummary.adjustment}｜风控 ${strategySummary.guardLevel}｜发布成功 ${strategySummary.campaignsPublished}｜发布失败 ${strategySummary.publishFailed}`
    )
    lines.push(`- 策略动作：成功 ${strategySummary.actionSuccess}｜失败 ${strategySummary.actionFailed}`)
    if (strategySummary.publishFailureRate > 0) {
      lines.push(`- 发布失败率：${(strategySummary.publishFailureRate * 100).toFixed(1)}%`)
    }
    if (strategySummary.rankCandidateCount > 0) {
      lines.push(
        `- 排序模型：候选 ${strategySummary.rankCandidateCount}｜入选 ${strategySummary.rankSelectedCount}｜入选均分 ${strategySummary.rankSelectedAverageScore}`
      )
    }
    if (strategySummary.recommendedMaxOffersPerRun > 0) {
      lines.push(
        `- 次日建议参数：Offer上限 ${strategySummary.recommendedMaxOffersPerRun}｜默认预算 ${strategySummary.recommendedDefaultBudget}｜最大CPC ${strategySummary.recommendedMaxCpc}｜来源 ${formatRecommendationSourceLabel(strategySummary.recommendationSource)}`
      )
    }
    lines.push(`- 次日建议：${strategySummary.recommendationNote}`)
    if (strategySummary.reason) {
      lines.push(`- 策略原因：${strategySummary.reason}`)
    }
    if (strategySummary.circuitBreakTriggered) {
      lines.push(`- 熔断状态：已触发｜暂停 ${strategySummary.circuitBreakPaused}`)
    }
    if (strategySummary.topPublishFailureReasons.length > 0) {
      lines.push(`- 发布失败TOP：${strategySummary.topPublishFailureReasons.join('；')}`)
    }
  }

  if (appUrl) {
    lines.push(`🔗 详情链接：${appUrl}/openclaw`)
  }

  return lines.join('\n')
}

export async function sendDailyReportToFeishu(params: SendDailyReportToFeishuParams): Promise<void> {
  const reportDate = params.date || formatLocalDate(new Date())
  const inflightKey = params.deliveryTaskId
    ? `daily-report-delivery:${params.userId}:${reportDate}:${params.target || 'no-target'}:${params.deliveryTaskId}`
    : undefined

  if (inflightKey) {
    const existing = reportDeliveryInflight.get(inflightKey)
    if (existing) {
      return existing
    }

    const task = sendDailyReportToFeishuInternal({
      ...params,
      date: reportDate,
    })
    reportDeliveryInflight.set(inflightKey, task)
    try {
      await task
      return
    } finally {
      reportDeliveryInflight.delete(inflightKey)
    }
  }

  return sendDailyReportToFeishuInternal({
    ...params,
    date: reportDate,
  })
}

async function sendDailyReportToFeishuInternal(params: SendDailyReportToFeishuParams): Promise<void> {
  const report = await getOrCreateDailyReport(params.userId, params.date)
  const db = await getDatabase()
  const nowSql = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  if (params.deliveryTaskId) {
    const latestDelivery = await db.queryOne<{
      sent_status?: string
      last_delivery_task_id?: string | null
    }>(
      `SELECT sent_status, last_delivery_task_id
       FROM openclaw_daily_reports
       WHERE user_id = ? AND report_date = ?`,
      [params.userId, report.date]
    )

    const lastTaskId = String(latestDelivery?.last_delivery_task_id || '').trim()
    if (latestDelivery?.sent_status === 'sent' && lastTaskId === params.deliveryTaskId) {
      return
    }
  }

  await db.exec(
    `UPDATE openclaw_daily_reports
     SET delivery_attempts = COALESCE(delivery_attempts, 0) + 1,
         last_delivery_task_id = ?,
         delivery_error = NULL
     WHERE user_id = ? AND report_date = ?`,
    [params.deliveryTaskId || null, params.userId, report.date]
  )

  const message = formatReportMessage(report)
  let sentAny = false
  const errors: string[] = []
  const accountId = await resolveUserFeishuAccountId(params.userId)
  const deliveryIdempotencyKey = params.deliveryTaskId
    ? `daily-report:${params.userId}:${report.date}:${params.target || 'no-target'}:${params.deliveryTaskId}`
    : undefined

  if (params.target) {
    try {
      await invokeOpenclawTool({
        tool: 'message',
        action: 'send',
        args: {
          channel: 'feishu',
          target: params.target,
          message,
          ...(accountId ? { accountId } : {}),
        },
      }, deliveryIdempotencyKey ? { idempotencyKey: deliveryIdempotencyKey } : {})
      sentAny = true
    } catch (error: any) {
      const messageText = error?.message || String(error)
      errors.push(`target: ${messageText}`)
      console.error('❌ 推送飞书消息失败:', error)
    }
  }

  try {
    await writeDailyReportToBitable(params.userId, report)
    sentAny = true
  } catch (error: any) {
    const messageText = error?.message || String(error)
    errors.push(`bitable: ${messageText}`)
    console.error('❌ 写入飞书多维表格失败:', error)
  }

  try {
    await writeDailyReportToDoc(params.userId, report)
    sentAny = true
  } catch (error: any) {
    const messageText = error?.message || String(error)
    errors.push(`doc: ${messageText}`)
    console.error('❌ 写入飞书文档失败:', error)
  }

  const deliveryError = sentAny ? null : (errors.join(' | ') || '所有投递渠道均失败')

  await db.exec(
    `UPDATE openclaw_daily_reports
     SET sent_status = ?,
         sent_at = CASE WHEN ? THEN ${nowSql} ELSE sent_at END,
         delivery_error = ?,
         last_delivery_task_id = COALESCE(?, last_delivery_task_id)
     WHERE user_id = ? AND report_date = ?`,
    [
      sentAny ? 'sent' : 'failed',
      sentAny,
      deliveryError,
      params.deliveryTaskId || null,
      params.userId,
      report.date,
    ]
  )

  if (!sentAny) {
    throw new Error(deliveryError || '每日报表投递失败')
  }
}
