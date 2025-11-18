import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/database'

/**
 * KPI数据响应
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

    const userId = authResult.user.id

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '7', 10)

    // 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const previousEndDate = new Date(startDate)
    previousEndDate.setDate(previousEndDate.getDate() - 1)
    const previousStartDate = new Date(previousEndDate)
    previousStartDate.setDate(previousStartDate.getDate() - days)

    const db = getDatabase()

    // 查询当前周期数据
    const currentPeriodQuery = `
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

    const currentData = db
      .prepare(currentPeriodQuery)
      .get(
        userId,
        formatDate(startDate),
        formatDate(endDate)
      ) as {
      impressions: number | null
      clicks: number | null
      cost: number | null
      conversions: number | null
    } | undefined

    // 查询上个周期数据（用于环比）
    const previousData = db
      .prepare(currentPeriodQuery)
      .get(
        userId,
        formatDate(previousStartDate),
        formatDate(previousEndDate)
      ) as {
      impressions: number | null
      clicks: number | null
      cost: number | null
      conversions: number | null
    } | undefined

    // 处理数据
    const current = {
      impressions: currentData?.impressions || 0,
      clicks: currentData?.clicks || 0,
      cost: currentData?.cost || 0,
      conversions: currentData?.conversions || 0,
      ctr: 0,
      cpc: 0,
      conversionRate: 0,
    }

    const previous = {
      impressions: previousData?.impressions || 0,
      clicks: previousData?.clicks || 0,
      cost: previousData?.cost || 0,
      conversions: previousData?.conversions || 0,
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
      impressions: calculateChange(current.impressions, previous.impressions),
      clicks: calculateChange(current.clicks, previous.clicks),
      cost: calculateChange(current.cost, previous.cost),
      conversions: calculateChange(current.conversions, previous.conversions),
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

    return NextResponse.json({
      success: true,
      data: response,
    })
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
