// GET /api/click-farm/stats - 获取统计数据

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getClickFarmStats } from '@/lib/click-farm';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const stats = await getClickFarmStats(session.user.id);

    return NextResponse.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('获取统计数据失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取统计数据失败' },
      { status: 500 }
    );
  }
}
