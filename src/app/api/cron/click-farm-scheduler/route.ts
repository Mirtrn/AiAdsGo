// Cron调度器 - 每小时执行补点击任务
// /api/cron/click-farm-scheduler
// 🔄 重构版本：使用UnifiedQueueManager队列系统

import { NextRequest, NextResponse } from 'next/server';
import { getPendingTasks, updateTaskStatus, pauseClickFarmTask, initializeDailyHistory } from '@/lib/click-farm';
import { shouldCompleteTask, generateNextRunAt, isWithinExecutionTimeRange, generateSubTasks } from '@/lib/click-farm/scheduler';
import { notifyTaskPaused, notifyTaskCompleted } from '@/lib/click-farm/notifications';
import { getOrCreateQueueManager } from '@/lib/queue/init-queue';
import { getDatabase } from '@/lib/db';
import { nowFunc } from '@/lib/db-helpers';
import { getDateInTimezone, getHourInTimezone } from '@/lib/timezone-utils';
import { getAllProxyUrls } from '@/lib/settings';
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
          // 🔧 修复P1-6：Offer已删除，自动停止任务
          await pauseClickFarmTask(
            task.id,
            'offer_deleted',
            `关联的Offer (ID: ${task.offer_id}) 已被删除，自动停止任务`
          );

          await notifyTaskPaused(
            task.user_id,
            task.id,
            'offer_deleted',
            `您关联的Offer已被删除，补点击任务已自动停止`
          );

          results.paused++;
          console.log(`[Cron] 任务 ${task.id} 因Offer被删除而中止`);
          continue;
        }

        // 检查代理配置
        // 🔧 修复(2025-12-31): 使用统一的 getAllProxyUrls 函数，与触发器和其他模块保持一致
        const proxyUrls = await getAllProxyUrls(task.user_id);
        const targetCountry = offer.target_country.toUpperCase();
        const proxyConfig = proxyUrls.find(p => p.country.toUpperCase() === targetCountry);

        if (!proxyConfig) {
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
            SET started_at = ${nowFunc(db.type)}, updated_at = ${nowFunc(db.type)}
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

        // 🆕 使用 generateSubTasks 生成分散执行时间的子任务
        const subTasks = generateSubTasks(
          task,
          currentHour,
          clickCount,
          offer.affiliate_link,
          offer.target_country
        );

        // 🔧 修复P1-3：添加错误恢复机制
        let queued = 0;
        let queueErrors: any[] = [];

        for (let i = 0; i < subTasks.length; i++) {
          const subTask = subTasks[i];
          const taskData: ClickFarmTaskData = {
            taskId: task.id,
            url: subTask.url,
            proxyUrl: proxyConfig.url,
            offerId: task.offer_id,
            scheduledAt: subTask.scheduledAt.toISOString()  // 🆕 传递计划执行时间，实现时间分散
          };

          try {
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

            queued++;
            results.queued++;
          } catch (enqueueError) {
            // 记录单个任务的加入队列失败
            queueErrors.push(enqueueError);
            console.warn(`[Cron] 任务 ${task.id} 加入队列失败 [${i}/${clickCount}]:`, enqueueError);
          }
        }

        // 🔧 修复P1-3：基于加入队列的结果决定是否更新状态
        if (queueErrors.length > 0) {
          if (queued === 0) {
            // 全部失败：不更新状态，保持running，下次cron仍会捡起
            console.error(`[Cron] 任务 ${task.id}: 全部(${clickCount})个点击加入队列失败，保持pending状态重试`);
            results.queued -= queued; // 回滚计数
            continue; // 不更新next_run_at，下次cron会重试
          } else {
            // 部分失败：记录警告，但继续更新状态
            console.warn(`[Cron] 任务 ${task.id}: 部分加入队列失败 (成功${queued}/${clickCount}，失败${queueErrors.length})`);
          }
        }

        // 只有在至少有部分成功时才更新状态
        if (queued > 0) {
          await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone));
          console.log(`[Cron] 任务 ${task.id} 成功加入 ${queued} 个点击到队列`);
        }

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
