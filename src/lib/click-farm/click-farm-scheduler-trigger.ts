/**
 * 补点击任务调度触发器
 * 用于创建任务后立即触发调度（无需外部Cron）
 */

import { getPendingTasks, updateTaskStatus, pauseClickFarmTask, initializeDailyHistory, parseClickFarmTask } from '@/lib/click-farm';
import { shouldCompleteTask, generateNextRunAt, isWithinExecutionTimeRange } from '@/lib/click-farm/scheduler';
import { notifyTaskPaused, notifyTaskCompleted } from '@/lib/click-farm/notifications';
import { getOrCreateQueueManager } from '@/lib/queue/init-queue';
import { getDatabase } from '@/lib/db';
import { getDateInTimezone, getHourInTimezone } from '@/lib/timezone-utils';
import { getAllProxyUrls } from '@/lib/settings';  // 🔧 修复：导入新的代理查询函数
import type { ClickFarmTaskData } from '@/lib/queue/executors/click-farm-executor';
import type { ClickFarmTask } from '@/lib/click-farm-types';

// 🆕 扩展ClickFarmTask类型，支持referer_config
// 🔧 修复(2025-12-31): ClickFarmTask 已包含 referer_config，不需要额外定义
interface TaskWithRefererConfig extends ClickFarmTask {
  // referer_config 已在 ClickFarmTask 类型中定义
}

interface TriggerResult {
  taskId: string;
  status: 'queued' | 'skipped' | 'paused' | 'completed' | 'error';
  clickCount?: number;
  message?: string;
}

/**
 * 触发单个补点击任务的调度
 * 用于创建任务后立即执行
 */
export async function triggerTaskScheduling(taskId: string): Promise<TriggerResult> {
  const db = getDatabase();

  // 获取任务
  const taskRow = await db.queryOne<any>(`
    SELECT * FROM click_farm_tasks WHERE id = ?
  `, [taskId]);

  if (!taskRow) {
    return { taskId, status: 'error', message: '任务不存在' };
  }

  // 🔧 修复：解析任务数据，确保字段类型正确（hourly_distribution、referer_config 等）
  const task = parseClickFarmTask(taskRow);

  // 检查任务状态
  if (task.status !== 'pending' && task.status !== 'running') {
    return { taskId, status: 'skipped', message: `任务状态为 ${task.status}，无需调度` };
  }

  // 检查是否到了开始日期
  if (task.scheduled_start_date) {
    const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone);
    if (todayInTaskTimezone < task.scheduled_start_date) {
      return { taskId, status: 'skipped', message: `尚未到开始日期 ${task.scheduled_start_date}` };
    }
  }

  // 检查是否应该完成
  if (shouldCompleteTask(task)) {
    await updateTaskStatus(task.id, 'completed');
    await notifyTaskCompleted(
      task.user_id,
      task.id,
      task.total_clicks || 0,
      task.success_clicks || 0
    );
    return { taskId, status: 'completed', message: '任务已完成' };
  }

  // 获取Offer信息
  const offer = await db.queryOne<any>(`
    SELECT affiliate_link, target_country
    FROM offers
    WHERE id = ?
  `, [task.offer_id]);

  if (!offer) {
    await pauseClickFarmTask(
      task.id,
      'offer_deleted',
      `关联的Offer (ID: ${task.offer_id}) 已被删除，自动停止任务`
    );
    await notifyTaskPaused(task.user_id, task.id, 'offer_deleted', '您关联的Offer已被删除');
    return { taskId, status: 'paused', message: 'Offer已删除，任务已暂停' };
  }

  // 🔧 修复(2025-12-30): 使用新的代理配置系统（proxy.urls JSON数组）
  const proxyUrls = await getAllProxyUrls(task.user_id);
  const targetCountry = offer.target_country.toUpperCase();
  const proxyConfig = proxyUrls?.find(p => p.country.toUpperCase() === targetCountry);

  if (!proxyConfig) {
    await pauseClickFarmTask(
      task.id,
      'no_proxy',
      `缺少${offer.target_country}国家的代理配置`
    );
    await notifyTaskPaused(task.user_id, task.id, 'no_proxy', `缺少${offer.target_country}代理配置`);
    return { taskId, status: 'paused', message: '缺少代理配置，任务已暂停' };
  }

  // 检查执行时间范围
  const currentHour = getHourInTimezone(new Date(), task.timezone);

  if (!isWithinExecutionTimeRange(task)) {
    const now = new Date();
    const timeInTaskTimezone = now.toLocaleString('en-US', {
      timeZone: task.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return {
      taskId,
      status: 'skipped',
      message: `当前时间 ${timeInTaskTimezone}（${task.timezone}）不在执行时间范围内`
    };
  }

  // 获取该小时应该执行的点击数
  const clickCount = task.hourly_distribution[currentHour] || 0;

  if (clickCount === 0) {
    await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone));
    return { taskId, status: 'skipped', message: '当前小时无需执行点击' };
  }

  // 🆕 获取任务的Referer配置
  // 🔧 修复(2025-12-31): parseClickFarmTask 已经解析好了 referer_config
  const refererConfig = task.referer_config && task.referer_config.type !== 'none'
    ? task.referer_config
    : undefined;

  // 获取队列管理器并加入队列
  const queueManager = await getOrCreateQueueManager();
  let queued = 0;

  for (let i = 0; i < clickCount; i++) {
    const taskData: ClickFarmTaskData = {
      taskId: task.id,
      url: offer.affiliate_link,
      proxyUrl: proxyConfig.url,  // 🔧 修复：使用新的代理配置格式
      offerId: task.offer_id,
      refererConfig  // 🆕 传递Referer配置
    };

    try {
      await queueManager.enqueue('click-farm', taskData, task.user_id, {
        priority: 'normal',
        maxRetries: 2
      });
      queued++;
    } catch (error) {
      console.error(`[Trigger] 任务 ${task.id} 加入队列失败:`, error);
    }
  }

  // 第一次执行时设置 started_at
  if (!task.started_at) {
    await db.exec(`
      UPDATE click_farm_tasks
      SET started_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, [task.id]);
    await initializeDailyHistory({ ...task, started_at: new Date().toISOString() });
  }

  // 更新状态
  if (queued > 0) {
    await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone));
    console.log(`[Trigger] 任务 ${task.id} 已加入 ${queued} 个点击到队列`);
  }

  return { taskId, status: 'queued', clickCount: queued };
}

/**
 * 触发所有待处理任务的调度
 * 用于定时任务调用
 */
export async function triggerAllPendingTasks(): Promise<{
  processed: number;
  queued: number;
  paused: number;
  skipped: number;
}> {
  const tasks = await getPendingTasks();
  const queueManager = await getOrCreateQueueManager();
  const db = getDatabase();

  console.log(`[TriggerAll] 开始执行，找到 ${tasks.length} 个待处理任务`);

  const results = { processed: 0, queued: 0, paused: 0, skipped: 0 };

  for (const task of tasks) {
    results.processed++;

    // 检查开始日期
    if (task.scheduled_start_date) {
      const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone);
      if (todayInTaskTimezone < task.scheduled_start_date) {
        results.skipped++;
        continue;
      }
    }

    // 检查是否完成
    if (shouldCompleteTask(task)) {
      await updateTaskStatus(task.id, 'completed');
      results.skipped++;
      continue;
    }

    // 获取Offer和代理
    const offer = await db.queryOne<any>(`
      SELECT affiliate_link, target_country FROM offers WHERE id = ?
    `, [task.offer_id]);

    if (!offer) {
      await pauseClickFarmTask(task.id, 'offer_deleted', 'Offer已删除');
      results.paused++;
      continue;
    }

    // 🔧 修复(2025-12-30): 使用新的代理配置系统
    const proxyUrls = await getAllProxyUrls(task.user_id);
    const targetCountry = offer.target_country.toUpperCase();
    const proxyConfig = proxyUrls?.find(p => p.country.toUpperCase() === targetCountry);

    if (!proxyConfig) {
      await pauseClickFarmTask(task.id, 'no_proxy', '缺少代理配置');
      results.paused++;
      continue;
    }

    // 检查执行时间
    const currentHour = getHourInTimezone(new Date(), task.timezone);
    if (!isWithinExecutionTimeRange(task)) {
      results.skipped++;
      continue;
    }

    const clickCount = task.hourly_distribution[currentHour] || 0;
    if (clickCount === 0) {
      results.skipped++;
      continue;
    }

    // 🆕 获取任务的Referer配置
    // 🔧 修复(2025-12-31): parseClickFarmTask 已经解析好了 referer_config
    const refererConfig = task.referer_config && task.referer_config.type !== 'none'
      ? task.referer_config
      : undefined;

    // 加入队列
    let queued = 0;
    for (let i = 0; i < clickCount; i++) {
      try {
        await queueManager.enqueue('click-farm', {
          taskId: task.id,
          url: offer.affiliate_link,
          proxyUrl: proxyConfig.url,  // 🔧 修复：使用新的代理配置格式
          offerId: task.offer_id,
          refererConfig  // 🆕 传递Referer配置
        }, task.user_id, { priority: 'normal', maxRetries: 2 });
        queued++;
      } catch (error) {
        console.error(`[TriggerAll] 任务 ${task.id} 加入队列失败:`, error);
      }
    }

    if (queued > 0) {
      await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone));
      results.queued += queued;
    }
  }

  console.log(`[TriggerAll] 执行完成:`, results);
  return results;
}
