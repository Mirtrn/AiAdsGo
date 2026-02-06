import type { Task } from '../types'
import { getDatabase } from '@/lib/db'
import { fetchAutoadsJson } from '@/lib/openclaw/autoads-client'
import { getOpenclawStrategyConfig, type OpenclawStrategyConfig } from '@/lib/openclaw/strategy-config'
import { createStrategyRun, recordStrategyAction, updateStrategyAction, updateStrategyRun } from '@/lib/openclaw/strategy-store'
import { fetchPartnerboostAssociates, fetchPartnerboostLinkByAsin } from '@/lib/openclaw/affiliate'
import { generateNamingScheme } from '@/lib/naming-convention'
import { recordOpenclawAction } from '@/lib/openclaw/action-logs'

export type OpenclawStrategyTaskData = {
  userId: number
  mode?: string
  trigger?: string
}

type AsinItemRow = {
  id: number
  input_id: number | null
  asin: string | null
  country_code: string | null
  price: string | null
  brand: string | null
  title: string | null
  affiliate_link: string | null
  product_url: string | null
  priority: number | null
  status: string
  offer_id: number | null
  error_message: string | null
  data_json: string | null
}

type AsinOutcomeRow = {
  asin: string | null
  brand: string | null
  status: string
  created_at: string | null
}

type AsinOutcomeStats = {
  published: number
  failed: number
  lastStatus?: 'published' | 'failed'
}

type AsinOutcomeIndex = {
  byAsin: Map<string, AsinOutcomeStats>
  byBrand: Map<string, AsinOutcomeStats>
}

type RankedAsinItem = {
  item: AsinItemRow
  score: number
  signalSource: 'asin' | 'brand' | 'none'
  outcome: AsinOutcomeStats | null
  isPreferred: boolean
}

type AdsAccount = {
  id: number
  customer_id?: string
  currency?: string
}

type CpcCandidate = {
  id?: number
  googleCampaignId?: string
  status?: string
  performance?: {
    costUsd?: number
    clicks?: number
    cpcUsd?: number
  }
}

type AccountBrandSnapshotRow = {
  campaignId: string
  campaignName: string
  status: 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN'
  bucket: 'own' | 'manual' | 'other'
  brand: string | null
  brandConfidence: 'high' | 'low' | 'none'
  source: 'naming' | 'manual'
}

type CreativeRow = {
  id: number
  keywords?: any
  keywordsWithVolume?: any
  negativeKeywords?: any
  creationStatus?: string | null
  finalUrlSuffix?: string | null
}

type KnowledgeBaseRow = {
  report_date: string
  summary_json: unknown
  notes: string | null
}

type AdaptiveStrategyInsight = {
  sampleDays: number
  roasSamples: number
  avgRoas: number | null
  profitableDays: number
  lossDays: number
  profitRate: number
  lossRate: number
  adjustment: 'expand' | 'defensive' | 'hold' | 'insufficient_data'
  before: {
    maxOffersPerRun: number
    defaultBudget: number
    maxCpc: number
  }
  after: {
    maxOffersPerRun: number
    defaultBudget: number
    maxCpc: number
  }
}

type StrategyRunStat = {
  publishSuccess: number
  publishFailed: number
  reason: string | null
}

type FailureGuardInsight = {
  sampleRuns: number
  publishSuccess: number
  publishFailed: number
  publishAttempts: number
  publishFailureRate: number
  stopLossRuns: number
  guardLevel: 'none' | 'mild' | 'strong' | 'insufficient_data'
  before: {
    maxOffersPerRun: number
    defaultBudget: number
    maxCpc: number
  }
  after: {
    maxOffersPerRun: number
    defaultBudget: number
    maxCpc: number
  }
}

const DEFAULT_TIMEZONE = process.env.TZ || 'Asia/Shanghai'

function formatLocalDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  if (typeof value === 'object') {
    return value as T
  }
  return fallback
}

function mergeJson(existing: string | null | undefined, patch: Record<string, any>): string {
  const base = parseJson<Record<string, any>>(existing, {})
  return JSON.stringify({ ...base, ...patch })
}

function normalizeKeywords(input: any, fallback: string[]): Array<{ text: string; matchType: string }> {
  const keywordMap = new Map<string, { text: string; matchType: string; score: number }>()
  const pushKeyword = (text: string, matchType?: string, score = 0) => {
    const cleaned = text.replace(/\s+/g, ' ').trim()
    if (!cleaned) return
    if (cleaned.length < 2 || cleaned.length > 80) return

    const normalizedMatch = String(matchType || '').toUpperCase()
    const validMatch = ['EXACT', 'PHRASE', 'BROAD', 'BROAD_MATCH_MODIFIER'].includes(normalizedMatch)
      ? normalizedMatch
      : (keywordMap.size === 0 ? 'EXACT' : 'PHRASE')

    const dedupeKey = cleaned.toLowerCase()
    const existing = keywordMap.get(dedupeKey)
    if (!existing || score > existing.score) {
      keywordMap.set(dedupeKey, { text: cleaned, matchType: validMatch, score })
    }
  }

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === 'string') {
        pushKeyword(entry, undefined, 0)
      } else if (entry && typeof entry === 'object') {
        const text = entry.text || entry.keyword || entry.term
        if (typeof text === 'string') {
          const searchVolume = toNumber(
            entry.searchVolume
            ?? entry.search_volume
            ?? entry.monthlySearches
            ?? entry.volume,
            0
          )
          const relevance = toNumber(entry.relevance ?? entry.relevanceScore ?? entry.score, 0)
          const score = searchVolume + relevance * 1000
          pushKeyword(text, entry.matchType, score)
        }
      }
    }
  }

  if (keywordMap.size === 0) {
    fallback.forEach((kw, idx) => {
      if (!kw) return
      pushKeyword(kw, idx === 0 ? 'EXACT' : 'PHRASE', 0)
    })
  }

  return Array.from(keywordMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ text, matchType }) => ({ text, matchType }))
}

function normalizeNegativeKeywords(input: any): string[] {
  if (!Array.isArray(input)) return []
  return Array.from(new Set(
    input
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((value) => Boolean(value))
      .map((value) => value.slice(0, 80))
  )).slice(0, 30)
}

function normalizeAsinKey(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toUpperCase()
  return normalized ? normalized : null
}

function normalizeBrandKey(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized ? normalized : null
}

function upsertOutcomeStats(map: Map<string, AsinOutcomeStats>, key: string | null, status: string) {
  if (!key) return
  const normalizedStatus = status === 'published' ? 'published' : 'failed'
  const current = map.get(key) || { published: 0, failed: 0 }

  if (normalizedStatus === 'published') {
    current.published += 1
  } else {
    current.failed += 1
  }

  if (!current.lastStatus) {
    current.lastStatus = normalizedStatus
  }

  map.set(key, current)
}

async function loadAsinOutcomeIndex(userId: number): Promise<AsinOutcomeIndex> {
  const db = await getDatabase()
  const rows = await db.query<AsinOutcomeRow>(
    `SELECT asin, brand, status, created_at
     FROM openclaw_asin_items
     WHERE user_id = ?
       AND status IN ('published', 'failed')
     ORDER BY created_at DESC
     LIMIT 5000`,
    [userId]
  )

  const byAsin = new Map<string, AsinOutcomeStats>()
  const byBrand = new Map<string, AsinOutcomeStats>()

  for (const row of rows) {
    upsertOutcomeStats(byAsin, normalizeAsinKey(row.asin), row.status)
    upsertOutcomeStats(byBrand, normalizeBrandKey(row.brand), row.status)
  }

  return { byAsin, byBrand }
}

export function scoreAsinItemForExecution(params: {
  priority?: number | null
  outcome?: Partial<AsinOutcomeStats> | null
  isPreferred?: boolean
}): number {
  const priority = Math.max(0, toNumber(params.priority, 0))
  const published = Math.max(0, toNumber(params.outcome?.published, 0))
  const failed = Math.max(0, toNumber(params.outcome?.failed, 0))
  const sampleSize = published + failed
  const bayesWinRate = (published + 1) / (sampleSize + 2)

  const explorationBonus = sampleSize < 3 ? (3 - sampleSize) * 6 : 0
  const failurePenalty = Math.min(18, failed * 2)
  const recentFailurePenalty = String(params.outcome?.lastStatus || '').toLowerCase() === 'failed' ? 6 : 0
  const preferredBoost = params.isPreferred ? 80 : 0

  return roundCurrency(priority * 100 + bayesWinRate * 25 + explorationBonus - failurePenalty - recentFailurePenalty + preferredBoost)
}

export function rankAsinItemsForExecution(
  items: AsinItemRow[],
  outcomeIndex: AsinOutcomeIndex,
  options?: { priorityAsins?: Iterable<string> }
): RankedAsinItem[] {
  const preferredAsins = new Set(
    Array.from(options?.priorityAsins || [])
      .map((value) => normalizeAsinKey(String(value || '')))
      .filter((value): value is string => Boolean(value))
  )

  const ranked = items.map((item) => {
    const asinKey = normalizeAsinKey(item.asin)
    const brandKey = normalizeBrandKey(item.brand)

    const asinOutcome = asinKey ? outcomeIndex.byAsin.get(asinKey) : undefined
    const brandOutcome = brandKey ? outcomeIndex.byBrand.get(brandKey) : undefined
    const outcome = asinOutcome || brandOutcome || null
    const isPreferred = asinKey ? preferredAsins.has(asinKey) : false
    const signalSource: RankedAsinItem['signalSource'] = asinOutcome
      ? 'asin'
      : (brandOutcome ? 'brand' : 'none')

    return {
      item,
      score: scoreAsinItemForExecution({
        priority: item.priority,
        outcome,
        isPreferred,
      }),
      signalSource,
      outcome,
      isPreferred,
    }
  })

  return ranked.sort((a, b) => {
    if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1
    if (b.score !== a.score) return b.score - a.score
    const priorityDelta = toNumber(b.item.priority, 0) - toNumber(a.item.priority, 0)
    if (priorityDelta !== 0) return priorityDelta
    return a.item.id - b.item.id
  })
}

async function updateAsinItem(params: {
  userId: number
  itemId: number
  status?: string
  offerId?: number | null
  errorMessage?: string | null
  dataPatch?: Record<string, any>
}) {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const fields: string[] = []
  const values: any[] = []

  if (params.status) {
    fields.push('status = ?')
    values.push(params.status)
  }
  if (params.offerId !== undefined) {
    fields.push('offer_id = ?')
    values.push(params.offerId)
  }
  if (params.errorMessage !== undefined) {
    fields.push('error_message = ?')
    values.push(params.errorMessage)
  }

  if (params.dataPatch) {
    const existing = await db.queryOne<{ data_json: string | null }>(
      'SELECT data_json FROM openclaw_asin_items WHERE id = ? AND user_id = ?',
      [params.itemId, params.userId]
    )
    fields.push('data_json = ?')
    values.push(mergeJson(existing?.data_json, params.dataPatch))
  }

  if (fields.length === 0) return

  await db.exec(
    `UPDATE openclaw_asin_items SET ${fields.join(', ')}, updated_at = ${nowFunc} WHERE id = ? AND user_id = ?`,
    [...values, params.itemId, params.userId]
  )
}

async function waitForOfferExtraction(userId: number, taskId: string, timeoutMs = 120000): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await fetchAutoadsJson<any>({
      userId,
      path: `/api/offers/extract/status/${taskId}`,
    })
    if (status.status === 'completed') {
      const offerId = status.result?.offerId
      return offerId ? Number(offerId) : null
    }
    if (status.status === 'failed') {
      throw new Error(status.error?.message || 'Offer提取失败')
    }
    await sleep(5000)
  }
  return null
}

async function waitForCreativeTask(userId: number, taskId: string, timeoutMs = 120000): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await fetchAutoadsJson<any>({
      userId,
      path: `/api/creative-tasks/${taskId}`,
    })
    if (status.status === 'completed') {
      const creativeId = status.result?.creative?.id
      return creativeId ? Number(creativeId) : null
    }
    if (status.status === 'failed') {
      throw new Error(status.error || '创意生成失败')
    }
    await sleep(5000)
  }
  return null
}

async function ensureAffiliateLink(userId: number, item: AsinItemRow): Promise<string | null> {
  if (item.affiliate_link) return item.affiliate_link
  if (!item.asin) return null
  const link = await fetchPartnerboostLinkByAsin({
    userId,
    asin: item.asin,
    countryCode: item.country_code,
  })
  return link?.link || null
}

async function loadActiveAdsAccounts(userId: number): Promise<AdsAccount[]> {
  const response = await fetchAutoadsJson<any>({
    userId,
    path: '/api/google-ads-accounts',
    query: { activeOnly: true },
  })
  return response?.accounts || []
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

const DEFAULT_PUBLISH_STOP_LOSS_THRESHOLD = 3

function summarizeTopErrorMessages(messages: string[], limit = 3): string[] {
  const counts = new Map<string, number>()
  for (const raw of messages) {
    const message = String(raw || '').trim()
    if (!message) continue
    const normalized = message.slice(0, 120)
    counts.set(normalized, (counts.get(normalized) || 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([message, count]) => `${message} (${count})`)
}

export function calculateNextCpc(params: {
  roas: number
  currentCpc: number
  minCpc: number
  maxCpc: number
  targetRoas: number
}): number {
  const minCpc = Math.max(0.01, params.minCpc)
  const maxCpc = Math.max(minCpc, params.maxCpc)
  const current = Math.max(minCpc, Math.min(maxCpc, params.currentCpc > 0 ? params.currentCpc : maxCpc))
  const targetRoas = Math.max(0.01, params.targetRoas)
  const roas = Math.max(0, params.roas)

  let next = current
  if (roas >= targetRoas * 1.25) {
    next = current * 1.1
  } else if (roas >= targetRoas) {
    next = current * 1.05
  } else if (roas >= targetRoas * 0.8) {
    next = current * 0.9
  } else {
    next = current * 0.75
  }

  return roundCurrency(Math.max(minCpc, Math.min(maxCpc, next)))
}

function extractRoasFromSummary(summary: unknown): number | null {
  const parsed = parseJson<Record<string, any>>(summary, {})
  const roi = parsed?.roi || {}
  const totalCost = toNumber(roi.totalCost, 0)
  const totalRevenue = toNumber(roi.totalRevenue, 0)

  if (totalCost <= 0) return null
  return totalRevenue / totalCost
}

async function loadRecentKnowledgeRows(userId: number, days = 7): Promise<KnowledgeBaseRow[]> {
  const db = await getDatabase()
  return db.query<KnowledgeBaseRow>(
    `SELECT report_date, summary_json, notes
     FROM openclaw_knowledge_base
     WHERE user_id = ?
     ORDER BY report_date DESC
     LIMIT ?`,
    [userId, days]
  )
}

async function loadRecentStrategyRunStats(userId: number, limit = 8): Promise<StrategyRunStat[]> {
  const db = await getDatabase()
  const rows = await db.query<{ stats_json: string | null }>(
    `SELECT stats_json
     FROM openclaw_strategy_runs
     WHERE user_id = ?
       AND status = 'completed'
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit]
  )

  return rows.map((row) => {
    const stats = parseJson<Record<string, any>>(row.stats_json, {})
    return {
      publishSuccess: toNumber(stats.campaignsPublished, 0),
      publishFailed: toNumber(stats.publishFailed, 0),
      reason: stats.reason ? String(stats.reason) : null,
    }
  })
}

export function deriveAdaptiveStrategyConfig(params: {
  config: OpenclawStrategyConfig
  knowledgeRows: Array<Pick<KnowledgeBaseRow, 'summary_json' | 'notes'>>
}): {
  effectiveConfig: OpenclawStrategyConfig
  insight: AdaptiveStrategyInsight
} {
  const { config, knowledgeRows } = params
  const effectiveConfig: OpenclawStrategyConfig = { ...config }

  const roasSamples = knowledgeRows
    .map(row => extractRoasFromSummary(row.summary_json))
    .filter((value): value is number => value !== null && Number.isFinite(value))

  const sampleCount = roasSamples.length
  const avgRoas = sampleCount > 0
    ? roasSamples.reduce((sum, roas) => sum + roas, 0) / sampleCount
    : null
  const profitableDays = roasSamples.filter(roas => roas >= config.targetRoas).length
  const lossDays = roasSamples.filter(roas => roas < config.targetRoas * 0.8).length
  const profitRate = sampleCount > 0 ? profitableDays / sampleCount : 0
  const lossRate = sampleCount > 0 ? lossDays / sampleCount : 0

  const before = {
    maxOffersPerRun: config.maxOffersPerRun,
    defaultBudget: config.defaultBudget,
    maxCpc: config.maxCpc,
  }

  let adjustment: AdaptiveStrategyInsight['adjustment'] = 'hold'

  if (sampleCount < 3) {
    adjustment = 'insufficient_data'
  } else if ((avgRoas || 0) >= config.targetRoas * 1.1 && profitRate >= 0.6) {
    adjustment = 'expand'
    const campaignBudgetCap = Math.max(1, Math.min(config.dailyBudgetCap, config.dailySpendCap))
    effectiveConfig.maxOffersPerRun = Math.min(config.maxOffersPerRun + 1, 8)
    effectiveConfig.defaultBudget = roundCurrency(clampNumber(config.defaultBudget * 1.1, 1, campaignBudgetCap))
    effectiveConfig.maxCpc = roundCurrency(clampNumber(config.maxCpc * 1.05, config.minCpc, config.maxCpc * 1.2))
  } else if ((avgRoas || 0) < config.targetRoas || lossRate >= 0.5) {
    adjustment = 'defensive'
    const campaignBudgetCap = Math.max(1, Math.min(config.dailyBudgetCap, config.dailySpendCap))
    effectiveConfig.maxOffersPerRun = Math.max(1, config.maxOffersPerRun - 1)
    effectiveConfig.defaultBudget = roundCurrency(clampNumber(config.defaultBudget * 0.8, 1, campaignBudgetCap))
    effectiveConfig.maxCpc = roundCurrency(clampNumber(config.maxCpc * 0.9, config.minCpc, config.maxCpc))
  }

  if (effectiveConfig.maxCpc < effectiveConfig.minCpc) {
    effectiveConfig.maxCpc = effectiveConfig.minCpc
  }

  return {
    effectiveConfig,
    insight: {
      sampleDays: knowledgeRows.length,
      roasSamples: sampleCount,
      avgRoas: avgRoas === null ? null : roundCurrency(avgRoas),
      profitableDays,
      lossDays,
      profitRate: roundCurrency(profitRate),
      lossRate: roundCurrency(lossRate),
      adjustment,
      before,
      after: {
        maxOffersPerRun: effectiveConfig.maxOffersPerRun,
        defaultBudget: effectiveConfig.defaultBudget,
        maxCpc: effectiveConfig.maxCpc,
      },
    },
  }
}

export function deriveFailureGuardConfig(params: {
  config: OpenclawStrategyConfig
  runStats: StrategyRunStat[]
}): {
  effectiveConfig: OpenclawStrategyConfig
  insight: FailureGuardInsight
} {
  const { config, runStats } = params
  const effectiveConfig: OpenclawStrategyConfig = { ...config }

  const publishSuccess = runStats.reduce((sum, stat) => sum + Math.max(0, toNumber(stat.publishSuccess, 0)), 0)
  const publishFailed = runStats.reduce((sum, stat) => sum + Math.max(0, toNumber(stat.publishFailed, 0)), 0)
  const publishAttempts = publishSuccess + publishFailed
  const publishFailureRate = publishAttempts > 0 ? publishFailed / publishAttempts : 0
  const stopLossRuns = runStats.filter((stat) => stat.reason === 'publish_failure_stop_loss').length

  const before = {
    maxOffersPerRun: config.maxOffersPerRun,
    defaultBudget: config.defaultBudget,
    maxCpc: config.maxCpc,
  }

  let guardLevel: FailureGuardInsight['guardLevel'] = 'none'
  if (runStats.length < 2 || publishAttempts < 3) {
    guardLevel = 'insufficient_data'
  } else if (stopLossRuns >= 2 || publishFailureRate >= 0.7) {
    guardLevel = 'strong'
  } else if (publishFailureRate >= 0.5) {
    guardLevel = 'mild'
  }

  const campaignBudgetCap = Math.max(1, Math.min(config.dailyBudgetCap, config.dailySpendCap))
  if (guardLevel === 'strong') {
    effectiveConfig.maxOffersPerRun = Math.max(1, config.maxOffersPerRun - 2)
    effectiveConfig.defaultBudget = roundCurrency(clampNumber(config.defaultBudget * 0.75, 1, campaignBudgetCap))
    effectiveConfig.maxCpc = roundCurrency(clampNumber(config.maxCpc * 0.85, config.minCpc, config.maxCpc))
  } else if (guardLevel === 'mild') {
    effectiveConfig.maxOffersPerRun = Math.max(1, config.maxOffersPerRun - 1)
    effectiveConfig.defaultBudget = roundCurrency(clampNumber(config.defaultBudget * 0.9, 1, campaignBudgetCap))
    effectiveConfig.maxCpc = roundCurrency(clampNumber(config.maxCpc * 0.92, config.minCpc, config.maxCpc))
  }

  return {
    effectiveConfig,
    insight: {
      sampleRuns: runStats.length,
      publishSuccess,
      publishFailed,
      publishAttempts,
      publishFailureRate: roundCurrency(publishFailureRate),
      stopLossRuns,
      guardLevel,
      before,
      after: {
        maxOffersPerRun: effectiveConfig.maxOffersPerRun,
        defaultBudget: effectiveConfig.defaultBudget,
        maxCpc: effectiveConfig.maxCpc,
      },
    },
  }
}

async function fetchOffer(userId: number, offerId: number): Promise<any> {
  const response = await fetchAutoadsJson<any>({
    userId,
    path: `/api/offers/${offerId}`,
  })
  return response?.offer
}

async function fetchCreatives(userId: number, offerId: number): Promise<CreativeRow[]> {
  const response = await fetchAutoadsJson<any>({
    userId,
    path: '/api/ad-creatives',
    query: { offer_id: offerId },
  })
  return response?.creatives || []
}

async function fetchAccountBrandSnapshot(userId: number, accountId: number): Promise<AccountBrandSnapshotRow[]> {
  const response = await fetchAutoadsJson<any>({
    userId,
    path: '/api/campaigns/active-brand-snapshot',
    query: { accountId },
  })
  const rows = Array.isArray(response?.data?.rows) ? response.data.rows : []

  return rows
    .map((row: any) => ({
      campaignId: String(row?.campaignId || ''),
      campaignName: String(row?.campaignName || ''),
      status: String(row?.status || 'UNKNOWN').toUpperCase() as AccountBrandSnapshotRow['status'],
      bucket: row?.bucket === 'manual' || row?.bucket === 'other' ? row.bucket : 'own',
      brand: typeof row?.brand === 'string' ? row.brand.trim() || null : null,
      brandConfidence: row?.brandConfidence === 'high' || row?.brandConfidence === 'low' ? row.brandConfidence : 'none',
      source: row?.source === 'manual' ? 'manual' : 'naming',
    }))
    .filter((row: AccountBrandSnapshotRow) => row.campaignId)
}

async function selectCreative(userId: number, offerId: number): Promise<CreativeRow | null> {
  const creatives = await fetchCreatives(userId, offerId)
  if (!creatives || creatives.length === 0) return null
  const preferred = creatives.find((c: any) => c.creationStatus !== 'failed') || creatives[0]
  return preferred ? {
    id: preferred.id,
    keywords: preferred.keywords,
    keywordsWithVolume: preferred.keywordsWithVolume,
    negativeKeywords: preferred.negativeKeywords,
    creationStatus: preferred.creationStatus,
    finalUrlSuffix: preferred.finalUrlSuffix,
  } : null
}

export function shouldTreatCampaignAsConflict(params: {
  campaignStatus?: unknown
  campaignBrand?: unknown
  targetBrand: string
  enforceUnknownBrandAsConflict?: boolean
}): { conflict: boolean; unknownBrand: boolean } {
  const status = String(params.campaignStatus || '').trim().toUpperCase()
  if (status !== 'ENABLED') {
    return { conflict: false, unknownBrand: false }
  }

  const target = String(params.targetBrand || '').trim().toLowerCase()
  if (!target) {
    return { conflict: false, unknownBrand: false }
  }

  const brand = String(params.campaignBrand || '').trim().toLowerCase()
  if (!brand) {
    const unknownAsConflict = params.enforceUnknownBrandAsConflict !== false
    return { conflict: unknownAsConflict, unknownBrand: unknownAsConflict }
  }

  return {
    conflict: brand !== target,
    unknownBrand: false,
  }
}

async function pauseConflictingCampaigns(params: {
  userId: number
  campaigns: any[]
  targetBrand: string
  allowPause: boolean
  runId: string
}) {
  const conflictRows = params.campaigns
    .map((campaign: any) => ({
      campaign,
      decision: shouldTreatCampaignAsConflict({
        campaignStatus: campaign.status,
        campaignBrand: campaign.offerBrand,
        targetBrand: params.targetBrand,
        enforceUnknownBrandAsConflict: true,
      }),
    }))
    .filter((entry) => entry.decision.conflict)

  const conflicts = conflictRows.map((entry) => entry.campaign)
  const unknownConflicts = conflictRows.filter((entry) => entry.decision.unknownBrand).length

  if (conflicts.length === 0) {
    return { paused: 0, skipped: 0, unknownConflicts: 0, failedCampaignIds: [] as string[] }
  }

  if (!params.allowPause) {
    return {
      paused: 0,
      skipped: conflicts.length,
      unknownConflicts,
      failedCampaignIds: conflicts.map((campaign) => String(campaign.id || '')),
    }
  }

  let paused = 0
  const failedCampaignIds: string[] = []
  for (const campaign of conflicts) {
    const actionId = await recordStrategyAction({
      runId: params.runId,
      userId: params.userId,
      actionType: 'pause_campaign',
      targetType: 'campaign',
      targetId: String(campaign.id),
      requestJson: JSON.stringify({ status: 'PAUSED' }),
    })
    try {
      await fetchAutoadsJson({
        userId: params.userId,
        path: `/api/campaigns/${campaign.id}/toggle-status`,
        method: 'PUT',
        body: { status: 'PAUSED' },
      })
      await updateStrategyAction({ actionId, status: 'success' })
      await recordOpenclawAction({
        userId: params.userId,
        channel: 'strategy',
        action: 'PUT /api/campaigns/:id/toggle-status',
        targetType: 'campaign',
        targetId: String(campaign.id),
        requestBody: JSON.stringify({ status: 'PAUSED' }),
        status: 'success',
      })
      paused += 1
    } catch (error: any) {
      failedCampaignIds.push(String(campaign.id || ''))
      await updateStrategyAction({
        actionId,
        status: 'failed',
        errorMessage: error?.message || '暂停失败',
      })
    }
  }

  return {
    paused,
    skipped: conflicts.length - paused,
    unknownConflicts,
    failedCampaignIds,
  }
}

function selectAccountForBrand(params: {
  accounts: AdsAccount[]
  targetBrand: string
  accountBrandLocks: Map<number, string>
  roundRobinSeed: number
}): AdsAccount | null {
  if (!params.accounts || params.accounts.length === 0) return null
  const normalizedBrand = normalizeBrandKey(params.targetBrand)
  if (!normalizedBrand) {
    return params.accounts[params.roundRobinSeed % params.accounts.length]
  }

  const aligned = params.accounts.find((account) => {
    const lock = params.accountBrandLocks.get(Number(account.id))
    return lock === normalizedBrand
  })
  if (aligned) return aligned

  const unlocked = params.accounts.find((account) => !params.accountBrandLocks.has(Number(account.id)))
  if (unlocked) return unlocked

  return null
}

async function fallbackPauseEnabledCampaignsForAccount(params: {
  userId: number
  accountId: number
}) {
  const { queryActiveCampaigns, pauseCampaigns } = await import('@/lib/active-campaigns-query')
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const active = await queryActiveCampaigns(0, params.accountId, params.userId)
  const enabledCampaigns = [
    ...active.ownCampaigns,
    ...active.manualCampaigns,
    ...active.otherCampaigns,
  ]

  if (enabledCampaigns.length === 0) {
    return {
      enabled: 0,
      attempted: 0,
      paused: 0,
      failed: 0,
      failures: [] as string[],
    }
  }

  const pauseResult = await pauseCampaigns(enabledCampaigns, params.accountId, params.userId)
  for (const campaign of enabledCampaigns) {
    await db.exec(
      `UPDATE campaigns
       SET status = 'PAUSED', updated_at = ${nowFunc}
       WHERE user_id = ?
         AND google_ads_account_id = ?
         AND (google_campaign_id = ? OR campaign_id = ?)`,
      [params.userId, params.accountId, String(campaign.id), String(campaign.id)]
    )
  }

  const failures = Array.isArray(pauseResult.failures)
    ? pauseResult.failures.map((failure: any) => {
      const campaignId = String(failure?.id || 'unknown')
      const errorMessage = String(failure?.error || '熔断暂停失败')
      return `campaign:${campaignId} ${errorMessage}`
    })
    : []

  return {
    enabled: enabledCampaigns.length,
    attempted: pauseResult.attemptedCount,
    paused: pauseResult.pausedCount,
    failed: pauseResult.failedCount,
    failures,
  }
}

async function enforceDailySpendCircuitBreak(params: {
  userId: number
  runId: string
  accountIds: number[]
  totalSpent: number
  dailySpendCap: number
}) {
  const actionId = await recordStrategyAction({
    runId: params.runId,
    userId: params.userId,
    actionType: 'spend_cap_circuit_break',
    requestJson: JSON.stringify({
      accountIds: params.accountIds,
      totalSpent: roundCurrency(params.totalSpent),
      dailySpendCap: roundCurrency(params.dailySpendCap),
    }),
  })

  const uniqueAccountIds = Array.from(new Set(params.accountIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)))

  let attempted = 0
  let paused = 0
  let failed = 0
  let apiTriggered = 0
  let fallbackTriggered = 0
  const accountSummaries: Array<{ accountId: number; enabled: number; paused: number; failed: number; source: 'api' | 'fallback' }> = []
  const accountErrors: string[] = []
  const accountWarnings: string[] = []

  for (const accountId of uniqueAccountIds) {
    let handledByApi = false

    try {
      const response = await fetchAutoadsJson<any>({
        userId: params.userId,
        path: '/api/campaigns/circuit-break',
        method: 'POST',
        body: {
          accountId,
          reason: 'daily_spend_cap',
          source: 'openclaw-strategy',
        },
      })

      if (!response?.success) {
        throw new Error('熔断接口返回失败')
      }

      const data = response?.data || {}
      const summary = data.summary || {}
      const result = data.result || {}

      const enabled = toNumber(summary.enabledCampaigns, toNumber(result.attemptedCount, 0))
      const attemptedCount = toNumber(result.attemptedCount, enabled)
      const pausedCount = toNumber(result.pausedCount, 0)
      const failedCount = toNumber(result.failedCount, 0)

      attempted += attemptedCount
      paused += pausedCount
      failed += failedCount
      apiTriggered += 1
      handledByApi = true

      accountSummaries.push({
        accountId,
        enabled,
        paused: pausedCount,
        failed: failedCount,
        source: 'api',
      })

      const failures = Array.isArray(result.failures) ? result.failures : []
      for (const failure of failures) {
        const failureId = String(failure?.id || 'unknown')
        const failureMessage = String(failure?.error || '熔断暂停失败')
        accountErrors.push(`account:${accountId} campaign:${failureId} ${failureMessage}`)
      }
    } catch (apiError: any) {
      accountWarnings.push(`account:${accountId} api_failed ${apiError?.message || '熔断接口调用失败'}`)
    }

    if (handledByApi) {
      continue
    }

    try {
      const fallback = await fallbackPauseEnabledCampaignsForAccount({
        userId: params.userId,
        accountId,
      })
      attempted += fallback.attempted
      paused += fallback.paused
      failed += fallback.failed
      fallbackTriggered += 1

      accountSummaries.push({
        accountId,
        enabled: fallback.enabled,
        paused: fallback.paused,
        failed: fallback.failed,
        source: 'fallback',
      })

      for (const message of fallback.failures) {
        accountErrors.push(`account:${accountId} ${message}`)
      }
    } catch (fallbackError: any) {
      accountErrors.push(`account:${accountId} fallback_failed ${fallbackError?.message || '熔断暂停失败'}`)
    }
  }

  const status = accountErrors.length === 0 ? 'success' : 'failed'
  await updateStrategyAction({
    actionId,
    status,
    responseJson: JSON.stringify({
      attempted,
      paused,
      failed,
      apiTriggered,
      fallbackTriggered,
      accountSummaries,
      accountWarnings,
      totalSpent: roundCurrency(params.totalSpent),
      dailySpendCap: roundCurrency(params.dailySpendCap),
    }),
    errorMessage: accountErrors.length > 0 ? accountErrors.join('; ') : undefined,
  })

  return {
    attempted,
    paused,
    failed,
    apiTriggered,
    fallbackTriggered,
    accountSummaries,
    accountWarnings,
    accountErrors,
  }
}

export async function executeOpenclawStrategy(
  task: Task<OpenclawStrategyTaskData>
): Promise<{ success: boolean; runId?: string; skipped?: boolean }> {
  const userId = task.data?.userId || task.userId
  const db = await getDatabase()
  const userAccess = await db.queryOne<{ openclaw_enabled: boolean | number }>(
    'SELECT openclaw_enabled FROM users WHERE id = ?',
    [userId]
  )
  const openclawEnabled = userAccess
    ? ((userAccess.openclaw_enabled as any) === true || (userAccess.openclaw_enabled as any) === 1)
    : false

  if (!openclawEnabled) {
    return { success: true, skipped: true }
  }

  const baseConfig = await getOpenclawStrategyConfig(userId)
  let config: OpenclawStrategyConfig = { ...baseConfig }
  const runDate = formatLocalDate(new Date())

  const runId = await createStrategyRun({
    userId,
    mode: task.data?.mode || 'auto',
    runDate,
    configJson: JSON.stringify(baseConfig),
  })

  const nowIso = new Date().toISOString()

  if (!config.enabled && task.data?.mode !== 'manual') {
    await updateStrategyRun({
      runId,
      status: 'skipped',
      statsJson: JSON.stringify({ reason: 'strategy_disabled' }),
      completedAt: nowIso,
    })
    return { success: true, runId, skipped: true }
  }

  const running = await db.queryOne<{ id: string }>(
    `SELECT id FROM openclaw_strategy_runs WHERE user_id = ? AND status = 'running' LIMIT 1`,
    [userId]
  )
  if (running) {
    await updateStrategyRun({
      runId,
      status: 'skipped',
      errorMessage: '已有运行中的策略',
      completedAt: nowIso,
    })
    return { success: true, runId, skipped: true }
  }

  await updateStrategyRun({
    runId,
    status: 'running',
    startedAt: nowIso,
  })

  const enforceAutoadsOnly = config.enforceAutoadsOnly !== false
  const shouldAutoPauseConflicts = config.enableAutoPause || enforceAutoadsOnly

  const stats: Record<string, any> = {
    offersConsidered: 0,
    offersCreated: 0,
    creativesGenerated: 0,
    campaignsPublished: 0,
    campaignsPaused: 0,
    publishFailed: 0,
    skipped: 0,
    enforceAutoadsOnly,
  }

  let adaptiveInsight: AdaptiveStrategyInsight | null = null

  try {
    const adaptiveActionId = await recordStrategyAction({
      runId,
      userId,
      actionType: 'adaptive_tune',
      requestJson: JSON.stringify({
        maxOffersPerRun: baseConfig.maxOffersPerRun,
        defaultBudget: baseConfig.defaultBudget,
        maxCpc: baseConfig.maxCpc,
        targetRoas: baseConfig.targetRoas,
      }),
    })

    try {
      const knowledgeRows = await loadRecentKnowledgeRows(userId, 7)
      const adaptive = deriveAdaptiveStrategyConfig({
        config: baseConfig,
        knowledgeRows,
      })

      config = adaptive.effectiveConfig
      adaptiveInsight = adaptive.insight
      stats.adaptiveInsight = adaptiveInsight
      stats.effectiveConfig = {
        maxOffersPerRun: config.maxOffersPerRun,
        defaultBudget: config.defaultBudget,
        maxCpc: config.maxCpc,
      }

      await updateStrategyAction({
        actionId: adaptiveActionId,
        status: 'success',
        responseJson: JSON.stringify(adaptiveInsight),
      })
    } catch (error: any) {
      await updateStrategyAction({
        actionId: adaptiveActionId,
        status: 'failed',
        errorMessage: error?.message || '策略自适应失败',
      })
      stats.adaptiveInsight = { adjustment: 'insufficient_data' }
    }

    const failureGuardActionId = await recordStrategyAction({
      runId,
      userId,
      actionType: 'failure_guard_tune',
      requestJson: JSON.stringify({
        maxOffersPerRun: config.maxOffersPerRun,
        defaultBudget: config.defaultBudget,
        maxCpc: config.maxCpc,
      }),
    })
    try {
      const runStats = await loadRecentStrategyRunStats(userId, 8)
      const guard = deriveFailureGuardConfig({
        config,
        runStats,
      })
      config = guard.effectiveConfig
      stats.failureGuardInsight = guard.insight
      stats.effectiveConfig = {
        maxOffersPerRun: config.maxOffersPerRun,
        defaultBudget: config.defaultBudget,
        maxCpc: config.maxCpc,
      }

      await updateStrategyAction({
        actionId: failureGuardActionId,
        status: 'success',
        responseJson: JSON.stringify(guard.insight),
      })
    } catch (error: any) {
      await updateStrategyAction({
        actionId: failureGuardActionId,
        status: 'failed',
        errorMessage: error?.message || '失败率防守调参失败',
      })
    }

    const budgetActionId = await recordStrategyAction({
      runId,
      userId,
      actionType: 'budget_check',
    })
    let budgetSummary: any = null
    try {
      const budget = await fetchAutoadsJson<any>({
        userId,
        path: '/api/analytics/budget',
        query: { start_date: runDate, end_date: runDate },
      })
      budgetSummary = budget?.data?.overall || null
      await updateStrategyAction({
        actionId: budgetActionId,
        status: 'success',
        responseJson: JSON.stringify(budgetSummary),
      })
    } catch (error: any) {
      await updateStrategyAction({
        actionId: budgetActionId,
        status: 'failed',
        errorMessage: error?.message || '预算查询失败',
      })
    }

    const totalSpent = Number(budgetSummary?.totalSpent || 0)
    let totalBudget = Number(budgetSummary?.totalBudget || 0)
    let projectedSpend = totalSpent
    let spendCircuitBroken = false

    stats.dailySpent = totalSpent
    stats.dailyBudget = totalBudget
    stats.projectedSpend = projectedSpend

    const accounts = await loadActiveAdsAccounts(userId)
    const filteredAccounts = config.adsAccountIds && config.adsAccountIds.length > 0
      ? accounts.filter(account => config.adsAccountIds!.includes(Number(account.id)))
      : accounts

    const accountBrandSnapshots = new Map<number, AccountBrandSnapshotRow[]>()
    const brandSnapshotActionId = await recordStrategyAction({
      runId,
      userId,
      actionType: 'active_brand_snapshot',
      requestJson: JSON.stringify({
        accountIds: filteredAccounts.map((account) => Number(account.id)),
      }),
    })

    try {
      const snapshotRows = await Promise.all(filteredAccounts.map(async (account) => {
        try {
          const rows = await fetchAccountBrandSnapshot(userId, Number(account.id))
          return {
            accountId: Number(account.id),
            rows,
            error: null,
          }
        } catch (error: any) {
          return {
            accountId: Number(account.id),
            rows: [] as AccountBrandSnapshotRow[],
            error: error?.message || '品牌快照获取失败',
          }
        }
      }))

      let totalActiveCampaigns = 0
      let unknownBrandCampaigns = 0
      let loadedAccounts = 0
      let failedAccounts = 0

      for (const row of snapshotRows) {
        if (row.error) {
          failedAccounts += 1
          continue
        }
        loadedAccounts += 1
        accountBrandSnapshots.set(row.accountId, row.rows)
        totalActiveCampaigns += row.rows.length
        unknownBrandCampaigns += row.rows.filter((entry) => entry.brandConfidence === 'none').length
      }

      stats.brandSnapshot = {
        accountCount: filteredAccounts.length,
        loadedAccounts,
        failedAccounts,
        totalActiveCampaigns,
        unknownBrandCampaigns,
      }

      await updateStrategyAction({
        actionId: brandSnapshotActionId,
        status: failedAccounts > 0 && loadedAccounts === 0 ? 'failed' : 'success',
        responseJson: JSON.stringify({
          summary: stats.brandSnapshot,
          snapshots: snapshotRows.map((row) => ({
            accountId: row.accountId,
            rowCount: row.rows.length,
            error: row.error,
          })),
        }),
        errorMessage: failedAccounts > 0 && loadedAccounts === 0
          ? '全部账号品牌快照获取失败'
          : undefined,
      })
    } catch (error: any) {
      await updateStrategyAction({
        actionId: brandSnapshotActionId,
        status: 'failed',
        errorMessage: error?.message || '品牌快照获取失败',
      })
    }

    const spendRealtimeActionId = await recordStrategyAction({
      runId,
      userId,
      actionType: 'spend_realtime_check',
      requestJson: JSON.stringify({ accountIds: filteredAccounts.map((account) => Number(account.id)) }),
    })

    try {
      const realtimeRows = await Promise.all(filteredAccounts.map(async (account) => {
        try {
          const response = await fetchAutoadsJson<any>({
            userId,
            path: '/api/analytics/spend-realtime',
            query: {
              accountId: Number(account.id),
            },
          })
          const data = response?.data || {}
          return {
            accountId: Number(account.id),
            spend: toNumber(data.spend, 0),
            reportingDate: data.reportingDate || null,
            isStale: Boolean(data.latestSync?.isStale),
          }
        } catch (error: any) {
          return {
            accountId: Number(account.id),
            spend: 0,
            error: error?.message || '实时花费查询失败',
          }
        }
      }))

      const hasRealtime = realtimeRows.some((row) => !row.error)
      if (hasRealtime) {
        const realtimeTotalSpent = roundCurrency(realtimeRows.reduce((sum, row) => sum + toNumber(row.spend, 0), 0))
        projectedSpend = realtimeTotalSpent
        stats.dailySpent = realtimeTotalSpent
        stats.projectedSpend = projectedSpend
      }

      stats.realtimeSpend = {
        hasRealtime,
        accountCount: realtimeRows.length,
        staleAccounts: realtimeRows.filter((row) => row.isStale).length,
      }

      await updateStrategyAction({
        actionId: spendRealtimeActionId,
        status: 'success',
        responseJson: JSON.stringify({
          hasRealtime,
          projectedSpend,
          rows: realtimeRows,
        }),
      })
    } catch (error: any) {
      await updateStrategyAction({
        actionId: spendRealtimeActionId,
        status: 'failed',
        errorMessage: error?.message || '实时花费校验失败',
      })
    }

    if (projectedSpend >= config.dailySpendCap) {
      const circuitBreakResult = await enforceDailySpendCircuitBreak({
        userId,
        runId,
        accountIds: filteredAccounts.map((account) => Number(account.id)),
        totalSpent: projectedSpend,
        dailySpendCap: config.dailySpendCap,
      })
      stats.circuitBreak = circuitBreakResult
      stats.reason = 'daily_spend_cap'

      await updateStrategyRun({
        runId,
        status: 'completed',
        statsJson: JSON.stringify({ ...stats, reason: 'daily_spend_cap' }),
        completedAt: new Date().toISOString(),
      })
      return { success: true, runId }
    }

    if (filteredAccounts.length === 0) {
      await updateStrategyRun({
        runId,
        status: 'completed',
        statsJson: JSON.stringify({ ...stats, reason: 'no_ads_accounts' }),
        completedAt: new Date().toISOString(),
      })
      return { success: true, runId }
    }

    const performance = await fetchAutoadsJson<any>({
      userId,
      path: '/api/campaigns/performance',
      query: { daysBack: 7 },
    }).catch(() => null)
    const campaigns: CpcCandidate[] = performance?.campaigns || []

    if (config.enableAutoAdjustCpc && campaigns.length > 0) {
      const candidates = campaigns
        .filter((campaign: any) => campaign.status === 'ENABLED' && campaign.googleCampaignId)
        .sort((a: any, b: any) => (b.performance?.costUsd || 0) - (a.performance?.costUsd || 0))
        .slice(0, 5)

      for (const campaign of candidates) {
        const actionId = await recordStrategyAction({
          runId,
          userId,
          actionType: 'adjust_cpc',
          targetType: 'campaign',
          targetId: String(campaign.id),
        })
        try {
          const roi = await fetchAutoadsJson<any>({
            userId,
            path: '/api/analytics/roi',
            query: { start_date: runDate, end_date: runDate, campaign_id: campaign.id },
          })
          const overall = roi?.data?.overall || {}
          const cost = Number(overall.totalCost || 0)
          const revenue = Number(overall.totalRevenue || 0)
          const roas = cost > 0 ? revenue / cost : 0
          const costUsd = toNumber(campaign.performance?.costUsd)
          const clicks = toNumber(campaign.performance?.clicks)
          const currentCpc = clicks > 0 ? costUsd / clicks : config.maxCpc
          const newCpc = calculateNextCpc({
            roas,
            currentCpc,
            minCpc: config.minCpc,
            maxCpc: config.maxCpc,
            targetRoas: config.targetRoas,
          })

          await fetchAutoadsJson({
            userId,
            path: `/api/campaigns/${campaign.googleCampaignId}/update-cpc`,
            method: 'PUT',
            body: { newCpc },
          })

          await updateStrategyAction({
            actionId,
            status: 'success',
            responseJson: JSON.stringify({ roas, currentCpc: roundCurrency(currentCpc), newCpc }),
          })

          stats.cpcAdjusted = (stats.cpcAdjusted || 0) + 1
        } catch (error: any) {
          await updateStrategyAction({
            actionId,
            status: 'failed',
            errorMessage: error?.message || 'CPC调整失败',
          })
        }
      }
    }

    const candidateLimit = Math.max(config.maxOffersPerRun, Math.min(config.maxOffersPerRun * 3, 30))
    const items = await db.query<AsinItemRow>(
      `
        SELECT id, input_id, asin, country_code, price, brand, title, affiliate_link, product_url, priority, status, offer_id, error_message, data_json
        FROM openclaw_asin_items
        WHERE user_id = ?
          AND status IN ('pending', 'offer_pending', 'offer_created', 'creative_pending', 'creative_ready')
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
      `,
      [userId, candidateLimit]
    )

    if (!items || items.length === 0) {
      if (config.allowAffiliateFetch) {
        const actionId = await recordStrategyAction({
          runId,
          userId,
          actionType: 'affiliate_discovery',
        })
        try {
          const associates = await fetchPartnerboostAssociates(userId)
          const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
          for (const item of associates.slice(0, config.maxOffersPerRun)) {
            await db.exec(
              `INSERT INTO openclaw_asin_items
               (user_id, asin, country_code, brand, priority, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ${nowFunc}, ${nowFunc})`,
              [
                userId,
                item.asin,
                item.region || 'US',
                item.brand_name || null,
                0,
                'partnerboost',
              ]
            )
          }
          await updateStrategyAction({
            actionId,
            status: 'success',
            responseJson: JSON.stringify({ inserted: Math.min(associates.length, config.maxOffersPerRun) }),
          })
        } catch (error: any) {
          await updateStrategyAction({
            actionId,
            status: 'failed',
            errorMessage: error?.message || '联盟平台获取失败',
          })
        }
      }

      await updateStrategyRun({
        runId,
        status: 'completed',
        statsJson: JSON.stringify({ ...stats, reason: 'no_asin_items' }),
        completedAt: new Date().toISOString(),
      })
      return { success: true, runId }
    }

    const rankActionId = await recordStrategyAction({
      runId,
      userId,
      actionType: 'rank_items',
      requestJson: JSON.stringify({
        candidateCount: items.length,
        selectedCount: config.maxOffersPerRun,
        priorityAsinCount: config.priorityAsins?.length || 0,
      }),
    })

    let executionItems = items.slice(0, config.maxOffersPerRun)
    try {
      const outcomeIndex = await loadAsinOutcomeIndex(userId)
      const rankedCandidates = rankAsinItemsForExecution(items, outcomeIndex, {
        priorityAsins: config.priorityAsins,
      })
      const selected = rankedCandidates.slice(0, config.maxOffersPerRun)
      executionItems = selected.map(entry => entry.item)

      const selectedAverageScore = selected.length > 0
        ? roundCurrency(selected.reduce((sum, entry) => sum + entry.score, 0) / selected.length)
        : 0
      const signalSourceCount = selected.reduce((acc, entry) => {
        acc[entry.signalSource] = (acc[entry.signalSource] || 0) + 1
        return acc
      }, {} as Record<string, number>)
      const preferredSelected = selected.filter((entry) => entry.isPreferred).length

      stats.rankModel = {
        candidateCount: items.length,
        selectedCount: executionItems.length,
        selectedAverageScore,
        signalSourceCount,
        preferredSelected,
      }

      await updateStrategyAction({
        actionId: rankActionId,
        status: 'success',
        responseJson: JSON.stringify({
          summary: stats.rankModel,
          selected: selected.map((entry) => ({
            itemId: entry.item.id,
            asin: entry.item.asin,
            brand: entry.item.brand,
            priority: entry.item.priority,
            score: entry.score,
            signalSource: entry.signalSource,
            isPreferred: entry.isPreferred,
            published: entry.outcome?.published || 0,
            failed: entry.outcome?.failed || 0,
          })),
        }),
      })
    } catch (error: any) {
      await updateStrategyAction({
        actionId: rankActionId,
        status: 'failed',
        errorMessage: error?.message || '候选ASIN排序失败',
      })
      stats.rankModel = {
        candidateCount: items.length,
        selectedCount: executionItems.length,
        selectedAverageScore: 0,
        signalSourceCount: { none: executionItems.length },
        preferredSelected: 0,
      }
    }

    let consecutivePublishFailures = 0
    const publishFailureReasons: string[] = []
    const publishStopLossThreshold = Math.max(2, Math.min(DEFAULT_PUBLISH_STOP_LOSS_THRESHOLD, config.maxOffersPerRun))
    const accountBrandLocks = new Map<number, string>()

    for (let idx = 0; idx < executionItems.length; idx += 1) {
      const item = executionItems[idx]
      stats.offersConsidered += 1
      const itemData = parseJson<Record<string, any>>(item.data_json, {})

      await updateAsinItem({ userId, itemId: item.id, status: 'processing' })

      let offerId = item.offer_id
      let affiliateLink: string | null = null
      if (!offerId && itemData.offer_task_id) {
        try {
          const status = await fetchAutoadsJson<any>({
            userId,
            path: `/api/offers/extract/status/${itemData.offer_task_id}`,
          })
          if (status.status === 'completed' && status.result?.offerId) {
            offerId = Number(status.result.offerId)
            await updateAsinItem({
              userId,
              itemId: item.id,
              offerId,
              status: 'offer_created',
            })
          } else if (status.status === 'failed') {
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'failed',
              errorMessage: status.error?.message || 'Offer提取失败',
            })
            stats.skipped += 1
            continue
          } else {
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'offer_pending',
            })
            stats.skipped += 1
            continue
          }
        } catch (error: any) {
          await updateAsinItem({
            userId,
            itemId: item.id,
            status: 'offer_pending',
            errorMessage: error?.message || 'Offer提取查询失败',
          })
          stats.skipped += 1
          continue
        }
      }

      if (!offerId) {
        affiliateLink = config.allowAffiliateFetch ? await ensureAffiliateLink(userId, item) : item.affiliate_link
        if (affiliateLink) {
          const actionId = await recordStrategyAction({
            runId,
            userId,
            actionType: 'create_offer_extract',
            targetType: 'asin',
            targetId: item.asin || String(item.id),
            requestJson: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: item.country_code || 'US',
            }),
          })

          try {
            const extractRes = await fetchAutoadsJson<any>({
              userId,
              path: '/api/offers/extract',
              method: 'POST',
              body: {
                affiliate_link: affiliateLink,
                target_country: item.country_code || 'US',
                product_price: item.price || undefined,
              },
            })
            await updateStrategyAction({
              actionId,
              status: 'success',
              responseJson: JSON.stringify(extractRes),
            })

            await recordOpenclawAction({
              userId,
              channel: 'strategy',
              action: 'POST /api/offers/extract',
              targetType: 'asin',
              targetId: item.asin || String(item.id),
              requestBody: JSON.stringify({ affiliate_link: affiliateLink, target_country: item.country_code || 'US' }),
              status: 'success',
            })

            const taskId = extractRes?.taskId
            if (taskId) {
              const extractedOfferId = await waitForOfferExtraction(userId, taskId)
              if (extractedOfferId) {
                offerId = extractedOfferId
                stats.offersCreated += 1
                await updateAsinItem({
                  userId,
                  itemId: item.id,
                  offerId,
                  status: 'offer_created',
                  dataPatch: { offer_task_id: taskId },
                })
              } else {
                await updateAsinItem({
                  userId,
                  itemId: item.id,
                  status: 'offer_pending',
                  dataPatch: { offer_task_id: taskId },
                })
                stats.skipped += 1
                continue
              }
            }
          } catch (error: any) {
            await updateStrategyAction({
              actionId,
              status: 'failed',
              errorMessage: error?.message || 'Offer提取失败',
            })
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'failed',
              errorMessage: error?.message || 'Offer提取失败',
            })
            stats.skipped += 1
            continue
          }
        } else if (item.product_url) {
          const actionId = await recordStrategyAction({
            runId,
            userId,
            actionType: 'create_offer',
            targetType: 'asin',
            targetId: item.asin || String(item.id),
          })
          try {
            const createRes = await fetchAutoadsJson<any>({
              userId,
              path: '/api/offers',
              method: 'POST',
              body: {
                url: item.product_url,
                brand: item.brand || undefined,
                target_country: item.country_code || 'US',
                affiliate_link: affiliateLink || undefined,
                product_price: item.price || undefined,
              },
            })
            offerId = createRes?.offer?.id
            await updateStrategyAction({
              actionId,
              status: 'success',
              responseJson: JSON.stringify(createRes),
            })
            if (offerId) {
              stats.offersCreated += 1
              await updateAsinItem({
                userId,
                itemId: item.id,
                offerId,
                status: 'offer_created',
              })
            }
          } catch (error: any) {
            await updateStrategyAction({
              actionId,
              status: 'failed',
              errorMessage: error?.message || 'Offer创建失败',
            })
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'failed',
              errorMessage: error?.message || 'Offer创建失败',
            })
            stats.skipped += 1
            continue
          }
        } else {
          await updateAsinItem({
            userId,
            itemId: item.id,
            status: 'failed',
            errorMessage: '缺少affiliate_link或product_url',
          })
          stats.skipped += 1
          continue
        }
      }

      if (!offerId) {
        stats.skipped += 1
        continue
      }

      const offer = await fetchOffer(userId, offerId)
      if (!offer) {
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'failed',
          errorMessage: 'Offer不存在',
        })
        stats.skipped += 1
        continue
      }

      if ((!offer.brand || offer.brand === 'Unknown') && item.brand) {
        try {
          await fetchAutoadsJson({
            userId,
            path: `/api/offers/${offerId}`,
            method: 'PUT',
            body: { brand: item.brand },
          })
        } catch (error) {
          // ignore
        }
      }

      let creativeId = itemData.creative_id ? Number(itemData.creative_id) : null
      let creative = creativeId ? { id: creativeId } as CreativeRow : null
      if (!creativeId && itemData.creative_task_id) {
        try {
          const maybeCreativeId = await waitForCreativeTask(userId, itemData.creative_task_id, 60000)
          if (maybeCreativeId) {
            creativeId = maybeCreativeId
            creative = { id: creativeId }
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'creative_ready',
              dataPatch: { creative_id: creativeId, creative_task_id: itemData.creative_task_id },
            })
          } else {
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'creative_pending',
              dataPatch: { creative_task_id: itemData.creative_task_id },
            })
            stats.skipped += 1
            continue
          }
        } catch (error: any) {
          await updateAsinItem({
            userId,
            itemId: item.id,
            status: 'creative_pending',
            errorMessage: error?.message || '创意任务等待失败',
          })
          stats.skipped += 1
          continue
        }
      }

      if (!creativeId) {
        creative = await selectCreative(userId, offerId)
        if (creative) {
          creativeId = creative.id
        } else {
          const actionId = await recordStrategyAction({
            runId,
            userId,
            actionType: 'generate_creative',
            targetType: 'offer',
            targetId: String(offerId),
          })
          try {
            const createRes = await fetchAutoadsJson<any>({
              userId,
              path: `/api/offers/${offerId}/generate-creatives-queue`,
              method: 'POST',
              body: { maxRetries: 3 },
            })
            const taskId = createRes?.taskId
            await updateStrategyAction({
              actionId,
              status: 'success',
              responseJson: JSON.stringify(createRes),
            })

            if (taskId) {
              const generatedId = await waitForCreativeTask(userId, taskId)
              if (generatedId) {
                creativeId = generatedId
                stats.creativesGenerated += 1
                await updateAsinItem({
                  userId,
                  itemId: item.id,
                  status: 'creative_ready',
                  dataPatch: { creative_id: creativeId, creative_task_id: taskId },
                })
              } else {
                await updateAsinItem({
                  userId,
                  itemId: item.id,
                  status: 'creative_pending',
                  dataPatch: { creative_task_id: taskId },
                })
                stats.skipped += 1
                continue
              }
            }
          } catch (error: any) {
            await updateStrategyAction({
              actionId,
              status: 'failed',
              errorMessage: error?.message || '创意生成失败',
            })
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'failed',
              errorMessage: error?.message || '创意生成失败',
            })
            stats.skipped += 1
            continue
          }
        }
      }

      if (!creativeId) {
        stats.skipped += 1
        continue
      }

      if (!config.enableAutoPublish || config.dryRun) {
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'creative_ready',
          dataPatch: { creative_id: creativeId, dry_run: config.dryRun },
        })
        stats.skipped += 1
        continue
      }

      const offerBrand = String(offer.brand || item.brand || '').trim()
      const account = selectAccountForBrand({
        accounts: filteredAccounts,
        targetBrand: offerBrand,
        accountBrandLocks,
        roundRobinSeed: idx,
      })
      if (!account) {
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'creative_ready',
          errorMessage: '账号品牌槽位已占用，已跳过',
        })
        stats.skipped += 1
        continue
      }

      const snapshotCampaigns = (accountBrandSnapshots.get(Number(account.id)) || []).map((row) => ({
        id: row.campaignId,
        status: row.status,
        offerBrand: row.brand,
      }))
      const accountCampaigns = snapshotCampaigns.length > 0
        ? snapshotCampaigns
        : campaigns.filter((c: any) => Number(c.googleAdsAccountId) === Number(account.id))

      const pauseResult = await pauseConflictingCampaigns({
        userId,
        campaigns: accountCampaigns,
        targetBrand: offerBrand,
        allowPause: shouldAutoPauseConflicts,
        runId,
      })
      stats.campaignsPaused += pauseResult.paused
      stats.unknownBrandConflicts = (stats.unknownBrandConflicts || 0) + (pauseResult.unknownConflicts || 0)

      const hasRemainingConflicts = pauseResult.skipped > 0
      if (hasRemainingConflicts && (enforceAutoadsOnly || !shouldAutoPauseConflicts)) {
        const unresolvedCount = Math.max(0, pauseResult.skipped)
        const unresolvedHint = pauseResult.failedCampaignIds.length > 0
          ? `；未处理Campaign: ${pauseResult.failedCampaignIds.slice(0, 5).join(', ')}`
          : ''

        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'creative_ready',
          errorMessage: enforceAutoadsOnly
            ? (pauseResult.unknownConflicts > 0
                ? `AutoAds强制模式：检测到手工/未知品牌Campaign冲突，发布已阻断${unresolvedHint}`
                : `AutoAds强制模式：存在品牌冲突Campaign未暂停，发布已阻断${unresolvedHint}`)
            : (pauseResult.unknownConflicts > 0
                ? '检测到手工/未知品牌Campaign冲突，已跳过'
                : '品牌冲突，已跳过'),
        })
        stats.skipped += 1
        stats.unresolvedConflicts = (stats.unresolvedConflicts || 0) + unresolvedCount
        continue
      }

      const naming = generateNamingScheme({
        offer: {
          id: offer.id,
          brand: offer.brand || item.brand || 'Brand',
          offerName: offer.offerName || undefined,
          category: offer.category || undefined,
        },
        config: {
          targetCountry: offer.targetCountry || 'US',
          budgetAmount: config.defaultBudget,
          budgetType: 'DAILY',
          biddingStrategy: 'MAXIMIZE_CLICKS',
          maxCpcBid: config.maxCpc,
        },
      })

      const creativeDetails = creative || await selectCreative(userId, offerId)
      const keywordsWithVolume = parseJson<any[]>(creativeDetails?.keywordsWithVolume, [])
      const keywordsRaw = parseJson<any[]>(creativeDetails?.keywords, [])
      const negativeKeywordsRaw = parseJson<any[]>(creativeDetails?.negativeKeywords, [])
      const fallbackKeywords = [offer.brand, offer.offerName].filter((v) => typeof v === 'string' && v.trim()) as string[]

      const budgetAllowance = Math.max(0, config.dailyBudgetCap - totalBudget)
      const spendAllowance = Math.max(0, config.dailySpendCap - projectedSpend)
      const budgetForCampaign = roundCurrency(Math.min(config.defaultBudget, budgetAllowance, spendAllowance))
      const campaignMaxCpc = roundCurrency(Math.max(config.minCpc, Math.min(config.maxCpc, config.maxCpc)))

      if (spendAllowance <= 0) {
        spendCircuitBroken = true
        const circuitBreakResult = await enforceDailySpendCircuitBreak({
          userId,
          runId,
          accountIds: filteredAccounts.map((row) => Number(row.id)),
          totalSpent: projectedSpend,
          dailySpendCap: config.dailySpendCap,
        })
        stats.circuitBreak = circuitBreakResult
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'creative_ready',
          errorMessage: '当日花费已达上限，触发熔断暂停',
        })
        stats.skipped += 1
        break
      }

      if (budgetForCampaign <= 0) {
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'creative_ready',
          errorMessage: '预算剩余额度不足，已跳过',
        })
        stats.skipped += 1
        continue
      }

      const campaignConfig = {
        campaignName: naming.campaignName,
        adGroupName: naming.adGroupName,
        budgetAmount: budgetForCampaign,
        budgetType: 'DAILY',
        targetCountry: offer.targetCountry || 'US',
        targetLanguage: offer.targetLanguage || 'en',
        biddingStrategy: 'MAXIMIZE_CLICKS',
        marketingObjective: 'WEB_TRAFFIC',
        finalUrlSuffix: offer.finalUrlSuffix || creativeDetails?.finalUrlSuffix || '',
        maxCpcBid: campaignMaxCpc,
        keywords: normalizeKeywords(
          keywordsWithVolume.length > 0 ? keywordsWithVolume : keywordsRaw,
          fallbackKeywords
        ),
        negativeKeywords: normalizeNegativeKeywords(negativeKeywordsRaw),
      }

      const publishActionId = await recordStrategyAction({
        runId,
        userId,
        actionType: 'publish_campaign',
        targetType: 'offer',
        targetId: String(offerId),
        requestJson: JSON.stringify({
          offerId,
          adCreativeId: creativeId,
          googleAdsAccountId: account.id,
          campaignConfig,
        }),
      })

      try {
        const publishRes = await fetchAutoadsJson<any>({
          userId,
          path: '/api/campaigns/publish',
          method: 'POST',
          body: {
            offerId,
            adCreativeId: creativeId,
            googleAdsAccountId: account.id,
            campaignConfig,
            pauseOldCampaigns: shouldAutoPauseConflicts,
            enableCampaignImmediately: true,
            enableSmartOptimization: false,
          },
        })

        await updateStrategyAction({
          actionId: publishActionId,
          status: 'success',
          responseJson: JSON.stringify(publishRes),
        })
        await recordOpenclawAction({
          userId,
          channel: 'strategy',
          action: 'POST /api/campaigns/publish',
          targetType: 'offer',
          targetId: String(offerId),
          requestBody: JSON.stringify({ offerId, adCreativeId: creativeId, googleAdsAccountId: account.id }),
          status: 'success',
        })

        stats.campaignsPublished += 1
        consecutivePublishFailures = 0
        const brandKey = normalizeBrandKey(offerBrand)
        if (brandKey) {
          accountBrandLocks.set(Number(account.id), brandKey)
        }
        totalBudget = roundCurrency(totalBudget + budgetForCampaign)
        projectedSpend = roundCurrency(projectedSpend + budgetForCampaign)
        stats.projectedSpend = projectedSpend
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'published',
          dataPatch: {
            creative_id: creativeId,
            publish_result: publishRes,
          },
        })
      } catch (error: any) {
        const publishError = error?.message || '发布失败'
        await updateStrategyAction({
          actionId: publishActionId,
          status: 'failed',
          errorMessage: publishError,
        })
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'failed',
          errorMessage: publishError,
        })

        stats.skipped += 1
        stats.publishFailed = (stats.publishFailed || 0) + 1
        consecutivePublishFailures += 1
        publishFailureReasons.push(publishError)

        if (consecutivePublishFailures >= publishStopLossThreshold) {
          const stopLossActionId = await recordStrategyAction({
            runId,
            userId,
            actionType: 'stop_loss',
            targetType: 'run',
            targetId: runId,
            requestJson: JSON.stringify({
              reason: 'consecutive_publish_failures',
              threshold: publishStopLossThreshold,
              consecutiveFailures: consecutivePublishFailures,
            }),
          })

          const topFailureReasons = summarizeTopErrorMessages(publishFailureReasons)
          await updateStrategyAction({
            actionId: stopLossActionId,
            status: 'success',
            responseJson: JSON.stringify({
              threshold: publishStopLossThreshold,
              consecutiveFailures: consecutivePublishFailures,
              totalPublishFailures: stats.publishFailed,
              topFailureReasons,
            }),
          })

          stats.reason = 'publish_failure_stop_loss'
          stats.stopLoss = {
            type: 'consecutive_publish_failures',
            threshold: publishStopLossThreshold,
            consecutiveFailures: consecutivePublishFailures,
            totalPublishFailures: stats.publishFailed,
            topFailureReasons,
          }
          break
        }

        continue
      }
    }

    if (spendCircuitBroken) {
      stats.reason = 'daily_spend_cap_circuit_break'
    }

    await updateStrategyRun({
      runId,
      status: 'completed',
      statsJson: JSON.stringify(stats),
      completedAt: new Date().toISOString(),
    })

    return { success: true, runId }
  } catch (error: any) {
    await updateStrategyRun({
      runId,
      status: 'failed',
      errorMessage: error?.message || '策略执行失败',
      statsJson: JSON.stringify(stats),
      completedAt: new Date().toISOString(),
    })
    return { success: false, runId }
  }
}
