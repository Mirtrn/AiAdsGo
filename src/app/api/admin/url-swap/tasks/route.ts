// GET /api/admin/url-swap/tasks - 获取所有任务列表（管理员）

import { NextRequest, NextResponse } from 'next/server';
import { getAllUrlSwapTasks } from '@/lib/url-swap';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // 解析查询参数
    const status = searchParams.get('status') as any;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const result = await getAllUrlSwapTasks({
      status: status || undefined,
      page,
      limit
    });

    return NextResponse.json({
      tasks: result.tasks,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit)
      }
    });

  } catch (error: any) {
    console.error('[admin/url-swap] 获取任务列表失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取任务列表失败: ' + error.message },
      { status: 500 }
    );
  }
}
