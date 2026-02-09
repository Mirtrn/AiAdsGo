import { getDatabase } from './db'

/**
 * Offer Performance Analytics
 *
 * Offer/Campaign 的广告基础指标仍来自 campaign_performance，
 * 佣金指标来自 affiliate_commission_attributions。
 */

export interface OfferPerformanceSummary {
  offer_id: number
  campaign_count: number
  impressions: number
  clicks: number
  conversions: number
  commission: number
  cost: number
  ctr: number
  avg_cpc: number
  conversion_rate: number
  commission_per_click: number
  date_range: {
    start: string
    end: string
  }
}

export interface OfferPerformanceTrend {
  date: string
  impressions: number
  clicks: number
  conversions: number
  commission: number
  cost: number
  ctr: number
  conversion_rate: number
  commission_per_click: number
}

export interface CampaignPerformanceComparison {
  campaign_id: number
  campaign_name: string
  google_campaign_id: string
  impressions: number
  clicks: number
  conversions: number
  commission: number
  cost: number
  currency?: string
  ctr: number
  cpc: number
  conversion_rate: number
  commission_per_click: number
}

export interface OfferROI {
  total_cost_usd: number
  total_revenue_usd: number
  roi_percentage: number
  profit_usd: number
  conversions: number
  commission: number
}

export interface OfferCurrencyInfo {
  currency: string
  currencies: string[]
  hasMixedCurrency: boolean
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeDateKey(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]

  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10)
  }

  return raw
}

function getDateRange(daysBack: number): { startDateStr: string; endDateStr: string } {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  return {
    startDateStr: startDate.toISOString().split('T')[0],
    endDateStr: endDate.toISOString().split('T')[0],
  }
}

/**
 * 获取 Offer 在时间范围内涉及的货币信息
 * 注意：campaign_performance.cost 存储的是 Ads 账号原币的标准单位（非 micros）。
 */
export async function getOfferCurrencyInfo(
  offerId: number,
  userId: number,
  daysBack: number = 30
): Promise<OfferCurrencyInfo> {
  const db = await getDatabase()
  const { startDateStr, endDateStr } = getDateRange(daysBack)

  const rows = await db.query(`
    SELECT DISTINCT
      COALESCE(cp.currency, gaa.currency, 'USD') as currency
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp
      ON c.id = cp.campaign_id
      AND cp.date >= ?
      AND cp.date <= ?
    WHERE c.offer_id = ?
      AND c.user_id = ?
  `, [startDateStr, endDateStr, offerId, userId]) as any[]

  const currencies = rows
    .map((r) => String(r.currency || '').trim())
    .filter((c) => Boolean(c))

  const unique = Array.from(new Set(currencies))
  if (unique.length === 0) {
    return { currency: 'USD', currencies: ['USD'], hasMixedCurrency: false }
  }

  const latestCurrencyRow = await db.queryOne(`
    SELECT COALESCE(gaa.currency, 'USD') as currency
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    WHERE c.offer_id = ?
      AND c.user_id = ?
    ORDER BY COALESCE(c.published_at, c.created_at) DESC
    LIMIT 1
  `, [offerId, userId]) as any

  const latestCurrency = String(latestCurrencyRow?.currency || '').trim()
  const preferredCurrency = latestCurrency && unique.includes(latestCurrency)
    ? latestCurrency
    : unique[0]

  return {
    currency: preferredCurrency,
    currencies: unique,
    hasMixedCurrency: unique.length > 1,
  }
}

export async function getOfferPerformanceSummary(
  offerId: number,
  userId: number,
  daysBack: number = 30,
  currency?: string
): Promise<OfferPerformanceSummary> {
  const db = await getDatabase()
  const { startDateStr, endDateStr } = getDateRange(daysBack)

  const currencyCondition = currency ? `AND COALESCE(cp.currency, gaa.currency, 'USD') = ?` : ''
  const params = currency
    ? [offerId, userId, startDateStr, endDateStr, currency]
    : [offerId, userId, startDateStr, endDateStr]

  const summary = await db.queryOne(`
    SELECT
      COUNT(DISTINCT cp.campaign_id) as campaign_count,
      SUM(cp.impressions) as impressions,
      SUM(cp.clicks) as clicks,
      SUM(cp.cost) as cost,
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as ctr,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.cost) / SUM(cp.clicks)
        ELSE 0
      END as avg_cpc
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
      ${currencyCondition}
  `, params) as any

  const commissionData = await db.queryOne(`
    SELECT COALESCE(SUM(aca.commission_amount), 0) AS commission
    FROM affiliate_commission_attributions aca
    WHERE aca.user_id = ?
      AND aca.offer_id = ?
      AND aca.report_date >= ?
      AND aca.report_date <= ?
  `, [userId, offerId, startDateStr, endDateStr]) as any

  const clicks = Number(summary?.clicks) || 0
  const commission = Number(commissionData?.commission) || 0
  const commissionPerClick = clicks > 0 ? commission / clicks : 0

  return {
    offer_id: offerId,
    campaign_count: Number(summary?.campaign_count) || 0,
    impressions: Number(summary?.impressions) || 0,
    clicks,
    conversions: roundTo2(commission),
    commission: roundTo2(commission),
    cost: Number(summary?.cost) || 0,
    ctr: Number(summary?.ctr) || 0,
    avg_cpc: Number(summary?.avg_cpc) || 0,
    conversion_rate: roundTo2(commissionPerClick),
    commission_per_click: roundTo2(commissionPerClick),
    date_range: {
      start: startDateStr,
      end: endDateStr,
    },
  }
}

export async function getOfferPerformanceTrend(
  offerId: number,
  userId: number,
  daysBack: number = 30,
  currency?: string
): Promise<OfferPerformanceTrend[]> {
  const db = await getDatabase()
  const { startDateStr, endDateStr } = getDateRange(daysBack)

  const currencyCondition = currency ? `AND COALESCE(cp.currency, gaa.currency, 'USD') = ?` : ''
  const params = currency
    ? [offerId, userId, startDateStr, endDateStr, currency]
    : [offerId, userId, startDateStr, endDateStr]

  const adTrends = await db.query(`
    SELECT
      cp.date as date,
      SUM(cp.impressions) as impressions,
      SUM(cp.clicks) as clicks,
      SUM(cp.cost) as cost,
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as ctr
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
      ${currencyCondition}
    GROUP BY cp.date
    ORDER BY cp.date ASC
  `, params) as any[]

  const commissionTrends = await db.query(`
    SELECT
      aca.report_date as date,
      COALESCE(SUM(aca.commission_amount), 0) as commission
    FROM affiliate_commission_attributions aca
    WHERE aca.user_id = ?
      AND aca.offer_id = ?
      AND aca.report_date >= ?
      AND aca.report_date <= ?
    GROUP BY aca.report_date
    ORDER BY aca.report_date ASC
  `, [userId, offerId, startDateStr, endDateStr]) as any[]

  const adMap = new Map<string, {
    impressions: number
    clicks: number
    cost: number
    ctr: number
  }>()
  for (const row of adTrends) {
    const date = normalizeDateKey(row?.date)
    if (!date) continue
    adMap.set(date, {
      impressions: Number(row?.impressions) || 0,
      clicks: Number(row?.clicks) || 0,
      cost: Number(row?.cost) || 0,
      ctr: Number(row?.ctr) || 0,
    })
  }

  const commissionMap = new Map<string, number>()
  for (const row of commissionTrends) {
    const date = normalizeDateKey(row?.date)
    if (!date) continue
    commissionMap.set(date, Number(row?.commission) || 0)
  }

  const dateSet = new Set<string>([
    ...Array.from(adMap.keys()),
    ...Array.from(commissionMap.keys()),
  ])

  const dates = Array.from(dateSet).sort((a, b) => a.localeCompare(b))

  return dates.map((date) => {
    const ad = adMap.get(date)
    const clicks = ad?.clicks || 0
    const commission = commissionMap.get(date) || 0
    const commissionPerClick = clicks > 0 ? commission / clicks : 0

    return {
      date,
      impressions: ad?.impressions || 0,
      clicks,
      conversions: roundTo2(commission),
      commission: roundTo2(commission),
      cost: ad?.cost || 0,
      ctr: ad?.ctr || 0,
      conversion_rate: roundTo2(commissionPerClick),
      commission_per_click: roundTo2(commissionPerClick),
    }
  })
}

export async function getCampaignPerformanceComparison(
  offerId: number,
  userId: number,
  daysBack: number = 30,
  currency?: string
): Promise<CampaignPerformanceComparison[]> {
  const db = await getDatabase()
  const { startDateStr, endDateStr } = getDateRange(daysBack)

  const currencyCondition = currency ? `AND COALESCE(cp.currency, gaa.currency, 'USD') = ?` : ''
  const params = currency
    ? [offerId, userId, startDateStr, endDateStr, currency]
    : [offerId, userId, startDateStr, endDateStr]

  const campaigns = await db.query(`
    SELECT
      cp.campaign_id,
      c.campaign_name,
      c.google_campaign_id,
      SUM(cp.impressions) as impressions,
      SUM(cp.clicks) as clicks,
      SUM(cp.cost) as cost,
      COALESCE(MAX(cp.currency), gaa.currency, 'USD') as currency,
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as ctr,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.cost) / SUM(cp.clicks)
        ELSE 0
      END as cpc
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
      ${currencyCondition}
    GROUP BY cp.campaign_id, c.campaign_name, c.google_campaign_id, gaa.currency
    ORDER BY SUM(cp.clicks) DESC
  `, params) as any[]

  const commissionRows = await db.query(`
    SELECT
      aca.campaign_id,
      COALESCE(SUM(aca.commission_amount), 0) AS commission
    FROM affiliate_commission_attributions aca
    WHERE aca.user_id = ?
      AND aca.offer_id = ?
      AND aca.report_date >= ?
      AND aca.report_date <= ?
      AND aca.campaign_id IS NOT NULL
    GROUP BY aca.campaign_id
  `, [userId, offerId, startDateStr, endDateStr]) as Array<{ campaign_id: number; commission: number }>

  const commissionByCampaign = new Map<number, number>()
  for (const row of commissionRows) {
    const campaignId = Number(row.campaign_id)
    if (!Number.isFinite(campaignId)) continue
    commissionByCampaign.set(campaignId, Number(row.commission) || 0)
  }

  const mapped = campaigns.map((row) => {
    const campaignId = Number(row.campaign_id)
    const clicks = Number(row.clicks) || 0
    const commission = commissionByCampaign.get(campaignId) || 0
    const commissionPerClick = clicks > 0 ? commission / clicks : 0

    return {
      campaign_id: campaignId,
      campaign_name: row.campaign_name,
      google_campaign_id: row.google_campaign_id,
      impressions: Number(row.impressions) || 0,
      clicks,
      conversions: roundTo2(commission),
      commission: roundTo2(commission),
      cost: Number(row.cost) || 0,
      currency: row.currency || 'USD',
      ctr: Number(row.ctr) || 0,
      cpc: Number(row.cpc) || 0,
      conversion_rate: roundTo2(commissionPerClick),
      commission_per_click: roundTo2(commissionPerClick),
    }
  })

  return mapped.sort((a, b) => {
    if (b.commission !== a.commission) return b.commission - a.commission
    return b.clicks - a.clicks
  })
}

export async function calculateOfferROI(
  offerId: number,
  userId: number,
  avgOrderValue: number,
  daysBack: number = 30,
  currency?: string
): Promise<OfferROI> {
  const db = await getDatabase()
  const { startDateStr, endDateStr } = getDateRange(daysBack)

  const currencyCondition = currency ? `AND COALESCE(cp.currency, gaa.currency, 'USD') = ?` : ''
  const params = currency
    ? [offerId, userId, startDateStr, endDateStr, currency]
    : [offerId, userId, startDateStr, endDateStr]

  const adData = await db.queryOne(`
    SELECT
      SUM(cp.cost) as total_cost
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
      ${currencyCondition}
  `, params) as any

  const commissionData = await db.queryOne(`
    SELECT COALESCE(SUM(aca.commission_amount), 0) AS total_commission
    FROM affiliate_commission_attributions aca
    WHERE aca.user_id = ?
      AND aca.offer_id = ?
      AND aca.report_date >= ?
      AND aca.report_date <= ?
  `, [userId, offerId, startDateStr, endDateStr]) as any

  const totalCostUsd = Number(adData?.total_cost) || 0
  const totalCommission = Number(commissionData?.total_commission) || 0

  void avgOrderValue
  const totalRevenueUsd = totalCommission
  const profitUsd = totalRevenueUsd - totalCostUsd
  const roiPercentage = totalCostUsd > 0 ? (profitUsd / totalCostUsd) * 100 : 0

  return {
    total_cost_usd: roundTo2(totalCostUsd),
    total_revenue_usd: roundTo2(totalRevenueUsd),
    roi_percentage: roundTo2(roiPercentage),
    profit_usd: roundTo2(profitUsd),
    conversions: roundTo2(totalCommission),
    commission: roundTo2(totalCommission),
  }
}
