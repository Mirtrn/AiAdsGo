// POST /api/click-farm/tasks - 创建补点击任务
// GET /api/click-farm/tasks - 获取任务列表

import { NextRequest, NextResponse } from 'next/server';
import { createClickFarmTask, getClickFarmTasks } from '@/lib/click-farm';
import { generateDefaultDistribution, validateDistribution } from '@/lib/click-farm/distribution';
import type { CreateClickFarmTaskRequest, TaskFilters } from '@/lib/click-farm-types';
import { getDatabase } from '@/lib/db';
import { getTimezoneByCountry, getDateInTimezone } from '@/lib/timezone-utils';
import { triggerTaskScheduling } from '@/lib/click-farm/click-farm-scheduler-trigger';
import { getAllProxyUrls } from '@/lib/settings';

/**
 * POST - 创建补点击任务
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const userIdNum = parseInt(userId);
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

    // 🆕 NEW-4：验证时间格式（如果提供了的话）
    const timeFormatRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$|^24:00$/;
    if (body.start_time && !timeFormatRegex.test(body.start_time)) {
      return NextResponse.json(
        { error: 'validation_error', message: '开始时间格式无效，请使用 HH:mm 或 HH:mm:ss 或 24:00' },
        { status: 400 }
      );
    }
    if (body.end_time && !timeFormatRegex.test(body.end_time)) {
      return NextResponse.json(
        { error: 'validation_error', message: '结束时间格式无效，请使用 HH:mm 或 HH:mm:ss 或 24:00' },
        { status: 400 }
      );
    }

    // 🆕 NEW-2：验证duration_days范围
    const durationDays = body.duration_days;
    if (durationDays !== undefined && durationDays !== null && durationDays !== -1) {
      if (durationDays < 1 || durationDays > 365) {
        return NextResponse.json(
          { error: 'validation_error', message: '任务天数必须在1-365天之间，或-1表示无限期' },
          { status: 400 }
        );
      }
    }

    // 检查Offer是否存在且属于当前用户
    const db = await getDatabase();
    const offer = await db.queryOne<any>(`
      SELECT id, affiliate_link, target_country
      FROM offers
      WHERE id = ? AND user_id = ?
    `, [body.offer_id, userIdNum]);

    if (!offer) {
      return NextResponse.json(
        { error: 'not_found', message: 'Offer不存在' },
        { status: 404 }
      );
    }

    // 🔧 修复(2025-12-28): 使用新的代理配置系统（proxy.urls JSON数组）
    const proxyUrls = await getAllProxyUrls(userIdNum);

    if (!proxyUrls || proxyUrls.length === 0) {
      return NextResponse.json(
        {
          error: 'proxy_required',
          message: '未配置任何代理',
          suggestion: '请先前往设置页面配置代理',
          redirectTo: '/settings'
        },
        { status: 400 }
      );
    }

    // 查找目标国家的代理配置
    const targetCountry = offer.target_country.toUpperCase();
    const proxyConfig = proxyUrls.find(
      (p) => p.country.toUpperCase() === targetCountry
    );

    if (!proxyConfig) {
      return NextResponse.json(
        {
          error: 'proxy_required',
          message: `未找到 ${offer.target_country} 国家的代理配置`,
          suggestion: '请先前往设置页面配置对应国家的代理',
          redirectTo: '/settings'
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

    // 🆕 如果没有提供timezone，从offer的target_country自动获取
    let timezone = body.timezone;
    if (!timezone) {
      timezone = getTimezoneByCountry(offer.target_country);
      console.log(`[CreateTask] 自动设置timezone: ${offer.target_country} → ${timezone}`);
    }

    // 创建任务
    const task = await createClickFarmTask(userIdNum, {
      ...body,
      hourly_distribution: hourlyDistribution,
      timezone  // 🆕 使用自动匹配的timezone
    });

    // 🆕 如果开始日期是今天，立即触发调度
    let triggerResult = null;
    const todayInTaskTimezone = getDateInTimezone(new Date(), timezone);
    const scheduledDate = task.scheduled_start_date || todayInTaskTimezone;

    if (scheduledDate === todayInTaskTimezone) {
      console.log(`[CreateTask] 任务 ${task.id} 开始日期是今天，触发调度...`);
      try {
        triggerResult = await triggerTaskScheduling(task.id);
        console.log(`[CreateTask] 任务 ${task.id} 调度结果:`, triggerResult);
      } catch (error) {
        console.error(`[CreateTask] 任务 ${task.id} 调度失败:`, error);
        // 调度失败不影响任务创建成功返回
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: task.id,
        status: task.status,
        trigger: triggerResult,
        message: triggerResult?.status === 'queued'
          ? `补点击任务创建成功，已加入 ${triggerResult.clickCount} 个点击任务`
          : '补点击任务创建成功'
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
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const userIdNum = parseInt(userId);

    const { searchParams } = new URL(request.url);
    const filters: TaskFilters = {
      status: searchParams.get('status') as any,
      offer_id: searchParams.get('offer_id') ? parseInt(searchParams.get('offer_id')!) : undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20
    };

    const result = await getClickFarmTasks(userIdNum, filters);

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
