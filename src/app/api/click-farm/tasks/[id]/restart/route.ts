// POST /api/click-farm/tasks/[id]/restart - 重启任务

import { NextRequest, NextResponse } from 'next/server';
import { getClickFarmTaskById, restartClickFarmTask } from '@/lib/click-farm';
import { notifyTaskResumed } from '@/lib/click-farm/notifications';
import { getDatabase } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const task = await getClickFarmTaskById(params.id, parseInt(userId!));
    if (!task) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    if (!['stopped', 'paused'].includes(task.status)) {
      return NextResponse.json(
        { error: 'invalid_status', message: '只能重启stopped或paused状态的任务' },
        { status: 400 }
      );
    }

    // 如果是因为代理缺失而中止，需要检查代理是否已配置
    if (task.pause_reason === 'no_proxy') {
      const db = await getDatabase();
      const offer = await db.queryOne<any>(`
        SELECT target_country FROM offers WHERE id = ?
      `, [task.offer_id]);

      if (offer) {
        const proxyConfig = await db.queryOne<any>(`
          SELECT proxy_url
          FROM system_settings
          WHERE user_id = ? AND key = ?
        `, [parseInt(userId!), `proxy_${offer.target_country.toLowerCase()}`]);

        if (!proxyConfig || !proxyConfig.proxy_url) {
          return NextResponse.json(
            {
              error: 'proxy_required',
              message: `仍未找到 ${offer.target_country} 国家的代理配置`,
              suggestion: '请先配置代理后再重启任务',
              redirectTo: '/settings/proxy'
            },
            { status: 400 }
          );
        }
      }
    }

    const updatedTask = await restartClickFarmTask(params.id, parseInt(userId!));

    // 🔔 发送任务恢复通知
    await notifyTaskResumed(parseInt(userId!), params.id);

    return NextResponse.json({
      success: true,
      data: updatedTask,
      message: '任务已重启'
    });

  } catch (error) {
    console.error('重启任务失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '重启任务失败' },
      { status: 500 }
    );
  }
}
