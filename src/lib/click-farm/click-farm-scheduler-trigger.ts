/**
 * 补点击任务调度触发器
 * 用于创建任务后立即触发调度（无需外部Cron）
 */

import { getPendingTasks, updateTaskStatus, pauseClickFarmTask, initializeDailyHistory, parseClickFarmTask } from '@/lib/click-farm';
import { shouldCompleteTask, generateNextRunAt, isWithinExecutionTimeRange } from '@/lib/click-farm/scheduler';
import { notifyTaskPaused, notifyTaskCompleted } from '@/lib/click-farm/notifications';
import { getQueueManagerForTaskType } from '@/lib/queue';
import { getDatabase } from '@/lib/db';
import { getDateInTimezone, getHourInTimezone } from '@/lib/timezone-utils';
import { getAllProxyUrls } from '@/lib/settings';  // 🔧 修复：导入新的代理查询函数
import type { ClickFarmTask } from '@/lib/click-farm-types';
import type { UnifiedQueueManager } from '@/lib/queue/unified-queue-manager';
import { getHeapStatistics } from 'v8';
import type { ClickFarmBatchTaskData, ClickFarmTriggerTaskData } from '@/lib/click-farm/queue-task-types';

// 🆕 扩展ClickFarmTask类型，支持referer_config
// 🔧 修复(2025-12-31): ClickFarmTask 已包含 referer_config，不需要额外定义
interface TriggerResult {
  taskId: string;
  status: 'queued' | 'skipped' | 'paused' | 'completed' | 'error';
  clickCount?: number;
  message?: string;
}

const CLICK_FARM_BATCH_SIZE = (() => {
  const n = parseInt(process.env.CLICK_FARM_BATCH_SIZE || '10', 10)
  return Number.isFinite(n) && n > 0 ? n : 10
})()

const CLICK_FARM_BATCH_DELAY_MS = (() => {
  const n = parseInt(process.env.CLICK_FARM_BATCH_DELAY_MS || '500', 10)
  return Number.isFinite(n) && n >= 0 ? n : 500
})()

const MAX_SAFE_CLICKS_PER_HOUR = 1000
const CLICK_FARM_HEAP_PRESSURE_THRESHOLD = (() => {
  const n = parseFloat(process.env.CLICK_FARM_HEAP_PRESSURE_PCT || '90')
  return Number.isFinite(n) && n > 0 ? n : 90
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

function normalizeBatchSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return CLICK_FARM_BATCH_SIZE
  return Math.max(1, Math.floor(n))
}

function buildClickFarmBatchTaskId(data: ClickFarmBatchTaskData): string {
  const hour = String(Math.min(23, Math.max(0, Math.floor(Number(data.targetHour) || 0)))).padStart(2, '0')
  const offset = Math.max(0, Math.floor(Number(data.dispatchedClicks) || 0))
  return `click-farm-batch:${data.clickFarmTaskId}:${data.targetDate}:${hour}:${offset}`
}

function buildClickFarmTriggerTaskId(clickFarmTaskId: string): string {
  return `click-farm-trigger:${clickFarmTaskId}`
}

export async function enqueueClickFarmTriggerRequest(params: {
  clickFarmTaskId: string
  userId: number
  source?: ClickFarmTriggerTaskData['source']
  priority?: 'high' | 'normal' | 'low'
  parentRequestId?: string
}): Promise<{ queueTaskId: string }> {
  const clickFarmTaskId = String(params.clickFarmTaskId || '').trim()
  if (!clickFarmTaskId) {
    throw new Error('clickFarmTaskId 不能为空')
  }

  const queueManager = getQueueManagerForTaskType('click-farm-trigger')
  if (!await ensureClickFarmQueueAvailable(queueManager)) {
    throw new Error('队列后端不可用，无法接收触发请求')
  }

  const queueTaskId = buildClickFarmTriggerTaskId(clickFarmTaskId)
  await queueManager.enqueue(
    'click-farm-trigger',
    {
      clickFarmTaskId,
      source: params.source || 'manual',
    },
    params.userId,
    {
      priority: params.priority || 'high',
      maxRetries: 0,
      taskId: queueTaskId,
      parentRequestId: params.parentRequestId,
    }
  )

  return { queueTaskId }
}

async function enqueueClickFarmBatchTask(params: {
  task: ClickFarmTask
  clickCount: number
  currentHour: number
  targetDate: string
  affiliateLink: string
  proxyUrl: string
  refererConfig?: ClickFarmBatchTaskData['refererConfig']
  parentRequestId?: string
}): Promise<{ accepted: boolean; queueTaskId?: string; error?: string }> {
  const queueManager = getQueueManagerForTaskType('click-farm-batch')
  if (!await ensureClickFarmQueueAvailable(queueManager)) {
    return { accepted: false, error: '队列后端不可用' }
  }

  const batchData: ClickFarmBatchTaskData = {
    clickFarmTaskId: params.task.id,
    offerId: params.task.offer_id,
    url: params.affiliateLink,
    proxyUrl: params.proxyUrl,
    timezone: params.task.timezone,
    targetDate: params.targetDate,
    targetHour: params.currentHour,
    totalClicks: Math.max(0, Math.floor(params.clickCount)),
    dispatchedClicks: 0,
    batchSize: normalizeBatchSize(process.env.CLICK_FARM_BATCH_SIZE),
    refererConfig: params.refererConfig,
    scheduledAt: new Date(Date.now() + CLICK_FARM_BATCH_DELAY_MS).toISOString(),
  }

  const queueTaskId = buildClickFarmBatchTaskId(batchData)
  await queueManager.enqueue('click-farm-batch', batchData, params.task.user_id, {
    priority: 'low',
    maxRetries: 0,
    taskId: queueTaskId,
    parentRequestId: params.parentRequestId,
  })

  return { accepted: true, queueTaskId }
}

/**
 * 触发单个补点击任务的调度
 * 用于创建任务后立即执行
 */
export async function triggerTaskScheduling(
  taskId: string,
  options?: { parentRequestId?: string }
): Promise<TriggerResult> {
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
    const nowSql = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    await db.exec(`
      UPDATE click_farm_tasks
      SET completed_at = ${nowSql}, updated_at = ${nowSql}
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

  const todayInTimezone = getDateInTimezone(new Date(), task.timezone)

  console.log(`[Trigger] 创建批次任务`, {
    taskId: task.id,
    targetDate: todayInTimezone,
    targetHour: currentHour,
    clickCount,
    batchSize: normalizeBatchSize(process.env.CLICK_FARM_BATCH_SIZE),
    refererType: refererConfig?.type || 'none'
  })

  const batchEnqueue = await enqueueClickFarmBatchTask({
    task,
    clickCount,
    currentHour,
    targetDate: todayInTimezone,
    affiliateLink: offer.affiliate_link,
    proxyUrl: proxyConfig.url,
    refererConfig,
    parentRequestId: options?.parentRequestId,
  })

  if (!batchEnqueue.accepted) {
    await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone, task))
    return {
      taskId,
      status: 'skipped',
      message: batchEnqueue.error || '队列后端不可用，已延后调度'
    }
  }

  const queued = clickCount

  // 第一次执行时设置 started_at
  if (!task.started_at) {
    const nowSql = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    await db.exec(`
      UPDATE click_farm_tasks
      SET started_at = ${nowSql}, updated_at = ${nowSql}
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
/**
 * 清理僵尸 running 任务：将超过 2 小时未更新的 running 状态任务重置为 pending。
 * 防止因进程崩溃、重启等原因导致任务卡在 running 状态无法再次执行。
 */
async function cleanupZombieRunningTasks(): Promise<number> {
  const db = getDatabase()
  try {
    const zombieThresholdHours = (() => {
      const n = parseFloat(process.env.CLICK_FARM_ZOMBIE_THRESHOLD_HOURS || '2')
      return Number.isFinite(n) && n > 0 ? n : 2
    })()

    // 使用 RETURNING id 统计受影响行数（db.query 返回 T[]，不带 rowCount）
    let rows: { id: string }[]
    if (db.type === 'postgres') {
      rows = await db.query<{ id: string }>(
        `UPDATE click_farm_tasks
         SET status = 'pending', next_run_at = NULL, updated_at = NOW()
         WHERE status = 'running'
           AND updated_at < NOW() - INTERVAL '${zombieThresholdHours} hours'
         RETURNING id`
      )
    } else {
      rows = await db.query<{ id: string }>(
        `UPDATE click_farm_tasks
         SET status = 'pending', next_run_at = NULL, updated_at = datetime('now')
         WHERE status = 'running'
           AND updated_at < datetime('now', '-${zombieThresholdHours} hours')
         RETURNING id`
      )
    }

    const cleanedCount = rows.length
    if (cleanedCount > 0) {
      console.log(`[TriggerAll] 🧹 自动清理僵尸 running 任务: ${cleanedCount} 个（超过 ${zombieThresholdHours}h 未更新）已重置为 pending`)
    }

    // 🔧 修复(2026-04-30)：额外清理 next_run_at 卡在过去超过2小时的任务。
    // 场景：即使 updated_at 很新（任务每次被触发时都更新），但 next_run_at 因为时区/DST
    // 计算错误而卡在很久以前，导致任务进入死循环（不断触发但始终跳过）。
    // 通过重置 next_run_at=NULL 让调度器重新计算正确的下次执行时间。
    let stuckRows: { id: string }[]
    if (db.type === 'postgres') {
      stuckRows = await db.query<{ id: string }>(
        `UPDATE click_farm_tasks
         SET next_run_at = NULL, updated_at = NOW()
         WHERE status IN ('pending', 'running')
           AND next_run_at IS NOT NULL
           AND next_run_at < NOW() - INTERVAL '${zombieThresholdHours} hours'
         RETURNING id`
      )
    } else {
      stuckRows = await db.query<{ id: string }>(
        `UPDATE click_farm_tasks
         SET next_run_at = NULL, updated_at = datetime('now')
         WHERE status IN ('pending', 'running')
           AND next_run_at IS NOT NULL
           AND next_run_at < datetime('now', '-${zombieThresholdHours} hours')
         RETURNING id`
      )
    }

    const stuckCount = stuckRows.length
    if (stuckCount > 0) {
      console.log(`[TriggerAll] 🔧 自动修复卡住 next_run_at 的任务: ${stuckCount} 个（next_run_at 超过 ${zombieThresholdHours}h 在过去）已重置为 NULL`)
    }

    return cleanedCount + stuckCount
  } catch (err) {
    console.error('[TriggerAll] ⚠️ 僵尸任务清理失败:', err)
    return 0
  }
}

export async function triggerAllPendingTasks(): Promise<{
  processed: number;
  queued: number;
  paused: number;
  skipped: number;
  zombieCleaned: number;
}> {
  // 先清理僵尸 running 任务，防止积累阻塞调度
  const zombieCleaned = await cleanupZombieRunningTasks()

  const tasks = await getPendingTasks();
  console.log(`[TriggerAll] 开始执行，找到 ${tasks.length} 个待处理任务，当前时间: ${new Date().toISOString()}`);

  const results = { processed: 0, queued: 0, paused: 0, skipped: 0, zombieCleaned };

  for (const task of tasks) {
    results.processed++;
    try {
      const result = await triggerTaskScheduling(task.id);
      if (result.status === 'queued') {
        results.queued += result.clickCount || 0;
      } else if (result.status === 'paused') {
        results.paused += 1;
      } else {
        results.skipped += 1;
      }
    } catch (error) {
      console.error(`[TriggerAll] 任务 ${task.id} 调度失败:`, error);
      results.skipped += 1;
    }
  }

  console.log(`[TriggerAll] 执行完成:`, results);
  return results;
}
