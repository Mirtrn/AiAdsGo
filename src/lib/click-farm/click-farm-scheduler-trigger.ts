/**
 * 补点击任务调度触发器
 * 用于创建任务后立即触发调度（无需外部Cron）
 */

import { getPendingTasks, updateTaskStatus, pauseClickFarmTask, initializeDailyHistory, parseClickFarmTask } from '@/lib/click-farm';
import { shouldCompleteTask, generateNextRunAt, isWithinExecutionTimeRange } from '@/lib/click-farm/scheduler';
import { notifyTaskPaused, notifyTaskCompleted } from '@/lib/click-farm/notifications';
import { getQueueManagerForTaskType } from '@/lib/queue';
import { getDatabase } from '@/lib/db';
import { createDateInTimezone, getDateInTimezone, getHourInTimezone } from '@/lib/timezone-utils';
import { getAllProxyUrls } from '@/lib/settings';  // 🔧 修复：导入新的代理查询函数
import type { ClickFarmTaskData } from '@/lib/queue/executors/click-farm-executor';
import type { ClickFarmTask } from '@/lib/click-farm-types';
import type { UnifiedQueueManager } from '@/lib/queue/unified-queue-manager';
import { getHeapStatistics } from 'v8';

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

const MAX_SAFE_CLICKS_PER_HOUR = 1000
const CLICK_FARM_HEAP_PRESSURE_THRESHOLD = (() => {
  const n = parseFloat(process.env.CLICK_FARM_HEAP_PRESSURE_PCT || '85')
  return Number.isFinite(n) && n > 0 ? n : 85
})()

const CLICK_FARM_REQUIRE_REDIS_IN_PRODUCTION =
  process.env.CLICK_FARM_REQUIRE_REDIS_IN_PRODUCTION !== 'false'

async function ensureClickFarmQueueAvailable(queueManager: UnifiedQueueManager): Promise<boolean> {
  await queueManager.ensureInitialized()

  const runtime = queueManager.getRuntimeInfo()
  const usingMemoryQueue = runtime.adapter === 'MemoryQueueAdapter'
  const enforceRedis =
    process.env.NODE_ENV === 'production' &&
    CLICK_FARM_REQUIRE_REDIS_IN_PRODUCTION

  if (enforceRedis && usingMemoryQueue) {
    console.error(
      '[ClickFarmScheduler] Redis不可用，已回退到内存队列。为避免生产环境OOM，本轮跳过补点击入队。'
    )
    return false
  }

  return true
}

function isHeapPressureHigh(): boolean {
  try {
    const heapUsed = process.memoryUsage().heapUsed
    const limit = getHeapStatistics().heap_size_limit
    if (!limit || limit <= 0) return false
    const pct = (heapUsed / limit) * 100
    return pct >= CLICK_FARM_HEAP_PRESSURE_THRESHOLD
  } catch {
    return false
  }
}

function toFiniteNumber(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function getSafeHourlyClickCount(params: {
  rawCount: unknown
  dailyClickCount: unknown
  taskId: string
  hour: number
}): number {
  const { rawCount, dailyClickCount, taskId, hour } = params
  const countNum = toFiniteNumber(rawCount)
  if (!countNum || countNum <= 0) return 0

  const dailyNum = toFiniteNumber(dailyClickCount)
  const maxAllowed = Math.min(
    MAX_SAFE_CLICKS_PER_HOUR,
    dailyNum && dailyNum > 0 ? dailyNum : MAX_SAFE_CLICKS_PER_HOUR
  )
  const normalized = Math.min(Math.floor(countNum), maxAllowed)

  if (normalized !== countNum) {
    console.warn(`[Trigger] 任务 ${taskId} 小时${hour}点击数异常(${countNum})，已限制为 ${normalized}`)
  }

  return normalized
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
    // 同时更新 completed_at 字段
    const db = getDatabase();
    await db.exec(`
      UPDATE click_farm_tasks
      SET completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, [task.id]);
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
      `关联的Offer (ID: ${task.offer_id}) 已被删除，自动暂停任务`
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
  const now = new Date();
  const timeInTaskTimezone = now.toLocaleString('en-US', {
    timeZone: task.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  console.log('[TriggerTaskScheduling] 执行时间检查:', {
    taskId,
    timezone: task.timezone,
    currentHour,
    now: now.toISOString(),
    timeInTaskTimezone,
    start_time: task.start_time,
    end_time: task.end_time,
    isWithinRange: isWithinExecutionTimeRange(task)
  });

  if (!isWithinExecutionTimeRange(task)) {
    // 🔧 修复：即使跳过任务，也要更新 next_run_at
    // 🔧 修复(2026-01-05): 传入完整的 task 对象，确保返回下一个有配额的小时
    await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task));
    return {
      taskId,
      status: 'skipped',
      message: `当前时间 ${timeInTaskTimezone}（${task.timezone}）不在执行时间范围内`
    };
  }

  if (isHeapPressureHigh()) {
    await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task))
    return { taskId, status: 'skipped', message: '服务器内存压力过高，已延后调度' }
  }

  // 获取该小时应该执行的点击数
  const hourlyDistribution = task.hourly_distribution
  const rawClickCount = Array.isArray(hourlyDistribution)
    ? hourlyDistribution[currentHour]
    : (hourlyDistribution && typeof hourlyDistribution === 'object')
      ? (hourlyDistribution as Record<string, unknown>)[String(currentHour)]
      : 0
  const clickCount = getSafeHourlyClickCount({
    rawCount: rawClickCount,
    dailyClickCount: task.daily_click_count,
    taskId: String(task.id),
    hour: currentHour
  })

  if (clickCount === 0) {
    // 🔧 修复(2026-01-05): 传入完整的 task 对象，确保返回下一个有配额的小时
    await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task));
    return { taskId, status: 'skipped', message: '当前小时无需执行点击' };
  }

  // 🆕 获取任务的Referer配置
  // 🔧 修复(2025-12-31): parseClickFarmTask 已经解析好了 referer_config
  const refererConfig = task.referer_config && task.referer_config.type !== 'none'
    ? task.referer_config
    : undefined;

  // 获取队列管理器并加入队列
  const queueManager = getQueueManagerForTaskType('click-farm');
  if (!await ensureClickFarmQueueAvailable(queueManager)) {
    await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task))
    return {
      taskId,
      status: 'skipped',
      message: '队列后端不可用，已延后调度'
    }
  }

  let queued = 0;

  // 🔧 修复(2025-12-31): 大批量点击时使用分批处理，避免内存溢出
  // 每批处理 50 个，批间等待 50ms 让 GC 有机会回收
  const BATCH_SIZE = 50;
  const BATCH_DELAY_MS = 50;

  const todayInTimezone = getDateInTimezone(new Date(), task.timezone)
  const hourStr = String(currentHour).padStart(2, '0')
  for (let i = 0; i < clickCount; i++) {
    const minute = Math.floor(Math.random() * 60)
    const second = Math.floor(Math.random() * 60)
    const scheduledAt = createDateInTimezone(
      todayInTimezone,
      `${hourStr}:${String(minute).padStart(2, '0')}`,
      task.timezone,
      second
    )
    const taskData: ClickFarmTaskData = {
      taskId: task.id,
      url: offer.affiliate_link,
      proxyUrl: proxyConfig.url,  // 🔧 修复：使用新的代理配置格式
      offerId: task.offer_id,
      timezone: task.timezone,
      scheduledAt: scheduledAt.toISOString(),  // 🆕 传递计划执行时间，实现时间分散
      refererConfig  // 🆕 传递Referer配置
    };

    try {
      await queueManager.enqueue('click-farm', taskData, task.user_id, {
        priority: 'normal',
        maxRetries: 0
      });
      queued++;

      // 🔧 修复(2025-12-31): 每 BATCH_SIZE 个任务后让出主线程，让 GC 回收
      if (queued % BATCH_SIZE === 0) {
        console.log(`[Trigger] 任务 ${task.id} 已加入 ${queued}/${clickCount} 个点击到队列...`);
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
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
    // 🔧 修复(2026-01-05): 传入完整的 task 对象，确保返回下一个有配额的小时
    await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task));
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
  const queueManager = getQueueManagerForTaskType('click-farm');
  const db = getDatabase();

  if (!await ensureClickFarmQueueAvailable(queueManager)) {
    for (const task of tasks) {
      await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task))
    }

    return {
      processed: tasks.length,
      queued: 0,
      paused: 0,
      skipped: tasks.length
    }
  }

  // 🔧 添加调试日志
  console.log(`[TriggerAll] 开始执行，找到 ${tasks.length} 个待处理任务，当前时间: ${new Date().toISOString()}`);

  const results = { processed: 0, queued: 0, paused: 0, skipped: 0 };

  for (const task of tasks) {
    // 🔧 添加任务详情日志
    console.log(`[TriggerAll] 处理任务 ${task.id}: status=${task.status}, duration_days=${task.duration_days}, started_at=${task.started_at}, next_run_at=${task.next_run_at}`);
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
      // 同时更新 completed_at 字段
      await db.exec(`
        UPDATE click_farm_tasks
        SET completed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `, [task.id]);
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
      // 🔧 修复：即使跳过任务，也要更新 next_run_at
      // 🔧 修复(2026-01-05): 传入完整的 task 对象，确保返回下一个有配额的小时
      await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task));
      results.skipped++;
      continue;
    }

    if (isHeapPressureHigh()) {
      await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task))
      results.skipped++
      continue
    }

    const hourlyDistribution = task.hourly_distribution
    const rawClickCount = Array.isArray(hourlyDistribution)
      ? hourlyDistribution[currentHour]
      : (hourlyDistribution && typeof hourlyDistribution === 'object')
        ? (hourlyDistribution as Record<string, unknown>)[String(currentHour)]
        : 0
    const clickCount = getSafeHourlyClickCount({
      rawCount: rawClickCount,
      dailyClickCount: task.daily_click_count,
      taskId: String(task.id),
      hour: currentHour
    })
    if (clickCount === 0) {
      // 🔧 修复：即使跳过任务，也要更新 next_run_at
      // 🔧 修复(2026-01-05): 传入完整的 task 对象，确保返回下一个有配额的小时
      await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task));
      results.skipped++;
      continue;
    }

    // 🆕 获取任务的Referer配置
    // 🔧 修复(2025-12-31): parseClickFarmTask 已经解析好了 referer_config
    const refererConfig = task.referer_config && task.referer_config.type !== 'none'
      ? task.referer_config
      : undefined;

    // 🔧 修复(2025-12-31): 大批量点击时使用分批处理，避免内存溢出
    const BATCH_SIZE = 100;
    const BATCH_DELAY_MS = 50;

    // 加入队列
    let queued = 0;
    const todayInTimezone = getDateInTimezone(new Date(), task.timezone)
    const hourStr = String(currentHour).padStart(2, '0')
    for (let i = 0; i < clickCount; i++) {
      const minute = Math.floor(Math.random() * 60)
      const second = Math.floor(Math.random() * 60)
      const scheduledAt = createDateInTimezone(
        todayInTimezone,
        `${hourStr}:${String(minute).padStart(2, '0')}`,
        task.timezone,
        second
      )
      try {
        await queueManager.enqueue('click-farm', {
          taskId: task.id,
          url: offer.affiliate_link,
          proxyUrl: proxyConfig.url,  // 🔧 修复：使用新的代理配置格式
          offerId: task.offer_id,
          timezone: task.timezone,
          scheduledAt: scheduledAt.toISOString(),  // 🆕 传递计划执行时间
          refererConfig  // 🆕 传递Referer配置
        }, task.user_id, { priority: 'normal', maxRetries: 0 });
        queued++;

        // 🔧 修复(2025-12-31): 每 BATCH_SIZE 个任务后让出主线程
        if (queued % BATCH_SIZE === 0) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (error) {
        console.error(`[TriggerAll] 任务 ${task.id} 加入队列失败:`, error);
      }
    }

    // 🔧 修复：第一次执行时设置 started_at（在 triggerTaskScheduling 中已有，这里补充）
    if (queued > 0 && !task.started_at) {
      await db.exec(`
        UPDATE click_farm_tasks
        SET started_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `, [task.id]);
      const { initializeDailyHistory } = await import('@/lib/click-farm');
      await initializeDailyHistory({ ...task, started_at: new Date().toISOString() });
    }

    if (queued > 0) {
      // 🔧 修复(2026-01-05): 传入完整的 task 对象，确保返回下一个有配额的小时
      await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task));
      results.queued += queued;
    }
  }

  console.log(`[TriggerAll] 执行完成:`, results);
  return results;
}
