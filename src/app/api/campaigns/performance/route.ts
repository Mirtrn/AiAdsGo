import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

function formatAsYmd(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value)
  if (!raw.trim()) return null

  // Fast path: ISO-like prefix
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

type Agg = {
  impressions: number
  clicks: number
  conversions: number
  cost: number
}

/**
 * GET /api/campaigns/performance
 *
 * Get performance data for all campaigns
 *
 * Query Parameters:
 * - daysBack: number (default: 7)
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Verify authentication
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '7')

    const db = await getDatabase()

    // 2. Calculate date range (current period)
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)
    const startDateStr = startDate.toISOString().split('T')[0]

    // Calculate previous period date range (for comparison)
    const prevEndDate = new Date(startDate)
    prevEndDate.setDate(prevEndDate.getDate() - 1)
    const prevStartDate = new Date(prevEndDate)
    prevStartDate.setDate(prevStartDate.getDate() - daysBack + 1)
    const prevStartDateStr = prevStartDate.toISOString().split('T')[0]
    const prevEndDateStr = prevEndDate.toISOString().split('T')[0]

    // 3. Query base campaigns (no performance aggregation)
    // 🔧 修复: 不过滤is_deleted，保留历史删除的campaigns用于展示
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

    // 4. Query performance aggregated by (campaign_id, currency) for current/previous period
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
          COALESCE(SUM(conversions), 0) as conversions,
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
          conversions: Number(row.conversions) || 0,
          cost: Number(row.cost) || 0,
        }

        const byCurrency = map.get(campaignId) ?? new Map<string, Agg>()
        byCurrency.set(currency, agg)
        map.set(campaignId, byCurrency)
      }
      return map
    }

    const currentAggByCampaign = await aggregateByCampaignCurrency({
      start: startDateStr,
      end: endDate,
    })
    const prevAggByCampaign = await aggregateByCampaignCurrency({
      start: prevStartDateStr,
      end: prevEndDateStr,
    })

    const pickCampaignCurrency = (params: {
      accountCurrency: string
      currentAgg?: Map<string, Agg>
    }): string => {
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

    // 4. Format response
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
      const conversions = Number(selectedCurrent?.conversions) || 0
      const cost = Number(selectedCurrent?.cost) || 0

      return {
      id: c.id,
      campaignName: c.campaign_name,
      offerId: c.offer_id,
      offerBrand: c.offer_brand,
      offerUrl: c.offer_url,
      status: c.status,
      googleCampaignId: c.google_campaign_id,
      googleAdsAccountId: c.google_ads_account_id,
      campaignId: c.campaign_id,
      creationStatus: c.creation_status,
      creationError: c.creation_error ?? null,
      // 投放日期：以“成功发布到 Ads 账号”的时间为准（published_at）；旧数据兜底为 created_at
      servingStartDate: formatAsYmd(c.published_at ?? c.created_at),
      adsAccountAvailable,
      // 🔧 展示币种：优先用 performance.currency（避免账号币种缺失/默认值导致全站显示$）
      adsAccountCurrency: selectedCurrency,
      // 🔧 修复(2025-12-29): 确保预算金额是数字类型
      budgetAmount: Number(c.budget_amount) || 0,
      budgetType: c.budget_type,
      lastSyncAt: c.last_sync_at,
      createdAt: c.created_at,
      // 🔧 新增: 删除状态字段，前端可据此区分显示
      isDeleted: c.is_deleted,
      deletedAt: c.deleted_at,
      offerIsDeleted: c.offer_is_deleted,
      performance: {
        // 🔧 修复(2025-12-29): 确保性能指标是数字类型，不是字符串
        // 这样前端排序时能正确进行数值比较而不是字符串比较
        impressions,
        clicks,
        conversions,
        // 🔧 修复(2025-12-30): 字段名与前端接口一致 (costUsd/cpcUsd)
        costUsd: cost,
        ctr: impressions > 0 ? Math.round((clicks * 10000) / impressions) / 100 : 0,
        cpcUsd: clicks > 0 ? Math.round((cost * 100) / clicks) / 100 : 0,
        conversionRate: clicks > 0 ? Math.round((conversions * 10000) / clicks) / 100 : 0,
        dateRange: {
          start: startDateStr,
          end: endDate,
          days: daysBack
        }
      }
    }})

    // 5. Calculate current/previous period totals（按每条campaign选中的币种聚合，避免混币种相加）
    const currentTotals = {
      impressions: formattedCampaigns.reduce((sum, c) => sum + (Number(c.performance?.impressions) || 0), 0),
      clicks: formattedCampaigns.reduce((sum, c) => sum + (Number(c.performance?.clicks) || 0), 0),
      conversions: formattedCampaigns.reduce((sum, c) => sum + (Number(c.performance?.conversions) || 0), 0),
      cost: formattedCampaigns.reduce((sum, c) => sum + (Number(c.performance?.costUsd) || 0), 0)
    }

    const prevTotals = formattedCampaigns.reduce(
      (acc, campaign) => {
        const campaignId = Number(campaign.id)
        const currency = normalizeCurrency(campaign.adsAccountCurrency)
        const prevAgg = prevAggByCampaign.get(campaignId)?.get(currency)

        acc.impressions += Number(prevAgg?.impressions) || 0
        acc.clicks += Number(prevAgg?.clicks) || 0
        acc.conversions += Number(prevAgg?.conversions) || 0
        acc.cost += Number(prevAgg?.cost) || 0
        return acc
      },
      { impressions: 0, clicks: 0, conversions: 0, cost: 0 }
    )

    // 7. Calculate percentage changes (环比增长)
    const calcChange = (current: number, previous: number): number | null => {
      if (previous === 0) return current > 0 ? 100 : null
      return Math.round(((current - previous) / previous) * 10000) / 100
    }

    const changes = {
      impressions: calcChange(currentTotals.impressions, prevTotals.impressions),
      clicks: calcChange(currentTotals.clicks, prevTotals.clicks),
      conversions: calcChange(currentTotals.conversions, prevTotals.conversions),
      cost: calcChange(currentTotals.cost, prevTotals.cost)
    }

    return NextResponse.json({
      success: true,
      campaigns: formattedCampaigns,
      summary: {
        totalCampaigns: formattedCampaigns.length,
        activeCampaigns: formattedCampaigns.filter(c => c.status === 'ENABLED').length,
        totalImpressions: currentTotals.impressions,
        totalClicks: currentTotals.clicks,
        totalConversions: currentTotals.conversions,
        totalCostUsd: currentTotals.cost,
        // 环比增长数据
        changes: {
          impressions: changes.impressions,
          clicks: changes.clicks,
          conversions: changes.conversions,
          cost: changes.cost
        },
        comparisonPeriod: {
          current: { start: startDateStr, end: endDate },
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
