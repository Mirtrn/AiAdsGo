// GET /api/click-farm/tasks/[id] - 获取任务详情
// PUT /api/click-farm/tasks/[id] - 更新任务
// DELETE /api/click-farm/tasks/[id] - 删除任务

import { NextRequest, NextResponse } from 'next/server';
import {
  getClickFarmTaskById,
  updateClickFarmTask,
  deleteClickFarmTask
} from '@/lib/click-farm';
import { validateDistribution } from '@/lib/click-farm/distribution';
import { triggerTaskScheduling } from '@/lib/click-farm/click-farm-scheduler-trigger';
import type { UpdateClickFarmTaskRequest } from '@/lib/click-farm-types';

/**
 * GET - 获取任务详情
 */
export async function GET(
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

    return NextResponse.json({
      success: true,
      data: task
    });

  } catch (error) {
    console.error('获取任务详情失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取任务详情失败' },
      { status: 500 }
    );
  }
}

/**
 * PUT - 更新任务
 */
export async function PUT(
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

    // 只有pending和running状态的任务可以更新
    if (!['pending', 'running'].includes(task.status)) {
      return NextResponse.json(
        { error: 'invalid_status', message: '只能更新pending或running状态的任务' },
        { status: 400 }
      );
    }

    const body = await request.json() as UpdateClickFarmTaskRequest;

    // 验证每日点击数范围
    if (body.daily_click_count !== undefined) {
      if (body.daily_click_count < 1 || body.daily_click_count > 1000) {
        return NextResponse.json(
          { error: 'validation_error', message: '每日点击数必须在1-1000之间' },
          { status: 400 }
        );
      }
    }

    // 验证分布总和
    if (body.hourly_distribution) {
      const targetCount = body.daily_click_count || task.daily_click_count;
      const validation = validateDistribution(body.hourly_distribution, targetCount);
      if (!validation.valid) {
        return NextResponse.json(
          { error: 'validation_error', message: validation.error },
          { status: 400 }
        );
      }
    }

    const updatedTask = await updateClickFarmTask(params.id, parseInt(userId!), body);

    // 🔧 修复：更新任务参数后重新触发调度，使新参数立即生效
    // 但如果任务是 pending 状态且 scheduled_start_date 是未来日期，不触发调度
    let triggerResult = null;
    if (updatedTask.status === 'running') {
      // 如果任务已在运行，直接触发调度（新参数立即生效）
      try {
        triggerResult = await triggerTaskScheduling(updatedTask.id);
        console.log(`[UpdateTask] 任务 ${updatedTask.id} 参数已更新，重新调度结果:`, triggerResult);
      } catch (error) {
        console.error(`[UpdateTask] 任务 ${updatedTask.id} 重新调度失败:`, error);
        // 调度失败不影响更新成功返回
      }
    } else if (updatedTask.status === 'pending') {
      // pending 状态检查是否需要触发
      const { getDateInTimezone } = await import('@/lib/timezone-utils');
      const todayInTaskTimezone = getDateInTimezone(new Date(), updatedTask.timezone);
      if (updatedTask.scheduled_start_date === todayInTaskTimezone) {
        // 今天开始的任务，立即触发
        try {
          triggerResult = await triggerTaskScheduling(updatedTask.id);
          console.log(`[UpdateTask] 任务 ${updatedTask.id} 已更新，触发调度:`, triggerResult);
        } catch (error) {
          console.error(`[UpdateTask] 任务 ${updatedTask.id} 调度失败:`, error);
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        task: updatedTask,
        trigger: triggerResult
      }
    });

  } catch (error) {
    console.error('更新任务失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '更新任务失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 删除任务（软删除）
 */
export async function DELETE(
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

    await deleteClickFarmTask(params.id, parseInt(userId!));

    return NextResponse.json({
      success: true,
      message: '任务已删除'
    });

  } catch (error) {
    console.error('删除任务失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '删除任务失败' },
      { status: 500 }
    );
  }
}
