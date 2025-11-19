import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabaseManager } from '@/lib/db-admin'

/**
 * GET /api/dashboard/trends
 * 获取广告表现数据趋势
 * P2-1优化新增
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.valid || !authResult.payload) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.payload.userId

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const days = parseInt(searchParams.get('days') || '7', 10)

    // 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // 获取数据库实例
    const dbManager = getDatabaseManager()
    const db = dbManager.getDb()

    // 查询每日表现数据
    const query = `
      SELECT
        DATE(date) as date,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost) as cost,
        SUM(conversions) as conversions
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY DATE(date)
      ORDER BY date ASC
    `

    const rows = db
      .prepare(query)
      .all(
        userId,
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      ) as Array<{
      date: string
      impressions: number
      clicks: number
      cost: number
      conversions: number
    }>

    // 计算CTR和CPC
    const trends = rows.map((row) => ({
      date: row.date,
      impressions: row.impressions,
      clicks: row.clicks,
      cost: row.cost,
      conversions: row.conversions,
      ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
      cpc: row.clicks > 0 ? row.cost / row.clicks : 0,
    }))

    // 计算汇总数据
    const summary = {
      totalImpressions: rows.reduce((sum, row) => sum + row.impressions, 0),
      totalClicks: rows.reduce((sum, row) => sum + row.clicks, 0),
      totalCost: rows.reduce((sum, row) => sum + row.cost, 0),
      totalConversions: rows.reduce((sum, row) => sum + row.conversions, 0),
      avgCTR: 0,
      avgCPC: 0,
    }

    // 计算平均CTR和CPC
    if (summary.totalImpressions > 0) {
      summary.avgCTR = (summary.totalClicks / summary.totalImpressions) * 100
    }
    if (summary.totalClicks > 0) {
      summary.avgCPC = summary.totalCost / summary.totalClicks
    }

    return NextResponse.json({
      success: true,
      data: {
        trends,
        summary,
      },
    })
  } catch (error) {
    console.error('获取趋势数据失败:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    )
  }
}
