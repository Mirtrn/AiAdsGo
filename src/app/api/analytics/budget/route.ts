import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/analytics/budget
 * 获取预算使用分析数据
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

    // 计算日期范围（天数）
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const end = endDate ? new Date(endDate) : new Date()
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) || 1

    // 1. 整体预算使用情况
    const overallBudget = db.prepare(`
      SELECT
        SUM(c.budget_amount) as total_budget,
        SUM(cp.cost) as total_spent,
        COUNT(DISTINCT c.id) as active_campaigns
      FROM campaigns c
      LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
        AND ${whereConditions.map(w => w.replace('cp.user_id', 'c.user_id')).join(' AND ')}
      WHERE c.user_id = ? AND c.status = 'ENABLED'
    `).get(authResult.user.userId) as any

    const totalBudget = overallBudget.total_budget || 0
    const totalSpent = overallBudget.total_spent || 0
    const remaining = totalBudget - totalSpent
    const utilizationRate = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0
    const dailyAvgSpend = totalSpent / daysDiff
    const projectedTotalSpend = dailyAvgSpend * 30 // 预测30天花费

    // 2. 按Campaign的预算使用
    const campaignBudgets = db.prepare(`
      SELECT
        c.id,
        c.campaign_name,
        c.budget_amount,
        c.budget_type,
        o.brand as offer_brand,
        SUM(cp.cost) as spent,
        SUM(cp.conversions) as conversions,
        COUNT(DISTINCT cp.date) as active_days
      FROM campaigns c
      LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
        AND ${whereConditions.join(' AND ')}
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE c.user_id = ? AND c.status = 'ENABLED'
      GROUP BY c.id, c.campaign_name, c.budget_amount, c.budget_type, o.brand
      ORDER BY c.budget_amount DESC
    `).all(authResult.user.userId) as any[]

    const campaignBudgetData = campaignBudgets.map((row) => {
      const budget = row.budget_amount || 0
      const spent = row.spent || 0
      const remaining = budget - spent
      const utilizationRate = budget > 0 ? (spent / budget) * 100 : 0
      const dailyAvg = row.active_days > 0 ? spent / row.active_days : 0
      const daysRemaining = budget > 0 && dailyAvg > 0 ? remaining / dailyAvg : 0
      const isOverBudget = spent > budget
      const isNearBudget = utilizationRate >= 80 && utilizationRate < 100

      return {
        campaign_id: row.id,
        campaign_name: row.campaign_name,
        offer_brand: row.offer_brand,
        budget_type: row.budget_type,
        budget: parseFloat(budget.toFixed(2)),
        spent: parseFloat(spent.toFixed(2)),
        remaining: parseFloat(remaining.toFixed(2)),
        utilizationRate: parseFloat(utilizationRate.toFixed(2)),
        dailyAvgSpend: parseFloat(dailyAvg.toFixed(2)),
        daysRemaining: parseFloat(daysRemaining.toFixed(1)),
        conversions: row.conversions || 0,
        isOverBudget,
        isNearBudget,
        status: isOverBudget ? 'over_budget' : isNearBudget ? 'near_budget' : 'on_track',
      }
    })

    // 3. 预算使用趋势（按日）
    const budgetTrend = db.prepare(`
      SELECT
        DATE(cp.date) as date,
        SUM(cp.cost) as daily_spent
      FROM campaign_performance cp
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY DATE(cp.date)
      ORDER BY date ASC
    `).all(...params) as any[]

    let cumulativeSpent = 0
    const budgetTrendData = budgetTrend.map((row) => {
      cumulativeSpent += row.daily_spent || 0
      return {
        date: row.date,
        dailySpent: parseFloat((row.daily_spent || 0).toFixed(2)),
        cumulativeSpent: parseFloat(cumulativeSpent.toFixed(2)),
      }
    })

    // 4. 预算分配分析（按Offer）
    const budgetByOffer = db.prepare(`
      SELECT
        o.id,
        o.brand,
        o.product_name,
        SUM(c.budget_amount) as allocated_budget,
        SUM(cp.cost) as spent,
        COUNT(DISTINCT c.id) as campaign_count,
        SUM(cp.conversions) as conversions
      FROM campaigns c
      LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
        AND ${whereConditions.join(' AND ')}
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE c.user_id = ? AND o.id IS NOT NULL
      GROUP BY o.id, o.brand, o.product_name
      HAVING SUM(cp.cost) > 0
      ORDER BY spent DESC
      LIMIT 10
    `).all(authResult.user.userId) as any[]

    const budgetByOfferData = budgetByOffer.map((row) => {
      const allocatedBudget = row.allocated_budget || 0
      const spent = row.spent || 0
      const utilizationRate = allocatedBudget > 0 ? (spent / allocatedBudget) * 100 : 0

      return {
        offer_id: row.id,
        brand: row.brand,
        product_name: row.product_name,
        allocatedBudget: parseFloat(allocatedBudget.toFixed(2)),
        spent: parseFloat(spent.toFixed(2)),
        utilizationRate: parseFloat(utilizationRate.toFixed(2)),
        campaignCount: row.campaign_count,
        conversions: row.conversions || 0,
      }
    })

    // 5. 预算警报
    const alerts: any[] = []

    // 超预算的Campaign
    const overBudgetCampaigns = campaignBudgetData.filter((c) => c.isOverBudget)
    if (overBudgetCampaigns.length > 0) {
      alerts.push({
        type: 'over_budget',
        severity: 'critical',
        message: `${overBudgetCampaigns.length} 个Campaign超出预算`,
        campaigns: overBudgetCampaigns.map((c) => ({
          id: c.campaign_id,
          name: c.campaign_name,
          overBy: parseFloat((c.spent - c.budget).toFixed(2)),
        })),
      })
    }

    // 接近预算的Campaign
    const nearBudgetCampaigns = campaignBudgetData.filter((c) => c.isNearBudget)
    if (nearBudgetCampaigns.length > 0) {
      alerts.push({
        type: 'near_budget',
        severity: 'warning',
        message: `${nearBudgetCampaigns.length} 个Campaign接近预算限制`,
        campaigns: nearBudgetCampaigns.map((c) => ({
          id: c.campaign_id,
          name: c.campaign_name,
          remaining: c.remaining,
          daysRemaining: c.daysRemaining,
        })),
      })
    }

    // 预算利用率过低
    const underutilizedCampaigns = campaignBudgetData.filter(
      (c) => c.utilizationRate < 20 && c.budget > 100
    )
    if (underutilizedCampaigns.length > 0) {
      alerts.push({
        type: 'underutilized',
        severity: 'info',
        message: `${underutilizedCampaigns.length} 个Campaign预算利用率过低`,
        campaigns: underutilizedCampaigns.map((c) => ({
          id: c.campaign_id,
          name: c.campaign_name,
          utilizationRate: c.utilizationRate,
        })),
      })
    }

    // 6. 预算优化建议
    const recommendations: any[] = []

    // 建议增加高ROI Campaign的预算
    const highRoiCampaigns = campaignBudgetData
      .filter((c) => c.conversions > 10 && c.utilizationRate > 90)
      .slice(0, 3)
    if (highRoiCampaigns.length > 0) {
      recommendations.push({
        type: 'increase_budget',
        message: '建议增加高转化Campaign的预算',
        campaigns: highRoiCampaigns.map((c) => c.campaign_name),
      })
    }

    // 建议暂停低效Campaign
    const lowPerformanceCampaigns = campaignBudgetData
      .filter((c) => c.conversions === 0 && c.spent > 50)
      .slice(0, 3)
    if (lowPerformanceCampaigns.length > 0) {
      recommendations.push({
        type: 'pause_campaign',
        message: '建议暂停或优化零转化Campaign',
        campaigns: lowPerformanceCampaigns.map((c) => c.campaign_name),
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        overall: {
          totalBudget: parseFloat(totalBudget.toFixed(2)),
          totalSpent: parseFloat(totalSpent.toFixed(2)),
          remaining: parseFloat(remaining.toFixed(2)),
          utilizationRate: parseFloat(utilizationRate.toFixed(2)),
          dailyAvgSpend: parseFloat(dailyAvgSpend.toFixed(2)),
          projectedTotalSpend: parseFloat(projectedTotalSpend.toFixed(2)),
          activeCampaigns: overallBudget.active_campaigns || 0,
        },
        byCampaign: campaignBudgetData,
        trend: budgetTrendData,
        byOffer: budgetByOfferData,
        alerts,
        recommendations,
      },
    })
  } catch (error: any) {
    console.error('获取预算分析数据失败:', error)
    return NextResponse.json(
      { error: '获取预算分析数据失败', message: error.message },
      { status: 500 }
    )
  }
}
