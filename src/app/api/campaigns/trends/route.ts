import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

function normalizeCurrency(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized || 'USD'
}

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
    const requestedCurrency = normalizeCurrency(searchParams.get('currency'))

    const db = await getDatabase()

    // 2. 计算日期范围
    // 🔧 修复(2025-01-02): 当选择7天时，应该返回7天的数据（今天 + 过去6天 = 7天）
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack + 1)  // +1 确保包含今天，共 daysBack 天数据

    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // 3. 计算币种列表：默认选花费最高的币种，避免多币种混合汇总
    const currencyRows = await db.query<any>(
      `
      SELECT
        COALESCE(currency, 'USD') as currency,
        SUM(cost) as cost
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY COALESCE(currency, 'USD')
      ORDER BY cost DESC
      `,
      [userId, startDateStr, endDateStr]
    )

    const currencies = currencyRows
      .map((r) => normalizeCurrency(r.currency))
      .filter((v, idx, arr) => arr.indexOf(v) === idx)

    const hasMixedCurrency = currencies.length > 1
    const reportingCurrency =
      currencies.includes(requestedCurrency)
        ? requestedCurrency
        : (currencies[0] || 'USD')

    // 4. 查询每日趋势数据（按币种过滤，避免混币种汇总）
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
        AND COALESCE(currency, 'USD') = ?
      GROUP BY DATE(date)
      ORDER BY date ASC
      `,
      [userId, startDateStr, endDateStr, reportingCurrency]
    )

    // 5. 格式化数据（正确计算加权CTR/转化率/CPC/CPA）
    const formattedTrends = trends.map((row) => {
      const impressions = Number(row.impressions) || 0
      const clicks = Number(row.clicks) || 0
      const conversions = Number(row.conversions) || 0
      const cost = Number(row.cost) || 0

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

    // 6. 返回结果
    return NextResponse.json({
      success: true,
      trends: formattedTrends,
      dateRange: {
        start: startDateStr,
        end: endDateStr,
        days: daysBack,
      },
      summary: {
        currency: reportingCurrency,
        currencies,
        hasMixedCurrency,
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
