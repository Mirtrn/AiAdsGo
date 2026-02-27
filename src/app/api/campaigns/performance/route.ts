import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

function formatAsYmd(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value)
  if (!raw.trim()) return null

  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]

  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 10)
}

function normalizeCurrency(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized || 'USD'
}

function formatLocalYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function parseYmdParam(value: string | null): string | null {
  if (!value) return null
  const normalized = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null

  const [year, month, day] = normalized.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null
  }

  return normalized
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const [year, month, day] = ymd.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

function diffDaysInclusive(startYmd: string, endYmd: string): number {
  const startTs = Date.parse(`${startYmd}T00:00:00Z`)
  const endTs = Date.parse(`${endYmd}T00:00:00Z`)
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return 1
  return Math.max(1, Math.floor((endTs - startTs) / (24 * 60 * 60 * 1000)) + 1)
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function calculateRoas(commission: number, cost: number): { value: number | null; infinite: boolean } {
  const normalizedCommission = Number(commission) || 0
  const normalizedCost = Number(cost) || 0
  if (normalizedCost <= 0) {
    if (normalizedCommission > 0) {
      return { value: null, infinite: true }
    }
    return { value: 0, infinite: false }
  }

  return {
    value: roundTo2(normalizedCommission / normalizedCost),
    infinite: false,
  }
}

type Agg = {
  impressions: number
  clicks: number
  cost: number
}

// campaign_mapping_miss rows are already written into affiliate_commission_attributions (offer-level fallback).
// Counting them again from failure audit rows would double-count commission.
const EXCLUDED_UNATTRIBUTED_REASON_CODE = 'campaign_mapping_miss'

/**
 * GET /api/campaigns/performance
 *
 * Get performance data for all campaigns
 *
 * Query Parameters:
 * - daysBack: number (default: 7)
 * - start_date: string (optional, YYYY-MM-DD)
 * - end_date: string (optional, YYYY-MM-DD)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const rawDaysBack = parseInt(searchParams.get('daysBack') || '7', 10)
    const daysBack = Number.isFinite(rawDaysBack) ? Math.min(Math.max(rawDaysBack, 1), 3650) : 7
    const startDateQuery = parseYmdParam(searchParams.get('start_date'))
    const endDateQuery = parseYmdParam(searchParams.get('end_date'))
    const hasCustomRangeQuery = searchParams.has('start_date') || searchParams.has('end_date')
    if (hasCustomRangeQuery) {
      if (!startDateQuery || !endDateQuery) {
        return NextResponse.json(
          { error: 'start_date 和 end_date 必须同时提供，且格式为 YYYY-MM-DD' },
          { status: 400 }
        )
      }
      if (startDateQuery > endDateQuery) {
        return NextResponse.json(
          { error: 'start_date 不能晚于 end_date' },
          { status: 400 }
        )
      }
    }
    const requestedCurrencyRaw = searchParams.get('currency')
    const requestedCurrency = requestedCurrencyRaw ? normalizeCurrency(requestedCurrencyRaw) : null

    const db = await getDatabase()

    let startDateStr = startDateQuery || ''
    let endDateStr = endDateQuery || ''
    let rangeDays = daysBack

    if (!startDateStr || !endDateStr) {
      const now = new Date()
      endDateStr = formatLocalYmd(now)
      const startDate = new Date(now)
      // daysBack=7 means "today + previous 6 days" (inclusive 7-day window).
      startDate.setDate(startDate.getDate() - daysBack + 1)
      startDateStr = formatLocalYmd(startDate)
      rangeDays = daysBack
    } else {
      rangeDays = diffDaysInclusive(startDateStr, endDateStr)
    }

    const prevEndDateStr = shiftYmd(startDateStr, -1)
    const prevStartDateStr = shiftYmd(prevEndDateStr, -(rangeDays - 1))

    const currencyRows = await db.query<any>(
      `
        SELECT
          COALESCE(currency, 'USD') as currency,
          COALESCE(SUM(cost), 0) as total_cost
        FROM campaign_performance
        WHERE user_id = ?
          AND date >= ?
          AND date <= ?
        GROUP BY COALESCE(currency, 'USD')
        ORDER BY total_cost DESC
      `,
      [userId, startDateStr, endDateStr]
    )

    const currencies = Array.from(
      new Set(
        (currencyRows || [])
          .map((r: any) => normalizeCurrency(r.currency))
          .filter(Boolean)
      )
    )
    const hasMixedCurrency = currencies.length > 1
    const reportingCurrency = requestedCurrency && currencies.includes(requestedCurrency)
      ? requestedCurrency
      : null

    const costs = (currencyRows || [])
      .map((r: any) => ({
        currency: normalizeCurrency(r.currency),
        amount: Number(r.total_cost) || 0,
      }))
      .filter((c: any) => c.currency && Number.isFinite(c.amount))

    const campaigns = await db.query(`
      SELECT
        c.id,
        c.campaign_id,
        c.campaign_name,
        c.offer_id,
        c.status,
        c.google_campaign_id,
        c.google_ads_account_id,
        c.budget_amount,
        c.budget_type,
        c.creation_status,
        c.creation_error,
        c.last_sync_at,
        c.created_at,
        c.published_at,
        c.is_deleted,
        c.deleted_at,
        gaa.id as ads_account_id,
        gaa.customer_id as ads_account_customer_id,
        gaa.account_name as ads_account_name,
        gaa.is_active as ads_account_is_active,
        gaa.is_deleted as ads_account_is_deleted,
        gaa.currency as ads_account_currency,
        o.brand as offer_brand,
        o.url as offer_url,
        o.is_deleted as offer_is_deleted
      FROM campaigns c
      LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `, [userId]) as any[]

    const aggregateByCampaignCurrency = async (params: {
      start: string
      end: string
    }): Promise<Map<number, Map<string, Agg>>> => {
      const rows = await db.query(`
        SELECT
          campaign_id,
          COALESCE(currency, 'USD') as currency,
          COALESCE(SUM(impressions), 0) as impressions,
          COALESCE(SUM(clicks), 0) as clicks,
          COALESCE(SUM(cost), 0) as cost
        FROM campaign_performance
        WHERE user_id = ?
          AND date >= ?
          AND date <= ?
        GROUP BY campaign_id, COALESCE(currency, 'USD')
      `, [userId, params.start, params.end]) as any[]

      const map = new Map<number, Map<string, Agg>>()
      for (const row of rows) {
        const campaignId = Number(row.campaign_id)
        if (!Number.isFinite(campaignId)) continue

        const currency = normalizeCurrency(row.currency)
        const agg: Agg = {
          impressions: Number(row.impressions) || 0,
          clicks: Number(row.clicks) || 0,
          cost: Number(row.cost) || 0,
        }

        const byCurrency = map.get(campaignId) ?? new Map<string, Agg>()
        byCurrency.set(currency, agg)
        map.set(campaignId, byCurrency)
      }
      return map
    }

    const queryCommissionByCampaign = async (params: {
      start: string
      end: string
      currency?: string
    }): Promise<Map<number, number>> => {
      const hasCurrencyFilter = Boolean(params.currency)
      const rows = await db.query<{ campaign_id: number; commission: number }>(
        `
          SELECT
            campaign_id,
            COALESCE(SUM(commission_amount), 0) AS commission
          FROM affiliate_commission_attributions
          WHERE user_id = ?
            AND report_date >= ?
            AND report_date <= ?
            ${hasCurrencyFilter ? 'AND COALESCE(currency, \'USD\') = ?' : ''}
            AND campaign_id IS NOT NULL
          GROUP BY campaign_id
        `,
        hasCurrencyFilter
          ? [userId, params.start, params.end, String(params.currency)]
          : [userId, params.start, params.end]
      )

      const map = new Map<number, number>()
      for (const row of rows) {
        const campaignId = Number(row.campaign_id)
        if (!Number.isFinite(campaignId)) continue
        map.set(campaignId, Number(row.commission) || 0)
      }
      return map
    }

    const currentAggByCampaign = await aggregateByCampaignCurrency({
      start: startDateStr,
      end: endDateStr,
    })
    const currentCommissionByCampaign = await queryCommissionByCampaign({
      start: startDateStr,
      end: endDateStr,
      currency: reportingCurrency || undefined,
    })
    const pickCampaignCurrency = (params: {
      accountCurrency: string
      currentAgg?: Map<string, Agg>
    }): string => {
      if (reportingCurrency) {
        return reportingCurrency
      }

      const accountCurrency = normalizeCurrency(params.accountCurrency)
      const currentAgg = params.currentAgg
      if (!currentAgg || currentAgg.size === 0) return accountCurrency

      const options = Array.from(currentAgg.entries())
        .map(([currency, agg]) => ({
          currency: normalizeCurrency(currency),
          cost: Number(agg.cost) || 0,
        }))
        .sort((a, b) => (b.cost - a.cost) || a.currency.localeCompare(b.currency))

      const top = options[0]?.currency
      if (!top) return accountCurrency

      return top
    }

    const formattedCampaigns = campaigns.map(c => {
      const hasLinkedAdsAccountId = c.google_ads_account_id !== null && c.google_ads_account_id !== undefined
      const hasAccountRow = c.ads_account_id !== null && c.ads_account_id !== undefined
      const adsAccountIsActive = c.ads_account_is_active === true || c.ads_account_is_active === 1
      const adsAccountIsDeleted = c.ads_account_is_deleted === true || c.ads_account_is_deleted === 1
      const adsAccountAvailable = hasLinkedAdsAccountId && hasAccountRow && adsAccountIsActive && !adsAccountIsDeleted

      const currentAgg = currentAggByCampaign.get(Number(c.id))
      const selectedCurrency = pickCampaignCurrency({
        accountCurrency: c.ads_account_currency,
        currentAgg,
      })

      const selectedCurrent = currentAgg?.get(selectedCurrency)
      const impressions = Number(selectedCurrent?.impressions) || 0
      const clicks = Number(selectedCurrent?.clicks) || 0
      const cost = Number(selectedCurrent?.cost) || 0

      const commission = Number(currentCommissionByCampaign.get(Number(c.id))) || 0
      const commissionPerClick = clicks > 0 ? commission / clicks : 0

      return {
        id: c.id,
        campaignName: c.campaign_name,
        offerId: c.offer_id,
        offerBrand: c.offer_brand,
        offerUrl: c.offer_url,
        status: c.status,
        googleCampaignId: c.google_campaign_id,
        googleAdsAccountId: c.google_ads_account_id,
        adsAccountCustomerId: c.ads_account_customer_id ?? null,
        adsAccountName: c.ads_account_name ?? null,
        campaignId: c.campaign_id,
        creationStatus: c.creation_status,
        creationError: c.creation_error ?? null,
        servingStartDate: formatAsYmd(c.published_at ?? c.created_at),
        adsAccountAvailable,
        adsAccountCurrency: selectedCurrency,
        budgetAmount: Number(c.budget_amount) || 0,
        budgetType: c.budget_type,
        lastSyncAt: c.last_sync_at,
        createdAt: c.created_at,
        isDeleted: c.is_deleted,
        deletedAt: c.deleted_at,
        offerIsDeleted: c.offer_is_deleted,
        performance: {
          impressions,
          clicks,
          conversions: roundTo2(commission),
          commission: roundTo2(commission),
          costUsd: cost,
          ctr: impressions > 0 ? Math.round((clicks * 10000) / impressions) / 100 : 0,
          cpcUsd: clicks > 0 ? Math.round((cost * 100) / clicks) / 100 : 0,
          conversionRate: roundTo2(commissionPerClick),
          commissionPerClick: roundTo2(commissionPerClick),
          dateRange: {
            start: startDateStr,
            end: endDateStr,
            days: rangeDays
          }
        }
      }
    })

    const latestCampaignSyncFallback = formattedCampaigns.reduce<string | null>((latest, campaign) => {
      const candidate = campaign.lastSyncAt
      if (!candidate) return latest

      const candidateTs = Date.parse(candidate)
      if (Number.isNaN(candidateTs)) return latest

      if (!latest) return candidate
      const latestTs = Date.parse(latest)
      if (Number.isNaN(latestTs) || candidateTs > latestTs) return candidate

      return latest
    }, null)

    const latestSyncFromLogsRow = db.type === 'postgres'
      ? await db.queryOne<{ latest_sync_at: string | null }>(
          `
            SELECT MAX(
              COALESCE(
                NULLIF(completed_at, '')::timestamptz,
                NULLIF(started_at, '')::timestamptz,
                NULLIF(created_at, '')::timestamptz
              )
            )::text AS latest_sync_at
            FROM sync_logs
            WHERE user_id = ?
          `,
          [userId]
        )
      : await db.queryOne<{ latest_sync_at: string | null }>(
          `
            SELECT MAX(COALESCE(NULLIF(completed_at, ''), NULLIF(started_at, ''), NULLIF(created_at, ''))) AS latest_sync_at
            FROM sync_logs
            WHERE user_id = ?
          `,
          [userId]
        )

    const latestSyncAt = latestSyncFromLogsRow?.latest_sync_at || latestCampaignSyncFallback

    const queryTotalsAll = async (params: {
      start: string
      end: string
    }): Promise<Agg> => {
      const row = await db.queryOne<any>(
        `
          SELECT
            COALESCE(SUM(impressions), 0) as impressions,
            COALESCE(SUM(clicks), 0) as clicks,
            COALESCE(SUM(cost), 0) as cost
          FROM campaign_performance
          WHERE user_id = ?
            AND date >= ?
            AND date <= ?
        `,
        [userId, params.start, params.end]
      )

      return {
        impressions: Number(row?.impressions) || 0,
        clicks: Number(row?.clicks) || 0,
        cost: Number(row?.cost) || 0,
      }
    }

    const queryTotals = async (params: {
      start: string
      end: string
      currency: string
    }): Promise<Agg> => {
      const row = await db.queryOne<any>(
        `
          SELECT
            COALESCE(SUM(impressions), 0) as impressions,
            COALESCE(SUM(clicks), 0) as clicks,
            COALESCE(SUM(cost), 0) as cost
          FROM campaign_performance
          WHERE user_id = ?
            AND date >= ?
            AND date <= ?
            AND COALESCE(currency, 'USD') = ?
        `,
        [userId, params.start, params.end, params.currency]
      )

      return {
        impressions: Number(row?.impressions) || 0,
        clicks: Number(row?.clicks) || 0,
        cost: Number(row?.cost) || 0,
      }
    }

    const queryCommissionTotals = async (params: {
      start: string
      end: string
      currency?: string
    }): Promise<number> => {
      const hasCurrencyFilter = Boolean(params.currency)
      const row = await db.queryOne<{ total_commission: number }>(
        `
          SELECT COALESCE(SUM(commission_amount), 0) AS total_commission
          FROM affiliate_commission_attributions
          WHERE user_id = ?
            AND report_date >= ?
            AND report_date <= ?
            ${hasCurrencyFilter ? 'AND COALESCE(currency, \'USD\') = ?' : ''}
        `,
        hasCurrencyFilter
          ? [userId, params.start, params.end, String(params.currency)]
          : [userId, params.start, params.end]
      )

      return Number(row?.total_commission) || 0
    }

    const queryUnattributedCommissionTotals = async (params: {
      start: string
      end: string
      currency?: string
    }): Promise<number> => {
      const hasCurrencyFilter = Boolean(params.currency)
      try {
        const queryParams = hasCurrencyFilter
          ? [userId, params.start, params.end, EXCLUDED_UNATTRIBUTED_REASON_CODE, String(params.currency)]
          : [userId, params.start, params.end, EXCLUDED_UNATTRIBUTED_REASON_CODE]
        const row = await db.queryOne<{ total_commission: number }>(
          `
            SELECT COALESCE(SUM(commission_amount), 0) AS total_commission
            FROM openclaw_affiliate_attribution_failures
            WHERE user_id = ?
              AND report_date >= ?
              AND report_date <= ?
              AND COALESCE(reason_code, '') <> ?
              ${hasCurrencyFilter ? 'AND COALESCE(currency, \'USD\') = ?' : ''}
          `,
          queryParams
        )

        return Number(row?.total_commission) || 0
      } catch (error: any) {
        const message = String(error?.message || '')
        if (
          /openclaw_affiliate_attribution_failures/i.test(message)
          && /(no such table|does not exist)/i.test(message)
        ) {
          return 0
        }
        throw error
      }
    }

    const isFilteredByCurrency = Boolean(reportingCurrency)

    const currentTotals = isFilteredByCurrency
      ? await queryTotals({
          start: startDateStr,
          end: endDateStr,
          currency: String(reportingCurrency),
        })
      : await queryTotalsAll({
          start: startDateStr,
          end: endDateStr,
        })

    const prevTotals = isFilteredByCurrency
      ? await queryTotals({
          start: prevStartDateStr,
          end: prevEndDateStr,
          currency: String(reportingCurrency),
        })
      : await queryTotalsAll({
          start: prevStartDateStr,
          end: prevEndDateStr,
        })

    const currentAttributedCommissionTotal = await queryCommissionTotals({
      start: startDateStr,
      end: endDateStr,
      currency: reportingCurrency || undefined,
    })
    const prevAttributedCommissionTotal = await queryCommissionTotals({
      start: prevStartDateStr,
      end: prevEndDateStr,
      currency: reportingCurrency || undefined,
    })
    const currentUnattributedCommissionTotal = await queryUnattributedCommissionTotals({
      start: startDateStr,
      end: endDateStr,
      currency: reportingCurrency || undefined,
    })
    const prevUnattributedCommissionTotal = await queryUnattributedCommissionTotals({
      start: prevStartDateStr,
      end: prevEndDateStr,
      currency: reportingCurrency || undefined,
    })
    const currentCommissionTotal = currentAttributedCommissionTotal + currentUnattributedCommissionTotal
    const prevCommissionTotal = prevAttributedCommissionTotal + prevUnattributedCommissionTotal

    const calcChange = (current: number, previous: number): number | null => {
      if (previous === 0) return current > 0 ? 100 : null
      return Math.round(((current - previous) / previous) * 10000) / 100
    }

    const changes = {
      impressions: calcChange(currentTotals.impressions, prevTotals.impressions),
      clicks: calcChange(currentTotals.clicks, prevTotals.clicks),
      conversions: calcChange(currentCommissionTotal, prevCommissionTotal),
      cost: isFilteredByCurrency ? calcChange(currentTotals.cost, prevTotals.cost) : null,
      roas: null as number | null,
      roasInfinite: false,
    }

    const roasAvailable = isFilteredByCurrency || !hasMixedCurrency
    let totalRoas: number | null = null
    let totalRoasInfinite = false
    let prevRoas: number | null = null
    let prevRoasInfinite = false

    if (roasAvailable) {
      const currentRoas = calculateRoas(currentCommissionTotal, currentTotals.cost)
      const previousRoas = calculateRoas(prevCommissionTotal, prevTotals.cost)
      totalRoas = currentRoas.value
      totalRoasInfinite = currentRoas.infinite
      prevRoas = previousRoas.value
      prevRoasInfinite = previousRoas.infinite

      if (totalRoasInfinite) {
        changes.roasInfinite = true
      } else if (
        !prevRoasInfinite
        && typeof prevRoas === 'number'
        && prevRoas > 0
        && typeof totalRoas === 'number'
      ) {
        changes.roas = roundTo2(((totalRoas - prevRoas) / prevRoas) * 100)
      }
    }

    return NextResponse.json({
      success: true,
      campaigns: formattedCampaigns,
      summary: {
        totalCampaigns: formattedCampaigns.length,
        activeCampaigns: formattedCampaigns.filter(c => c.status === 'ENABLED').length,
        totalImpressions: currentTotals.impressions,
        totalClicks: currentTotals.clicks,
        totalConversions: roundTo2(currentCommissionTotal),
        totalCommission: roundTo2(currentCommissionTotal),
        attributedCommission: roundTo2(currentAttributedCommissionTotal),
        unattributedCommission: roundTo2(currentUnattributedCommissionTotal),
        totalCostUsd: currentTotals.cost,
        totalRoas: roasAvailable ? totalRoas : null,
        totalRoasInfinite: roasAvailable ? totalRoasInfinite : false,
        currency: hasMixedCurrency && !isFilteredByCurrency ? 'MIXED' : (reportingCurrency || currencies[0] || 'USD'),
        currencies,
        hasMixedCurrency,
        costs: hasMixedCurrency && !isFilteredByCurrency ? costs : undefined,
        latestSyncAt,
        changes: {
          impressions: changes.impressions,
          clicks: changes.clicks,
          conversions: changes.conversions,
          cost: changes.cost
        },
        comparisonPeriod: {
          current: { start: startDateStr, end: endDateStr },
          previous: { start: prevStartDateStr, end: prevEndDateStr }
        }
      }
    })

  } catch (error: any) {
    console.error('Get campaigns performance error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get performance data' },
      { status: 500 }
    )
  }
}
