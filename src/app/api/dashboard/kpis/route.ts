import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { apiCache, generateCacheKey } from '@/lib/api-cache'

/**
 * KPI数据响应
 * 🔧 修复(2025-12-30): 添加货币信息支持多货币账户
 */
interface KPIData {
  current: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
    ctr: number
    cpc: number
    conversionRate: number
    currency?: string // 单一货币时的货币代码
    costs?: Array<{ currency: string; amount: number }> // 多货币时的详细信息
  }
  previous: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
  }
  changes: {
    impressions: number // 百分比变化
    clicks: number
    cost: number
    conversions: number
  }
  period: {
    current: { start: string; end: string }
    previous: { start: string; end: string }
  }
}

/**
 * GET /api/dashboard/kpis
 * 获取核心KPI指标（展示、点击、花费、转化）
 * Query参数：
 * - days: 统计天数（默认7天）
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '7', 10)

    // 尝试从缓存获取
    const cacheKey = generateCacheKey('kpis', userId, { days })
    const cached = apiCache.get<{ success: boolean; data: KPIData }>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const previousEndDate = new Date(startDate)
    previousEndDate.setDate(previousEndDate.getDate() - 1)
    const previousStartDate = new Date(previousEndDate)
    previousStartDate.setDate(previousStartDate.getDate() - days)

    const db = await getDatabase()

    // 🔧 修复(2025-12-30): 查询货币分布以支持多货币账户
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

    // 查询当前周期数据
    // 🔧 修复(2025-12-30): 按货币分组以支持多货币场景
    // 🔧 修复(2025-12-30): PostgreSQL GROUP BY兼容性 - 单货币场景不SELECT currency字段
    const currentPeriodQuery = isMultiCurrency ? `
      SELECT
        currency,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost) as cost,
        SUM(conversions) as conversions
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY currency
    ` : `
      SELECT
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost) as cost,
        SUM(conversions) as conversions
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
      conversions: number | null
    }>

    // 查询上个周期数据（用于环比）
    const previousPeriodQuery = `
      SELECT
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost) as cost,
        SUM(conversions) as conversions
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
      conversions: number | null
    } | undefined

    // 处理数据
    // 🔧 修复(2025-12-30): 聚合多货币数据
    const totalImpressions = currentData.reduce((sum, row) => sum + (Number(row?.impressions) || 0), 0)
    const totalClicks = currentData.reduce((sum, row) => sum + (Number(row?.clicks) || 0), 0)
    const totalCost = currentData.reduce((sum, row) => sum + (Number(row?.cost) || 0), 0)
    const totalConversions = currentData.reduce((sum, row) => sum + (Number(row?.conversions) || 0), 0)

    const current = {
      impressions: totalImpressions,
      clicks: totalClicks,
      cost: totalCost,
      conversions: totalConversions,
      ctr: 0,
      cpc: 0,
      conversionRate: 0,
      // 货币信息
      currency: isSingleCurrency ? uniqueCurrencies[0] : (isMultiCurrency ? 'MIXED' : 'USD'),
      costs: isMultiCurrency
        ? currentData.map(row => ({
            currency: row.currency || 'USD',
            amount: Number(row.cost) || 0
          }))
        : undefined
    }

    const previous = {
      impressions: Number(previousData?.impressions) || 0,
      clicks: Number(previousData?.clicks) || 0,
      cost: Number(previousData?.cost) || 0,
      conversions: Number(previousData?.conversions) || 0,
    }

    // 计算派生指标
    if (current.impressions > 0) {
      current.ctr = (current.clicks / current.impressions) * 100
    }
    if (current.clicks > 0) {
      current.cpc = current.cost / current.clicks
      current.conversionRate = (current.conversions / current.clicks) * 100
    }

    // 计算环比变化（百分比）
    const calculateChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0
      return ((current - previous) / previous) * 100
    }

    const changes = {
      impressions: Number(calculateChange(current.impressions, previous.impressions)) || 0,
      clicks: Number(calculateChange(current.clicks, previous.clicks)) || 0,
      cost: Number(calculateChange(current.cost, previous.cost)) || 0,
      conversions: Number(calculateChange(current.conversions, previous.conversions)) || 0,
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

    const result = {
      success: true,
      data: response,
    }

    // 缓存结果（5分钟）
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
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}
