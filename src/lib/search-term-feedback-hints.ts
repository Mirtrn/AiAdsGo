import { getDatabase } from './db'

export interface SearchTermFeedbackHints {
  hardNegativeTerms: string[]
  softSuppressTerms: string[]
  lookbackDays: number
  sourceRows: number
}

interface SearchTermAggregateRow {
  search_term: string
  impressions: number
  clicks: number
  cost: number
}

interface CurrencyAggregateRow {
  currency: string
  campaign_count: number
}

interface AdaptiveThresholds {
  hardMinClicks: number
  softMinClicks: number
  hardMinCost: number
  softMinCost: number
  hardMinCpc: number
  softMinCpc: number
  hardMaxCtr: number
  softMaxCtr: number
  medianCpc: number
  medianCtr: number
  dominantCurrency: string
}

const DEFAULT_LOOKBACK_DAYS = 14
const DEFAULT_MAX_TERMS = 24
const HARD_MIN_CLICKS = 10
const HARD_MIN_IMPRESSIONS_FOR_CTR = 400
const HARD_MAX_CTR = 0.012 // 1.2%

const SOFT_MIN_CLICKS = 6
const SOFT_MIN_IMPRESSIONS_FOR_CTR = 250
const SOFT_MAX_CTR = 0.018 // 1.8%

const DEFAULT_FALLBACK_CPC_BY_CURRENCY: Record<string, number> = {
  USD: 0.9,
  EUR: 0.85,
  GBP: 0.75,
  CAD: 0.95,
  AUD: 1.0,
  CNY: 5.0,
  JPY: 120,
  KRW: 1200,
  INR: 45,
  BRL: 4.0,
  MXN: 16,
  SGD: 1.2,
  HKD: 7.0,
  TWD: 32,
  THB: 28,
  VND: 16000,
  IDR: 13000,
  PHP: 52,
  MYR: 4.2,
  AED: 3.6,
  SAR: 3.6,
  TRY: 32,
  RUB: 90,
  ZAR: 16
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const ratio = clamp(p, 0, 1)
  const pos = (sorted.length - 1) * ratio
  const lower = Math.floor(pos)
  const upper = Math.ceil(pos)
  if (lower === upper) return sorted[lower]
  const weight = pos - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

function resolveFallbackCpcByCurrency(currency: string): number {
  const normalized = String(currency || 'USD').trim().toUpperCase()
  return DEFAULT_FALLBACK_CPC_BY_CURRENCY[normalized] || DEFAULT_FALLBACK_CPC_BY_CURRENCY.USD
}

function buildAdaptiveThresholds(
  rows: SearchTermAggregateRow[],
  dominantCurrency: string
): AdaptiveThresholds {
  const cpcSamples = rows
    .map((row) => {
      const clicks = Number(row.clicks || 0)
      const cost = Number(row.cost || 0)
      if (clicks <= 0 || cost <= 0) return 0
      return cost / clicks
    })
    .filter((value) => Number.isFinite(value) && value > 0)

  const ctrSamples = rows
    .map((row) => {
      const impressions = Number(row.impressions || 0)
      const clicks = Number(row.clicks || 0)
      if (impressions < 100 || clicks <= 0) return 0
      return clicks / impressions
    })
    .filter((value) => Number.isFinite(value) && value > 0)

  const medianCpc = percentile(cpcSamples, 0.5)
  const p75Cpc = percentile(cpcSamples, 0.75)
  const p90Cpc = percentile(cpcSamples, 0.9)
  const medianCtr = percentile(ctrSamples, 0.5)
  const fallbackCpc = resolveFallbackCpcByCurrency(dominantCurrency)

  const softMinCpc = round2(
    Math.max(
      medianCpc > 0
        ? Math.max(p75Cpc, medianCpc * 1.15)
        : fallbackCpc * 1.2,
      fallbackCpc * 0.8
    )
  )

  const hardMinCpc = round2(
    Math.max(
      medianCpc > 0
        ? Math.max(p90Cpc, medianCpc * 1.45)
        : fallbackCpc * 1.7,
      softMinCpc * 1.15
    )
  )

  const softMinCost = round2(
    Math.max(
      SOFT_MIN_CLICKS * softMinCpc,
      fallbackCpc * SOFT_MIN_CLICKS
    )
  )

  const hardMinCost = round2(
    Math.max(
      HARD_MIN_CLICKS * hardMinCpc,
      fallbackCpc * HARD_MIN_CLICKS,
      softMinCost * 1.4
    )
  )

  const softMaxCtr = medianCtr > 0
    ? clamp(medianCtr * 0.65, 0.006, 0.03)
    : SOFT_MAX_CTR

  const hardMaxCtr = medianCtr > 0
    ? clamp(medianCtr * 0.45, 0.004, softMaxCtr * 0.9)
    : HARD_MAX_CTR

  return {
    hardMinClicks: HARD_MIN_CLICKS,
    softMinClicks: SOFT_MIN_CLICKS,
    hardMinCost,
    softMinCost,
    hardMinCpc,
    softMinCpc,
    hardMaxCtr,
    softMaxCtr,
    medianCpc: round2(medianCpc),
    medianCtr: round2(medianCtr),
    dominantCurrency
  }
}

function sanitizeSearchTerm(term: string): string {
  return String(term || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUsableSearchTerm(term: string): boolean {
  if (!term) return false
  if (term.length < 2) return false
  if (term.length > 80) return false
  if (/^\d+$/.test(term)) return false
  return /[\p{L}\p{N}]/u.test(term)
}

/**
 * Build lightweight hard/soft suppression hints from search term reports.
 * This module intentionally does NOT depend on conversions signal, because some
 * accounts run with missing/always-zero conversion tracking.
 * - hardNegativeTerms: clear spend waste by clicks/cost + poor efficiency (CPC/CTR)
 * - softSuppressTerms: moderate inefficiency that should be deprioritized in copy
 */
export async function getSearchTermFeedbackHints(params: {
  offerId: number
  userId: number
  lookbackDays?: number
  maxTerms?: number
}): Promise<SearchTermFeedbackHints> {
  const db = await getDatabase()
  const lookbackDays = Math.max(3, Math.min(60, params.lookbackDays ?? DEFAULT_LOOKBACK_DAYS))
  const maxTerms = Math.max(5, Math.min(100, params.maxTerms ?? DEFAULT_MAX_TERMS))

  const isDeletedCondition = db.type === 'postgres' ? 'COALESCE(c.is_deleted, FALSE) = FALSE' : 'COALESCE(c.is_deleted, 0) = 0'
  const dateExpr = `date('now', '-${lookbackDays} days')`

  const currencyRows = await db.query<CurrencyAggregateRow>(
    `SELECT
       COALESCE(gaa.currency, 'USD') AS currency,
       COUNT(*) AS campaign_count
     FROM campaigns c
     LEFT JOIN google_ads_accounts gaa ON gaa.id = c.google_ads_account_id
     WHERE c.user_id = ?
       AND c.offer_id = ?
       AND ${isDeletedCondition}
     GROUP BY COALESCE(gaa.currency, 'USD')
     ORDER BY COUNT(*) DESC`,
    [params.userId, params.offerId]
  )
  const dominantCurrency = String(currencyRows[0]?.currency || 'USD').trim().toUpperCase()

  const rows = await db.query<SearchTermAggregateRow>(
    `SELECT
       str.search_term,
       SUM(str.impressions) AS impressions,
       SUM(str.clicks) AS clicks,
       SUM(str.cost) AS cost
     FROM search_term_reports str
     JOIN campaigns c ON c.id = str.campaign_id
     WHERE str.user_id = ?
       AND c.offer_id = ?
       AND ${isDeletedCondition}
       AND str.date >= ${dateExpr}
     GROUP BY str.search_term
     HAVING SUM(str.clicks) > 0
     ORDER BY SUM(str.cost) DESC`,
    [params.userId, params.offerId]
  )
  const thresholds = buildAdaptiveThresholds(rows, dominantCurrency)

  const hardNegativeTerms: string[] = []
  const softSuppressTerms: string[] = []

  for (const row of rows) {
    const term = sanitizeSearchTerm(row.search_term)
    if (!isUsableSearchTerm(term)) continue

    const impressions = Number(row.impressions || 0)
    const clicks = Number(row.clicks || 0)
    const cost = Number(row.cost || 0)
    const cpc = clicks > 0 ? cost / clicks : 0
    const ctr = impressions > 0 ? clicks / impressions : 0

    // Hard negative: high spend/click volume with clearly weak efficiency signal.
    const hardByCpc =
      clicks >= thresholds.hardMinClicks &&
      cost >= thresholds.hardMinCost &&
      cpc >= thresholds.hardMinCpc
    const hardByCtr =
      impressions >= HARD_MIN_IMPRESSIONS_FOR_CTR &&
      clicks >= thresholds.hardMinClicks &&
      ctr <= thresholds.hardMaxCtr
    if (hardByCpc || hardByCtr) {
      hardNegativeTerms.push(term)
      continue
    }

    // Soft suppression: moderate inefficiency, keep as guidance not hard block.
    const softByCpc =
      clicks >= thresholds.softMinClicks &&
      cost >= thresholds.softMinCost &&
      cpc >= thresholds.softMinCpc
    const softByCtr =
      impressions >= SOFT_MIN_IMPRESSIONS_FOR_CTR &&
      clicks >= thresholds.softMinClicks &&
      ctr <= thresholds.softMaxCtr
    if (softByCpc || softByCtr) {
      softSuppressTerms.push(term)
    }
  }

  const dedupe = (list: string[]) => Array.from(new Set(list.map(sanitizeSearchTerm))).filter(isUsableSearchTerm)

  const hard = dedupe(hardNegativeTerms).slice(0, maxTerms)
  const soft = dedupe(softSuppressTerms)
    .filter(term => !hard.includes(term))
    .slice(0, maxTerms)

  return {
    hardNegativeTerms: hard,
    softSuppressTerms: soft,
    lookbackDays,
    sourceRows: rows.length
  }
}
