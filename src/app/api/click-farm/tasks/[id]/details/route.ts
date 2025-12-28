// GET /api/click-farm/tasks/[id]/details - 获取任务详情（包含历史记录和offer信息）
// src/app/api/click-farm/tasks/[id]/details/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { estimateTraffic } from '@/lib/click-farm/distribution';
import type { ClickFarmTask } from '@/lib/click-farm-types';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = getDatabase();

    // 查询任务详情（包含offer信息）
    const task = await db.queryOne<any>(`
      SELECT
        t.*,
        o.name as offer_name,
        o.brand_name,
        o.target_country,
        o.affiliate_link
      FROM click_farm_tasks t
      LEFT JOIN offers o ON t.offer_id = o.id
      WHERE t.id = ? AND t.user_id = ? AND t.is_deleted = 0
    `, [id, parseInt(userId)]);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // 解析JSON字段
    const hourlyDistribution = JSON.parse(task.hourly_distribution || '[]');
    const dailyHistory = JSON.parse(task.daily_history || '[]');

    // 计算额外的统计信息
    const successRate = task.total_clicks > 0
      ? (task.success_clicks / task.total_clicks) * 100
      : 0;

    // 🔧 修复NEW-5：统一使用与stats API相同的流量估算值（使用estimateTraffic函数）
    const totalTraffic = estimateTraffic(task.total_clicks);

    // 计算任务时长
    const startDate = task.started_at ? new Date(task.started_at) : null;
    const endDate = task.completed_at ? new Date(task.completed_at) : task.status === 'running' ? new Date() : null;
    const durationMs = startDate && endDate ? endDate.getTime() - startDate.getTime() : 0;
    const durationDays = durationMs > 0 ? Math.floor(durationMs / (1000 * 60 * 60 * 24)) : 0;
    const durationHours = durationMs > 0 ? Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) : 0;

    // 组装响应数据
    const response = {
      task: {
        ...task,
        hourly_distribution: hourlyDistribution,
        daily_history: dailyHistory,
        is_deleted: Boolean(task.is_deleted),
      },
      statistics: {
        success_rate: parseFloat(successRate.toFixed(2)),
        total_traffic: totalTraffic,
        duration_days: durationDays,
        duration_hours: durationHours,
        avg_daily_clicks: dailyHistory.length > 0
          ? Math.round(dailyHistory.reduce((sum: number, day: any) => sum + day.actual, 0) / dailyHistory.length)
          : 0,
        best_day: dailyHistory.length > 0
          ? dailyHistory.reduce((max: any, day: any) => day.actual > (max?.actual || 0) ? day : max, null)
          : null,
        worst_day: dailyHistory.length > 0
          ? dailyHistory.reduce((min: any, day: any) => day.actual < (min?.actual || Infinity) ? day : min, null)
          : null,
      },
      offer: {
        id: task.offer_id,
        name: task.offer_name,
        brand_name: task.brand_name,
        target_country: task.target_country,
        affiliate_link: task.affiliate_link,
      },
    };

    return NextResponse.json({ success: true, data: response });
  } catch (error: any) {
    console.error('Failed to fetch task details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch task details', message: error.message },
      { status: 500 }
    );
  }
}
