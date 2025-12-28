// GET /api/admin/click-farm/stats - 管理员全局统计

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    const userRole = request.headers.get('x-user-role');
    if (!userId || userRole !== 'admin') {
      return NextResponse.json(
        { error: 'forbidden', message: '需要管理员权限' },
        { status: 403 }
      );
    }

    const db = await getDatabase();

    // 全局统计
    const global = await db.queryOne<any>(`
      SELECT
        COUNT(*) as total_tasks,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as active_tasks,
        COALESCE(SUM(total_clicks), 0) as total_clicks,
        COALESCE(SUM(success_clicks), 0) as success_clicks,
        COALESCE(SUM(failed_clicks), 0) as failed_clicks
      FROM click_farm_tasks
    `, []);

    const successRate = global.total_clicks > 0
      ? (global.success_clicks / global.total_clicks) * 100
      : 0;

    // 今日流量
    const today = await db.queryOne<any>(`
      SELECT COALESCE(SUM(total_clicks), 0) as clicks
      FROM click_farm_tasks
      WHERE DATE(started_at) = DATE('now')
    `, []);

    // 🆕 任务状态分布统计（不含已删除任务）
    const statusDistribution = await db.query<{ status: string; count: number }>(`
      SELECT status, COUNT(*) as count
      FROM click_farm_tasks
      WHERE is_deleted = 0
      GROUP BY status
    `, []);

    // 构建状态分布对象
    const taskStatusDistribution = {
      pending: 0,
      running: 0,
      paused: 0,
      stopped: 0,
      completed: 0,
      total: 0
    };

    statusDistribution.forEach(row => {
      const status = row.status as 'pending' | 'running' | 'paused' | 'stopped' | 'completed';
      taskStatusDistribution[status] = row.count;
      taskStatusDistribution.total += row.count;
    });

    return NextResponse.json({
      success: true,
      data: {
        total_tasks: global.total_tasks,
        active_tasks: global.active_tasks,
        total_clicks: global.total_clicks,
        success_clicks: global.success_clicks,
        success_rate: parseFloat(successRate.toFixed(1)),
        today_clicks: today.clicks,
        today_traffic: today.clicks * 200,
        total_traffic: global.total_clicks * 200,
        taskStatusDistribution  // 🆕 任务状态分布
      }
    });

  } catch (error) {
    console.error('获取管理员统计失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取统计失败' },
      { status: 500 }
    );
  }
}
