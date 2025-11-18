import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/database'

/**
 * 趋势数据点
 */
interface TrendDataPoint {
  date: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  ctr: number
  cpc: number
  conversionRate: number
}

/**
 * GET /api/dashboard/trends
 * 获取趋势数据（折线图用）
 * Query参数：
 * - days: 统计天数（7/30/90，默认7）
 * - metrics: 需要的指标（逗号分隔，默认全部）
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.id

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '7', 10)
    const metricsParam = searchParams.get('metrics')

    // 验证days参数
    if (![7, 30, 90].includes(days)) {
      return NextResponse.json(
        { error: 'days参数必须是7、30或90' },
        { status: 400 }
      )
    }

    // 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const db = getDatabase()

    // 查询每日数据
    const query = `
      SELECT
        date,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost) as cost,
        SUM(conversions) as conversions
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY date
      ORDER BY date ASC
    `

    const rawData = db
      .prepare(query)
      .all(userId, formatDate(startDate), formatDate(endDate)) as Array<{
      date: string
      impressions: number
      clicks: number
      cost: number
      conversions: number
    }>

    // 计算派生指标
    const trends: TrendDataPoint[] = rawData.map((row) => {
      const ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0
      const cpc = row.clicks > 0 ? row.cost / row.clicks : 0
      const conversionRate =
        row.clicks > 0 ? (row.conversions / row.clicks) * 100 : 0

      return {
        date: row.date,
        impressions: row.impressions,
        clicks: row.clicks,
        cost: row.cost,
        conversions: row.conversions,
        ctr: parseFloat(ctr.toFixed(2)),
        cpc: parseFloat(cpc.toFixed(2)),
        conversionRate: parseFloat(conversionRate.toFixed(2)),
      }
    })

    // 如果指定了特定指标，只返回这些指标
    let filteredTrends = trends
    if (metricsParam) {
      const requestedMetrics = metricsParam.split(',').map((m) => m.trim())
      filteredTrends = trends.map((point) => {
        const filtered: any = { date: point.date }
        requestedMetrics.forEach((metric) => {
          if (metric in point) {
            filtered[metric] = point[metric as keyof TrendDataPoint]
          }
        })
        return filtered
      })
    }

    // 计算汇总统计
    const summary = {
      totalImpressions: trends.reduce((sum, p) => sum + p.impressions, 0),
      totalClicks: trends.reduce((sum, p) => sum + p.clicks, 0),
      totalCost: trends.reduce((sum, p) => sum + p.cost, 0),
      totalConversions: trends.reduce((sum, p) => sum + p.conversions, 0),
      avgCtr:
        trends.length > 0
          ? trends.reduce((sum, p) => sum + p.ctr, 0) / trends.length
          : 0,
      avgCpc:
        trends.length > 0
          ? trends.reduce((sum, p) => sum + p.cpc, 0) / trends.length
          : 0,
      avgConversionRate:
        trends.length > 0
          ? trends.reduce((sum, p) => sum + p.conversionRate, 0) /
            trends.length
          : 0,
    }

    return NextResponse.json({
      success: true,
      data: {
        trends: filteredTrends,
        summary,
        period: {
          start: formatDate(startDate),
          end: formatDate(endDate),
          days,
        },
      },
    })
  } catch (error) {
    console.error('获取趋势数据失败:', error)
    return NextResponse.json(
      {
        error: '获取趋势数据失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}
