// Cron调度器 - 每小时执行补点击任务
// /api/cron/click-farm-scheduler
// 🔄 重构版本：使用UnifiedQueueManager队列系统

import { NextRequest, NextResponse } from 'next/server';
import { getPendingTasks, updateTaskStatus, pauseClickFarmTask, initializeDailyHistory } from '@/lib/click-farm';
import { getHourInTimezone, shouldCompleteTask, generateNextRunAt, isWithinExecutionTimeRange } from '@/lib/click-farm/scheduler';
import { notifyTaskPaused, notifyTaskCompleted } from '@/lib/click-farm/notifications';
import { getOrCreateQueueManager } from '@/lib/queue/init-queue';
import { getDatabase } from '@/lib/db';
import { getDateInTimezone } from '@/lib/timezone-utils';
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

        /**
         * ⚠️ 时区检查：scheduled_start_date 是相对于 task.timezone（目标国家时区）的本地日期
         * 不是 UTC 日期，必须使用 getDateInTimezone() 转换为目标时区的本地日期后比较
         * 例如：task.timezone = "America/New_York"，scheduled_start_date = "2024-12-30"
         * 则需要等到纽约时间达到 2024-12-30 才能开始执行
         */
        if (task.scheduled_start_date) {
          const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone);
          if (todayInTaskTimezone < task.scheduled_start_date) {
            console.log(`[Cron] 任务 ${task.id} 尚未到开始日期 ${task.scheduled_start_date}（任务时区${task.timezone}当前日期：${todayInTaskTimezone}），跳过执行`);
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

        // 🆕 第一次执行时设置 started_at（用于计算任务完成时间）
        if (!task.started_at) {
          await db.exec(`
            UPDATE click_farm_tasks
            SET started_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?
          `, [task.id]);

          console.log(`[Cron] 任务 ${task.id} 首次执行，设置 started_at`);

          // 🆕 初始化每日历史记录
          // 重新获取任务对象以获取更新后的started_at
          const updatedTask = await db.queryOne<any>(`
            SELECT * FROM click_farm_tasks WHERE id = ?
          `, [task.id]);
          if (updatedTask) {
            await initializeDailyHistory(updatedTask);
            console.log(`[Cron] 任务 ${task.id} 已初始化每日历史记录`);
          }
        }

        /**
         * ⚠️ 时区转换：hourly_distribution 中的索引 i（0-23）表示 task.timezone（目标时区）的第 i 个小时
         * 必须用 getHourInTimezone() 获取目标时区的当前小时，而不是 UTC 小时
         * 例如：task.timezone = "Asia/Shanghai"，UTC 当前时间是 2024-12-28 16:00:00
         * getHourInTimezone() 会返回 0（上海时间 00:00:00 的下一天）
         * 所以应该查找 hourly_distribution[0]，而不是 hourly_distribution[16]
         */
        const currentHour = getHourInTimezone(new Date(), task.timezone);

        // 🆕 检查当前时间是否在任务的执行时间范围内
        // ⚠️ 时区处理：start_time 和 end_time 都相对于 task.timezone（目标时区）
        // 例如：task.timezone = "Asia/Shanghai"，start_time = "06:00"，end_time = "18:00"
        // 表示只在上海时间的 06:00-18:00 之间执行
        if (!isWithinExecutionTimeRange(task)) {
          const now = new Date();
          const timeInTaskTimezone = now.toLocaleString('en-US', {
            timeZone: task.timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
          console.log(`[Cron] 任务 ${task.id} 当前时间 ${timeInTaskTimezone}（${task.timezone}）不在执行时间范围 [${task.start_time}, ${task.end_time}] 内，跳过执行`);
          results.skipped++;
          continue;
        }

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
