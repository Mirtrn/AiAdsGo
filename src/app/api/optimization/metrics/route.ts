import { NextRequest, NextResponse } from 'next/server'
import { getSQLiteDatabase } from '@/lib/db'

/**
 * GET /api/optimization/metrics
 * 获取用户的优化指标（过去7天变化）
 * 数据通过 user_id 隔离
 */
export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const db = getSQLiteDatabase()

    // 获取过去7天和前7天的性能数据进行对比
    const today = new Date()
    const sevenDaysAgo = new Date(today)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const fourteenDaysAgo = new Date(today)
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

    const todayStr = today.toISOString().split('T')[0]
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]
    const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0]

    // 获取最近7天的汇总数据
    const recentStats = db.prepare(`
      SELECT
        COALESCE(SUM(cp.clicks), 0) as clicks,
        COALESCE(SUM(cp.impressions), 0) as impressions,
        COALESCE(SUM(cp.cost), 0) as cost,
        CASE
          WHEN SUM(cp.impressions) > 0
          THEN CAST(SUM(cp.clicks) AS REAL) / SUM(cp.impressions)
          ELSE 0
        END as ctr,
        CASE
          WHEN SUM(cp.clicks) > 0
          THEN CAST(SUM(cp.cost) AS REAL) / SUM(cp.clicks)
          ELSE 0
        END as cpc
      FROM campaign_performance cp
      JOIN campaigns c ON cp.campaign_id = c.id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
    `).get(parseInt(userId, 10), sevenDaysAgoStr, todayStr) as any

    // 获取前7天的汇总数据
    const previousStats = db.prepare(`
      SELECT
        COALESCE(SUM(cp.clicks), 0) as clicks,
        COALESCE(SUM(cp.impressions), 0) as impressions,
        COALESCE(SUM(cp.cost), 0) as cost,
        CASE
          WHEN SUM(cp.impressions) > 0
          THEN CAST(SUM(cp.clicks) AS REAL) / SUM(cp.impressions)
          ELSE 0
        END as ctr,
        CASE
          WHEN SUM(cp.clicks) > 0
          THEN CAST(SUM(cp.cost) AS REAL) / SUM(cp.clicks)
          ELSE 0
        END as cpc
      FROM campaign_performance cp
      JOIN campaigns c ON cp.campaign_id = c.id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date < ?
    `).get(parseInt(userId, 10), fourteenDaysAgoStr, sevenDaysAgoStr) as any

    // 计算变化率
    const calcChange = (recent: number, previous: number): number => {
      if (previous === 0) return recent > 0 ? 100 : 0
      return ((recent - previous) / previous) * 100
    }

    const ctrChange = calcChange(recentStats?.ctr || 0, previousStats?.ctr || 0)
    const cpcChange = calcChange(recentStats?.cpc || 0, previousStats?.cpc || 0)
    const impressionsChange = calcChange(recentStats?.impressions || 0, previousStats?.impressions || 0)
    const clicksChange = calcChange(recentStats?.clicks || 0, previousStats?.clicks || 0)

    // 获取优化任务统计（user_id 隔离）
    const taskStats = db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'pending' OR status = 'in_progress' THEN 1 END) as pending_tasks,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks
      FROM optimization_tasks
      WHERE user_id = ?
    `).get(parseInt(userId, 10)) as any

    // 计算成本节省（基于CPC下降）
    const costSavings = cpcChange < 0 ? Math.abs(cpcChange) * (recentStats?.cost || 0) / 100 : 0

    return NextResponse.json({
      success: true,
      metrics: {
        ctrChange: parseFloat(ctrChange.toFixed(2)),
        cpcChange: parseFloat(cpcChange.toFixed(2)),
        impressionsChange: parseFloat(impressionsChange.toFixed(2)),
        clicksChange: parseFloat(clicksChange.toFixed(2)),
        pendingTasks: taskStats?.pending_tasks || 0,
        completedTasks: taskStats?.completed_tasks || 0,
        costSavings: parseFloat(costSavings.toFixed(2)),
        lastUpdated: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error('获取优化指标失败:', error)
    return NextResponse.json(
      { error: error.message || '获取优化指标失败' },
      { status: 500 }
    )
  }
}
