import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/dashboard/trends
 * 获取广告表现数据趋势
 * P2-1优化新增
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const days = parseInt(searchParams.get('days') || '7', 10)
    const requestedCurrencyRaw = searchParams.get('currency')
    const requestedCurrency = requestedCurrencyRaw ? requestedCurrencyRaw.trim().toUpperCase() : null

    // 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // 获取数据库实例
    const db = await getDatabase()

    // 查询货币分布（按花费排序，避免默认选择一个随机币种）
    const currencyRows = await db.query<any>(`
      SELECT
        COALESCE(currency, 'USD') as currency,
        COALESCE(SUM(cost), 0) as total_cost
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY COALESCE(currency, 'USD')
      ORDER BY total_cost DESC
    `, [userId, startDateStr, endDateStr])

    const currencies = Array.from(new Set(
      (currencyRows || [])
        .map((r: any) => String(r.currency || '').trim().toUpperCase())
        .filter(Boolean)
    ))

    const defaultCurrency = currencies.length > 0 ? currencies[0] : 'USD'
    const reportingCurrency = requestedCurrency && currencies.includes(requestedCurrency)
      ? requestedCurrency
      : defaultCurrency
    const hasMixedCurrency = currencies.length > 1

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
        AND COALESCE(currency, 'USD') = ?
      GROUP BY DATE(date)
      ORDER BY date ASC
    `

    const rows = await db.query(query, [
      userId,
      startDateStr,
      endDateStr,
      reportingCurrency
    ]) as Array<{
      date: string
      impressions: number
      clicks: number
      cost: number
      conversions: number
    }>

    // 计算CTR和CPC（✅ 修复：确保数值类型安全，处理NULL值）
    const trends = rows.map((row) => ({
      date: row.date,
      impressions: Number(row.impressions) || 0,
      clicks: Number(row.clicks) || 0,
      cost: Number(row.cost) || 0,
      conversions: Number(row.conversions) || 0,
      ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
      cpc: row.clicks > 0 ? (Number(row.cost) || 0) / row.clicks : 0,
    }))

    // 计算汇总数据（✅ 修复：确保reduce结果为number，处理NULL值）
    const summary = {
      totalImpressions: rows.reduce((sum, row) => sum + (Number(row.impressions) || 0), 0),
      totalClicks: rows.reduce((sum, row) => sum + (Number(row.clicks) || 0), 0),
      totalCost: rows.reduce((sum, row) => sum + (Number(row.cost) || 0), 0),
      totalConversions: rows.reduce((sum, row) => sum + (Number(row.conversions) || 0), 0),
      avgCTR: 0,
      avgCPC: 0,
      currency: reportingCurrency,
      currencies,
      hasMixedCurrency,
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
