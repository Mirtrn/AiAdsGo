import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/dashboard/ai-token-cost
 * 获取AI Token成本统计数据
 */
export async function GET(request: NextRequest) {
  try {
    // 从header获取用户ID
    const userIdHeader = request.headers.get('x-user-id')
    if (!userIdHeader) {
      return NextResponse.json(
        { error: '缺少用户认证信息' },
        { status: 401 }
      )
    }

    const userId = parseInt(userIdHeader, 10)
    const searchParams = request.nextUrl.searchParams
    const days = parseInt(searchParams.get('days') || '7', 10)

    const db = getDatabase()
    const today = new Date().toISOString().split('T')[0]

    // 获取今日数据
    const todayData = await db.query<{
      model: string
      operation_type: string
      input_tokens: number
      output_tokens: number
      total_tokens: number
      cost: number
      call_count: number
    }>(
      `SELECT
        model,
        operation_type,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as cost,
        COUNT(*) as call_count
      FROM ai_token_usage
      WHERE user_id = ?
        AND date = ?
      GROUP BY model, operation_type
      ORDER BY cost DESC`,
      [userId, today]
    )

    // 计算今日总计
    const todayTotals = todayData.reduce(
      (acc, row) => ({
        totalCost: acc.totalCost + (row.cost || 0),
        totalTokens: acc.totalTokens + (row.total_tokens || 0),
        totalCalls: acc.totalCalls + (row.call_count || 0),
      }),
      { totalCost: 0, totalTokens: 0, totalCalls: 0 }
    )

    // 模型使用明细
    const modelUsageMap = new Map()
    for (const row of todayData) {
      const model = row.model
      if (!modelUsageMap.has(model)) {
        modelUsageMap.set(model, {
          model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: 0,
          callCount: 0,
        })
      }
      const modelData = modelUsageMap.get(model)
      modelData.inputTokens += row.input_tokens || 0
      modelData.outputTokens += row.output_tokens || 0
      modelData.totalTokens += row.total_tokens || 0
      modelData.cost += row.cost || 0
      modelData.callCount += row.call_count || 0
    }

    // 获取趋势数据（最近N天）
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    const startDateStr = startDate.toISOString().split('T')[0]

    const trendData = await db.query<{
      date: string
      total_tokens: number
      total_cost: number
    }>(
      `SELECT
        date,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost
      FROM ai_token_usage
      WHERE user_id = ?
        AND date >= ?
      GROUP BY date
      ORDER BY date DESC
      LIMIT ?`,
      [userId, startDateStr, days]
    )

    // 生成建议
    const recommendations = []
    if (todayTotals.totalCost > 100) {
      recommendations.push('⚠️ 今日AI成本较高，建议检查是否有不必要的重复调用')
    } else if (todayTotals.totalCost > 50) {
      recommendations.push('💡 今日AI成本中等，可以考虑优化prompt以减少token使用')
    } else {
      recommendations.push('✅ 今日AI成本正常，继续保持')
    }

    // 如果有flash模型使用，建议使用flash
    const hasProModel = Array.from(modelUsageMap.values()).some(m => m.model.includes('pro'))
    const hasFlashModel = Array.from(modelUsageMap.values()).some(m => m.model.includes('flash'))
    if (hasProModel && !hasFlashModel) {
      recommendations.push('💡 考虑在非关键场景使用flash模型以降低成本')
    }

    return NextResponse.json({
      success: true,
      data: {
        today: {
          totalCost: todayTotals.totalCost,
          totalTokens: todayTotals.totalTokens,
          totalCalls: todayTotals.totalCalls,
          modelUsage: Array.from(modelUsageMap.values()),
        },
        trend: trendData.map(row => ({
          date: row.date,
          totalTokens: row.total_tokens || 0,
          totalCost: row.total_cost || 0,
        })),
        recommendations,
      },
    })
  } catch (error: any) {
    console.error('获取AI Token成本数据失败:', error)
    return NextResponse.json(
      { error: '获取数据失败', message: error.message },
      { status: 500 }
    )
  }
}
