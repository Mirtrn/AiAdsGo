// POST /api/click-farm/tasks/[id]/trigger - 手动触发任务立即执行
// src/app/api/click-farm/tasks/[id]/trigger/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { triggerTaskScheduling } from '@/lib/click-farm/click-farm-scheduler-trigger';
import { getDatabase } from '@/lib/db';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    console.log(`[API] 手动触发任务 ${id} 执行`);

    // 🔧 修复(2026-01-05): 不要清空 next_run_at，这会导致任务在每次 cron job 执行时被重复选中
    // 而是设置为一个过去的值，让任务立即执行一次，然后在 triggerTaskScheduling 中正确更新 next_run_at
    const db = getDatabase();
    // 🔧 PostgreSQL 语法：使用 INTERVAL
    await db.exec(`
      UPDATE click_farm_tasks
      SET next_run_at = NOW() - INTERVAL '1 hour', updated_at = NOW()
      WHERE id = ? AND user_id = ?
    `, [id, parseInt(userId)]);

    console.log(`[API] 已设置任务 ${id} 的 next_run_at 为过去时间，准备立即触发`);

    // 调用触发函数
    const result = await triggerTaskScheduling(id);

    console.log(`[API] 触发结果:`, result);

    // 根据结果返回响应
    if (result.status === 'error') {
      return NextResponse.json(
        {
          success: false,
          error: result.message || '触发任务失败'
        },
        { status: 400 }
      );
    }

    if (result.status === 'paused') {
      return NextResponse.json(
        {
          success: false,
          error: result.message || '任务已暂停',
          status: 'paused'
        },
        { status: 400 }
      );
    }

    if (result.status === 'completed') {
      return NextResponse.json({
        success: true,
        message: '任务已完成',
        data: result
      });
    }

    if (result.status === 'queued') {
      return NextResponse.json({
        success: true,
        message: `已加入${result.clickCount}个点击到队列`,
        data: result
      });
    }

    return NextResponse.json({
      success: true,
      message: result.message || '触发成功',
      data: result
    });

  } catch (error: any) {
    console.error('[API] 触发任务失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: '触发任务失败',
        message: error.message
      },
      { status: 500 }
    );
  }
}
