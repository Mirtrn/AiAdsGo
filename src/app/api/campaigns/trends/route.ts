import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/campaigns/trends
 *
 * 获取所有Campaigns的趋势数据（按日期聚合）
 *
 * Query Parameters:
 * - daysBack: number (可选，默认7天)
 */
export async function GET(request: NextRequest) {
  try {
    // 1. 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '7')

    const db = getDatabase()

    // 2. 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)

    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // 3. 查询每日趋势数据
    const trends = db
      .prepare(
        `
      SELECT
        DATE(date) as date,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(conversions) as conversions,
        SUM(cost) as cost,
        AVG(ctr) as ctr,
        AVG(conversion_rate) as conversionRate
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY DATE(date)
      ORDER BY date ASC
    `
      )
      .all(userId, startDateStr, endDateStr) as any[]

    // 4. 格式化数据
    const formattedTrends = trends.map((row) => ({
      date: row.date,
      impressions: row.impressions || 0,
      clicks: row.clicks || 0,
      conversions: row.conversions || 0,
      cost: Math.round((row.cost || 0) * 100) / 100,
      ctr: Math.round((row.ctr || 0) * 10000) / 100, // 转换为百分比
      conversionRate: Math.round((row.conversionRate || 0) * 10000) / 100, // 转换为百分比
      avgCpc: row.clicks > 0 ? Math.round((row.cost / row.clicks) * 100) / 100 : 0,
    }))

    // 5. 返回结果
    return NextResponse.json({
      success: true,
      trends: formattedTrends,
      dateRange: {
        start: startDateStr,
        end: endDateStr,
        days: daysBack,
      },
    })
  } catch (error: any) {
    console.error('Get campaigns trends error:', error)
    return NextResponse.json(
      { error: error.message || '获取趋势数据失败' },
      { status: 500 }
    )
  }
}
