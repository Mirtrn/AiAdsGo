import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  getOfferPerformanceSummary,
  getOfferPerformanceTrend,
  getCampaignPerformanceComparison,
  calculateOfferROI
} from '@/lib/offer-performance'

/**
 * GET /api/offers/[id]/performance
 *
 * 获取Offer级别的性能数据汇总
 *
 * Query Parameters:
 * - daysBack: number (可选，默认30天)
 * - avgOrderValue: number (可选，用于ROI计算，默认0)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 1. 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId
    const offerId = parseInt(params.id)

    if (isNaN(offerId)) {
      return NextResponse.json(
        { error: '无效的Offer ID' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '30')
    const avgOrderValue = parseFloat(searchParams.get('avgOrderValue') || '0')

    // 2. 获取Offer性能汇总
    const summary = getOfferPerformanceSummary(offerId, userId, daysBack)

    // 3. 获取趋势数据
    const trend = getOfferPerformanceTrend(offerId, userId, daysBack)

    // 4. 获取Campaign对比数据
    const campaigns = getCampaignPerformanceComparison(offerId, userId, daysBack)

    // 5. 计算ROI（如果提供了avgOrderValue）
    let roi = null
    if (avgOrderValue > 0) {
      roi = calculateOfferROI(offerId, userId, avgOrderValue, daysBack)
    }

    // 6. 格式化返回数据
    return NextResponse.json({
      success: true,
      offerId,
      daysBack,
      summary: {
        campaignCount: summary.campaign_count,
        impressions: summary.impressions,
        clicks: summary.clicks,
        conversions: summary.conversions,
        costUsd: Math.round((summary.cost_micros / 1000000) * 100) / 100,
        ctr: summary.ctr,
        avgCpcUsd: Math.round((summary.avg_cpc_micros / 1000000) * 100) / 100,
        conversionRate: summary.conversion_rate,
        dateRange: summary.date_range
      },
      trend: trend.map(t => ({
        date: t.date,
        impressions: t.impressions,
        clicks: t.clicks,
        conversions: t.conversions,
        costUsd: Math.round((t.cost_micros / 1000000) * 100) / 100,
        ctr: t.ctr,
        conversionRate: t.conversion_rate
      })),
      campaigns: campaigns.map(c => ({
        campaignId: c.campaign_id,
        campaignName: c.campaign_name,
        googleCampaignId: c.google_campaign_id,
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        costUsd: Math.round((c.cost_micros / 1000000) * 100) / 100,
        ctr: c.ctr,
        cpcUsd: Math.round((c.cpc_micros / 1000000) * 100) / 100,
        conversionRate: c.conversion_rate
      })),
      roi: roi ? {
        totalCostUsd: roi.total_cost_usd,
        totalRevenueUsd: roi.total_revenue_usd,
        roiPercentage: roi.roi_percentage,
        profitUsd: roi.profit_usd,
        conversions: roi.conversions,
        avgOrderValue: avgOrderValue
      } : null
    })

  } catch (error: any) {
    console.error('Get offer performance error:', error)
    return NextResponse.json(
      { error: error.message || '获取Offer性能数据失败' },
      { status: 500 }
    )
  }
}
