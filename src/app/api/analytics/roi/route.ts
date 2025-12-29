import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { toNumber } from '@/lib/utils'

/**
 * GET /api/analytics/roi
 * 获取ROI分析数据
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    const campaignId = searchParams.get('campaign_id')
    const offerId = searchParams.get('offer_id')

    const db = await getDatabase()

    // 构建查询条件
    let whereConditions = ['cp.user_id = ?']
    const params: any[] = [authResult.user.userId]

    if (startDate) {
      whereConditions.push('cp.date >= ?')
      params.push(startDate)
    }

    if (endDate) {
      whereConditions.push('cp.date <= ?')
      params.push(endDate)
    }

    if (campaignId) {
      whereConditions.push('cp.campaign_id = ?')
      params.push(parseInt(campaignId))
    }

    if (offerId) {
      whereConditions.push('c.offer_id = ?')
      params.push(parseInt(offerId))
    }

    // 计算佣金金额的SQL表达式：product_price * (commission_payout / 100)
    const commissionAmountExpr = `
      CAST(REPLACE(REPLACE(o.product_price, '$', ''), ',', '') AS REAL) *
      (CAST(REPLACE(o.commission_payout, '%', '') AS REAL) / 100.0)
    `.trim()

    // 1. 整体ROI分析
    // 🔧 修复(2025-12-29): 不过滤is_deleted，保留历史删除的campaigns的performance数据用于ROI统计
    // 这样即使campaign被删除，历史收益数据仍会体现在总ROI中
    const overallRoi = await db.queryOne(`
      SELECT
        SUM(cp.cost) as total_cost,
        SUM(cp.conversions) as total_conversions,
        AVG(${commissionAmountExpr}) as avg_commission,
        SUM(cp.conversions * COALESCE(${commissionAmountExpr}, 0)) as total_revenue
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE ${whereConditions.join(' AND ')}
    `, params) as any

    // Ensure all values are proper numbers before returning
    const totalCost = toNumber(overallRoi.total_cost)
    const totalRevenue = toNumber(overallRoi.total_revenue)
    const totalConversions = toNumber(overallRoi.total_conversions)
    const avgCommission = toNumber(overallRoi.avg_commission)

    const totalProfit = totalRevenue - totalCost
    const overallRoiPercentage = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0

    // 2. 按日期的ROI趋势
    const roiTrend = await db.query(`
      SELECT
        DATE(cp.date) as date,
        SUM(cp.cost) as cost,
        SUM(cp.conversions) as conversions,
        AVG(${commissionAmountExpr}) as avg_commission,
        SUM(cp.conversions * COALESCE(${commissionAmountExpr}, 0)) as revenue
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY DATE(cp.date)
      ORDER BY date ASC
    `, params) as any[]

    const roiTrendData = roiTrend.map((row) => {
      const cost = toNumber(row.cost)
      const revenue = toNumber(row.revenue)
      const conversions = toNumber(row.conversions)

      const profit = revenue - cost
      const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : 0

      return {
        date: row.date,
        cost: parseFloat(cost.toFixed(2)),
        revenue: parseFloat(revenue.toFixed(2)),
        profit: parseFloat(profit.toFixed(2)),
        roi: parseFloat(roi.toFixed(2)),
        conversions,
      }
    })

    // 3. 按Campaign的ROI排名
    const campaignRoi = await db.query(`
      SELECT
        c.id,
        c.campaign_name,
        o.brand as offer_brand,
        SUM(cp.cost) as cost,
        SUM(cp.conversions) as conversions,
        SUM(cp.impressions) as impressions,
        SUM(cp.clicks) as clicks,
        AVG(${commissionAmountExpr}) as avg_commission,
        SUM(cp.conversions * COALESCE(${commissionAmountExpr}, 0)) as revenue
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY c.id, c.campaign_name, o.brand
      HAVING SUM(cp.conversions) > 0
      ORDER BY revenue DESC
      LIMIT 10
    `, params) as any[]

    const campaignRoiData = campaignRoi.map((row) => {
      const cost = toNumber(row.cost)
      const revenue = toNumber(row.revenue)
      const impressions = toNumber(row.impressions)
      const clicks = toNumber(row.clicks)
      const conversions = toNumber(row.conversions)
      const avgCommission = toNumber(row.avg_commission)

      const profit = revenue - cost
      const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : 0
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
      const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0

      return {
        campaignId: row.id,
        campaignName: row.campaign_name,
        offerBrand: row.offer_brand,
        cost: parseFloat(cost.toFixed(2)),
        revenue: parseFloat(revenue.toFixed(2)),
        profit: parseFloat(profit.toFixed(2)),
        roi: parseFloat(roi.toFixed(2)),
        conversions,
        ctr: parseFloat(ctr.toFixed(2)),
        conversionRate: parseFloat(conversionRate.toFixed(2)),
        impressions,
        clicks,
      }
    })

    // 4. 按Offer的ROI分析
    const offerRoi = await db.query(`
      SELECT
        o.id,
        o.brand,
        o.offer_name,
        ${commissionAmountExpr} as commission_amount,
        COUNT(DISTINCT c.id) as campaign_count,
        SUM(cp.cost) as cost,
        SUM(cp.conversions) as conversions,
        SUM(cp.conversions * COALESCE(${commissionAmountExpr}, 0)) as revenue
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE ${whereConditions.join(' AND ')} AND o.id IS NOT NULL
      GROUP BY o.id, o.brand, o.offer_name
      HAVING SUM(cp.conversions) > 0
      ORDER BY revenue DESC
      LIMIT 10
    `, params) as any[]

    const offerRoiData = offerRoi.map((row) => {
      const cost = toNumber(row.cost)
      const revenue = toNumber(row.revenue)
      const conversions = toNumber(row.conversions)
      const commissionAmount = toNumber(row.commission_amount)
      const campaignCount = toNumber(row.campaign_count)

      const profit = revenue - cost
      const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : 0

      return {
        offerId: row.id,
        brand: row.brand,
        offerName: row.offer_name,
        commissionAmount: parseFloat(commissionAmount.toFixed(2)),
        campaignCount,
        cost: parseFloat(cost.toFixed(2)),
        revenue: parseFloat(revenue.toFixed(2)),
        profit: parseFloat(profit.toFixed(2)),
        roi: parseFloat(roi.toFixed(2)),
        conversions,
      }
    })

    // 5. 投资回报效率指标
    const efficiencyMetrics = {
      costPerConversion: totalConversions > 0
        ? parseFloat((totalCost / totalConversions).toFixed(2))
        : 0,
      revenuePerConversion: totalConversions > 0
        ? parseFloat((totalRevenue / totalConversions).toFixed(2))
        : 0,
      profitMargin: totalRevenue > 0
        ? parseFloat(((totalProfit / totalRevenue) * 100).toFixed(2))
        : 0,
      breakEvenPoint: avgCommission > 0
        ? parseFloat((totalCost / avgCommission).toFixed(0))
        : 0,
    }

    return NextResponse.json({
      success: true,
      data: {
        overall: {
          totalCost: parseFloat(totalCost.toFixed(2)),
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          totalProfit: parseFloat(totalProfit.toFixed(2)),
          roi: parseFloat(overallRoiPercentage.toFixed(2)),
          conversions: totalConversions,
          avgCommission: parseFloat(avgCommission.toFixed(2)),
        },
        trend: roiTrendData,
        byCampaign: campaignRoiData,
        byOffer: offerRoiData,
        efficiency: efficiencyMetrics,
      },
    })
  } catch (error: any) {
    console.error('获取ROI分析数据失败:', error)
    return NextResponse.json(
      { error: '获取ROI分析数据失败', message: error.message },
      { status: 500 }
    )
  }
}
