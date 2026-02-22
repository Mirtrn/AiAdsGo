import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

function normalizeCurrency(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized || 'USD'
}

function formatLocalYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeDateKey(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]

  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10)
  }

  return raw
}

/**
 * GET /api/campaigns/trends
 *
 * 获取所有 Campaign 的趋势数据（按日期聚合）
 * 转化口径改为佣金。
 *
 * Query Parameters:
 * - daysBack: number (可选，默认7天)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '7')
    const requestedCurrency = normalizeCurrency(searchParams.get('currency'))

    const db = await getDatabase()

    const endDate = new Date()
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - daysBack + 1)

    const startDateStr = formatLocalYmd(startDate)
    const endDateStr = formatLocalYmd(endDate)

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

    const adTrends = await db.query<any>(
      `
      SELECT
        DATE(date) as date,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
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

    const commissionTrends = await db.query<any>(
      `
      SELECT
        report_date as date,
        COALESCE(SUM(commission_amount), 0) as commission
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND report_date >= ?
        AND report_date <= ?
      GROUP BY report_date
      ORDER BY report_date ASC
      `,
      [userId, startDateStr, endDateStr]
    )

    const adMap = new Map<string, { impressions: number; clicks: number; cost: number }>()
    for (const row of adTrends) {
      const date = normalizeDateKey(row.date)
      adMap.set(date, {
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        cost: Number(row.cost) || 0,
      })
    }

    const commissionMap = new Map<string, number>()
    for (const row of commissionTrends) {
      const date = normalizeDateKey(row.date)
      commissionMap.set(date, Number(row.commission) || 0)
    }

    const dates = Array.from(new Set<string>([
      ...Array.from(adMap.keys()),
      ...Array.from(commissionMap.keys()),
    ])).sort((a, b) => a.localeCompare(b))

    const formattedTrends = dates.map((date) => {
      const ad = adMap.get(date)
      const impressions = ad?.impressions || 0
      const clicks = ad?.clicks || 0
      const cost = ad?.cost || 0
      const commission = commissionMap.get(date) || 0

      const commissionPerClick = clicks > 0 ? commission / clicks : 0
      const costPerCommission = commission > 0 ? cost / commission : 0

      return {
        date,
        impressions,
        clicks,
        conversions: roundTo2(commission),
        commission: roundTo2(commission),
        cost: roundTo2(cost),
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        conversionRate: roundTo2(commissionPerClick),
        commissionPerClick: roundTo2(commissionPerClick),
        avgCpc: clicks > 0 ? roundTo2(cost / clicks) : 0,
        avgCpa: roundTo2(costPerCommission),
        costPerCommission: roundTo2(costPerCommission),
      }
    })

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
