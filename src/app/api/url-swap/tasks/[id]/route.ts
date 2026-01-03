// GET /api/url-swap/tasks/[id] - 获取任务详情
// PUT /api/url-swap/tasks/[id] - 更新任务配置
// DELETE /api/url-swap/tasks/[id] - 删除任务

import { NextRequest, NextResponse } from 'next/server';
import { getUrlSwapTaskById, updateUrlSwapTask, disableUrlSwapTask, enableUrlSwapTask } from '@/lib/url-swap';
import { getUrlSwapTaskStats } from '@/lib/url-swap';
import { triggerUrlSwapScheduling } from '@/lib/url-swap-scheduler';
import type { UpdateUrlSwapTaskRequest } from '@/lib/url-swap-types';

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET - 获取任务详情
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const task = await getUrlSwapTaskById(id, parseInt(userId));
    if (!task) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    // 获取统计信息
    const stats = await getUrlSwapTaskStats(id, parseInt(userId));

    return NextResponse.json({
      task,
      stats
    });

  } catch (error: any) {
    console.error('[url-swap] 获取任务详情失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取任务详情失败: ' + error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT - 更新任务配置
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    // 验证任务存在
    const existingTask = await getUrlSwapTaskById(id, parseInt(userId));
    if (!existingTask) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    // 解析请求体
    const rawBody = await request.text();
    if (!rawBody) {
      return NextResponse.json(
        { error: 'validation_error', message: '请求体为空' },
        { status: 400 }
      );
    }

    let body: UpdateUrlSwapTaskRequest;
    try {
      body = JSON.parse(rawBody) as UpdateUrlSwapTaskRequest;
    } catch (parseError: any) {
      return NextResponse.json(
        { error: 'validation_error', message: 'JSON格式错误: ' + parseError.message },
        { status: 400 }
      );
    }

    // 更新任务
    const task = await updateUrlSwapTask(id, parseInt(userId), body);

    console.log(`[url-swap] 更新任务成功: ${id}`);

    return NextResponse.json({
      success: true,
      task,
      message: '任务更新成功'
    });

  } catch (error: any) {
    console.error('[url-swap] 更新任务失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '更新任务失败: ' + error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 删除任务
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    // 验证任务存在
    const existingTask = await getUrlSwapTaskById(id, parseInt(userId));
    if (!existingTask) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    // 软删除任务
    const db = await getDatabase();
    const now = new Date().toISOString();
    await db.exec(`
      UPDATE url_swap_tasks
      SET is_deleted = 1, deleted_at = ?, updated_at = ?
      WHERE id = ?
    `, [now, now, id]);

    console.log(`[url-swap] 删除任务成功: ${id}`);

    return NextResponse.json({
      success: true,
      message: '任务删除成功'
    });

  } catch (error: any) {
    console.error('[url-swap] 删除任务失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '删除任务失败: ' + error.message },
      { status: 500 }
    );
  }
}

declare function getDatabase(): Promise<{
  exec(sql: string, params?: any[]): Promise<{ changes: number }>
}>
