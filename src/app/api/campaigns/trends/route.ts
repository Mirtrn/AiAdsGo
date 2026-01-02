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

    const db = await getDatabase()

    // 2. 计算日期范围
    // 🔧 修复(2025-01-02): 当选择7天时，应该返回7天的数据（今天 + 过去6天 = 7天）
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack + 1)  // +1 确保包含今天，共 daysBack 天数据

    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // 3. 查询每日趋势数据（修复：使用正确的加权计算而非简单平均）
    const trends = await db.query<any>(
      `
      SELECT
        DATE(date) as date,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(conversions) as conversions,
        SUM(cost) as cost
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY DATE(date)
      ORDER BY date ASC
      `,
      [userId, startDateStr, endDateStr]
    )

    // 4. 格式化数据（正确计算加权CTR/转化率/CPC/CPA）
    const formattedTrends = trends.map((row) => {
      const impressions = row.impressions || 0
      const clicks = row.clicks || 0
      const conversions = row.conversions || 0
      const cost = row.cost || 0

      return {
        date: row.date,
        impressions,
        clicks,
        conversions,
        cost: Math.round(cost * 100) / 100,
        // CTR = 点击数 / 展示数 * 100（正确的加权计算）
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        // 转化率 = 转化数 / 点击数 * 100（正确的加权计算）
        conversionRate: clicks > 0 ? Math.round((conversions / clicks) * 10000) / 100 : 0,
        // CPC = 花费 / 点击数
        avgCpc: clicks > 0 ? Math.round((cost / clicks) * 100) / 100 : 0,
        // CPA = 花费 / 转化数（新增）
        avgCpa: conversions > 0 ? Math.round((cost / conversions) * 100) / 100 : 0,
      }
    })

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
