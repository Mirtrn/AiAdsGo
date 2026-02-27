import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { apiCache, generateCacheKey } from '@/lib/api-cache'
import { withPerformanceMonitoring } from '@/lib/api-performance'

/**
 * KPI数据响应
 * 转化口径改为佣金。
 */
interface KPIData {
  current: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
    commission: number
    roas: number | null
    roasInfinite: boolean
    ctr: number
    cpc: number
    conversionRate: number
    commissionPerClick: number
    currency?: string
    costs?: Array<{ currency: string; amount: number }>
  }
  previous: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
    commission: number
    roas: number | null
    roasInfinite: boolean
  }
  changes: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
    commission: number
    roas: number | null
    roasInfinite: boolean
  }
  period: {
    current: { start: string; end: string }
    previous: { start: string; end: string }
  }
}

// campaign_mapping_miss rows are already written into affiliate_commission_attributions (offer-level fallback).
// Counting them again from failure audit rows would double-count commission.
const EXCLUDED_UNATTRIBUTED_REASON_CODE = 'campaign_mapping_miss'

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function calculateRoas(commission: number, cost: number): { value: number | null; infinite: boolean } {
  const normalizedCommission = Number(commission) || 0
  const normalizedCost = Number(cost) || 0
  if (normalizedCost <= 0) {
    if (normalizedCommission > 0) {
      return { value: null, infinite: true }
    }
    return { value: 0, infinite: false }
  }

  return {
    value: roundTo2(normalizedCommission / normalizedCost),
    infinite: false,
  }
}

/**
 * GET /api/dashboard/kpis
 * 获取核心KPI指标（展示、点击、花费、佣金）
 * Query参数：
 * - days: 统计天数（默认7天）
 */
export async function GET(request: NextRequest) {
  return getHandler(request)
}

const getHandler = withPerformanceMonitoring<any>(async (request: NextRequest) => {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '7', 10)
    const refresh = searchParams.get('refresh') === 'true' || searchParams.get('noCache') === 'true'

    const cacheKey = generateCacheKey('kpis', userId, { days })
    if (!refresh) {
      const cached = apiCache.get<{ success: boolean; data: KPIData }>(cacheKey)
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const buildResult = async () => {
      const endDate = new Date()
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days + 1)

      const previousEndDate = new Date(startDate)
      previousEndDate.setDate(previousEndDate.getDate() - 1)
      const previousStartDate = new Date(previousEndDate)
      previousStartDate.setDate(previousStartDate.getDate() - days + 1)

      const db = await getDatabase()

      const currencyQuery = `
        SELECT DISTINCT currency
        FROM campaign_performance
        WHERE user_id = ?
          AND date >= ?
          AND date <= ?
      `
      const currencies = await db.query(
        currencyQuery,
        [userId, formatDate(startDate), formatDate(endDate)]
      ) as Array<{ currency: string }>

      const uniqueCurrencies = currencies.map(c => c.currency).filter(Boolean)
      const isSingleCurrency = uniqueCurrencies.length === 1
      const isMultiCurrency = uniqueCurrencies.length > 1

      const currentPeriodQuery = isMultiCurrency ? `
        SELECT
          currency,
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          SUM(cost) as cost
        FROM campaign_performance
        WHERE user_id = ?
          AND date >= ?
          AND date <= ?
        GROUP BY currency
      ` : `
        SELECT
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          SUM(cost) as cost
        FROM campaign_performance
        WHERE user_id = ?
          AND date >= ?
          AND date <= ?
      `

      const currentDataRaw = isMultiCurrency
        ? await db.query(currentPeriodQuery, [userId, formatDate(startDate), formatDate(endDate)])
        : [await db.queryOne(currentPeriodQuery, [userId, formatDate(startDate), formatDate(endDate)])]

      const currentData = currentDataRaw as Array<{
        currency?: string | null
        impressions: number | null
        clicks: number | null
        cost: number | null
      }>

      const previousPeriodQuery = `
        SELECT
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          SUM(cost) as cost
        FROM campaign_performance
        WHERE user_id = ?
          AND date >= ?
          AND date <= ?
      `

      const previousData = await db.queryOne(
        previousPeriodQuery,
        [
          userId,
          formatDate(previousStartDate),
          formatDate(previousEndDate)
        ]
      ) as {
        impressions: number | null
        clicks: number | null
        cost: number | null
      } | undefined

      const queryAttributedCommissionTotals = async (params: {
        start: string
        end: string
      }): Promise<number> => {
        const row = await db.queryOne<{ total_commission: number }>(
          `
            SELECT COALESCE(SUM(commission_amount), 0) AS total_commission
            FROM affiliate_commission_attributions
            WHERE user_id = ?
              AND report_date >= ?
              AND report_date <= ?
          `,
          [userId, params.start, params.end]
        )

        return Number(row?.total_commission) || 0
      }

      const queryUnattributedCommissionTotals = async (params: {
        start: string
        end: string
      }): Promise<number> => {
        try {
          const row = await db.queryOne<{ total_commission: number }>(
            `
              SELECT COALESCE(SUM(commission_amount), 0) AS total_commission
              FROM openclaw_affiliate_attribution_failures
              WHERE user_id = ?
                AND report_date >= ?
                AND report_date <= ?
                AND COALESCE(reason_code, '') <> ?
            `,
            [userId, params.start, params.end, EXCLUDED_UNATTRIBUTED_REASON_CODE]
          )

          return Number(row?.total_commission) || 0
        } catch (error: any) {
          const message = String(error?.message || '')
          if (
            /openclaw_affiliate_attribution_failures/i.test(message)
            && /(no such table|does not exist)/i.test(message)
          ) {
            return 0
          }
          throw error
        }
      }

      const currentAttributedCommissionTotal = await queryAttributedCommissionTotals({
        start: formatDate(startDate),
        end: formatDate(endDate),
      })
      const previousAttributedCommissionTotal = await queryAttributedCommissionTotals({
        start: formatDate(previousStartDate),
        end: formatDate(previousEndDate),
      })
      const currentUnattributedCommissionTotal = await queryUnattributedCommissionTotals({
        start: formatDate(startDate),
        end: formatDate(endDate),
      })
      const previousUnattributedCommissionTotal = await queryUnattributedCommissionTotals({
        start: formatDate(previousStartDate),
        end: formatDate(previousEndDate),
      })

      const totalImpressions = currentData.reduce((sum, row) => sum + (Number(row?.impressions) || 0), 0)
      const totalClicks = currentData.reduce((sum, row) => sum + (Number(row?.clicks) || 0), 0)
      const totalCost = currentData.reduce((sum, row) => sum + (Number(row?.cost) || 0), 0)
      const totalCommission = currentAttributedCommissionTotal + currentUnattributedCommissionTotal

      const current = {
        impressions: totalImpressions,
        clicks: totalClicks,
        cost: totalCost,
        conversions: totalCommission,
        commission: totalCommission,
        roas: null as number | null,
        roasInfinite: false,
        ctr: 0,
        cpc: 0,
        conversionRate: 0,
        commissionPerClick: 0,
        currency: isSingleCurrency ? uniqueCurrencies[0] : (isMultiCurrency ? 'MIXED' : 'USD'),
        costs: isMultiCurrency
          ? currentData.map(row => ({
              currency: row.currency || 'USD',
              amount: Number(row.cost) || 0
            }))
          : undefined
      }

      const previousCommission = previousAttributedCommissionTotal + previousUnattributedCommissionTotal
      const previous = {
        impressions: Number(previousData?.impressions) || 0,
        clicks: Number(previousData?.clicks) || 0,
        cost: Number(previousData?.cost) || 0,
        conversions: previousCommission,
        commission: previousCommission,
        roas: null as number | null,
        roasInfinite: false,
      }

      const roasAvailable = !isMultiCurrency
      if (roasAvailable) {
        const currentRoas = calculateRoas(current.commission, current.cost)
        const previousRoas = calculateRoas(previous.commission, previous.cost)
        current.roas = currentRoas.value
        current.roasInfinite = currentRoas.infinite
        previous.roas = previousRoas.value
        previous.roasInfinite = previousRoas.infinite
      }

      if (current.impressions > 0) {
        current.ctr = (current.clicks / current.impressions) * 100
      }
      if (current.clicks > 0) {
        current.cpc = current.cost / current.clicks
        current.conversionRate = current.commission / current.clicks
        current.commissionPerClick = current.commission / current.clicks
      }

      const calculateChange = (currentValue: number, previousValue: number): number => {
        if (previousValue === 0) return currentValue > 0 ? 100 : 0
        return ((currentValue - previousValue) / previousValue) * 100
      }

      const commissionChange = Number(calculateChange(current.commission, previous.commission)) || 0

      const changes = {
        impressions: Number(calculateChange(current.impressions, previous.impressions)) || 0,
        clicks: Number(calculateChange(current.clicks, previous.clicks)) || 0,
        cost: Number(calculateChange(current.cost, previous.cost)) || 0,
        conversions: commissionChange,
        commission: commissionChange,
        roas: null as number | null,
        roasInfinite: false,
      }

      if (roasAvailable) {
        if (current.roasInfinite) {
          changes.roasInfinite = true
        } else if (
          !previous.roasInfinite
          && typeof previous.roas === 'number'
          && previous.roas > 0
          && typeof current.roas === 'number'
        ) {
          changes.roas = roundTo2(((current.roas - previous.roas) / previous.roas) * 100)
        }
      }

      const response: KPIData = {
        current,
        previous,
        changes,
        period: {
          current: {
            start: formatDate(startDate),
            end: formatDate(endDate),
          },
          previous: {
            start: formatDate(previousStartDate),
            end: formatDate(previousEndDate),
          },
        },
      }

      return {
        success: true,
        data: response,
      }
    }

    if (!refresh) {
      const result = await apiCache.getOrSet(cacheKey, buildResult, 5 * 60 * 1000)
      return NextResponse.json(result)
    }

    const result = await buildResult()
    apiCache.set(cacheKey, result, 5 * 60 * 1000)
    return NextResponse.json(result)
  } catch (error) {
    console.error('获取KPI数据失败:', error)
    return NextResponse.json(
      {
        error: '获取KPI数据失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}, { path: '/api/dashboard/kpis' })

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
