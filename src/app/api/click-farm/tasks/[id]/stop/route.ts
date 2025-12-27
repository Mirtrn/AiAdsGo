// POST /api/click-farm/tasks/[id]/stop - 停止任务

import { NextRequest, NextResponse } from 'next/server';
import { getClickFarmTaskById, stopClickFarmTask } from '@/lib/click-farm';

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

    if (!['pending', 'running', 'paused'].includes(task.status)) {
      return NextResponse.json(
        { error: 'invalid_status', message: '任务当前状态无法停止' },
        { status: 400 }
      );
    }

    const updatedTask = await stopClickFarmTask(params.id, parseInt(userId!));

    return NextResponse.json({
      success: true,
      data: updatedTask,
      message: '任务已停止'
    });

  } catch (error) {
    console.error('停止任务失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '停止任务失败' },
      { status: 500 }
    );
  }
}
