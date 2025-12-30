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

    // 🔧 修复(2025-12-30): 手动触发时清空next_run_at，让任务立即执行
    // 正常情况下，任务会等到next_run_at时间才执行
    // 手动触发应该忽略这个限制，立即执行
    const db = getDatabase();
    await db.exec(`
      UPDATE click_farm_tasks
      SET next_run_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `, [id, parseInt(userId)]);

    console.log(`[API] 已清空任务 ${id} 的next_run_at，准备立即触发`);

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
