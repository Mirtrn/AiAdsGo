import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  getOfferPerformanceSummary,
  getOfferPerformanceTrend,
  getCampaignPerformanceComparison,
  calculateOfferROI,
  getOfferCurrencyInfo
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
    const requestedCurrencyRaw = searchParams.get('currency')
    const requestedCurrency = requestedCurrencyRaw ? requestedCurrencyRaw.trim().toUpperCase() : null

    // 2. 获取币种信息（用于前端展示货币符号/单位）
    const currencyInfo = await getOfferCurrencyInfo(offerId, userId, daysBack)

    const reportingCurrency = requestedCurrency && currencyInfo.currencies.includes(requestedCurrency)
      ? requestedCurrency
      : currencyInfo.currency

    // 3. 获取Offer性能汇总（按币种过滤，避免多币种相加）
    const summary = await getOfferPerformanceSummary(offerId, userId, daysBack, reportingCurrency)

    // 4. 获取趋势数据（按币种过滤）
    const trend = await getOfferPerformanceTrend(offerId, userId, daysBack, reportingCurrency)

    // 5. 获取Campaign对比数据（按币种过滤）
    const campaigns = await getCampaignPerformanceComparison(offerId, userId, daysBack, reportingCurrency)

    // 5. 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)
    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // 6. 计算ROI（如果提供了avgOrderValue）
    let roi = null
    if (avgOrderValue > 0) {
      roi = await calculateOfferROI(offerId, userId, avgOrderValue, daysBack, reportingCurrency)
    }

    // 7. 格式化返回数据
    // 处理null值，确保计算安全
    const safeSummary = {
      campaignCount: summary?.campaign_count || 0,
      impressions: summary?.impressions || 0,
      clicks: summary?.clicks || 0,
      conversions: summary?.conversions || 0,
      costUsd: Math.round((summary?.cost || 0) * 100) / 100,
      ctr: Math.round((summary?.ctr || 0) * 100) / 100,
      avgCpcUsd: Math.round((summary?.avg_cpc || 0) * 100) / 100,
      conversionRate: Math.round((summary?.conversion_rate || 0) * 100) / 100,
      dateRange: { start: startDateStr, end: endDateStr, days: daysBack }
    }

    return NextResponse.json({
      success: true,
      offerId,
      daysBack,
      currency: reportingCurrency,
      currencies: currencyInfo.currencies,
      hasMixedCurrency: currencyInfo.hasMixedCurrency,
      summary: safeSummary,
      trend: trend.map(t => ({
        date: t.date,
        impressions: t.impressions || 0,
        clicks: t.clicks || 0,
        conversions: t.conversions || 0,
        costUsd: Math.round((t.cost || 0) * 100) / 100,
        ctr: Math.round((t.ctr || 0) * 100) / 100,
        conversionRate: Math.round((t.conversion_rate || 0) * 100) / 100
      })),
      campaigns: campaigns.map(c => ({
        campaignId: c.campaign_id,
        campaignName: c.campaign_name,
        googleCampaignId: c.google_campaign_id,
        adsAccountCurrency: c.currency || reportingCurrency,
        impressions: c.impressions || 0,
        clicks: c.clicks || 0,
        conversions: c.conversions || 0,
        costUsd: Math.round((c.cost || 0) * 100) / 100,
        ctr: Math.round((c.ctr || 0) * 100) / 100,
        cpcUsd: Math.round((c.cpc || 0) * 100) / 100,
        conversionRate: Math.round((c.conversion_rate || 0) * 100) / 100
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
