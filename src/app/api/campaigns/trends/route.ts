import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { buildAffiliateUnattributedFailureFilter } from '@/lib/openclaw/affiliate-attribution-failures'

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

function parseYmdParam(value: string | null): string | null {
  if (!value) return null
  const normalized = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null

  const [year, month, day] = normalized.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null
  }

  return normalized
}

function diffDaysInclusive(startYmd: string, endYmd: string): number {
  const startTs = Date.parse(`${startYmd}T00:00:00Z`)
  const endTs = Date.parse(`${endYmd}T00:00:00Z`)
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return 1
  return Math.max(1, Math.floor((endTs - startTs) / (24 * 60 * 60 * 1000)) + 1)
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
 * - start_date: string (可选，YYYY-MM-DD)
 * - end_date: string (可选，YYYY-MM-DD)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const rawDaysBack = parseInt(searchParams.get('daysBack') || '7', 10)
    const daysBack = Number.isFinite(rawDaysBack) ? Math.min(Math.max(rawDaysBack, 1), 3650) : 7
    const startDateQuery = parseYmdParam(searchParams.get('start_date'))
    const endDateQuery = parseYmdParam(searchParams.get('end_date'))
    const hasCustomRangeQuery = searchParams.has('start_date') || searchParams.has('end_date')
    if (hasCustomRangeQuery) {
      if (!startDateQuery || !endDateQuery) {
        return NextResponse.json(
          { error: 'start_date 和 end_date 必须同时提供，且格式为 YYYY-MM-DD' },
          { status: 400 }
        )
      }
      if (startDateQuery > endDateQuery) {
        return NextResponse.json(
          { error: 'start_date 不能晚于 end_date' },
          { status: 400 }
        )
      }
    }
    const requestedCurrency = normalizeCurrency(searchParams.get('currency'))

    const db = await getDatabase()

    let startDateStr = startDateQuery || ''
    let endDateStr = endDateQuery || ''
    let rangeDays = daysBack
    if (!startDateStr || !endDateStr) {
      const endDate = new Date()
      const startDate = new Date(endDate)
      startDate.setDate(startDate.getDate() - daysBack + 1)
      startDateStr = formatLocalYmd(startDate)
      endDateStr = formatLocalYmd(endDate)
      rangeDays = daysBack
    } else {
      rangeDays = diffDaysInclusive(startDateStr, endDateStr)
    }

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

    const queryAttributedCommissionTrends = async () => db.query<any>(
      `
      SELECT
        report_date as date,
        COALESCE(SUM(commission_amount), 0) as commission
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND report_date >= ?
        AND report_date <= ?
        AND COALESCE(currency, 'USD') = ?
      GROUP BY report_date
      ORDER BY report_date ASC
      `,
      [userId, startDateStr, endDateStr, reportingCurrency]
    )

    const queryUnattributedCommissionTrends = async (): Promise<any[]> => {
      const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter()
      try {
        return await db.query<any>(
          `
          SELECT
            report_date as date,
            COALESCE(SUM(commission_amount), 0) as commission
          FROM openclaw_affiliate_attribution_failures
          WHERE user_id = ?
            AND report_date >= ?
            AND report_date <= ?
            AND ${unattributedFailureFilter.sql}
            AND COALESCE(currency, 'USD') = ?
          GROUP BY report_date
          ORDER BY report_date ASC
          `,
          [userId, startDateStr, endDateStr, ...unattributedFailureFilter.values, reportingCurrency]
        )
      } catch (error: any) {
        const message = String(error?.message || '')
        if (
          /openclaw_affiliate_attribution_failures/i.test(message)
          && /(no such table|does not exist)/i.test(message)
        ) {
          return []
        }
        throw error
      }
    }

    const [attributedCommissionTrends, unattributedCommissionTrends] = await Promise.all([
      queryAttributedCommissionTrends(),
      queryUnattributedCommissionTrends(),
    ])

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
    const appendCommissionRows = (rows: any[]) => {
      for (const row of rows) {
        const date = normalizeDateKey(row.date)
        const commission = Number(row.commission) || 0
        commissionMap.set(date, (commissionMap.get(date) || 0) + commission)
      }
    }
    appendCommissionRows(attributedCommissionTrends)
    appendCommissionRows(unattributedCommissionTrends)

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
      const roas = cost > 0 ? commission / cost : 0

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
        roas: roundTo2(roas),
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
        days: rangeDays,
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
