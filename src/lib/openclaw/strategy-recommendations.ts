import crypto from 'crypto'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/json-field'
import { fetchAutoadsJson } from '@/lib/openclaw/autoads-client'
import { formatOpenclawLocalDate, normalizeOpenclawReportDate } from '@/lib/openclaw/report-date'
import { getCommissionPerConversion } from '@/lib/offer-monetization'
import { classifyKeywordIntent, recommendMatchTypeForKeyword } from '@/lib/keyword-intent'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import { extractCampaignConfigKeywords } from '@/lib/campaign-config-keywords'

export type StrategyRecommendationType =
  | 'adjust_cpc'
  | 'adjust_budget'
  | 'offline_campaign'
  | 'expand_keywords'
  | 'add_negative_keywords'
  | 'optimize_match_type'

export type StrategyRecommendationStatus =
  | 'pending'
  | 'approved'
  | 'executed'
  | 'failed'
  | 'dismissed'
  | 'stale'

export type StrategyKeywordSuggestion = {
  text: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
}

export type StrategyNegativeKeywordSuggestion = {
  text: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  reason?: string
}

export type StrategyMatchTypeSuggestion = {
  text: string
  currentMatchType: 'BROAD' | 'PHRASE' | 'EXACT'
  recommendedMatchType: 'BROAD' | 'PHRASE' | 'EXACT'
  clicks?: number
  conversions?: number
  cost?: number
}

export type StrategyPostReviewStatus =
  | 'pending_window'
  | 'effective'
  | 'mixed'
  | 'ineffective'
  | 'no_data'

export type StrategyImpactConfidence = 'low' | 'medium' | 'high'
export type StrategyImpactEstimationSource =
  | 'observed_roas'
  | 'fallback_lag_protected'
  | 'fallback_default'

export type StrategyMatchTypeReplaceMode = 'none' | 'pause_existing'

export type StrategyRecommendationData = {
  campaignId: number
  campaignName: string
  offerId: number | null
  googleCampaignId: string | null
  snapshotHash?: string
  runDays: number
  impressions: number
  clicks: number
  cost: number
  ctrPct: number
  cpc: number
  roas: number | null
  commissionAmount: number
  commissionLagProtected: boolean
  commissionPerConversion: number | null
  currentCpc: number | null
  recommendedCpc: number | null
  cpcAdjustmentDirection?: 'lower' | 'set'
  currentBudget: number | null
  recommendedBudget: number | null
  budgetType?: 'DAILY' | 'TOTAL'
  budgetAdjustmentDirection?: 'increase'
  breakEvenConversionRatePct: number | null
  breakEvenConversionRateByRecommendedCpcPct: number | null
  estimatedCostSaving: number
  estimatedRevenueUplift: number
  estimatedNetImpact: number
  impactWindowDays: number
  impactConfidence: StrategyImpactConfidence
  impactConfidenceReason: string
  impactEstimationSource?: StrategyImpactEstimationSource
  postReviewStatus?: StrategyPostReviewStatus
  postReviewSummary?: {
    reviewedAt: string
    reviewWindowDays: number
    baseline: {
      impressions: number
      clicks: number
      cost: number
      ctrPct: number
      cpc: number
      roas: number | null
      commission: number
    }
    after: {
      impressions: number
      clicks: number
      cost: number
      ctrPct: number
      cpc: number
      roas: number | null
      commission: number
      observedDays: number
    }
    delta: {
      impressionsPct: number | null
      clicksPct: number | null
      costPct: number | null
      ctrPctDiff: number | null
      cpcPct: number | null
      roasDiff: number | null
    }
  }
  keywordCoverageCount: number
  creativeQuality: {
    headlineCount: number
    descriptionCount: number
    keywordCount: number
    level: 'high' | 'medium' | 'low'
  }
  offlineOptions?: {
    removeGoogleAdsCampaign: boolean
    pauseClickFarmTasks: boolean
    pauseUrlSwapTasks: boolean
  }
  keywordPlan?: StrategyKeywordSuggestion[]
  negativeKeywordPlan?: StrategyNegativeKeywordSuggestion[]
  matchTypePlan?: StrategyMatchTypeSuggestion[]
  matchTypeReplaceMode?: StrategyMatchTypeReplaceMode
  ruleCode: string
  analysisNote: string
}

export type StrategyRecommendation = {
  id: string
  userId: number
  reportDate: string
  campaignId: number
  googleCampaignId: string | null
  snapshotHash: string | null
  approvedSnapshotHash: string | null
  recommendationType: StrategyRecommendationType
  title: string
  summary: string | null
  reason: string | null
  priorityScore: number
  status: StrategyRecommendationStatus
  data: StrategyRecommendationData
  approvedAt: string | null
  executedAt: string | null
  executionResult: unknown
  createdAt: string
  updatedAt: string
}

type CampaignRow = {
  id: number
  campaign_name: string
  campaign_id: string | null
  google_campaign_id: string | null
  max_cpc: number | null
  budget_amount: number | null
  budget_type: string | null
  created_at: string | null
  published_at: string | null
  offer_id: number | null
  ad_creative_id: number | null
  product_price: string | null
  commission_payout: string | null
  target_country: string | null
  brand: string | null
  category: string | null
  product_name: string | null
  campaign_config?: unknown
}

type PerfAgg = {
  impressions: number
  clicks: number
  cost: number
}

type CreativeRow = {
  id: number
  headlines: unknown
  descriptions: unknown
  keywords: unknown
  keywords_with_volume: unknown
}

type KeywordInventoryRow = {
  campaign_id: number
  keyword_text: string
  match_type: string | null
  is_negative: number | boolean | null
}

type CampaignKeywordInventory = {
  text: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  isNegative: boolean
}

type SearchTermAgg = {
  searchTerm: string
  impressions: number
  clicks: number
  conversions: number
  cost: number
}

type RecommendationDraft = {
  key: string
  campaignId: number
  googleCampaignId: string | null
  recommendationType: StrategyRecommendationType
  title: string
  summary: string
  reason: string
  priorityScore: number
  data: StrategyRecommendationData
}

export type StrategyRecommendationQueueTaskData = {
  userId: number
  mode?: string
  trigger?: string
  kind: 'execute_recommendation' | 'review_recommendation'
  recommendationId: string
  confirm?: boolean
  scheduledAt?: string
}

export type QueueStrategyRecommendationExecutionResult = {
  queued: boolean
  deduplicated: boolean
  taskId: string
  recommendation: StrategyRecommendation
}

const MIN_KEYWORD_COVERAGE_TARGET = 20
const KEYWORD_EXPANSION_TARGET_MAX = 30
const KEYWORD_EXPANSION_TARGET_MIN = 20
const CPC_RECOMMENDED_DIVISOR = 50
const SEARCH_TERM_LOOKBACK_DAYS = 14
const NEGATIVE_KEYWORD_PLAN_MAX = 15
const MATCH_TYPE_OPTIMIZATION_MAX = 15
const IMPACT_WINDOW_DAYS_COST_CONTROL = 7
const IMPACT_WINDOW_DAYS_TRAFFIC_GROWTH = 14
const POST_REVIEW_DEFAULT_WINDOW_DAYS = 3
const MAX_POST_REVIEW_WINDOW_DAYS = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000
const OFFLINE_LOW_CTR_MIN_IMPRESSIONS = 200
const OFFLINE_LOW_CTR_MIN_CLICKS = 10
const OFFLINE_LOW_CTR_MIN_COST = 8
const POST_REVIEW_MIN_IMPRESSIONS = 200
const POST_REVIEW_MIN_CLICKS = 20
const POST_REVIEW_MIN_COST = 8
const POST_REVIEW_MIN_OBSERVED_DAYS = 3
const RECOMMENDATION_COOLDOWN_DAYS: Record<StrategyRecommendationType, number> = {
  adjust_cpc: 2,
  adjust_budget: 2,
  offline_campaign: 30,
  expand_keywords: 5,
  add_negative_keywords: 3,
  optimize_match_type: 5,
}
const refreshRecommendationsInflight = new Map<string, Promise<StrategyRecommendation[]>>()

function formatLocalDate(date: Date): string {
  return formatOpenclawLocalDate(date)
}

function isIsoDateLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function shiftIsoDate(dateText: string, offsetDays: number): string {
  if (!isIsoDateLike(dateText)) return formatLocalDate(new Date())
  const [yearText, monthText, dayText] = dateText.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return formatLocalDate(new Date())
  }
  const baseMs = Date.UTC(year, month - 1, day, 12, 0, 0, 0)
  return formatLocalDate(new Date(baseMs + offsetDays * 24 * 60 * 60 * 1000))
}

function toIsoTimestampFromEpoch(value: unknown): string | null {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return new Date(num).toISOString()
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function recommendationCooldownKey(campaignId: number, recommendationType: StrategyRecommendationType): string {
  return `${campaignId}:${recommendationType}`
}

function parseReviewWindowDays(value: unknown, fallback = POST_REVIEW_DEFAULT_WINDOW_DAYS): number {
  const parsed = Math.floor(toNumber(value, fallback))
  return clampNumber(parsed, 1, MAX_POST_REVIEW_WINDOW_DAYS)
}

function hasSignalSample(params: {
  impressions: number
  clicks: number
  cost: number
  minImpressions: number
  minClicks: number
  minCost: number
}): boolean {
  return params.impressions >= params.minImpressions
    || params.clicks >= params.minClicks
    || params.cost >= params.minCost
}

function estimateImpactConfidence(params: {
  impressions: number
  clicks: number
  cost: number
  roas: number | null
  commissionLagProtected: boolean
}): StrategyImpactConfidence {
  if (params.commissionLagProtected) {
    return 'low'
  }

  let signal = 0
  if (params.impressions >= 1500) {
    signal += 2
  } else if (params.impressions >= 500) {
    signal += 1
  }
  if (params.clicks >= 120) {
    signal += 2
  } else if (params.clicks >= 40) {
    signal += 1
  }
  if (params.cost >= 80) {
    signal += 2
  } else if (params.cost >= 25) {
    signal += 1
  }
  if (params.roas !== null) {
    signal += 1
  }

  if (signal >= 6) return 'high'
  if (signal >= 3) return 'medium'
  return 'low'
}

function buildImpactConfidenceReason(params: {
  impressions: number
  clicks: number
  cost: number
  roas: number | null
}): string {
  return `样本：曝光 ${Math.round(params.impressions)} / 点击 ${Math.round(params.clicks)} / 花费 ${roundTo2(params.cost).toFixed(2)}${params.roas !== null ? ` / ROAS ${params.roas.toFixed(2)}` : ' / ROAS --'}`
}

function resolveImpactEstimationSource(params: {
  roas: number | null
  commissionLagProtected: boolean
}): StrategyImpactEstimationSource {
  if (params.roas !== null) return 'observed_roas'
  return params.commissionLagProtected ? 'fallback_lag_protected' : 'fallback_default'
}

function formatImpactEstimationSource(source: StrategyImpactEstimationSource): string {
  if (source === 'observed_roas') return '估算口径：实测ROAS'
  if (source === 'fallback_lag_protected') return '估算口径：滞后保护回退'
  return '估算口径：默认回退'
}

function applyFallbackPriorityPenalty(
  priority: number,
  source: StrategyImpactEstimationSource
): number {
  if (source === 'observed_roas') return roundTo2(priority)
  const penalty = source === 'fallback_lag_protected' ? 4 : 8
  return roundTo2(Math.max(1, priority - penalty))
}

function applyImpactEstimation(
  baseData: Omit<StrategyRecommendationData, 'ruleCode' | 'analysisNote'>,
  impact: {
    estimatedCostSaving?: number
    estimatedRevenueUplift?: number
    impactWindowDays?: number
  }
): Omit<StrategyRecommendationData, 'ruleCode' | 'analysisNote'> {
  const estimatedCostSaving = roundTo2(Math.max(0, toNumber(impact.estimatedCostSaving, 0)))
  const estimatedRevenueUplift = roundTo2(Math.max(0, toNumber(impact.estimatedRevenueUplift, 0)))
  const impactWindowDays = parseReviewWindowDays(impact.impactWindowDays, IMPACT_WINDOW_DAYS_COST_CONTROL)
  return {
    ...baseData,
    estimatedCostSaving,
    estimatedRevenueUplift,
    estimatedNetImpact: roundTo2(estimatedCostSaving + estimatedRevenueUplift),
    impactWindowDays,
  }
}

function buildSnapshotHash(payload: Record<string, unknown>): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 24)
}

function safeParseArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function safeParseObject(value: unknown): Record<string, any> {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>
  }
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : {}
  } catch {
    return {}
  }
}

function normalizeGoogleCampaignId(...values: Array<unknown>): string | null {
  for (const value of values) {
    const text = String(value || '').trim()
    if (/^\d+$/.test(text)) {
      return text
    }
  }
  return null
}

function calculateRunDays(createdAt: string | null, publishedAt: string | null): number {
  const source = String(publishedAt || createdAt || '').trim()
  if (!source) return 0
  const time = Date.parse(source)
  if (!Number.isFinite(time)) return 0
  return Math.max(0, Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24)))
}

function buildPerfMap(rows: Array<{ campaign_id: number; impressions: number; clicks: number; cost: number }>): Map<number, PerfAgg> {
  const map = new Map<number, PerfAgg>()
  for (const row of rows) {
    const campaignId = Number(row.campaign_id)
    if (!Number.isFinite(campaignId)) continue
    map.set(campaignId, {
      impressions: toNumber(row.impressions, 0),
      clicks: toNumber(row.clicks, 0),
      cost: roundTo2(toNumber(row.cost, 0)),
    })
  }
  return map
}

function calculateCreativeQuality(creative: CreativeRow | undefined): StrategyRecommendationData['creativeQuality'] {
  if (!creative) {
    return {
      headlineCount: 0,
      descriptionCount: 0,
      keywordCount: 0,
      level: 'low',
    }
  }

  const headlines = safeParseArray(creative.headlines)
  const descriptions = safeParseArray(creative.descriptions)
  const keywords = safeParseArray(creative.keywords)
  const keywordsWithVolume = safeParseArray(creative.keywords_with_volume)
  const mergedKeywordCount = Math.max(keywords.length, keywordsWithVolume.length, 0)

  const headlineCount = headlines.length
  const descriptionCount = descriptions.length
  const keywordCount = mergedKeywordCount

  let level: 'high' | 'medium' | 'low' = 'low'
  if (headlineCount >= 12 && descriptionCount >= 4 && keywordCount >= 20) {
    level = 'high'
  } else if (headlineCount >= 8 && descriptionCount >= 3 && keywordCount >= 10) {
    level = 'medium'
  }

  return {
    headlineCount,
    descriptionCount,
    keywordCount,
    level,
  }
}

function sanitizeKeyword(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeBudgetType(value: unknown): 'DAILY' | 'TOTAL' {
  const text = String(value || '').trim().toUpperCase()
  return text === 'TOTAL' ? 'TOTAL' : 'DAILY'
}

function normalizeKeywordMatchType(value: unknown): 'BROAD' | 'PHRASE' | 'EXACT' | null {
  const text = String(value || '').trim().toUpperCase()
  if (text === 'BROAD' || text === 'PHRASE' || text === 'EXACT') {
    return text
  }
  return null
}

function normalizeBoolean(value: unknown): boolean {
  if (value === true || value === false) return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  const text = String(value || '').trim().toLowerCase()
  return text === 'true' || text === 'yes' || text === 'on'
}

function normalizeKeywordKey(text: string): string {
  return sanitizeKeyword(String(text || '')).toLowerCase()
}

function extractCampaignConfigKeywordSet(campaignConfig: unknown): Set<string> {
  const keywordSet = new Set<string>()
  for (const item of extractCampaignConfigKeywords(campaignConfig)) {
    const normalized = normalizeKeywordKey(item.text)
    if (!normalized) continue
    keywordSet.add(normalized)
  }
  return keywordSet
}

function patchExpandKeywordsSummaryCoverage(summary: string | null, keywordCoverageCount: number): string | null {
  if (!summary) return summary
  if (!Number.isFinite(keywordCoverageCount) || keywordCoverageCount < 0) return summary
  return summary.replace(/当前关键词\s+\d+\s+个/, `当前关键词 ${Math.floor(keywordCoverageCount)} 个`)
}

function dedupeKeywordPool(values: string[], existing: Set<string>): string[] {
  const output: string[] = []
  const seen = new Set<string>(Array.from(existing))
  for (const raw of values) {
    const text = sanitizeKeyword(raw)
    if (!text) continue
    const normalized = text.toLowerCase()
    if (normalized.length < 2 || normalized.length > 80) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    output.push(text)
  }
  return output
}

function dedupeKeywordSuggestions(params: {
  values: StrategyKeywordSuggestion[]
  existing: Set<string>
  brand: string
}): StrategyKeywordSuggestion[] {
  const output: StrategyKeywordSuggestion[] = []
  const seen = new Set<string>(Array.from(params.existing))
  for (const item of params.values) {
    const text = sanitizeKeyword(String(item?.text || ''))
    if (!text) continue
    const normalized = text.toLowerCase()
    if (normalized.length < 2 || normalized.length > 80) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)

    const intent = classifyKeywordIntent(text).intent
    output.push({
      text,
      matchType:
        normalizeKeywordMatchType(item?.matchType) ||
        recommendMatchTypeForKeyword({
          keyword: text,
          brandName: params.brand || undefined,
          intent,
        }),
    })
  }
  return output
}

function shouldGenerateExpandKeywordsRecommendation(params: {
  runDays: number
  keywordCoverageCount: number
  impressions: number
  clicks: number
}): boolean {
  const lowKeywordCoverage = params.keywordCoverageCount < MIN_KEYWORD_COVERAGE_TARGET
  const lowTraffic = params.impressions < 400 || params.clicks < 25
  return params.runDays > 1 && lowKeywordCoverage && lowTraffic
}

function buildKeywordExpansionPlan(params: {
  brand: string | null
  category: string | null
  productName: string | null
  existing: Set<string>
  offerKeywordIdeas?: StrategyKeywordSuggestion[]
}): StrategyKeywordSuggestion[] {
  const brand = sanitizeKeyword(String(params.brand || ''))
  const category = sanitizeKeyword(String(params.category || ''))
  const productName = sanitizeKeyword(String(params.productName || ''))
  const existing = new Set<string>(Array.from(params.existing))

  const externalSuggestions = dedupeKeywordSuggestions({
    values: Array.isArray(params.offerKeywordIdeas) ? params.offerKeywordIdeas : [],
    existing,
    brand,
  })
  for (const item of externalSuggestions) {
    existing.add(item.text.toLowerCase())
  }

  const seeds: string[] = []
  if (brand) {
    seeds.push(
      brand,
      `${brand} official`,
      `${brand} store`,
      `${brand} price`,
      `${brand} review`,
      `${brand} buy`,
      `${brand} coupons`,
      `${brand} deals`,
      `${brand} discount`,
      `${brand} sale`,
      `${brand} warranty`,
    )
  }
  if (category) {
    seeds.push(
      category,
      `${category} price`,
      `${category} review`,
      `${category} deals`,
      `best ${category}`,
      `${category} comparison`,
      `${category} recommendations`,
      `buy ${category}`,
      `${category} online`,
      `${category} for home`,
      `${category} near me`,
    )
  }
  if (brand && category) {
    seeds.push(
      `${brand} ${category}`,
      `${brand} ${category} deals`,
      `${brand} ${category} official`,
      `${brand} ${category} price`,
      `${brand} ${category} review`,
      `${brand} ${category} discount`,
      `best ${brand} ${category}`,
      `buy ${brand} ${category}`,
    )
  }
  if (productName) {
    seeds.push(
      productName,
      `${productName} price`,
      `${productName} review`,
      `${productName} specs`,
      `${productName} deal`,
      `${productName} discount`,
    )
    if (brand) {
      seeds.push(
        `${brand} ${productName}`,
        `${brand} ${productName} price`,
        `${brand} ${productName} review`,
        `${brand} ${productName} discount`,
      )
    }
    if (category) {
      seeds.push(
        `${productName} ${category}`,
        `best ${productName} ${category}`,
      )
    }
  }

  const uniqueCandidates = dedupeKeywordPool(seeds, existing)
  const localSuggestions = uniqueCandidates.map((keyword) => {
    const intent = classifyKeywordIntent(keyword).intent
    return {
      text: keyword,
      matchType: recommendMatchTypeForKeyword({
        keyword,
        brandName: brand || undefined,
        intent,
      }),
    }
  })

  const desiredAdditionCount = Math.min(
    KEYWORD_EXPANSION_TARGET_MAX,
    Math.max(
      KEYWORD_EXPANSION_TARGET_MIN,
      MIN_KEYWORD_COVERAGE_TARGET - params.existing.size + KEYWORD_EXPANSION_TARGET_MIN
    )
  )

  return [...externalSuggestions, ...localSuggestions].slice(0, desiredAdditionCount)
}

function buildExpandKeywordsSnapshotHash(params: {
  campaignId: number
  runDays: number
  keywordCoverageCount: number
  impressions: number
  clicks: number
  keywordPlan: StrategyKeywordSuggestion[]
}): string {
  return buildSnapshotHash({
    type: 'expand_keywords',
    campaignId: params.campaignId,
    runDays: params.runDays,
    keywordCoverageCount: params.keywordCoverageCount,
    impressions: params.impressions,
    clicks: params.clicks,
    keywordPlan: params.keywordPlan.map((item) => ({ text: item.text, matchType: item.matchType })),
  })
}

function estimateOfflinePriority(params: {
  noTraffic: boolean
  lowCtr: boolean
  lowRoas: boolean
  roas: number | null
  cost7d: number
  costTotal: number
}): number {
  const base = params.noTraffic ? 92 : (params.lowRoas ? 86 : (params.lowCtr ? 82 : 75))
  const roasPenalty = params.lowRoas && params.roas !== null
    ? Math.min(8, Math.max(0, (0.5 - params.roas) * 20))
    : 0
  const wasteCost = Math.max(params.cost7d, params.costTotal * 0.3)
  return roundTo2(Math.min(100, base + roasPenalty + Math.min(12, wasteCost / 20)))
}

function estimateCpcPriority(params: {
  currentCpc: number | null
  recommendedCpc: number
  clicks7d: number
}): number {
  if (!params.currentCpc || params.currentCpc <= 0) {
    return 70
  }
  const gap = Math.max(0, params.currentCpc - params.recommendedCpc)
  const savings = gap * params.clicks7d
  return roundTo2(Math.min(96, 68 + Math.min(18, gap * 30) + Math.min(10, savings * 2)))
}

function estimateKeywordPriority(params: {
  keywordCount: number
  impressions: number
  clicks: number
}): number {
  const coverageGap = Math.max(0, MIN_KEYWORD_COVERAGE_TARGET - params.keywordCount)
  const trafficGap = Math.max(0, 400 - params.impressions)
  const clickGap = Math.max(0, 25 - params.clicks)
  return roundTo2(Math.min(90, 52 + Math.min(20, coverageGap) + Math.min(10, trafficGap / 80) + Math.min(8, clickGap / 5)))
}

function estimateBudgetPriority(params: {
  ctrPct: number
  cpc: number
  currentBudget: number | null
  recommendedBudget: number
}): number {
  const ctrBoost = Math.min(14, Math.max(0, params.ctrPct - 6))
  const lowCpcBoost = params.cpc > 0 ? Math.min(10, Math.max(0, (0.8 - params.cpc) * 12)) : 0
  const budgetGap = params.currentBudget && params.currentBudget > 0
    ? Math.max(0, params.recommendedBudget - params.currentBudget)
    : params.recommendedBudget
  const budgetBoost = Math.min(8, budgetGap / 2)
  return roundTo2(Math.min(92, 60 + ctrBoost + lowCpcBoost + budgetBoost))
}

function estimateNegativeKeywordPriority(params: {
  hardNegativeCount: number
  totalCost: number
  selectedCount: number
}): number {
  const hardNegativeBoost = Math.min(20, params.hardNegativeCount * 3.5)
  const wasteCostBoost = Math.min(12, params.totalCost / 4)
  const coverageBoost = Math.min(8, params.selectedCount)
  return roundTo2(Math.min(96, 62 + hardNegativeBoost + wasteCostBoost + coverageBoost))
}

function estimateMatchTypePriority(params: {
  selectedCount: number
  totalCost: number
  broadToNarrowCount: number
}): number {
  const countBoost = Math.min(10, params.selectedCount * 1.4)
  const costBoost = Math.min(12, params.totalCost / 5)
  const directionBoost = Math.min(12, params.broadToNarrowCount * 2.5)
  return roundTo2(Math.min(94, 58 + countBoost + costBoost + directionBoost))
}

function buildNegativeKeywordPlan(params: {
  searchTerms: SearchTermAgg[]
  existingNegativeTerms: Set<string>
}): StrategyNegativeKeywordSuggestion[] {
  const selected: StrategyNegativeKeywordSuggestion[] = []
  const seen = new Set<string>()

  const ranked = [...params.searchTerms]
    .sort((a, b) => {
      const hardA = classifyKeywordIntent(a.searchTerm).hardNegative ? 1 : 0
      const hardB = classifyKeywordIntent(b.searchTerm).hardNegative ? 1 : 0
      if (hardA !== hardB) return hardB - hardA
      const costDiff = toNumber(b.cost) - toNumber(a.cost)
      if (costDiff !== 0) return costDiff
      return toNumber(b.clicks) - toNumber(a.clicks)
    })

  for (const row of ranked) {
    const term = sanitizeKeyword(String(row.searchTerm || ''))
    if (!term) continue
    const normalized = normalizeKeywordKey(term)
    if (!normalized) continue
    if (seen.has(normalized) || params.existingNegativeTerms.has(normalized)) continue

    const clicks = toNumber(row.clicks, 0)
    const conversions = toNumber(row.conversions, 0)
    const cost = toNumber(row.cost, 0)
    const intent = classifyKeywordIntent(term)
    if (!intent.hardNegative) continue
    if (conversions > 0) continue
    if (clicks < 2 && cost < 1.5) continue

    seen.add(normalized)
    selected.push({
      text: term,
      matchType: 'EXACT',
      reason: intent.reasons.join(', ') || 'hard_negative_intent',
    })
    if (selected.length >= NEGATIVE_KEYWORD_PLAN_MAX) {
      break
    }
  }

  return selected
}

function buildMatchTypeOptimizationPlan(params: {
  campaignKeywords: CampaignKeywordInventory[]
  brand: string | null
  searchTermMetrics: Map<string, SearchTermAgg>
}): StrategyMatchTypeSuggestion[] {
  const selected: StrategyMatchTypeSuggestion[] = []
  const existingByTextMatch = new Set<string>()
  for (const keyword of params.campaignKeywords) {
    if (keyword.isNegative) continue
    existingByTextMatch.add(`${normalizeKeywordKey(keyword.text)}|${keyword.matchType}`)
  }

  for (const keyword of params.campaignKeywords) {
    if (keyword.isNegative) continue
    const text = sanitizeKeyword(keyword.text)
    const normalized = normalizeKeywordKey(text)
    if (!normalized) continue
    const currentMatchType = normalizeKeywordMatchType(keyword.matchType) || 'PHRASE'
    const intent = classifyKeywordIntent(text).intent
    const recommendedMatchType = recommendMatchTypeForKeyword({
      keyword: text,
      brandName: params.brand || undefined,
      intent,
    })
    if (recommendedMatchType === currentMatchType) continue
    // KISS: 仅建议“收紧匹配类型”，避免放大流量风险
    const isNarrowing =
      (currentMatchType === 'BROAD' && (recommendedMatchType === 'PHRASE' || recommendedMatchType === 'EXACT'))
      || (currentMatchType === 'PHRASE' && recommendedMatchType === 'EXACT')
    if (!isNarrowing) continue
    if (existingByTextMatch.has(`${normalized}|${recommendedMatchType}`)) continue

    const perf = params.searchTermMetrics.get(normalized)
    const clicks = toNumber(perf?.clicks, 0)
    const conversions = toNumber(perf?.conversions, 0)
    const cost = toNumber(perf?.cost, 0)
    if (clicks < 5 && cost < 3) continue
    if (conversions > 0 && clicks < 20) continue

    selected.push({
      text,
      currentMatchType,
      recommendedMatchType,
      clicks: roundTo2(clicks),
      conversions: roundTo2(conversions),
      cost: roundTo2(cost),
    })
  }

  return selected
    .sort((a, b) => {
      const aGap = a.currentMatchType === 'BROAD' ? 2 : 1
      const bGap = b.currentMatchType === 'BROAD' ? 2 : 1
      if (aGap !== bGap) return bGap - aGap
      const costDiff = toNumber(b.cost) - toNumber(a.cost)
      if (costDiff !== 0) return costDiff
      return toNumber(b.clicks) - toNumber(a.clicks)
    })
    .slice(0, MATCH_TYPE_OPTIMIZATION_MAX)
}

type DuplicateOfflineMeta = {
  offerId: number
  winnerCampaignId: number
  winnerCampaignName: string
  winnerScore: number
  loserScore: number
}

function estimateDuplicateCampaignValueScore(params: {
  roas: number | null
  ctrPct: number
  clicks: number
  cpc: number
}): number {
  const roasScore = params.roas !== null
    ? Math.min(80, Math.max(0, params.roas * 40))
    : 0
  const ctrScore = Math.min(20, Math.max(0, params.ctrPct * 2))
  const clickScore = Math.min(15, Math.max(0, params.clicks / 8))
  const cpcPenalty = params.cpc > 0 ? Math.min(12, params.cpc * 8) : 0
  return roundTo2(roasScore + ctrScore + clickScore - cpcPenalty)
}

function estimateDuplicateOfflinePriority(params: {
  winnerScore: number
  loserScore: number
  cost7d: number
}): number {
  const gap = Math.max(0, params.winnerScore - params.loserScore)
  const gapBoost = Math.min(12, gap * 1.2)
  const wasteBoost = Math.min(8, params.cost7d / 8)
  return roundTo2(Math.min(94, 74 + gapBoost + wasteBoost))
}

function buildDuplicateOfflineMetaByCampaign(params: {
  campaigns: CampaignRow[]
  perfTotalByCampaign: Map<number, PerfAgg>
  perf7dByCampaign: Map<number, PerfAgg>
  commissionByCampaign: Map<number, number>
}): Map<number, DuplicateOfflineMeta> {
  type Candidate = {
    campaignId: number
    campaignName: string
    offerId: number
    runDays: number
    impressions: number
    clicks: number
    cpc: number
    roas: number | null
    score: number
  }

  const candidatesByOffer = new Map<number, Candidate[]>()

  for (const campaign of params.campaigns) {
    const campaignId = Number(campaign.id)
    const offerId = Number(campaign.offer_id)
    if (!Number.isFinite(campaignId) || !Number.isFinite(offerId) || offerId <= 0) continue

    const runDays = calculateRunDays(campaign.created_at, campaign.published_at)
    if (runDays <= 3) continue

    const perfTotal = params.perfTotalByCampaign.get(campaignId) || { impressions: 0, clicks: 0, cost: 0 }
    const hasTraffic = perfTotal.impressions > 0 || perfTotal.clicks > 0 || perfTotal.cost > 0
    if (!hasTraffic) continue

    const ctrPct = perfTotal.impressions > 0
      ? roundTo2((perfTotal.clicks / perfTotal.impressions) * 100)
      : 0
    const cpc = perfTotal.clicks > 0 ? roundTo2(perfTotal.cost / perfTotal.clicks) : 0
    const commissionAmount = roundTo2(params.commissionByCampaign.get(campaignId) || 0)
    const roas = perfTotal.cost > 0
      ? roundTo2(commissionAmount / perfTotal.cost)
      : null
    const score = estimateDuplicateCampaignValueScore({
      roas,
      ctrPct,
      clicks: perfTotal.clicks,
      cpc,
    })

    const bucket = candidatesByOffer.get(offerId) || []
    bucket.push({
      campaignId,
      campaignName: campaign.campaign_name,
      offerId,
      runDays,
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
      cpc,
      roas,
      score,
    })
    candidatesByOffer.set(offerId, bucket)
  }

  const duplicateOfflineMetaByCampaign = new Map<number, DuplicateOfflineMeta>()

  for (const [offerId, candidates] of candidatesByOffer.entries()) {
    if (candidates.length < 2) continue
    const sorted = [...candidates].sort((a, b) => b.score - a.score)
    const winner = sorted[0]
    if (!winner) continue

    for (const candidate of sorted.slice(1)) {
      const scoreGap = winner.score - candidate.score
      const gapLargeEnough = scoreGap >= 4
      const clicksWeak = candidate.clicks <= winner.clicks * 0.85
      const roasWeak =
        winner.roas !== null
        && candidate.roas !== null
        && candidate.roas + 0.12 < winner.roas
      if (!gapLargeEnough && !clicksWeak && !roasWeak) {
        continue
      }

      const perf7d = params.perf7dByCampaign.get(candidate.campaignId) || { impressions: 0, clicks: 0, cost: 0 }
      if (perf7d.cost <= 0 && candidate.clicks <= 0) {
        continue
      }

      duplicateOfflineMetaByCampaign.set(candidate.campaignId, {
        offerId,
        winnerCampaignId: winner.campaignId,
        winnerCampaignName: winner.campaignName,
        winnerScore: winner.score,
        loserScore: candidate.score,
      })
    }
  }

  return duplicateOfflineMetaByCampaign
}

function buildCooldownUntilByKey(rows: Array<{
  campaign_id: number
  recommendation_type: string
  executed_at: string | null
}>): Map<string, number> {
  const cooldownUntilByKey = new Map<string, number>()
  for (const row of rows || []) {
    const campaignId = Number(row.campaign_id)
    if (!Number.isFinite(campaignId) || campaignId <= 0) continue
    const recommendationType = String(row.recommendation_type || '') as StrategyRecommendationType
    const cooldownDays = RECOMMENDATION_COOLDOWN_DAYS[recommendationType]
    if (!cooldownDays || cooldownDays <= 0) continue
    const executedAtMs = Date.parse(String(row.executed_at || ''))
    if (!Number.isFinite(executedAtMs) || executedAtMs <= 0) continue

    const cooldownUntilMs = executedAtMs + cooldownDays * MS_PER_DAY
    const key = recommendationCooldownKey(campaignId, recommendationType)
    const existing = cooldownUntilByKey.get(key)
    if (!existing || cooldownUntilMs > existing) {
      cooldownUntilByKey.set(key, cooldownUntilMs)
    }
  }
  return cooldownUntilByKey
}

function isRecommendationInCooldown(params: {
  campaignId: number
  recommendationType: StrategyRecommendationType
  cooldownUntilByKey?: Map<string, number>
  nowMs?: number
}): boolean {
  const until = params.cooldownUntilByKey?.get(
    recommendationCooldownKey(params.campaignId, params.recommendationType)
  )
  if (!until || !Number.isFinite(until)) return false
  return (params.nowMs || Date.now()) < until
}

function buildRecommendationDrafts(params: {
  campaigns: CampaignRow[]
  perf7dByCampaign: Map<number, PerfAgg>
  perfTotalByCampaign: Map<number, PerfAgg>
  commissionByCampaign: Map<number, number>
  keywordsByCampaign: Map<number, Set<string>>
  keywordInventoryByCampaign?: Map<number, CampaignKeywordInventory[]>
  searchTermsByCampaign?: Map<number, SearchTermAgg[]>
  keywordIdeasByOffer: Map<number, StrategyKeywordSuggestion[]>
  creativeById: Map<number, CreativeRow>
  cooldownUntilByKey?: Map<string, number>
  nowMs?: number
}): RecommendationDraft[] {
  const recommendations: RecommendationDraft[] = []
  const duplicateOfflineMetaByCampaign = buildDuplicateOfflineMetaByCampaign({
    campaigns: params.campaigns,
    perfTotalByCampaign: params.perfTotalByCampaign,
    perf7dByCampaign: params.perf7dByCampaign,
    commissionByCampaign: params.commissionByCampaign,
  })

  for (const campaign of params.campaigns) {
    const campaignId = Number(campaign.id)
    if (!Number.isFinite(campaignId)) continue

    const perf7d = params.perf7dByCampaign.get(campaignId) || { impressions: 0, clicks: 0, cost: 0 }
    const perfTotal = params.perfTotalByCampaign.get(campaignId) || { impressions: 0, clicks: 0, cost: 0 }
    const commissionAmount = roundTo2(params.commissionByCampaign.get(campaignId) || 0)
    const runDays = calculateRunDays(campaign.created_at, campaign.published_at)
    const ctrPct = perfTotal.impressions > 0
      ? roundTo2((perfTotal.clicks / perfTotal.impressions) * 100)
      : 0
    const cpc = perfTotal.clicks > 0 ? roundTo2(perfTotal.cost / perfTotal.clicks) : 0
    const roas = perfTotal.cost > 0
      ? roundTo2(commissionAmount / perfTotal.cost)
      : null

    const commissionInfo = getCommissionPerConversion({
      productPrice: campaign.product_price,
      commissionPayout: campaign.commission_payout,
      targetCountry: campaign.target_country || undefined,
    })
    const commissionPerConversion = commissionInfo?.amount && commissionInfo.amount > 0
      ? roundTo2(commissionInfo.amount)
      : null
    const recommendedCpc = commissionPerConversion
      ? roundTo2(Math.max(0.01, commissionPerConversion / CPC_RECOMMENDED_DIVISOR))
      : null
    const currentCpc = campaign.max_cpc !== null && campaign.max_cpc !== undefined
      ? roundTo2(Number(campaign.max_cpc))
      : null
    const currentBudget =
      campaign.budget_amount !== null && campaign.budget_amount !== undefined
        ? roundTo2(toNumber(campaign.budget_amount, 0))
        : null
    const budgetType = normalizeBudgetType(campaign.budget_type)
    const breakEvenConversionRatePct =
      currentCpc && commissionPerConversion
        ? roundTo2((currentCpc / commissionPerConversion) * 100)
        : null
    const breakEvenConversionRateByRecommendedCpcPct =
      recommendedCpc && commissionPerConversion
        ? roundTo2((recommendedCpc / commissionPerConversion) * 100)
        : null
    const inventoryKeywordSet = params.keywordsByCampaign.get(campaignId) || new Set<string>()
    const configKeywordSet = extractCampaignConfigKeywordSet(campaign.campaign_config)
    const keywordSet = new Set<string>(configKeywordSet)
    for (const item of inventoryKeywordSet) {
      keywordSet.add(item)
    }
    if (keywordSet.size > 0) {
      params.keywordsByCampaign.set(campaignId, keywordSet)
    }
    const keywordCoverageCount = keywordSet.size
    const keywordInventory = params.keywordInventoryByCampaign?.get(campaignId) || []
    const positiveKeywordInventory = keywordInventory.filter((item) => !item.isNegative)
    const negativeKeywordSet = new Set(
      keywordInventory
        .filter((item) => item.isNegative)
        .map((item) => normalizeKeywordKey(item.text))
        .filter(Boolean)
    )
    const searchTermRows = params.searchTermsByCampaign?.get(campaignId) || []
    const searchTermPerfByText = new Map<string, SearchTermAgg>()
    for (const row of searchTermRows) {
      const key = normalizeKeywordKey(row.searchTerm)
      if (!key) continue
      const existing = searchTermPerfByText.get(key)
      if (!existing) {
        searchTermPerfByText.set(key, row)
      } else {
        searchTermPerfByText.set(key, {
          searchTerm: existing.searchTerm || row.searchTerm,
          impressions: roundTo2(toNumber(existing.impressions, 0) + toNumber(row.impressions, 0)),
          clicks: roundTo2(toNumber(existing.clicks, 0) + toNumber(row.clicks, 0)),
          conversions: roundTo2(toNumber(existing.conversions, 0) + toNumber(row.conversions, 0)),
          cost: roundTo2(toNumber(existing.cost, 0) + toNumber(row.cost, 0)),
        })
      }
    }
    const creativeQuality = calculateCreativeQuality(
      campaign.ad_creative_id ? params.creativeById.get(Number(campaign.ad_creative_id)) : undefined
    )
    const googleCampaignId = normalizeGoogleCampaignId(campaign.google_campaign_id, campaign.campaign_id)
    const commissionLagProtected = runDays <= 3 && commissionAmount <= 0
    const impactConfidence = estimateImpactConfidence({
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
      cost: perfTotal.cost,
      roas,
      commissionLagProtected,
    })
    const impactConfidenceReason = buildImpactConfidenceReason({
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
      cost: perfTotal.cost,
      roas,
    })
    const hasLowCtrSignalSample = hasSignalSample({
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
      cost: perfTotal.cost,
      minImpressions: OFFLINE_LOW_CTR_MIN_IMPRESSIONS,
      minClicks: OFFLINE_LOW_CTR_MIN_CLICKS,
      minCost: OFFLINE_LOW_CTR_MIN_COST,
    })

    const baseData: Omit<StrategyRecommendationData, 'ruleCode' | 'analysisNote'> = {
      campaignId,
      campaignName: campaign.campaign_name,
      offerId: campaign.offer_id ?? null,
      googleCampaignId,
      runDays,
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
      cost: perfTotal.cost,
      ctrPct,
      cpc,
      roas,
      commissionAmount,
      commissionLagProtected,
      commissionPerConversion,
      currentCpc,
      recommendedCpc,
      currentBudget,
      recommendedBudget: null,
      budgetType,
      breakEvenConversionRatePct,
      breakEvenConversionRateByRecommendedCpcPct,
      estimatedCostSaving: 0,
      estimatedRevenueUplift: 0,
      estimatedNetImpact: 0,
      impactWindowDays: IMPACT_WINDOW_DAYS_COST_CONTROL,
      impactConfidence,
      impactConfidenceReason,
      keywordCoverageCount,
      creativeQuality,
    }

    const over7DaysZeroImpression =
      runDays > 7 && perfTotal.impressions <= 0 && perfTotal.clicks <= 0
    const over7DaysLowCtr =
      runDays > 7 && hasLowCtrSignalSample && perfTotal.impressions > 0 && ctrPct < 5
    const over7DaysLowRoas =
      runDays > 7
      && perfTotal.cost > 0
      && roas !== null
      && roas < 0.5
      && !commissionLagProtected

    if (over7DaysZeroImpression || over7DaysLowCtr || over7DaysLowRoas) {
      if (isRecommendationInCooldown({
        campaignId,
        recommendationType: 'offline_campaign',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs,
      })) {
        continue
      }

      const ruleCode = over7DaysZeroImpression
        ? 'offline_over7d_zero_impression'
        : over7DaysLowRoas
          ? 'offline_over7d_low_roas'
          : 'offline_over7d_low_ctr'
      const snapshotHash = buildSnapshotHash({
        type: 'offline_campaign',
        campaignId,
        ruleCode,
        runDays,
        impressions: perfTotal.impressions,
        clicks: perfTotal.clicks,
        ctrPct,
        cost: perfTotal.cost,
        cpc,
        roas,
      })
      const reason = over7DaysZeroImpression
        ? `已投放 ${runDays} 天，累计仍无曝光/点击。`
        : over7DaysLowRoas
          ? `已投放 ${runDays} 天，ROAS ${roas?.toFixed(2)}（低于 0.50）且成本已持续消耗。`
          : `已投放 ${runDays} 天，CTR 仅 ${ctrPct.toFixed(2)}%（低于 5%，且样本量已达判定阈值）。`
      const summary = over7DaysZeroImpression
        ? '建议下线该 Campaign，停止长期无效占用并回收预算。'
        : over7DaysLowRoas
          ? '建议下线该 Campaign，触发7天低ROAS止损。'
          : '建议下线该 Campaign，避免继续低效消耗。'
      const projectedWasteCost = roundTo2(
        Math.max(
          perf7d.cost,
          runDays > 0
            ? (perfTotal.cost / runDays) * IMPACT_WINDOW_DAYS_COST_CONTROL
            : perfTotal.cost
        )
      )

      recommendations.push({
        key: `${campaignId}:offline_campaign`,
        campaignId,
        googleCampaignId,
        recommendationType: 'offline_campaign',
        title: '下线Campaign（复用下线广告系列操作）',
        summary,
        reason,
        priorityScore: estimateOfflinePriority({
          noTraffic: over7DaysZeroImpression,
          lowCtr: over7DaysLowCtr,
          lowRoas: over7DaysLowRoas,
          roas,
          cost7d: perf7d.cost,
          costTotal: perfTotal.cost,
        }),
        data: {
          ...applyImpactEstimation(baseData, {
            estimatedCostSaving: projectedWasteCost,
            estimatedRevenueUplift: 0,
            impactWindowDays: IMPACT_WINDOW_DAYS_COST_CONTROL,
          }),
          snapshotHash,
          offlineOptions: {
            removeGoogleAdsCampaign: true,
            pauseClickFarmTasks: true,
            pauseUrlSwapTasks: true,
          },
          ruleCode,
          analysisNote: over7DaysZeroImpression
            ? '超过7天且无曝光/点击，命中下线规则。'
            : over7DaysLowRoas
              ? '超过7天且ROAS<0.5，命中止损下线规则。'
              : '超过7天且CTR<5%，并满足最低样本量阈值，命中下线规则。',
        },
      })

      // 下线建议优先级最高，同一 Campaign 不再生成其它可执行建议，避免冲突。
      continue
    }

    const duplicateOfflineMeta = duplicateOfflineMetaByCampaign.get(campaignId)
    if (duplicateOfflineMeta) {
      if (isRecommendationInCooldown({
        campaignId,
        recommendationType: 'offline_campaign',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs,
      })) {
        continue
      }

      const scoreGap = roundTo2(duplicateOfflineMeta.winnerScore - duplicateOfflineMeta.loserScore)
      const ruleCode = 'offline_duplicate_offer_campaign'
      const snapshotHash = buildSnapshotHash({
        type: 'offline_campaign',
        campaignId,
        ruleCode,
        offerId: duplicateOfflineMeta.offerId,
        winnerCampaignId: duplicateOfflineMeta.winnerCampaignId,
        winnerScore: duplicateOfflineMeta.winnerScore,
        loserScore: duplicateOfflineMeta.loserScore,
        scoreGap,
      })

      recommendations.push({
        key: `${campaignId}:offline_campaign`,
        campaignId,
        googleCampaignId,
        recommendationType: 'offline_campaign',
        title: '下线Campaign（合并同Offer重复系列）',
        summary: `同一Offer存在重复系列，建议保留高价值系列「${duplicateOfflineMeta.winnerCampaignName}」，下线该系列以集中预算。`,
        reason: `当前系列价值评分较低（${duplicateOfflineMeta.loserScore.toFixed(1)}），较优系列评分 ${duplicateOfflineMeta.winnerScore.toFixed(1)}，差值 ${scoreGap.toFixed(1)}。`,
        priorityScore: estimateDuplicateOfflinePriority({
          winnerScore: duplicateOfflineMeta.winnerScore,
          loserScore: duplicateOfflineMeta.loserScore,
          cost7d: perf7d.cost,
        }),
        data: {
          ...applyImpactEstimation(baseData, {
            estimatedCostSaving: roundTo2(
              Math.max(
                perf7d.cost,
                runDays > 0
                  ? (perfTotal.cost / runDays) * IMPACT_WINDOW_DAYS_COST_CONTROL
                  : perfTotal.cost
              )
            ),
            estimatedRevenueUplift: 0,
            impactWindowDays: IMPACT_WINDOW_DAYS_COST_CONTROL,
          }),
          snapshotHash,
          offlineOptions: {
            removeGoogleAdsCampaign: true,
            pauseClickFarmTasks: true,
            pauseUrlSwapTasks: true,
          },
          ruleCode,
          analysisNote: `命中重复系列合并规则：同Offer建议仅保留 ${duplicateOfflineMeta.winnerCampaignName}，当前系列建议下线。`,
        },
      })

      // 同 Offer 重复系列建议使用下线动作，避免与其它写操作冲突。
      continue
    }

    if (recommendedCpc && recommendedCpc > 0 && googleCampaignId) {
      const shouldSetCpc = !currentCpc || currentCpc <= 0
      const shouldLowerCpc = Boolean(currentCpc && currentCpc > recommendedCpc * 1.05)
      if (shouldSetCpc || shouldLowerCpc) {
        const inCooldown = isRecommendationInCooldown({
          campaignId,
          recommendationType: 'adjust_cpc',
          cooldownUntilByKey: params.cooldownUntilByKey,
          nowMs: params.nowMs,
        })
        if (!inCooldown) {
          const direction = shouldLowerCpc ? 'lower' : 'set'
          const ruleCode = direction === 'lower' ? 'cpc_above_recommended' : 'cpc_unset_use_recommended'
          const snapshotHash = buildSnapshotHash({
            type: 'adjust_cpc',
            campaignId,
            direction,
            ruleCode,
            runDays,
            currentCpc,
            recommendedCpc,
            commissionPerConversion,
            breakEvenConversionRatePct,
            breakEvenConversionRateByRecommendedCpcPct,
          })
          const reason = shouldLowerCpc
            ? `当前CPC ${currentCpc?.toFixed(2)} 高于建议CPC ${recommendedCpc.toFixed(2)}，建议下调。`
            : `当前未设置CPC上限，建议设置为 ${recommendedCpc.toFixed(2)}。`
          const lagHint = commissionLagProtected
            ? '投放≤3天且暂无佣金，按佣金滞后规则不做负向判定。'
            : '已纳入投放成本与盈亏平衡分析。'
          const projectedClicks = Math.max(
            perf7d.clicks,
            Math.round((perfTotal.clicks / Math.max(runDays, 1)) * IMPACT_WINDOW_DAYS_COST_CONTROL)
          )
          const baselineCpc = currentCpc && currentCpc > 0 ? currentCpc : (cpc > 0 ? cpc : recommendedCpc)
          const estimatedCostSaving = roundTo2(
            Math.max(0, baselineCpc - recommendedCpc) * Math.max(0, projectedClicks)
          )

          recommendations.push({
            key: `${campaignId}:adjust_cpc`,
            campaignId,
            googleCampaignId,
            recommendationType: 'adjust_cpc',
            title: direction === 'lower' ? '降低CPC至建议值' : '设置建议CPC',
            summary: `建议CPC = 商品价格 × 佣金比例 ÷ 50 = ${recommendedCpc.toFixed(2)}。`,
            reason,
            priorityScore: estimateCpcPriority({
              currentCpc,
              recommendedCpc,
              clicks7d: perf7d.clicks,
            }),
            data: {
              ...applyImpactEstimation(baseData, {
                estimatedCostSaving,
                estimatedRevenueUplift: 0,
                impactWindowDays: IMPACT_WINDOW_DAYS_COST_CONTROL,
              }),
              snapshotHash,
              cpcAdjustmentDirection: direction,
              ruleCode,
              analysisNote: `${lagHint} 当前盈亏平衡转化率 ${breakEvenConversionRatePct?.toFixed(2) ?? '--'}%，按建议CPC可降至 ${breakEvenConversionRateByRecommendedCpcPct?.toFixed(2) ?? '--'}%。`,
            },
          })
        }
      }
    }

    const shouldScaleBudget =
      Boolean(googleCampaignId)
      && (currentBudget || 0) > 0
      && runDays >= 2
      && ctrPct >= 8
      && perfTotal.impressions >= 300
      && perfTotal.clicks >= 20
      && (recommendedCpc ? cpc <= recommendedCpc * 1.1 : cpc <= 0.8)
      && (roas !== null ? roas >= 0.8 : commissionLagProtected)

    if (shouldScaleBudget && currentBudget && currentBudget > 0) {
      const inCooldown = isRecommendationInCooldown({
        campaignId,
        recommendationType: 'adjust_budget',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs,
      })
      if (!inCooldown) {
        const incrementalBudget = Math.max(
          3,
          Math.min(
            20,
            currentBudget * (roas !== null && roas >= 1.2 ? 0.6 : roas !== null && roas >= 1 ? 0.45 : 0.35)
          )
        )
        const recommendedBudget = roundTo2(currentBudget + incrementalBudget)
        const snapshotHash = buildSnapshotHash({
          type: 'adjust_budget',
          campaignId,
          runDays,
          currentBudget,
          recommendedBudget,
          budgetType,
          ctrPct,
          cpc,
          roas,
        })
        const incrementalSpend = roundTo2(
          budgetType === 'DAILY'
            ? Math.max(0, recommendedBudget - currentBudget) * IMPACT_WINDOW_DAYS_COST_CONTROL
            : Math.max(0, recommendedBudget - currentBudget)
        )
        const impactEstimationSource = resolveImpactEstimationSource({
          roas,
          commissionLagProtected,
        })
        const effectiveRoas = roas !== null
          ? Math.max(0, roas)
          : (commissionLagProtected ? 1 : 0.6)
        const estimatedRevenueUplift = roundTo2(Math.max(0, incrementalSpend * (effectiveRoas - 1)))
        const priorityScore = applyFallbackPriorityPenalty(
          estimateBudgetPriority({
            ctrPct,
            cpc,
            currentBudget,
            recommendedBudget,
          }),
          impactEstimationSource
        )

        recommendations.push({
          key: `${campaignId}:adjust_budget`,
          campaignId,
          googleCampaignId,
          recommendationType: 'adjust_budget',
          title: '提高预算放量',
          summary: `当前预算 ${currentBudget.toFixed(2)}，建议提升到 ${recommendedBudget.toFixed(2)}（${budgetType}）。`,
          reason: `CTR ${ctrPct.toFixed(2)}%、CPC ${cpc.toFixed(2)}${roas !== null ? `、ROAS ${roas.toFixed(2)}` : ''}，满足放量条件。`,
          priorityScore,
          data: {
            ...applyImpactEstimation(baseData, {
              estimatedCostSaving: 0,
              estimatedRevenueUplift,
              impactWindowDays: IMPACT_WINDOW_DAYS_COST_CONTROL,
            }),
            snapshotHash,
            recommendedBudget,
            budgetAdjustmentDirection: 'increase',
            ruleCode: 'adjust_budget_high_value_campaign',
            impactEstimationSource,
            analysisNote: `基于CTR/CPC/ROAS综合评估，建议提升预算承接有效流量。${formatImpactEstimationSource(impactEstimationSource)}。`,
          },
        })
      }
    }

    if (shouldGenerateExpandKeywordsRecommendation({
      runDays,
      keywordCoverageCount,
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
    })) {
      const inCooldown = isRecommendationInCooldown({
        campaignId,
        recommendationType: 'expand_keywords',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs,
      })
      if (!inCooldown) {
        const offerKeywordIdeas = campaign.offer_id
          ? (params.keywordIdeasByOffer.get(Number(campaign.offer_id)) || [])
          : []
        const keywordPlan = buildKeywordExpansionPlan({
          brand: campaign.brand,
          category: campaign.category,
          productName: campaign.product_name,
          existing: keywordSet,
          offerKeywordIdeas,
        })

        if (keywordPlan.length > 0) {
          const snapshotHash = buildExpandKeywordsSnapshotHash({
            campaignId,
            runDays,
            keywordCoverageCount,
            impressions: perfTotal.impressions,
            clicks: perfTotal.clicks,
            keywordPlan,
          })
          const targetHint = keywordPlan.length < KEYWORD_EXPANSION_TARGET_MIN
            ? `（候选不足，先落地 ${keywordPlan.length} 个）`
            : '（目标 20-30 个）'
          const coverageGap = Math.max(1, MIN_KEYWORD_COVERAGE_TARGET - keywordCoverageCount)
          const projectedClicks = Math.max(
            5,
            Math.round(perf7d.clicks * (0.12 + Math.min(0.28, coverageGap * 0.015)))
          )
          const projectedCost = roundTo2(projectedClicks * (cpc > 0 ? cpc : (recommendedCpc || 0.5)))
          const impactEstimationSource = resolveImpactEstimationSource({
            roas,
            commissionLagProtected,
          })
          const effectiveRoas = roas !== null
            ? Math.max(0, roas)
            : (commissionLagProtected ? 0.9 : 0.6)
          const estimatedRevenueUplift = roundTo2(Math.max(0, projectedCost * (effectiveRoas - 1)))
          const priorityScore = applyFallbackPriorityPenalty(
            estimateKeywordPriority({
              keywordCount: keywordCoverageCount,
              impressions: perfTotal.impressions,
              clicks: perfTotal.clicks,
            }),
            impactEstimationSource
          )

          recommendations.push({
            key: `${campaignId}:expand_keywords`,
            campaignId,
            googleCampaignId,
            recommendationType: 'expand_keywords',
            title: '扩量关键词（含匹配类型）',
            summary: `当前关键词 ${keywordCoverageCount} 个，建议新增 ${keywordPlan.length} 个关键词提升覆盖${targetHint}。`,
            reason: `关键词覆盖不足（<${MIN_KEYWORD_COVERAGE_TARGET}）且流量偏低（曝光 ${perfTotal.impressions} / 点击 ${perfTotal.clicks}）。`,
            priorityScore,
            data: {
              ...applyImpactEstimation(baseData, {
                estimatedCostSaving: 0,
                estimatedRevenueUplift,
                impactWindowDays: IMPACT_WINDOW_DAYS_TRAFFIC_GROWTH,
              }),
              snapshotHash,
              keywordPlan,
              ruleCode: 'expand_keywords_low_coverage_low_traffic',
              impactEstimationSource,
              analysisNote: `已为新增关键词自动选择匹配类型（EXACT/PHRASE/BROAD）。${formatImpactEstimationSource(impactEstimationSource)}。`,
            },
          })
        }
      }
    }

    const negativeKeywordPlan = buildNegativeKeywordPlan({
      searchTerms: searchTermRows,
      existingNegativeTerms: negativeKeywordSet,
    })
    if (negativeKeywordPlan.length > 0) {
      const inCooldown = isRecommendationInCooldown({
        campaignId,
        recommendationType: 'add_negative_keywords',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs,
      })
      if (!inCooldown) {
        const hardNegativeCount = negativeKeywordPlan.length
        const totalNegativeWasteCost = roundTo2(
          negativeKeywordPlan.reduce((acc, item) => {
            const row = searchTermPerfByText.get(normalizeKeywordKey(item.text))
            return acc + toNumber(row?.cost, 0)
          }, 0)
        )
        const snapshotHash = buildSnapshotHash({
          type: 'add_negative_keywords',
          campaignId,
          runDays,
          plan: negativeKeywordPlan.map((item) => ({
            text: item.text,
            matchType: item.matchType,
          })),
        })
        const estimatedCostSaving = roundTo2(totalNegativeWasteCost * 0.7)
        recommendations.push({
          key: `${campaignId}:add_negative_keywords`,
          campaignId,
          googleCampaignId,
          recommendationType: 'add_negative_keywords',
          title: '新增否词（低质流量拦截）',
          summary: `识别到 ${negativeKeywordPlan.length} 个高风险搜索词，建议作为否词拦截。`,
          reason: `近${SEARCH_TERM_LOOKBACK_DAYS}天硬负向词存在消耗，预估可减少无效花费 ${totalNegativeWasteCost.toFixed(2)}。`,
          priorityScore: estimateNegativeKeywordPriority({
            hardNegativeCount,
            totalCost: totalNegativeWasteCost,
            selectedCount: negativeKeywordPlan.length,
          }),
          data: {
            ...applyImpactEstimation(baseData, {
              estimatedCostSaving,
              estimatedRevenueUplift: 0,
              impactWindowDays: IMPACT_WINDOW_DAYS_TRAFFIC_GROWTH,
            }),
            snapshotHash,
            negativeKeywordPlan,
            ruleCode: 'negative_keywords_from_search_terms',
            analysisNote: '基于搜索词报告识别硬负向意图词（投放回收口径仍按Campaign/Offer级佣金）。',
          },
        })
      }
    }

    const matchTypePlan = buildMatchTypeOptimizationPlan({
      campaignKeywords: positiveKeywordInventory,
      brand: campaign.brand,
      searchTermMetrics: searchTermPerfByText,
    })
    if (matchTypePlan.length > 0) {
      const inCooldown = isRecommendationInCooldown({
        campaignId,
        recommendationType: 'optimize_match_type',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs,
      })
      if (!inCooldown) {
        const broadToNarrowCount = matchTypePlan.filter((item) => item.currentMatchType === 'BROAD').length
        const totalCost = roundTo2(matchTypePlan.reduce((acc, item) => acc + toNumber(item.cost, 0), 0))
        const snapshotHash = buildSnapshotHash({
          type: 'optimize_match_type',
          campaignId,
          runDays,
          plan: matchTypePlan.map((item) => ({
            text: item.text,
            currentMatchType: item.currentMatchType,
            recommendedMatchType: item.recommendedMatchType,
          })),
        })
        const estimatedCostSaving = roundTo2(totalCost * 0.2)
        const estimatedRevenueUplift = roas !== null && roas >= 0.6
          ? roundTo2(totalCost * Math.min(0.12, Math.max(0.03, roas * 0.05)))
          : 0

        recommendations.push({
          key: `${campaignId}:optimize_match_type`,
          campaignId,
          googleCampaignId,
          recommendationType: 'optimize_match_type',
          title: '优化匹配类型（收紧流量）',
          summary: `识别到 ${matchTypePlan.length} 个关键词存在匹配类型优化空间，建议收紧以提升流量质量。`,
          reason: `候选词近${SEARCH_TERM_LOOKBACK_DAYS}天累计花费 ${totalCost.toFixed(2)}，建议优先从 BROAD 收敛到 PHRASE/EXACT。`,
          priorityScore: estimateMatchTypePriority({
            selectedCount: matchTypePlan.length,
            totalCost,
            broadToNarrowCount,
          }),
          data: {
            ...applyImpactEstimation(baseData, {
              estimatedCostSaving,
              estimatedRevenueUplift,
              impactWindowDays: IMPACT_WINDOW_DAYS_TRAFFIC_GROWTH,
            }),
            snapshotHash,
            matchTypePlan,
            matchTypeReplaceMode: 'pause_existing',
            ruleCode: 'optimize_keyword_match_type',
            analysisNote: '执行方式为新增推荐匹配类型关键词，并默认暂停原匹配类型关键词（可回滚）。',
          },
        })
      }
    }
  }

  return recommendations.sort((a, b) => b.priorityScore - a.priorityScore)
}

async function fetchOfferKeywordIdeas(params: {
  userId: number
  offerIds: number[]
  brandByOfferId: Map<number, string>
}): Promise<Map<number, StrategyKeywordSuggestion[]>> {
  const result = new Map<number, StrategyKeywordSuggestion[]>()
  if (!params.offerIds.length) {
    return result
  }

  await Promise.all(params.offerIds.map(async (offerId) => {
    try {
      const payload = await fetchAutoadsJson<{
        success?: boolean
        keywords?: Array<{
          text?: string
          recommendedMatchType?: string
          matchType?: string
        }>
      }>({
        userId: params.userId,
        path: `/api/offers/${offerId}/keyword-ideas`,
        method: 'POST',
        body: {},
      })

      const brand = sanitizeKeyword(params.brandByOfferId.get(offerId) || '')
      const seen = new Set<string>()
      const normalized: StrategyKeywordSuggestion[] = []

      for (const row of payload?.keywords || []) {
        const text = sanitizeKeyword(String(row?.text || ''))
        if (!text) continue
        const key = text.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const intent = classifyKeywordIntent(text).intent
        normalized.push({
          text,
          matchType:
            normalizeKeywordMatchType(row?.recommendedMatchType || row?.matchType)
            || recommendMatchTypeForKeyword({
              keyword: text,
              brandName: brand || undefined,
              intent,
            }),
        })
      }

      result.set(offerId, normalized.slice(0, 50))
    } catch (error: any) {
      console.warn(`[openclaw.strategy] fetch keyword ideas failed for offer ${offerId}:`, error?.message || error)
      result.set(offerId, [])
    }
  }))

  return result
}

async function listRecommendations(params: {
  userId: number
  reportDate: string
  limit?: number
}): Promise<StrategyRecommendation[]> {
  const db = await getDatabase()
  const rows = await db.query<any>(
    `
      SELECT
        id,
        user_id,
        report_date,
        campaign_id,
        google_campaign_id,
        snapshot_hash,
        approved_snapshot_hash,
        recommendation_type,
        title,
        summary,
        reason,
        priority_score,
        status,
        data_json,
        approved_at,
        executed_at,
        execution_result_json,
        created_at,
        updated_at
      FROM openclaw_strategy_recommendations
      WHERE user_id = ?
        AND report_date = ?
      ORDER BY priority_score DESC, created_at DESC
      LIMIT ?
    `,
    [params.userId, params.reportDate, params.limit || 200]
  )

  return rows.map((row: any) => ({
    id: String(row.id),
    userId: Number(row.user_id),
    reportDate: String(row.report_date),
    campaignId: Number(row.campaign_id),
    googleCampaignId: row.google_campaign_id ? String(row.google_campaign_id) : null,
    snapshotHash: row.snapshot_hash ? String(row.snapshot_hash) : null,
    approvedSnapshotHash: row.approved_snapshot_hash ? String(row.approved_snapshot_hash) : null,
    recommendationType: String(row.recommendation_type) as StrategyRecommendationType,
    title: String(row.title || ''),
    summary: row.summary ? String(row.summary) : null,
    reason: row.reason ? String(row.reason) : null,
    priorityScore: toNumber(row.priority_score, 0),
    status: String(row.status || 'pending') as StrategyRecommendationStatus,
    data: safeParseObject(row.data_json) as StrategyRecommendationData,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    executedAt: row.executed_at ? String(row.executed_at) : null,
    executionResult: safeParseObject(row.execution_result_json),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }))
}

async function fetchKeywordCoverageByCampaign(params: {
  userId: number
  campaignIds: number[]
}): Promise<Map<number, number>> {
  const campaignIds = Array.from(new Set(
    (params.campaignIds || [])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
  ))
  if (campaignIds.length === 0) {
    return new Map<number, number>()
  }

  const db = await getDatabase()
  const placeholders = campaignIds.map(() => '?').join(', ')
  const [keywordRows, campaignRows] = await Promise.all([
    db.query<KeywordInventoryRow>(
      `
        SELECT
          ag.campaign_id,
          k.keyword_text,
          k.match_type,
          k.is_negative
        FROM ad_groups ag
        INNER JOIN keywords k ON k.ad_group_id = ag.id AND k.user_id = ?
        WHERE ag.user_id = ?
          AND ag.campaign_id IN (${placeholders})
      `,
      [params.userId, params.userId, ...campaignIds]
    ),
    db.query<{
      id: number
      campaign_config: unknown
    }>(
      `
        SELECT
          id,
          campaign_config
        FROM campaigns
        WHERE user_id = ?
          AND id IN (${placeholders})
      `,
      [params.userId, ...campaignIds]
    ),
  ])

  const keywordsByCampaign = new Map<number, Set<string>>()

  for (const row of keywordRows || []) {
    const campaignId = Number(row.campaign_id)
    const keywordText = sanitizeKeyword(String(row.keyword_text || ''))
    if (!Number.isFinite(campaignId) || !keywordText) continue
    if (normalizeBoolean(row.is_negative)) continue
    const normalized = normalizeKeywordKey(keywordText)
    if (!normalized) continue
    const bucket = keywordsByCampaign.get(campaignId) || new Set<string>()
    bucket.add(normalized)
    keywordsByCampaign.set(campaignId, bucket)
  }

  for (const row of campaignRows || []) {
    const campaignId = Number(row.id)
    if (!Number.isFinite(campaignId)) continue
    const bucket = keywordsByCampaign.get(campaignId) || new Set<string>()
    const configKeywordSet = extractCampaignConfigKeywordSet(row.campaign_config)
    for (const item of configKeywordSet) {
      bucket.add(item)
    }
    keywordsByCampaign.set(campaignId, bucket)
  }

  const coverageByCampaign = new Map<number, number>()
  for (const campaignId of campaignIds) {
    coverageByCampaign.set(campaignId, (keywordsByCampaign.get(campaignId) || new Set<string>()).size)
  }
  return coverageByCampaign
}

async function repairLegacyExpandKeywordCoverage(params: {
  userId: number
  reportDate: string
  recommendations: StrategyRecommendation[]
}): Promise<StrategyRecommendation[]> {
  const targetRecommendations = params.recommendations.filter((item) => (
    item.recommendationType === 'expand_keywords'
    && toNumber(item.data?.keywordCoverageCount, 0) <= 0
  ))
  if (targetRecommendations.length === 0) {
    return params.recommendations
  }

  const coverageByCampaign = await fetchKeywordCoverageByCampaign({
    userId: params.userId,
    campaignIds: targetRecommendations.map((item) => item.campaignId),
  })
  if (coverageByCampaign.size === 0) {
    return params.recommendations
  }

  const updates = new Map<string, { summary: string | null; data: StrategyRecommendationData }>()
  for (const item of targetRecommendations) {
    const keywordCoverageCount = Number(coverageByCampaign.get(item.campaignId) || 0)
    if (!Number.isFinite(keywordCoverageCount) || keywordCoverageCount <= 0) continue
    const nextData = {
      ...item.data,
      keywordCoverageCount: Math.floor(keywordCoverageCount),
    }
    updates.set(item.id, {
      summary: patchExpandKeywordsSummaryCoverage(item.summary, keywordCoverageCount),
      data: nextData,
    })
  }

  if (updates.size === 0) {
    return params.recommendations
  }

  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  await Promise.allSettled(
    Array.from(updates.entries()).map(async ([recommendationId, payload]) => {
      await db.exec(
        `
          UPDATE openclaw_strategy_recommendations
          SET data_json = ?,
              summary = ?,
              updated_at = ${nowFunc}
          WHERE id = ?
            AND user_id = ?
            AND report_date = ?
        `,
        [
          toDbJsonObjectField(payload.data, db.type, payload.data),
          payload.summary,
          recommendationId,
          params.userId,
          params.reportDate,
        ]
      )
    })
  )

  const nowIso = new Date().toISOString()
  return params.recommendations.map((item) => {
    const patched = updates.get(item.id)
    if (!patched) return item
    return {
      ...item,
      summary: patched.summary,
      data: patched.data,
      updatedAt: nowIso,
    }
  })
}

async function appendRecommendationEvent(params: {
  recommendationId: string
  userId: number
  eventType: string
  actorUserId?: number | null
  eventJson?: unknown
}) {
  const db = await getDatabase()
  await db.exec(
    `
      INSERT INTO openclaw_strategy_recommendation_events
        (recommendation_id, user_id, event_type, actor_user_id, event_json)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      params.recommendationId,
      params.userId,
      params.eventType,
      params.actorUserId || null,
      toDbJsonObjectField(params.eventJson ?? null, db.type, null),
    ]
  )
}

export async function persistStrategyRecommendationExecutionRuntime(params: {
  userId: number
  recommendationId: string
  executionResult: Record<string, any>
}): Promise<void> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  await db.exec(
    `
      UPDATE openclaw_strategy_recommendations
      SET execution_result_json = ?,
          updated_at = ${nowFunc}
      WHERE id = ?
        AND user_id = ?
    `,
    [
      toDbJsonObjectField(params.executionResult || {}, db.type, params.executionResult || {}),
      params.recommendationId,
      params.userId,
    ]
  )
}

export async function refreshStrategyRecommendations(params: {
  userId: number
  reportDate?: string
  limit?: number
}): Promise<StrategyRecommendation[]> {
  const requestedReportDate = params.reportDate || formatLocalDate(new Date())
  const reportDate = normalizeOpenclawReportDate(requestedReportDate)
  const limit = params.limit || 200
  const inflightKey = `${params.userId}:${reportDate}:${limit}`
  const existingInflight = refreshRecommendationsInflight.get(inflightKey)
  if (existingInflight) {
    return existingInflight
  }

  const task = (async () => {
    const db = await getDatabase()
    const isDeletedCondition = db.type === 'postgres' ? 'c.is_deleted = FALSE' : 'c.is_deleted = 0'

    const campaigns = await db.query<CampaignRow>(
      `
        SELECT
          c.id,
          c.campaign_name,
          c.campaign_id,
          c.google_campaign_id,
          c.max_cpc,
          c.budget_amount,
          c.budget_type,
          c.created_at,
          c.published_at,
          c.offer_id,
          c.ad_creative_id,
          o.product_price,
          o.commission_payout,
          o.target_country,
          o.brand,
          o.category,
          o.product_name,
          c.campaign_config
        FROM campaigns c
        LEFT JOIN offers o ON c.offer_id = o.id
        WHERE c.user_id = ?
          AND c.status = 'ENABLED'
          AND ${isDeletedCondition}
        ORDER BY c.created_at DESC
      `,
      [params.userId]
    )

    const endDate = reportDate
    const startDate7 = shiftIsoDate(endDate, -6)
    const startDateSearchTerm = shiftIsoDate(endDate, -(SEARCH_TERM_LOOKBACK_DAYS - 1))

    const [perf7Rows, perfTotalRows, commissionRows, keywordRows, searchTermRows] = await Promise.all([
      db.query<{ campaign_id: number; impressions: number; clicks: number; cost: number }>(
        `
          SELECT
            campaign_id,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(cost), 0) AS cost
          FROM campaign_performance
          WHERE user_id = ?
            AND date >= ?
            AND date <= ?
          GROUP BY campaign_id
        `,
        [params.userId, startDate7, endDate]
      ),
      db.query<{ campaign_id: number; impressions: number; clicks: number; cost: number }>(
        `
          SELECT
            campaign_id,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(cost), 0) AS cost
          FROM campaign_performance
          WHERE user_id = ?
            AND date <= ?
          GROUP BY campaign_id
        `,
        [params.userId, endDate]
      ),
      db.query<{ campaign_id: number; commission: number }>(
        `
          SELECT
            campaign_id,
            COALESCE(SUM(commission_amount), 0) AS commission
          FROM affiliate_commission_attributions
          WHERE user_id = ?
            AND campaign_id IS NOT NULL
            AND report_date <= ?
          GROUP BY campaign_id
        `,
        [params.userId, endDate]
      ),
      db.query<KeywordInventoryRow>(
        `
          SELECT
            ag.campaign_id,
            k.keyword_text,
            k.match_type,
            k.is_negative
          FROM ad_groups ag
          INNER JOIN keywords k ON k.ad_group_id = ag.id AND k.user_id = ?
          WHERE ag.user_id = ?
        `,
        [params.userId, params.userId]
      ),
      db.query<{
        campaign_id: number
        search_term: string
        impressions: number
        clicks: number
        conversions: number
        cost: number
      }>(
        `
          SELECT
            campaign_id,
            search_term,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(conversions), 0) AS conversions,
            COALESCE(SUM(cost), 0) AS cost
          FROM search_term_reports
          WHERE user_id = ?
            AND date >= ?
            AND date <= ?
          GROUP BY campaign_id, search_term
        `,
        [params.userId, startDateSearchTerm, endDate]
      ),
    ])

    const perf7dByCampaign = buildPerfMap(perf7Rows || [])
    const perfTotalByCampaign = buildPerfMap(perfTotalRows || [])
    const commissionByCampaign = new Map<number, number>()
    for (const row of commissionRows || []) {
      const id = Number(row.campaign_id)
      if (!Number.isFinite(id)) continue
      commissionByCampaign.set(id, roundTo2(toNumber(row.commission, 0)))
    }

    const keywordInventoryByCampaign = new Map<number, CampaignKeywordInventory[]>()
    const keywordsByCampaign = new Map<number, Set<string>>()
    for (const row of (keywordRows || []) as KeywordInventoryRow[]) {
      const campaignId = Number(row.campaign_id)
      const keywordText = sanitizeKeyword(String(row.keyword_text || ''))
      if (!Number.isFinite(campaignId) || !keywordText) continue
      const matchType = normalizeKeywordMatchType(row.match_type) || 'PHRASE'
      const isNegative = normalizeBoolean(row.is_negative)
      const inventory = keywordInventoryByCampaign.get(campaignId) || []
      inventory.push({
        text: keywordText,
        matchType,
        isNegative,
      })
      keywordInventoryByCampaign.set(campaignId, inventory)
      if (isNegative) {
        continue
      }
      const normalized = keywordText.toLowerCase()
      const set = keywordsByCampaign.get(campaignId) || new Set<string>()
      set.add(normalized)
      keywordsByCampaign.set(campaignId, set)
    }

    const searchTermsByCampaign = new Map<number, SearchTermAgg[]>()
    for (const row of searchTermRows || []) {
      const campaignId = Number(row.campaign_id)
      const searchTerm = sanitizeKeyword(String(row.search_term || ''))
      if (!Number.isFinite(campaignId) || !searchTerm) continue
      const bucket = searchTermsByCampaign.get(campaignId) || []
      bucket.push({
        searchTerm,
        impressions: toNumber(row.impressions, 0),
        clicks: toNumber(row.clicks, 0),
        conversions: toNumber(row.conversions, 0),
        cost: roundTo2(toNumber(row.cost, 0)),
      })
      searchTermsByCampaign.set(campaignId, bucket)
    }

    const creativeIds = Array.from(
      new Set(campaigns
        .map((campaign) => Number(campaign.ad_creative_id))
        .filter((id) => Number.isFinite(id) && id > 0))
    )
    const creativeById = new Map<number, CreativeRow>()
    if (creativeIds.length > 0) {
      const placeholders = creativeIds.map(() => '?').join(', ')
      const rows = await db.query<CreativeRow>(
        `
          SELECT id, headlines, descriptions, keywords, keywords_with_volume
          FROM ad_creatives
          WHERE user_id = ?
            AND id IN (${placeholders})
        `,
        [params.userId, ...creativeIds]
      )
      for (const row of rows) {
        creativeById.set(Number(row.id), row)
      }
    }

    const brandByOfferId = new Map<number, string>()
    const keywordIdeaOfferIds = new Set<number>()
    for (const campaign of campaigns) {
      const offerId = Number(campaign.offer_id)
      if (!Number.isFinite(offerId) || offerId <= 0) continue
      if (!brandByOfferId.has(offerId)) {
        brandByOfferId.set(offerId, sanitizeKeyword(String(campaign.brand || '')))
      }
      const campaignId = Number(campaign.id)
      if (!Number.isFinite(campaignId)) continue
      const perfTotal = perfTotalByCampaign.get(campaignId) || { impressions: 0, clicks: 0, cost: 0 }
      const runDays = calculateRunDays(campaign.created_at, campaign.published_at)
      const inventoryKeywordSet = keywordsByCampaign.get(campaignId) || new Set<string>()
      const configKeywordSet = extractCampaignConfigKeywordSet(campaign.campaign_config)
      const keywordSet = new Set<string>(configKeywordSet)
      for (const item of inventoryKeywordSet) {
        keywordSet.add(item)
      }
      if (keywordSet.size > 0) {
        keywordsByCampaign.set(campaignId, keywordSet)
      }
      const keywordCoverageCount = keywordSet.size
      if (shouldGenerateExpandKeywordsRecommendation({
        runDays,
        keywordCoverageCount,
        impressions: perfTotal.impressions,
        clicks: perfTotal.clicks,
      })) {
        keywordIdeaOfferIds.add(offerId)
      }
    }

    const keywordIdeasByOffer = await fetchOfferKeywordIdeas({
      userId: params.userId,
      offerIds: Array.from(keywordIdeaOfferIds),
      brandByOfferId,
    })

    const executedRecommendationRows = await db.query<{
      campaign_id: number
      recommendation_type: string
      executed_at: string | null
    }>(
      `
        SELECT campaign_id, recommendation_type, executed_at
        FROM openclaw_strategy_recommendations
        WHERE user_id = ?
          AND status = 'executed'
          AND executed_at IS NOT NULL
        ORDER BY executed_at DESC
        LIMIT 1000
      `,
      [params.userId]
    )
    const cooldownUntilByKey = buildCooldownUntilByKey(executedRecommendationRows || [])

    const drafts = buildRecommendationDrafts({
      campaigns,
      perf7dByCampaign,
      perfTotalByCampaign,
      commissionByCampaign,
      keywordsByCampaign,
      keywordInventoryByCampaign,
      searchTermsByCampaign,
      keywordIdeasByOffer,
      creativeById,
      cooldownUntilByKey,
      nowMs: Date.now(),
    })

    const existingRows = await db.query<{
      id: string
      campaign_id: number
      recommendation_type: StrategyRecommendationType
      status: StrategyRecommendationStatus
      snapshot_hash: string | null
    }>(
      `
        SELECT id, campaign_id, recommendation_type, status, snapshot_hash
        FROM openclaw_strategy_recommendations
        WHERE user_id = ?
          AND report_date = ?
      `,
      [params.userId, reportDate]
    )

    const existingByKey = new Map<string, {
      id: string
      status: StrategyRecommendationStatus
      snapshotHash: string | null
    }>()
    for (const row of existingRows || []) {
      existingByKey.set(`${row.campaign_id}:${row.recommendation_type}`, {
        id: row.id,
        status: row.status,
        snapshotHash: row.snapshot_hash ? String(row.snapshot_hash) : null,
      })
    }

    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    const generatedIds: string[] = []
    for (const draft of drafts) {
      const existing = existingByKey.get(draft.key)
      const recommendationId = existing?.id || crypto.randomUUID()
      generatedIds.push(recommendationId)
      const snapshotHash = draft.data.snapshotHash || null
      const shouldAppendGeneratedEvent = !existing || String(existing.snapshotHash || '') !== String(snapshotHash || '')

      await db.exec(
        `
          INSERT INTO openclaw_strategy_recommendations
            (
              id,
              user_id,
              report_date,
              campaign_id,
              google_campaign_id,
              recommendation_type,
              title,
              summary,
              reason,
              priority_score,
              status,
              snapshot_hash,
              approved_snapshot_hash,
              data_json,
              created_at,
              updated_at
            )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})
          ON CONFLICT(user_id, report_date, campaign_id, recommendation_type)
          DO UPDATE SET
            google_campaign_id = excluded.google_campaign_id,
            title = excluded.title,
            summary = excluded.summary,
            reason = excluded.reason,
            priority_score = excluded.priority_score,
            snapshot_hash = excluded.snapshot_hash,
            data_json = CASE
              WHEN openclaw_strategy_recommendations.status = 'executed'
                THEN openclaw_strategy_recommendations.data_json
              ELSE excluded.data_json
            END,
            status = CASE
              WHEN openclaw_strategy_recommendations.status = 'executed' THEN openclaw_strategy_recommendations.status
              WHEN openclaw_strategy_recommendations.status = 'approved'
                AND openclaw_strategy_recommendations.approved_snapshot_hash IS NOT NULL
                AND openclaw_strategy_recommendations.snapshot_hash = excluded.snapshot_hash
                THEN openclaw_strategy_recommendations.status
              WHEN openclaw_strategy_recommendations.status = 'dismissed'
                AND openclaw_strategy_recommendations.snapshot_hash = excluded.snapshot_hash
                THEN openclaw_strategy_recommendations.status
              ELSE excluded.status
            END,
            approved_at = CASE
              WHEN openclaw_strategy_recommendations.status = 'approved'
                AND openclaw_strategy_recommendations.approved_snapshot_hash IS NOT NULL
                AND openclaw_strategy_recommendations.snapshot_hash = excluded.snapshot_hash
                THEN openclaw_strategy_recommendations.approved_at
              WHEN openclaw_strategy_recommendations.status = 'executed'
                THEN openclaw_strategy_recommendations.approved_at
              ELSE NULL
            END,
            approved_snapshot_hash = CASE
              WHEN openclaw_strategy_recommendations.status = 'approved'
                AND openclaw_strategy_recommendations.approved_snapshot_hash IS NOT NULL
                AND openclaw_strategy_recommendations.snapshot_hash = excluded.snapshot_hash
                THEN openclaw_strategy_recommendations.approved_snapshot_hash
              WHEN openclaw_strategy_recommendations.status = 'executed'
                THEN openclaw_strategy_recommendations.approved_snapshot_hash
              ELSE NULL
            END,
            updated_at = ${nowFunc}
        `,
        [
          recommendationId,
          params.userId,
          reportDate,
          draft.campaignId,
          draft.googleCampaignId,
          draft.recommendationType,
          draft.title,
          draft.summary,
          draft.reason,
          draft.priorityScore,
          'pending',
          snapshotHash,
          null,
          toDbJsonObjectField(draft.data, db.type, draft.data),
        ]
      )

      if (shouldAppendGeneratedEvent) {
        await appendRecommendationEvent({
          recommendationId,
          userId: params.userId,
          eventType: 'generated',
          actorUserId: params.userId,
          eventJson: {
            recommendationType: draft.recommendationType,
            priorityScore: draft.priorityScore,
            snapshotHash,
          },
        })
      }
    }

    if (generatedIds.length > 0) {
      const placeholders = generatedIds.map(() => '?').join(', ')
      await db.exec(
        `
          DELETE FROM openclaw_strategy_recommendations
          WHERE user_id = ?
            AND report_date = ?
            AND status = 'pending'
            AND id NOT IN (${placeholders})
        `,
        [params.userId, reportDate, ...generatedIds]
      )

      // 对于当次未再命中的建议，标记为 stale（待重审），避免继续执行历史审批结果。
      await db.exec(
        `
          UPDATE openclaw_strategy_recommendations
          SET status = 'stale',
              approved_at = NULL,
              approved_snapshot_hash = NULL,
              updated_at = ${nowFunc}
          WHERE user_id = ?
            AND report_date = ?
            AND status IN ('approved', 'failed')
            AND id NOT IN (${placeholders})
        `,
        [params.userId, reportDate, ...generatedIds]
      )
    } else {
      await db.exec(
        `
          DELETE FROM openclaw_strategy_recommendations
          WHERE user_id = ?
            AND report_date = ?
            AND status = 'pending'
        `,
        [params.userId, reportDate]
      )

      await db.exec(
        `
          UPDATE openclaw_strategy_recommendations
          SET status = 'stale',
              approved_at = NULL,
              approved_snapshot_hash = NULL,
              updated_at = ${nowFunc}
          WHERE user_id = ?
            AND report_date = ?
            AND status IN ('approved', 'failed')
        `,
        [params.userId, reportDate]
      )
    }

    return listRecommendations({
      userId: params.userId,
      reportDate,
      limit: params.limit,
    })
  })()

  refreshRecommendationsInflight.set(inflightKey, task)
  try {
    return await task
  } finally {
    if (refreshRecommendationsInflight.get(inflightKey) === task) {
      refreshRecommendationsInflight.delete(inflightKey)
    }
  }
}

export async function getStrategyRecommendations(params: {
  userId: number
  reportDate?: string
  forceRefresh?: boolean
  limit?: number
}): Promise<StrategyRecommendation[]> {
  const requestedReportDate = params.reportDate || formatLocalDate(new Date())
  const reportDate = normalizeOpenclawReportDate(requestedReportDate)
  if (params.forceRefresh) {
    return refreshStrategyRecommendations({
      userId: params.userId,
      reportDate,
      limit: params.limit,
    })
  }

  const existing = await listRecommendations({
    userId: params.userId,
    reportDate,
    limit: params.limit,
  })
  if (existing.length > 0) {
    return repairLegacyExpandKeywordCoverage({
      userId: params.userId,
      reportDate,
      recommendations: existing,
    })
  }

  return refreshStrategyRecommendations({
    userId: params.userId,
    reportDate,
    limit: params.limit,
  })
}

async function getRecommendationById(params: {
  userId: number
  recommendationId: string
}): Promise<StrategyRecommendation | null> {
  const db = await getDatabase()
  const row = await db.queryOne<any>(
    `
      SELECT
        id,
        user_id,
        report_date,
        campaign_id,
        google_campaign_id,
        snapshot_hash,
        approved_snapshot_hash,
        recommendation_type,
        title,
        summary,
        reason,
        priority_score,
        status,
        data_json,
        approved_at,
        executed_at,
        execution_result_json,
        created_at,
        updated_at
      FROM openclaw_strategy_recommendations
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    [params.recommendationId, params.userId]
  )

  if (!row) return null

  return {
    id: String(row.id),
    userId: Number(row.user_id),
    reportDate: String(row.report_date),
    campaignId: Number(row.campaign_id),
    googleCampaignId: row.google_campaign_id ? String(row.google_campaign_id) : null,
    snapshotHash: row.snapshot_hash ? String(row.snapshot_hash) : null,
    approvedSnapshotHash: row.approved_snapshot_hash ? String(row.approved_snapshot_hash) : null,
    recommendationType: String(row.recommendation_type) as StrategyRecommendationType,
    title: String(row.title || ''),
    summary: row.summary ? String(row.summary) : null,
    reason: row.reason ? String(row.reason) : null,
    priorityScore: toNumber(row.priority_score, 0),
    status: String(row.status || 'pending') as StrategyRecommendationStatus,
    data: safeParseObject(row.data_json) as StrategyRecommendationData,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    executedAt: row.executed_at ? String(row.executed_at) : null,
    executionResult: safeParseObject(row.execution_result_json),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

export async function approveStrategyRecommendation(params: {
  userId: number
  recommendationId: string
}): Promise<StrategyRecommendation> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const existing = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!existing) {
    throw new Error('建议不存在或无权限访问')
  }

  if (existing.status === 'executed') {
    return existing
  }

  await db.exec(
    `
      UPDATE openclaw_strategy_recommendations
      SET status = 'approved',
          approved_at = COALESCE(approved_at, ${nowFunc}),
          approved_snapshot_hash = snapshot_hash,
          updated_at = ${nowFunc}
      WHERE id = ?
        AND user_id = ?
    `,
    [params.recommendationId, params.userId]
  )

  await appendRecommendationEvent({
    recommendationId: params.recommendationId,
    userId: params.userId,
    eventType: 'approved',
    actorUserId: params.userId,
    eventJson: {
      snapshotHash: existing.snapshotHash || null,
    },
  })

  const latest = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!latest) {
    throw new Error('建议审批后读取失败')
  }
  return latest
}

export async function dismissStrategyRecommendation(params: {
  userId: number
  recommendationId: string
}): Promise<StrategyRecommendation> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const existing = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!existing) {
    throw new Error('建议不存在或无权限访问')
  }
  if (existing.status === 'executed') {
    throw new Error('已执行建议不支持忽略')
  }

  await db.exec(
    `
      UPDATE openclaw_strategy_recommendations
      SET status = 'dismissed',
          approved_at = NULL,
          approved_snapshot_hash = NULL,
          updated_at = ${nowFunc}
      WHERE id = ?
        AND user_id = ?
    `,
    [params.recommendationId, params.userId]
  )

  await appendRecommendationEvent({
    recommendationId: params.recommendationId,
    userId: params.userId,
    eventType: 'dismissed',
    actorUserId: params.userId,
    eventJson: {
      snapshotHash: existing.snapshotHash || null,
    },
  })

  const latest = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!latest) {
    throw new Error('建议忽略后读取失败')
  }
  return latest
}

function parseExecutionResultObject(value: unknown): Record<string, any> {
  return safeParseObject(value)
}

function buildDeterministicRecommendationExecuteTaskId(params: {
  recommendationId: string
  snapshotHash: string | null | undefined
}): string {
  const normalizedRecommendationId = String(params.recommendationId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80)
  const normalizedSnapshotHash = String(params.snapshotHash || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40)
  const recommendationPart = normalizedRecommendationId || 'unknown'
  const snapshotPart = normalizedSnapshotHash || 'nosnapshot'
  return `openclaw-strategy-exec-${recommendationPart}-${snapshotPart}`
}

export async function assertStrategyRecommendationReadyForExecution(params: {
  userId: number
  recommendationId: string
  confirm: boolean
}): Promise<StrategyRecommendation> {
  if (!params.confirm) {
    throw new Error('执行前需要二次确认')
  }

  const recommendation = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!recommendation) {
    throw new Error('建议不存在或无权限访问')
  }
  const serverDate = formatLocalDate(new Date())
  if (String(recommendation.reportDate || '').trim() !== serverDate) {
    throw new Error(`仅支持执行当天策略建议（${serverDate}），历史日期建议仅可查看`)
  }
  if (recommendation.status === 'executed') {
    return recommendation
  }
  if (recommendation.status !== 'approved') {
    throw new Error('请先审批后再执行')
  }
  if (!recommendation.snapshotHash || !recommendation.approvedSnapshotHash) {
    throw new Error('建议快照缺失，请重新审批后再执行')
  }
  if (recommendation.snapshotHash !== recommendation.approvedSnapshotHash) {
    throw new Error('建议内容已更新，请重新审批后再执行')
  }

  return recommendation
}

export async function markStrategyRecommendationQueued(params: {
  userId: number
  recommendationId: string
  taskId: string
  queuedAt?: string
  taskStatus?: string
  retryCount?: number
  taskError?: string | null
  taskCreatedAt?: number | null
  taskStartedAt?: number | null
}): Promise<StrategyRecommendation> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const recommendation = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!recommendation) {
    throw new Error('建议不存在或无权限访问')
  }

  const queuedAt = params.queuedAt || new Date().toISOString()
  const retryCount = Number(params.retryCount)
  const normalizedRetryCount = Number.isFinite(retryCount) && retryCount >= 0
    ? Math.floor(retryCount)
    : undefined
  const existingExecutionResult = parseExecutionResultObject(recommendation.executionResult)
  const nextExecutionResult = {
    ...existingExecutionResult,
    queued: true,
    queueTaskId: params.taskId,
    queueTaskStatus: String(params.taskStatus || 'pending'),
    queuedAt,
    queueUpdatedAt: queuedAt,
    queueRetryCount: normalizedRetryCount,
    queueTaskError: params.taskError ? String(params.taskError) : null,
    queueTaskCreatedAt:
      toIsoTimestampFromEpoch(params.taskCreatedAt)
      || existingExecutionResult.queueTaskCreatedAt
      || null,
    queueTaskStartedAt:
      toIsoTimestampFromEpoch(params.taskStartedAt)
      || existingExecutionResult.queueTaskStartedAt
      || null,
  }

  await db.exec(
    `
      UPDATE openclaw_strategy_recommendations
      SET execution_result_json = ?,
          updated_at = ${nowFunc}
      WHERE id = ?
        AND user_id = ?
    `,
    [
      toDbJsonObjectField(nextExecutionResult, db.type, nextExecutionResult),
      params.recommendationId,
      params.userId,
    ]
  )

  await appendRecommendationEvent({
    recommendationId: params.recommendationId,
    userId: params.userId,
    eventType: 'execute_queued',
    actorUserId: params.userId,
    eventJson: {
      taskId: params.taskId,
      queuedAt,
    },
  })

  const latest = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!latest) {
    throw new Error('写入执行队列状态失败')
  }
  return latest
}

export async function markStrategyRecommendationReviewQueued(params: {
  userId: number
  recommendationId: string
  taskId: string
  scheduledAt: string
}) {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const recommendation = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!recommendation) {
    throw new Error('建议不存在或无权限访问')
  }

  const existingExecutionResult = parseExecutionResultObject(recommendation.executionResult)
  const nextExecutionResult = {
    ...existingExecutionResult,
    postReviewTaskId: params.taskId,
    postReviewScheduledAt: params.scheduledAt,
  }
  const nextData: StrategyRecommendationData = {
    ...(recommendation.data || ({} as StrategyRecommendationData)),
    postReviewStatus: 'pending_window',
  }

  await db.exec(
    `
      UPDATE openclaw_strategy_recommendations
      SET data_json = ?,
          execution_result_json = ?,
          updated_at = ${nowFunc}
      WHERE id = ?
        AND user_id = ?
    `,
    [
      toDbJsonObjectField(nextData, db.type, nextData),
      toDbJsonObjectField(nextExecutionResult, db.type, nextExecutionResult),
      params.recommendationId,
      params.userId,
    ]
  )

  await appendRecommendationEvent({
    recommendationId: params.recommendationId,
    userId: params.userId,
    eventType: 'post_review_queued',
    actorUserId: params.userId,
    eventJson: {
      taskId: params.taskId,
      scheduledAt: params.scheduledAt,
    },
  })
}

function computeReviewDateRange(params: {
  executedAtMs: number
  reviewWindowDays: number
  nowMs: number
}) {
  const baselineStartDate = formatLocalDate(new Date(params.executedAtMs - params.reviewWindowDays * MS_PER_DAY))
  const baselineEndDate = formatLocalDate(new Date(params.executedAtMs - MS_PER_DAY))
  const afterStartDate = formatLocalDate(new Date(params.executedAtMs))
  const afterWindowEndMs = params.executedAtMs + params.reviewWindowDays * MS_PER_DAY - MS_PER_DAY
  const afterEndMs = Math.min(params.nowMs, afterWindowEndMs)
  const afterEndDate = formatLocalDate(new Date(afterEndMs))
  return {
    baselineStartDate,
    baselineEndDate,
    afterStartDate,
    afterEndDate,
    afterEndMs,
  }
}

async function aggregateCampaignWindow(params: {
  db: Awaited<ReturnType<typeof getDatabase>>
  userId: number
  campaignId: number
  startDate: string
  endDate: string
}) {
  const perf = await params.db.queryOne<{
    impressions: number
    clicks: number
    cost: number
  }>(
    `
      SELECT
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(cost), 0) AS cost
      FROM campaign_performance
      WHERE user_id = ?
        AND campaign_id = ?
        AND date >= ?
        AND date <= ?
    `,
    [params.userId, params.campaignId, params.startDate, params.endDate]
  )

  const commission = await params.db.queryOne<{ commission: number }>(
    `
      SELECT COALESCE(SUM(commission_amount), 0) AS commission
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND campaign_id = ?
        AND report_date >= ?
        AND report_date <= ?
    `,
    [params.userId, params.campaignId, params.startDate, params.endDate]
  )

  const impressions = toNumber(perf?.impressions, 0)
  const clicks = toNumber(perf?.clicks, 0)
  const cost = roundTo2(toNumber(perf?.cost, 0))
  const commissionAmount = roundTo2(toNumber(commission?.commission, 0))

  return {
    impressions,
    clicks,
    cost,
    ctrPct: impressions > 0 ? roundTo2((clicks / impressions) * 100) : 0,
    cpc: clicks > 0 ? roundTo2(cost / clicks) : 0,
    commission: commissionAmount,
    roas: cost > 0 ? roundTo2(commissionAmount / cost) : null as number | null,
  }
}

function pctChange(after: number, before: number): number | null {
  if (!(before > 0)) return null
  return roundTo2(((after - before) / before) * 100)
}

function evaluatePostReviewStatus(params: {
  recommendationType: StrategyRecommendationType
  observedDays?: number
  reviewWindowDays?: number
  baseline: {
    impressions: number
    clicks: number
    cost: number
    ctrPct: number
    roas: number | null
  }
  after: {
    impressions: number
    clicks: number
    cost: number
    ctrPct: number
    roas: number | null
  }
}): StrategyPostReviewStatus {
  const observedDays = Math.max(1, Math.floor(toNumber(params.observedDays, 1)))
  const reviewWindowDays = Math.max(1, Math.floor(toNumber(params.reviewWindowDays, observedDays)))
  const minObservedDays = Math.min(POST_REVIEW_MIN_OBSERVED_DAYS, reviewWindowDays)
  if (observedDays < minObservedDays) {
    return 'pending_window'
  }

  const noData = params.baseline.impressions <= 0
    && params.baseline.clicks <= 0
    && params.baseline.cost <= 0
    && params.after.impressions <= 0
    && params.after.clicks <= 0
    && params.after.cost <= 0
  if (noData) {
    return 'no_data'
  }

  const baselineHasSample = hasSignalSample({
    impressions: params.baseline.impressions,
    clicks: params.baseline.clicks,
    cost: params.baseline.cost,
    minImpressions: POST_REVIEW_MIN_IMPRESSIONS,
    minClicks: POST_REVIEW_MIN_CLICKS,
    minCost: POST_REVIEW_MIN_COST,
  })
  const afterHasSample = hasSignalSample({
    impressions: params.after.impressions,
    clicks: params.after.clicks,
    cost: params.after.cost,
    minImpressions: POST_REVIEW_MIN_IMPRESSIONS,
    minClicks: POST_REVIEW_MIN_CLICKS,
    minCost: POST_REVIEW_MIN_COST,
  })
  if (!baselineHasSample && !afterHasSample) {
    return 'no_data'
  }

  const costPct = pctChange(params.after.cost, params.baseline.cost)
  const clicksPct = pctChange(params.after.clicks, params.baseline.clicks)
  const roasDiff =
    params.after.roas !== null && params.baseline.roas !== null
      ? roundTo2(params.after.roas - params.baseline.roas)
      : null

  if (params.recommendationType === 'offline_campaign') {
    if (params.after.cost <= params.baseline.cost * 0.35) return 'effective'
    if (params.after.cost <= params.baseline.cost * 0.6) return 'mixed'
    return 'ineffective'
  }

  if (params.recommendationType === 'adjust_budget' || params.recommendationType === 'expand_keywords') {
    if ((clicksPct !== null && clicksPct >= 15) && (roasDiff === null || roasDiff >= -0.1)) {
      return 'effective'
    }
    if ((clicksPct !== null && clicksPct >= 5) || (costPct !== null && costPct >= 5)) {
      return 'mixed'
    }
    return 'ineffective'
  }

  if ((costPct !== null && costPct <= -10) && (clicksPct === null || clicksPct >= -20)) {
    return 'effective'
  }
  if ((costPct !== null && costPct <= -5) || (clicksPct !== null && clicksPct >= 0)) {
    return 'mixed'
  }
  return 'ineffective'
}

export async function reviewStrategyRecommendationEffect(params: {
  userId: number
  recommendationId: string
  force?: boolean
}): Promise<StrategyRecommendation> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const recommendation = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!recommendation) {
    throw new Error('建议不存在或无权限访问')
  }
  if (recommendation.status !== 'executed') {
    return recommendation
  }

  const executedAtMs = Date.parse(String(recommendation.executedAt || ''))
  if (!Number.isFinite(executedAtMs)) {
    return recommendation
  }

  const reviewWindowDays = parseReviewWindowDays(
    recommendation.data?.impactWindowDays,
    POST_REVIEW_DEFAULT_WINDOW_DAYS
  )
  const nowMs = Date.now()
  const reviewDueAtMs = executedAtMs + reviewWindowDays * MS_PER_DAY
  const reviewedAt = new Date().toISOString()

  if (!params.force && nowMs < reviewDueAtMs) {
    const pendingData: StrategyRecommendationData = {
      ...(recommendation.data || ({} as StrategyRecommendationData)),
      postReviewStatus: 'pending_window',
    }
    await db.exec(
      `
        UPDATE openclaw_strategy_recommendations
        SET data_json = ?,
            updated_at = ${nowFunc}
        WHERE id = ?
          AND user_id = ?
      `,
      [
        toDbJsonObjectField(pendingData, db.type, pendingData),
        params.recommendationId,
        params.userId,
      ]
    )
    const latest = await getRecommendationById({
      userId: params.userId,
      recommendationId: params.recommendationId,
    })
    if (!latest) {
      throw new Error('复盘状态写入失败')
    }
    return latest
  }

  const dateRange = computeReviewDateRange({
    executedAtMs,
    reviewWindowDays,
    nowMs,
  })
  if (dateRange.afterEndMs < executedAtMs) {
    return recommendation
  }

  const baseline = await aggregateCampaignWindow({
    db,
    userId: params.userId,
    campaignId: recommendation.campaignId,
    startDate: dateRange.baselineStartDate,
    endDate: dateRange.baselineEndDate,
  })
  const after = await aggregateCampaignWindow({
    db,
    userId: params.userId,
    campaignId: recommendation.campaignId,
    startDate: dateRange.afterStartDate,
    endDate: dateRange.afterEndDate,
  })
  const observedDays = Math.max(
    1,
    Math.floor((Date.parse(`${dateRange.afterEndDate}T00:00:00.000Z`) - Date.parse(`${dateRange.afterStartDate}T00:00:00.000Z`)) / MS_PER_DAY) + 1
  )

  const status = evaluatePostReviewStatus({
    recommendationType: recommendation.recommendationType,
    observedDays,
    reviewWindowDays,
    baseline: {
      impressions: baseline.impressions,
      clicks: baseline.clicks,
      cost: baseline.cost,
      ctrPct: baseline.ctrPct,
      roas: baseline.roas,
    },
    after: {
      impressions: after.impressions,
      clicks: after.clicks,
      cost: after.cost,
      ctrPct: after.ctrPct,
      roas: after.roas,
    },
  })

  const postReviewSummary: StrategyRecommendationData['postReviewSummary'] = {
    reviewedAt,
    reviewWindowDays,
    baseline: {
      impressions: baseline.impressions,
      clicks: baseline.clicks,
      cost: baseline.cost,
      ctrPct: baseline.ctrPct,
      cpc: baseline.cpc,
      roas: baseline.roas,
      commission: baseline.commission,
    },
    after: {
      impressions: after.impressions,
      clicks: after.clicks,
      cost: after.cost,
      ctrPct: after.ctrPct,
      cpc: after.cpc,
      roas: after.roas,
      commission: after.commission,
      observedDays,
    },
    delta: {
      impressionsPct: pctChange(after.impressions, baseline.impressions),
      clicksPct: pctChange(after.clicks, baseline.clicks),
      costPct: pctChange(after.cost, baseline.cost),
      ctrPctDiff: roundTo2(after.ctrPct - baseline.ctrPct),
      cpcPct: pctChange(after.cpc, baseline.cpc),
      roasDiff:
        after.roas !== null && baseline.roas !== null
          ? roundTo2(after.roas - baseline.roas)
          : null,
    },
  }

  const nextData: StrategyRecommendationData = {
    ...(recommendation.data || ({} as StrategyRecommendationData)),
    postReviewStatus: status,
    postReviewSummary,
  }
  const executionResult = parseExecutionResultObject(recommendation.executionResult)
  const nextExecutionResult = {
    ...executionResult,
    postReview: {
      status,
      reviewedAt,
      reviewWindowDays,
      observedDays,
    },
  }

  await db.exec(
    `
      UPDATE openclaw_strategy_recommendations
      SET data_json = ?,
          execution_result_json = ?,
          updated_at = ${nowFunc}
      WHERE id = ?
        AND user_id = ?
    `,
    [
      toDbJsonObjectField(nextData, db.type, nextData),
      toDbJsonObjectField(nextExecutionResult, db.type, nextExecutionResult),
      params.recommendationId,
      params.userId,
    ]
  )

  await appendRecommendationEvent({
    recommendationId: params.recommendationId,
    userId: params.userId,
    eventType: 'post_reviewed',
    actorUserId: params.userId,
    eventJson: {
      status,
      reviewWindowDays,
      observedDays,
    },
  })

  const latest = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!latest) {
    throw new Error('复盘后读取建议失败')
  }
  return latest
}

export async function queueStrategyRecommendationExecution(params: {
  userId: number
  recommendationId: string
  confirm: boolean
  parentRequestId?: string | null
}): Promise<QueueStrategyRecommendationExecutionResult> {
  const recommendation = await assertStrategyRecommendationReadyForExecution({
    userId: params.userId,
    recommendationId: params.recommendationId,
    confirm: params.confirm,
  })
  if (recommendation.status === 'executed') {
    throw new Error('建议已执行，无需重复执行')
  }

  const queue = getQueueManagerForTaskType('openclaw-strategy')
  await queue.initialize()

  const executionResult = parseExecutionResultObject(recommendation.executionResult)
  const existingTaskId = String(executionResult.queueTaskId || '').trim()
  if (existingTaskId) {
    const task = await queue.getTask(existingTaskId).catch(() => null)
    if (task && (task.status === 'pending' || task.status === 'running')) {
      const latest = await markStrategyRecommendationQueued({
        userId: params.userId,
        recommendationId: params.recommendationId,
        taskId: existingTaskId,
        taskStatus: task.status,
        retryCount: task.retryCount,
        taskError: task.error || null,
        taskCreatedAt: task.createdAt,
        taskStartedAt: task.startedAt || null,
      })
      return {
        queued: true,
        deduplicated: true,
        taskId: existingTaskId,
        recommendation: latest,
      }
    }
  }

  const deterministicTaskId = buildDeterministicRecommendationExecuteTaskId({
    recommendationId: params.recommendationId,
    snapshotHash: recommendation.snapshotHash,
  })
  const deterministicTask = await queue.getTask(deterministicTaskId).catch(() => null)
  if (deterministicTask && (deterministicTask.status === 'pending' || deterministicTask.status === 'running')) {
    const latest = await markStrategyRecommendationQueued({
      userId: params.userId,
      recommendationId: params.recommendationId,
      taskId: deterministicTaskId,
      taskStatus: deterministicTask.status,
      retryCount: deterministicTask.retryCount,
      taskError: deterministicTask.error || null,
      taskCreatedAt: deterministicTask.createdAt,
      taskStartedAt: deterministicTask.startedAt || null,
    })
    return {
      queued: true,
      deduplicated: true,
      taskId: deterministicTaskId,
      recommendation: latest,
    }
  }

  const taskPayload: StrategyRecommendationQueueTaskData = {
    userId: params.userId,
    mode: 'manual',
    trigger: 'strategy_recommendation_execute',
    kind: 'execute_recommendation',
    recommendationId: params.recommendationId,
    confirm: true,
  }

  const taskId = await queue.enqueue(
    'openclaw-strategy',
    taskPayload,
    params.userId,
    {
      priority: 'high',
      maxRetries: 0,
      taskId: deterministicTaskId,
      parentRequestId: params.parentRequestId || undefined,
    }
  )
  const task = await queue.getTask(taskId).catch(() => null)
  const latest = await markStrategyRecommendationQueued({
    userId: params.userId,
    recommendationId: params.recommendationId,
    taskId,
    taskStatus: task?.status || 'pending',
    retryCount: task?.retryCount,
    taskError: task?.error || null,
    taskCreatedAt: task?.createdAt || null,
    taskStartedAt: task?.startedAt || null,
  })

  return {
    queued: true,
    deduplicated: false,
    taskId,
    recommendation: latest,
  }
}

type ExecuteActionResult = {
  route: string
  response: unknown
}

function normalizeNonNegativeInt(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function assertRecommendationActionResult(params: {
  recommendationType: StrategyRecommendationType
  response: unknown
}) {
  const payload = safeParseObject(params.response)
  if (payload.success === false) {
    throw new Error(String(payload.error || '执行失败'))
  }

  const failures = Array.isArray(payload.failures) ? payload.failures.filter(Boolean) : []
  if (
    (
      params.recommendationType === 'expand_keywords'
      || params.recommendationType === 'add_negative_keywords'
      || params.recommendationType === 'optimize_match_type'
    )
    && failures.length > 0
  ) {
    throw new Error(`执行存在失败项（${failures.length}条），请修复后重试`)
  }

  if (params.recommendationType === 'offline_campaign') {
    const googleAds = safeParseObject(payload.googleAds)
    const queued = googleAds.queued === true
    if (queued) {
      throw new Error('下线执行仍在异步处理中，未返回最终结果')
    }

    const failed = normalizeNonNegativeInt(googleAds.failed)
    if (failed > 0) {
      throw new Error(`下线执行失败：Google Ads 失败 ${failed} 条`)
    }

    const planned = normalizeNonNegativeInt(googleAds.planned)
    if (planned > 0) {
      const action = String(googleAds.action || '').trim().toUpperCase()
      if (action === 'REMOVE') {
        const removed = normalizeNonNegativeInt(googleAds.removed)
        if (removed < planned) {
          throw new Error(`下线执行不完整：计划删除 ${planned} 条，成功 ${removed} 条`)
        }
      } else {
        const paused = normalizeNonNegativeInt(googleAds.paused)
        const pausedFallback = normalizeNonNegativeInt(googleAds.pausedFallback)
        if (paused + pausedFallback < planned) {
          throw new Error(`下线执行不完整：计划暂停 ${planned} 条，成功 ${paused + pausedFallback} 条`)
        }
      }
    }
  }
}

async function executeRecommendationAction(params: {
  userId: number
  recommendation: StrategyRecommendation
}): Promise<ExecuteActionResult> {
  const recommendation = params.recommendation
  const data = recommendation.data || ({} as StrategyRecommendationData)

  if (recommendation.recommendationType === 'adjust_cpc') {
    const googleCampaignId = normalizeGoogleCampaignId(
      data.googleCampaignId,
      recommendation.googleCampaignId
    )
    const newCpc = toNumber(data.recommendedCpc, 0)
    if (!googleCampaignId) {
      throw new Error('缺少Google Campaign ID，无法执行CPC调整')
    }
    if (!(newCpc > 0)) {
      throw new Error('建议CPC无效，无法执行')
    }

    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${googleCampaignId}/update-cpc`,
      method: 'PUT',
      body: { newCpc },
    })
    return {
      route: `/api/campaigns/${googleCampaignId}/update-cpc`,
      response,
    }
  }

  if (recommendation.recommendationType === 'adjust_budget') {
    const googleCampaignId = normalizeGoogleCampaignId(
      data.googleCampaignId,
      recommendation.googleCampaignId
    )
    const budgetAmount = toNumber(data.recommendedBudget, 0)
    if (!googleCampaignId) {
      throw new Error('缺少Google Campaign ID，无法执行预算调整')
    }
    if (!(budgetAmount > 0)) {
      throw new Error('建议预算无效，无法执行')
    }
    const budgetType = normalizeBudgetType(data.budgetType)

    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${googleCampaignId}/update-budget`,
      method: 'PUT',
      body: {
        budgetAmount,
        budgetType,
      },
    })
    return {
      route: `/api/campaigns/${googleCampaignId}/update-budget`,
      response,
    }
  }

  if (recommendation.recommendationType === 'offline_campaign') {
    const campaignId = Number(data.campaignId || recommendation.campaignId)
    if (!Number.isFinite(campaignId)) {
      throw new Error('缺少Campaign ID，无法执行下线')
    }
    const body = {
      removeGoogleAdsCampaign: true,
      pauseClickFarmTasks: true,
      pauseUrlSwapTasks: true,
      waitRemote: true,
    }
    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${campaignId}/offline`,
      method: 'POST',
      body,
    })
    return {
      route: `/api/campaigns/${campaignId}/offline`,
      response,
    }
  }

  if (recommendation.recommendationType === 'expand_keywords') {
    const campaignId = Number(data.campaignId || recommendation.campaignId)
    if (!Number.isFinite(campaignId)) {
      throw new Error('缺少Campaign ID，无法执行关键词扩量')
    }
    const keywordPlan = Array.isArray(data.keywordPlan)
      ? data.keywordPlan
      : []
    if (keywordPlan.length === 0) {
      throw new Error('建议中缺少关键词计划，无法执行')
    }
    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${campaignId}/keywords/add`,
      method: 'POST',
      body: {
        keywords: keywordPlan.map((item) => ({
          text: String(item.text || '').trim(),
          matchType: String(item.matchType || 'PHRASE').toUpperCase(),
        })),
      },
    })
    return {
      route: `/api/campaigns/${campaignId}/keywords/add`,
      response,
    }
  }

  if (recommendation.recommendationType === 'add_negative_keywords') {
    const campaignId = Number(data.campaignId || recommendation.campaignId)
    if (!Number.isFinite(campaignId)) {
      throw new Error('缺少Campaign ID，无法执行否词优化')
    }
    const negativeKeywordPlan = Array.isArray(data.negativeKeywordPlan)
      ? data.negativeKeywordPlan
      : []
    if (negativeKeywordPlan.length === 0) {
      throw new Error('建议中缺少否词计划，无法执行')
    }
    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${campaignId}/keywords/negatives/add`,
      method: 'POST',
      body: {
        keywords: negativeKeywordPlan.map((item) => ({
          text: String(item.text || '').trim(),
          matchType: String(item.matchType || 'EXACT').toUpperCase(),
        })),
      },
    })
    return {
      route: `/api/campaigns/${campaignId}/keywords/negatives/add`,
      response,
    }
  }

  if (recommendation.recommendationType === 'optimize_match_type') {
    const campaignId = Number(data.campaignId || recommendation.campaignId)
    if (!Number.isFinite(campaignId)) {
      throw new Error('缺少Campaign ID，无法执行匹配类型优化')
    }
    const matchTypePlan = Array.isArray(data.matchTypePlan)
      ? data.matchTypePlan
      : []
    if (matchTypePlan.length === 0) {
      throw new Error('建议中缺少匹配类型计划，无法执行')
    }
    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${campaignId}/keywords/match-type/add`,
      method: 'POST',
      body: {
        keywords: matchTypePlan.map((item) => ({
          text: String(item.text || '').trim(),
          matchType: String(item.recommendedMatchType || 'PHRASE').toUpperCase(),
        })),
        oldKeywords: matchTypePlan.map((item) => ({
          text: String(item.text || '').trim(),
          matchType: String(item.currentMatchType || 'BROAD').toUpperCase(),
        })),
        replaceMode: String(data.matchTypeReplaceMode || 'pause_existing'),
      },
    })
    return {
      route: `/api/campaigns/${campaignId}/keywords/match-type/add`,
      response,
    }
  }

  throw new Error(`不支持的建议类型: ${recommendation.recommendationType}`)
}

export async function executeStrategyRecommendation(params: {
  userId: number
  recommendationId: string
  confirm: boolean
  queueTaskId?: string | null
}): Promise<StrategyRecommendation> {
  const recommendation = await assertStrategyRecommendationReadyForExecution({
    userId: params.userId,
    recommendationId: params.recommendationId,
    confirm: params.confirm,
  })
  if (recommendation.status === 'executed') {
    return recommendation
  }

  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const existingExecutionResult = parseExecutionResultObject(recommendation.executionResult)
  const queueTaskId = String(params.queueTaskId || existingExecutionResult.queueTaskId || '').trim() || null

  try {
    const actionResult = await executeRecommendationAction({
      userId: params.userId,
      recommendation,
    })
    assertRecommendationActionResult({
      recommendationType: recommendation.recommendationType,
      response: actionResult.response,
    })
    const executedAt = new Date().toISOString()
    const successPayload = {
      ...existingExecutionResult,
      queued: false,
      queueTaskId,
      queueTaskStatus: 'completed',
      queueTaskError: null,
      success: true,
      route: actionResult.route,
      response: actionResult.response,
      queueUpdatedAt: executedAt,
      executedAt,
    }

    await db.exec(
      `
        UPDATE openclaw_strategy_recommendations
        SET status = 'executed',
            executed_at = ${nowFunc},
            execution_result_json = ?,
            updated_at = ${nowFunc}
        WHERE id = ?
          AND user_id = ?
      `,
      [
        toDbJsonObjectField(
          successPayload,
          db.type,
          successPayload
        ),
        params.recommendationId,
        params.userId,
      ]
    )

    await appendRecommendationEvent({
      recommendationId: params.recommendationId,
      userId: params.userId,
      eventType: 'executed',
      actorUserId: params.userId,
      eventJson: {
        route: actionResult.route,
        queueTaskId,
      },
    })
  } catch (error: any) {
    const message = error?.message || '执行失败'
    const failedAt = new Date().toISOString()
    const failedPayload = {
      ...existingExecutionResult,
      queued: false,
      queueTaskId,
      queueTaskStatus: 'failed',
      queueTaskError: message,
      success: false,
      error: message,
      queueUpdatedAt: failedAt,
      failedAt,
    }
    await db.exec(
      `
        UPDATE openclaw_strategy_recommendations
        SET status = 'failed',
            execution_result_json = ?,
            updated_at = ${nowFunc}
        WHERE id = ?
          AND user_id = ?
      `,
      [
        toDbJsonObjectField(
          failedPayload,
          db.type,
          failedPayload
        ),
        params.recommendationId,
        params.userId,
      ]
    )

    await appendRecommendationEvent({
      recommendationId: params.recommendationId,
      userId: params.userId,
      eventType: 'execute_failed',
      actorUserId: params.userId,
      eventJson: {
        error: message,
        queueTaskId,
      },
    })
    throw error
  }

  const latest = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId,
  })
  if (!latest) {
    throw new Error('执行后读取建议失败')
  }
  return latest
}

export const __testUtils = {
  buildRecommendationDrafts,
  buildDeterministicRecommendationExecuteTaskId,
  assertRecommendationActionResult,
  patchExpandKeywordsSummaryCoverage,
}
