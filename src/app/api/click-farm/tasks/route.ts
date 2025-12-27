// POST /api/click-farm/tasks - 创建补点击任务
// GET /api/click-farm/tasks - 获取任务列表

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createClickFarmTask, getClickFarmTasks } from '@/lib/click-farm';
import { generateDefaultDistribution, validateDistribution } from '@/lib/click-farm/distribution';
import type { CreateClickFarmTaskRequest, TaskFilters } from '@/lib/click-farm-types';
import { getDatabase } from '@/lib/db';

/**
 * POST - 创建补点击任务
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const body = await request.json() as CreateClickFarmTaskRequest;

    // 验证必填字段
    if (!body.offer_id || !body.daily_click_count) {
      return NextResponse.json(
        { error: 'validation_error', message: '缺少必填字段' },
        { status: 400 }
      );
    }

    // 验证每日点击数范围
    if (body.daily_click_count < 1 || body.daily_click_count > 1000) {
      return NextResponse.json(
        { error: 'validation_error', message: '每日点击数必须在1-1000之间' },
        { status: 400 }
      );
    }

    // 检查Offer是否存在且属于当前用户
    const db = await getDatabase();
    const offer = await db.get<any>(`
      SELECT id, affiliate_link, target_country
      FROM offers
      WHERE id = ? AND user_id = ?
    `, [body.offer_id, session.user.id]);

    if (!offer) {
      return NextResponse.json(
        { error: 'not_found', message: 'Offer不存在' },
        { status: 404 }
      );
    }

    // 检查代理配置
    const proxyConfig = await db.get<any>(`
      SELECT proxy_url
      FROM system_settings
      WHERE user_id = ? AND key = ?
    `, [session.user.id, `proxy_${offer.target_country.toLowerCase()}`]);

    if (!proxyConfig || !proxyConfig.proxy_url) {
      return NextResponse.json(
        {
          error: 'proxy_required',
          message: `未找到 ${offer.target_country} 国家的代理配置`,
          suggestion: '请先配置代理后再创建补点击任务',
          redirectTo: '/settings/proxy'
        },
        { status: 400 }
      );
    }

    // 如果未提供分布，生成默认分布
    let hourlyDistribution = body.hourly_distribution;
    if (!hourlyDistribution || hourlyDistribution.length !== 24) {
      hourlyDistribution = generateDefaultDistribution(
        body.daily_click_count,
        body.start_time || '06:00',
        body.end_time || '24:00'
      );
    } else {
      // 验证分布总和
      const validation = validateDistribution(hourlyDistribution, body.daily_click_count);
      if (!validation.valid) {
        return NextResponse.json(
          { error: 'validation_error', message: validation.error },
          { status: 400 }
        );
      }
    }

    // 创建任务
    const task = await createClickFarmTask(session.user.id, {
      ...body,
      hourly_distribution: hourlyDistribution
    });

    return NextResponse.json({
      success: true,
      data: {
        id: task.id,
        status: task.status,
        message: '补点击任务创建成功'
      }
    });

  } catch (error) {
    console.error('创建补点击任务失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '创建任务失败' },
      { status: 500 }
    );
  }
}

/**
 * GET - 获取任务列表
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const filters: TaskFilters = {
      status: searchParams.get('status') as any,
      offer_id: searchParams.get('offer_id') ? parseInt(searchParams.get('offer_id')!) : undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20
    };

    const result = await getClickFarmTasks(session.user.id, filters);

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('获取任务列表失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取任务列表失败' },
      { status: 500 }
    );
  }
}
