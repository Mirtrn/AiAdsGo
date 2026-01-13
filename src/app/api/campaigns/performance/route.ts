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

    // 3. Query campaigns with performance data
    // 🔧 修复: 不过滤is_deleted，保留历史删除的campaigns的performance数据用于统计
    // 但在前端显示时可以通过is_deleted字段区分展示
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
        o.brand as offer_brand,
        o.url as offer_url,
        o.is_deleted as offer_is_deleted,
        COALESCE(SUM(cp.impressions), 0) as impressions,
        COALESCE(SUM(cp.clicks), 0) as clicks,
        COALESCE(SUM(cp.conversions), 0) as conversions,
        COALESCE(SUM(cp.cost), 0) as cost,
        CASE
          WHEN SUM(cp.impressions) > 0
          THEN ROUND(SUM(cp.clicks) * 100.0 / SUM(cp.impressions), 2)
          ELSE 0
        END as ctr,
        CASE
          WHEN SUM(cp.clicks) > 0
          THEN ROUND(SUM(cp.cost) * 1.0 / SUM(cp.clicks), 2)
          ELSE 0
        END as cpc,
        CASE
          WHEN SUM(cp.clicks) > 0
          THEN ROUND(SUM(cp.conversions) * 100.0 / SUM(cp.clicks), 2)
          ELSE 0
        END as conversion_rate
      FROM campaigns c
      LEFT JOIN offers o ON c.offer_id = o.id
      LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
        AND cp.date >= ?
        AND cp.date <= ?
      WHERE c.user_id = ?
      GROUP BY
        c.id, c.campaign_id, c.campaign_name, c.offer_id, c.status,
        c.google_campaign_id, c.google_ads_account_id, c.budget_amount,
        c.budget_type, c.creation_status, c.creation_error, c.last_sync_at,
        c.created_at, c.published_at, c.is_deleted, c.deleted_at,
        o.brand, o.url, o.is_deleted
      ORDER BY c.created_at DESC
    `, [userId, startDateStr, endDate, userId]) as any[]

    // 4. Format response
    const formattedCampaigns = campaigns.map(c => ({
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
        impressions: Number(c.impressions) || 0,
        clicks: Number(c.clicks) || 0,
        conversions: Number(c.conversions) || 0,
        // 🔧 修复(2025-12-30): 字段名与前端接口一致 (costUsd/cpcUsd)
        costUsd: Number(c.cost) || 0,
        ctr: Number(c.ctr) || 0,
        cpcUsd: Number(c.cpc) || 0,
        conversionRate: Number(c.conversion_rate) || 0,
        dateRange: {
          start: startDateStr,
          end: endDate,
          days: daysBack
        }
      }
    }))

    // 5. Calculate current period totals（✅ 修复：确保数值类型安全，处理NULL值）
    const currentTotals = {
      impressions: campaigns.reduce((sum, c) => sum + (Number(c.impressions) || 0), 0),
      clicks: campaigns.reduce((sum, c) => sum + (Number(c.clicks) || 0), 0),
      conversions: campaigns.reduce((sum, c) => sum + (Number(c.conversions) || 0), 0),
      cost: campaigns.reduce((sum, c) => sum + (Number(c.cost) || 0), 0)
    }

    // 6. Query previous period totals for comparison
    const prevPeriodData = await db.queryOne(`
      SELECT
        COALESCE(SUM(impressions), 0) as impressions,
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(conversions), 0) as conversions,
        COALESCE(SUM(cost), 0) as cost
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
    `, [userId, prevStartDateStr, prevEndDateStr]) as any

    // 7. Calculate percentage changes (环比增长)
    const calcChange = (current: number, previous: number): number | null => {
      if (previous === 0) return current > 0 ? 100 : null
      return Math.round(((current - previous) / previous) * 10000) / 100
    }

    const changes = {
      impressions: calcChange(currentTotals.impressions, prevPeriodData?.impressions || 0),
      clicks: calcChange(currentTotals.clicks, prevPeriodData?.clicks || 0),
      conversions: calcChange(currentTotals.conversions, prevPeriodData?.conversions || 0),
      cost: calcChange(currentTotals.cost, prevPeriodData?.cost || 0)
    }

    return NextResponse.json({
      success: true,
      campaigns: formattedCampaigns,
      summary: {
        totalCampaigns: campaigns.length,
        activeCampaigns: campaigns.filter(c => c.status === 'ENABLED').length,
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
