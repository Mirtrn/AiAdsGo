// Cron调度器 - 每小时执行补点击任务
// /api/cron/click-farm-scheduler
// 🔄 重构版本：使用UnifiedQueueManager队列系统

import { NextRequest, NextResponse } from 'next/server';
import { getPendingTasks, updateTaskStatus, pauseClickFarmTask } from '@/lib/click-farm';
import { getHourInTimezone, shouldCompleteTask, generateNextRunAt } from '@/lib/click-farm/scheduler';
import { notifyTaskPaused, notifyTaskCompleted } from '@/lib/click-farm/notifications';
import { getOrCreateQueueManager } from '@/lib/queue/init-queue';
import { getDatabase } from '@/lib/db';
import type { ClickFarmTaskData } from '@/lib/queue/executors/click-farm-executor';

export async function GET(request: NextRequest) {
  try {
    // 验证Cron密钥
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401 }
      );
    }

    const db = getDatabase();
    const tasks = await getPendingTasks();

    // 获取队列管理器实例
    const queueManager = await getOrCreateQueueManager();

    console.log(`[Cron] 开始执行补点击任务，找到 ${tasks.length} 个待处理任务`);

    const results = {
      processed: 0,
      queued: 0,       // 加入队列的任务数
      paused: 0,
      completed: 0,
      skipped: 0       // 当前时段无需执行的任务数
    };

    for (const task of tasks) {
      try {
        results.processed++;

        // 🆕 检查是否到达scheduled_start_date
        if (task.scheduled_start_date) {
          const today = new Date().toISOString().split('T')[0];
          if (today < task.scheduled_start_date) {
            console.log(`[Cron] 任务 ${task.id} 尚未到开始日期 ${task.scheduled_start_date}，跳过执行`);
            results.skipped++;
            continue;
          }
        }

        // 检查是否应该完成
        if (shouldCompleteTask(task)) {
          await updateTaskStatus(task.id, 'completed');
          results.completed++;
          console.log(`[Cron] 任务 ${task.id} 已完成`);

          // 🔔 发送任务完成通知
          await notifyTaskCompleted(
            task.user_id,
            task.id,
            task.total_clicks || 0,
            task.success_clicks || 0
          );

          continue;
        }

        // 获取Offer信息
        const offer = await db.queryOne<any>(`
          SELECT affiliate_link, target_country
          FROM offers
          WHERE id = ?
        `, [task.offer_id]);

        if (!offer) {
          console.error(`[Cron] Offer ${task.offer_id} 不存在`);
          continue;
        }

        // 检查代理配置
        const proxyConfig = await db.queryOne<any>(`
          SELECT proxy_url FROM system_settings
          WHERE user_id = ? AND key = ?
        `, [task.user_id, `proxy_${offer.target_country.toLowerCase()}`]);

        if (!proxyConfig || !proxyConfig.proxy_url) {
          // 代理缺失，中止任务
          await pauseClickFarmTask(
            task.id,
            'no_proxy',
            `缺少${offer.target_country}国家的代理配置`
          );
          results.paused++;
          console.log(`[Cron] 任务 ${task.id} 因代理缺失而中止`);

          // 🔔 发送任务中止通知
          await notifyTaskPaused(
            task.user_id,
            task.id,
            'no_proxy',
            `缺少${offer.target_country}国家的代理配置，请前往设置页面配置`
          );

          continue;
        }

        // 获取当前时区的小时
        const currentHour = getHourInTimezone(new Date(), task.timezone);

        // 获取该小时应该执行的点击数
        const clickCount = task.hourly_distribution[currentHour] || 0;

        if (clickCount === 0) {
          // 该小时无需执行
          await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone));
          results.skipped++;
          continue;
        }

        // 🔥 核心改进：将所有点击任务加入队列系统
        console.log(`[Cron] 任务 ${task.id} 将创建 ${clickCount} 个队列任务`);

        for (let i = 0; i < clickCount; i++) {
          // 🔥 计算该点击在当前小时内的执行时间（秒级随机分布，避开整分钟）
          let randomSecond = Math.floor(Math.random() * 3600);

          // 🔥 需求10：避开整分钟触发（:00秒）
          if (randomSecond % 60 === 0) {
            randomSecond = (randomSecond + Math.floor(Math.random() * 30) + 15) % 3600;
          }

          const taskData: ClickFarmTaskData = {
            taskId: task.id,
            url: offer.affiliate_link,
            proxyUrl: proxyConfig.proxy_url,
            offerId: task.offer_id
          };

          // 加入队列（正常优先级）
          await queueManager.enqueue(
            'click-farm',
            taskData,
            task.user_id,
            {
              priority: 'normal',
              maxRetries: 2  // 点击任务最多重试2次
            }
          );

          results.queued++;
        }

        // 更新下次执行时间
        await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone));

      } catch (error) {
        console.error(`[Cron] 处理任务 ${task.id} 失败:`, error);
      }
    }

    console.log(`[Cron] 执行完成:`, results);

    return NextResponse.json({
      success: true,
      data: results,
      message: `处理 ${results.processed} 个任务，加入队列 ${results.queued} 个点击任务`
    });

  } catch (error) {
    console.error('[Cron] 调度器执行失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '调度器执行失败' },
      { status: 500 }
    );
  }
}
