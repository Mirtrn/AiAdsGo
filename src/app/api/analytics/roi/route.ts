import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

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

    const db = getDatabase()

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
    const overallRoi = db.prepare(`
      SELECT
        SUM(cp.cost) as total_cost,
        SUM(cp.conversions) as total_conversions,
        AVG(${commissionAmountExpr}) as avg_commission,
        SUM(cp.conversions * COALESCE(${commissionAmountExpr}, 0)) as total_revenue
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE ${whereConditions.join(' AND ')}
    `).get(...params) as any

    const totalCost = overallRoi.total_cost || 0
    const totalRevenue = overallRoi.total_revenue || 0
    const totalProfit = totalRevenue - totalCost
    const overallRoiPercentage = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0

    // 2. 按日期的ROI趋势
    const roiTrend = db.prepare(`
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
    `).all(...params) as any[]

    const roiTrendData = roiTrend.map((row) => ({
      date: row.date,
      cost: parseFloat(row.cost?.toFixed(2) || '0'),
      revenue: parseFloat(row.revenue?.toFixed(2) || '0'),
      profit: parseFloat((row.revenue - row.cost)?.toFixed(2) || '0'),
      roi: row.cost > 0 ? parseFloat((((row.revenue - row.cost) / row.cost) * 100).toFixed(2)) : 0,
      conversions: row.conversions || 0,
    }))

    // 3. 按Campaign的ROI排名
    const campaignRoi = db.prepare(`
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
    `).all(...params) as any[]

    const campaignRoiData = campaignRoi.map((row) => {
      const cost = row.cost || 0
      const revenue = row.revenue || 0
      const profit = revenue - cost
      const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : 0
      const ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0
      const conversionRate = row.clicks > 0 ? (row.conversions / row.clicks) * 100 : 0

      return {
        campaign_id: row.id,
        campaign_name: row.campaign_name,
        offer_brand: row.offer_brand,
        cost: parseFloat(cost.toFixed(2)),
        revenue: parseFloat(revenue.toFixed(2)),
        profit: parseFloat(profit.toFixed(2)),
        roi: parseFloat(roi.toFixed(2)),
        conversions: row.conversions,
        ctr: parseFloat(ctr.toFixed(2)),
        conversionRate: parseFloat(conversionRate.toFixed(2)),
        impressions: row.impressions,
        clicks: row.clicks,
      }
    })

    // 4. 按Offer的ROI分析
    const offerRoi = db.prepare(`
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
    `).all(...params) as any[]

    const offerRoiData = offerRoi.map((row) => {
      const cost = row.cost || 0
      const revenue = row.revenue || 0
      const profit = revenue - cost
      const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : 0

      return {
        offer_id: row.id,
        brand: row.brand,
        offer_name: row.offer_name,
        commission_amount: row.commission_amount,
        campaign_count: row.campaign_count,
        cost: parseFloat(cost.toFixed(2)),
        revenue: parseFloat(revenue.toFixed(2)),
        profit: parseFloat(profit.toFixed(2)),
        roi: parseFloat(roi.toFixed(2)),
        conversions: row.conversions,
      }
    })

    // 5. 投资回报效率指标
    const efficiencyMetrics = {
      costPerConversion: overallRoi.total_conversions > 0
        ? parseFloat((totalCost / overallRoi.total_conversions).toFixed(2))
        : 0,
      revenuePerConversion: overallRoi.total_conversions > 0
        ? parseFloat((totalRevenue / overallRoi.total_conversions).toFixed(2))
        : 0,
      profitMargin: totalRevenue > 0
        ? parseFloat(((totalProfit / totalRevenue) * 100).toFixed(2))
        : 0,
      breakEvenPoint: overallRoi.avg_commission > 0
        ? parseFloat((totalCost / overallRoi.avg_commission).toFixed(0))
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
          conversions: overallRoi.total_conversions || 0,
          avgCommission: parseFloat((overallRoi.avg_commission || 0).toFixed(2)),
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
