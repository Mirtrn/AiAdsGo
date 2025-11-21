import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

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

    const db = getDatabase()

    // 2. Calculate date range
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)
    const startDateStr = startDate.toISOString().split('T')[0]

    // 3. Query campaigns with performance data
    const campaigns = db.prepare(`
      SELECT
        c.id,
        c.campaign_name,
        c.offer_id,
        c.status,
        c.google_campaign_id,
        c.google_ads_account_id,
        c.budget_amount,
        c.budget_type,
        c.last_sync_at,
        c.created_at,
        o.brand as offer_brand,
        o.url as offer_url,
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
        c.id, c.campaign_name, c.offer_id, c.status,
        c.google_campaign_id, c.google_ads_account_id, c.budget_amount,
        c.budget_type, c.last_sync_at, c.created_at, o.brand, o.url
      ORDER BY c.created_at DESC
    `).all(startDateStr, endDate, userId) as any[]

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
      budgetAmount: c.budget_amount,
      budgetType: c.budget_type,
      lastSyncAt: c.last_sync_at,
      createdAt: c.created_at,
      performance: {
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        cost: c.cost,
        ctr: c.ctr,
        cpc: c.cpc,
        conversionRate: c.conversion_rate,
        dateRange: {
          start: startDateStr,
          end: endDate,
          days: daysBack
        }
      }
    }))

    return NextResponse.json({
      success: true,
      campaigns: formattedCampaigns,
      summary: {
        totalCampaigns: campaigns.length,
        activeCampaigns: campaigns.filter(c => c.status === 'ENABLED').length,
        totalImpressions: campaigns.reduce((sum, c) => sum + c.impressions, 0),
        totalClicks: campaigns.reduce((sum, c) => sum + c.clicks, 0),
        totalConversions: campaigns.reduce((sum, c) => sum + c.conversions, 0),
        totalCost: campaigns.reduce((sum, c) => sum + c.cost, 0)
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
