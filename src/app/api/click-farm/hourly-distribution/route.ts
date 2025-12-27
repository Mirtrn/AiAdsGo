// GET /api/click-farm/hourly-distribution - 获取今日时间分布

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHourlyDistribution } from '@/lib/click-farm';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const distribution = await getHourlyDistribution(session.user.id);

    return NextResponse.json({
      success: true,
      data: distribution
    });

  } catch (error) {
    console.error('获取时间分布失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取时间分布失败' },
      { status: 500 }
    );
  }
}
