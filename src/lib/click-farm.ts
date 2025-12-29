// 补点击功能数据访问层
// src/lib/click-farm.ts

import { getDatabase } from './db';
import { generateNextRunAt } from './click-farm/scheduler';
import { getDateInTimezone, getHourInTimezone, createDateInTimezone } from './timezone-utils';
import { estimateTraffic } from './click-farm/distribution';
import type {
  ClickFarmTask,
  ClickFarmTaskListItem,  // 🆕 导入任务列表项类型
  ClickFarmTaskStatus,  // 🆕 导入状态类型
  CreateClickFarmTaskRequest,
  UpdateClickFarmTaskRequest,
  TaskFilters,
  ClickFarmStats,
  HourlyDistribution,
  DailyHistoryEntry
} from './click-farm-types';

/**
 * 创建补点击任务
 */
export async function createClickFarmTask(
  userId: number,
  input: CreateClickFarmTaskRequest
): Promise<ClickFarmTask> {
  const db = await getDatabase();

  // 🆕 scheduled_start_date默认为当天
  const scheduledStartDate = input.scheduled_start_date || new Date().toISOString().split('T')[0];

  console.log('[createClickFarmTask] 开始插入任务:', {
    userId,
    offer_id: input.offer_id,
    daily_click_count: input.daily_click_count,
    hourly_distribution_length: input.hourly_distribution?.length,
    timezone: input.timezone
  });

  try {
    const result = await db.exec(`
      INSERT INTO click_farm_tasks (
        user_id, offer_id, daily_click_count, start_time, end_time,
        duration_days, scheduled_start_date, hourly_distribution, timezone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      input.offer_id,
      input.daily_click_count,
      input.start_time,
      input.end_time,
      input.duration_days,
      scheduledStartDate,  // 🆕 添加scheduled_start_date字段
      JSON.stringify(input.hourly_distribution),
      input.timezone || 'America/New_York'
    ]);

    console.log('[createClickFarmTask] INSERT结果:', result);

    // 🔧 修复(2025-12-29): lastInsertRowid可能是数字(SQLite)或字符串(PostgreSQL)
    // 需要转换为正确的类型用于查询
    const insertedId = result.lastInsertRowid ? String(result.lastInsertRowid) : null;

    if (!insertedId) {
      throw new Error('Failed to insert task: no insert ID returned');
    }

    console.log('[createClickFarmTask] 获取插入的ID:', insertedId);

    const task = (await getClickFarmTaskById(insertedId, userId))!;

    // 🆕 计算并设置 next_run_at
    const nextRunAt = generateNextRunAt(task.timezone, task);
    await db.exec(`
      UPDATE click_farm_tasks
      SET next_run_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [nextRunAt.toISOString(), task.id]);

    // 重新获取更新后的任务
    return (await getClickFarmTaskById(insertedId, userId))!;
  } catch (error) {
    console.error('[createClickFarmTask] 错误:', error);
    if (error instanceof Error) {
      console.error('[createClickFarmTask] 错误消息:', error.message);
      console.error('[createClickFarmTask] 错误堆栈:', error.stack);
    }
    throw error;
  }
}

/**
 * 获取任务（带权限验证）
 */
export async function getClickFarmTaskById(
  id: number | string,
  userId: number
): Promise<ClickFarmTask | null> {
  const db = await getDatabase();

  const task = await db.queryOne<any>(`
    SELECT * FROM click_farm_tasks
    WHERE id = ? AND user_id = ? AND is_deleted = FALSE
  `, [id, userId]);

  if (!task) return null;

  return parseClickFarmTask(task);
}

/**
 * 获取任务列表
 */
export async function getClickFarmTasks(
  userId: number,
  filters: TaskFilters = {}
): Promise<{ tasks: ClickFarmTaskListItem[]; total: number }> {
  const db = await getDatabase();

  let query = `
    SELECT cft.*, o.target_country
    FROM click_farm_tasks cft
    LEFT JOIN offers o ON cft.offer_id = o.id
    WHERE cft.user_id = ? AND cft.is_deleted = FALSE
  `;
  const params: any[] = [userId];

  if (filters.status) {
    query += ' AND cft.status = ?';
    params.push(filters.status);
  }

  if (filters.offer_id) {
    query += ' AND cft.offer_id = ?';
    params.push(filters.offer_id);
  }

  // 分页
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const offset = (page - 1) * limit;

  // 获取总数（注意：count查询需要完整的params，包含userId）
  const countParams = [...params]; // 复制完整的params
  const countResult = await db.queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = FALSE
    ${filters.status ? 'AND status = ?' : ''}
    ${filters.offer_id ? 'AND offer_id = ?' : ''}
  `, countParams);

  const total = countResult?.count || 0;

  // 获取任务列表
  query += ' ORDER BY cft.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const tasks = await db.query<any>(query, params);

  return {
    tasks: tasks.map(parseClickFarmTask),
    total
  };
}

/**
 * 更新任务
 */
export async function updateClickFarmTask(
  id: number | string,
  userId: number,
  updates: UpdateClickFarmTaskRequest
): Promise<ClickFarmTask> {
  const db = await getDatabase();

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.daily_click_count !== undefined) {
    fields.push('daily_click_count = ?');
    values.push(updates.daily_click_count);
  }

  if (updates.start_time !== undefined) {
    fields.push('start_time = ?');
    values.push(updates.start_time);
  }

  if (updates.end_time !== undefined) {
    fields.push('end_time = ?');
    values.push(updates.end_time);
  }

  if (updates.duration_days !== undefined) {
    fields.push('duration_days = ?');
    values.push(updates.duration_days);
  }

  // 🆕 支持更新scheduled_start_date
  if (updates.scheduled_start_date !== undefined) {
    fields.push('scheduled_start_date = ?');
    values.push(updates.scheduled_start_date);
  }

  if (updates.hourly_distribution !== undefined) {
    fields.push('hourly_distribution = ?');
    values.push(JSON.stringify(updates.hourly_distribution));
  }

  // 🆕 支持更新timezone
  if (updates.timezone !== undefined) {
    fields.push('timezone = ?');
    values.push(updates.timezone);
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  fields.push('updated_at = datetime(\'now\')');
  values.push(id, userId);

  await db.exec(`
    UPDATE click_farm_tasks
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ? AND is_deleted = FALSE
  `, values);

  return (await getClickFarmTaskById(id, userId))!;
}

/**
 * 删除任务（软删除）
 */
export async function deleteClickFarmTask(
  id: number | string,
  userId: number
): Promise<void> {
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET is_deleted = TRUE, deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `, [id, userId]);
}

/**
 * 停止任务
 */
export async function stopClickFarmTask(
  id: number | string,
  userId: number
): Promise<ClickFarmTask> {
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET status = 'stopped', updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND status IN ('pending', 'running', 'paused')
  `, [id, userId]);

  return (await getClickFarmTaskById(id, userId))!;
}

/**
 * 重启任务
 */
export async function restartClickFarmTask(
  id: number | string,
  userId: number
): Promise<ClickFarmTask> {
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET status = 'running',
        pause_reason = NULL,
        pause_message = NULL,
        paused_at = NULL,
        updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND status IN ('stopped', 'paused')
  `, [id, userId]);

  return (await getClickFarmTaskById(id, userId))!;
}

/**
 * 中止任务（代理缺失）
 */
export async function pauseClickFarmTask(
  id: number | string,
  reason: string,
  message: string
): Promise<void> {
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET status = 'paused',
        pause_reason = ?,
        pause_message = ?,
        paused_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `, [reason, message, id]);
}

/**
 * 获取用户统计数据
 *
 * @param userId - 用户ID
 * @param daysBack - 时间范围，'all'表示全部历史，数字表示最近N天
 */
export async function getClickFarmStats(userId: number, daysBack: number | 'all' = 'all'): Promise<ClickFarmStats> {
  const db = await getDatabase();

  // 构建日期过滤条件
  let dateFilter = '';
  let dateParams: string[] = [];
  if (daysBack !== 'all') {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    dateFilter = ` AND started_at >= datetime('${cutoffDate.toISOString()}')`;
  }

  // 🔧 修复：获取所有任务及其对应的timezone，在应用层按每个任务的timezone过滤今日数据
  // ⚠️ 注意：每个任务可能有不同的timezone（来自offer的target_country）
  // 必须按每个任务的timezone单独判断"today"，然后聚合统计
  const allTasks = await db.query<{
    timezone: string;
    started_at: string | null;
    total_clicks: number;
    success_clicks: number;
    failed_clicks: number;
  }>(`
    SELECT timezone, started_at, total_clicks, success_clicks, failed_clicks
    FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = FALSE AND started_at IS NOT NULL ${dateFilter}
  `, [userId]);

  // 按每个任务的timezone单独判断是否为今日
  const todayTasks = allTasks.filter(task => {
    if (!task.started_at) return false;
    // 用该任务的timezone来判断"today"
    const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone);
    const taskDate = getDateInTimezone(new Date(task.started_at), task.timezone);
    return taskDate === todayInTaskTimezone;
  });

  const today = {
    clicks: todayTasks.reduce((sum, t) => sum + t.total_clicks, 0),
    successClicks: todayTasks.reduce((sum, t) => sum + t.success_clicks, 0),
    failedClicks: todayTasks.reduce((sum, t) => sum + t.failed_clicks, 0),
  };

  const todaySuccessRate = today.clicks > 0
    ? (today.successClicks / today.clicks) * 100
    : 0;

  // 累计统计（包含已删除任务的历史数据，以便保留历史记录）
  // 如果指定了daysBack，则只统计指定范围内的数据
  let cumulativeFilter = '';
  let cumulativeParams: (string | number)[] = [userId];
  if (daysBack !== 'all') {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    cumulativeFilter = ` AND created_at >= datetime('${cutoffDate.toISOString()}')`;
  }

  // 累计统计（包含已删除任务的历史数据，以便保留历史记录）
  // 注意：如果需要只统计未删除任务，添加 AND is_deleted = 0 条件
  const cumulative = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(total_clicks), 0) as clicks,
      COALESCE(SUM(success_clicks), 0) as successClicks,
      COALESCE(SUM(failed_clicks), 0) as failedClicks
    FROM click_farm_tasks
    WHERE user_id = ? ${cumulativeFilter}
  `, cumulativeParams);

  const cumulativeSuccessRate = cumulative.clicks > 0
    ? (cumulative.successClicks / cumulative.clicks) * 100
    : 0;

  // 🆕 任务状态分布统计（不含已删除任务）
  const statusDistribution = await db.query<{ status: string; count: number }>(`
    SELECT status, COUNT(*) as count
    FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = FALSE ${dateFilter.replace('started_at', 'created_at')}
    GROUP BY status
  `, [userId]);

  // 构建状态分布对象
  const taskStatusDistribution = {
    pending: 0,
    running: 0,
    paused: 0,
    stopped: 0,
    completed: 0,
    total: 0
  };

  statusDistribution.forEach(row => {
    const status = row.status as ClickFarmTaskStatus;
    taskStatusDistribution[status] = row.count;
    taskStatusDistribution.total += row.count;
  });

  return {
    today: {
      clicks: today.clicks,
      successClicks: today.successClicks,
      failedClicks: today.failedClicks,
      successRate: parseFloat(todaySuccessRate.toFixed(1)),
      traffic: estimateTraffic(today.clicks)  // 🔧 统一使用估算函数
    },
    cumulative: {
      clicks: cumulative.clicks,
      successClicks: cumulative.successClicks,
      failedClicks: cumulative.failedClicks,
      successRate: parseFloat(cumulativeSuccessRate.toFixed(1)),
      traffic: estimateTraffic(cumulative.clicks)  // 🔧 统一使用估算函数
    },
    taskStatusDistribution  // 🆕 任务状态分布
  };
}

/**
 * 获取管理员全局统计数据（支持多时区聚合）
 * ⚠️ 重要：统计"今日"是指在每个任务所在时区的"今日"
 * 例如：
 * - 任务A（America/New_York）的"今日"点击 = 60
 * - 任务B（Asia/Shanghai）的"今日"点击 = 50
 * - 管理员看到的总"今日点击" = 110（聚合所有时区）
 */
export async function getAdminClickFarmStats(): Promise<{
  total_tasks: number;
  active_tasks: number;
  total_clicks: number;
  success_clicks: number;
  success_rate: number;
  today_clicks: number;
  today_traffic: number;
  total_traffic: number;
  taskStatusDistribution: {
    pending: number;
    running: number;
    paused: number;
    stopped: number;
    completed: number;
    total: number;
  };
}> {
  const db = await getDatabase();

  // 1️⃣ 全局统计（包含已删除任务的历史数据，以便保留历史记录）
  const global = await db.queryOne<any>(`
    SELECT
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'running' AND NOT is_deleted THEN 1 ELSE 0 END) as active_tasks,
      COALESCE(SUM(total_clicks), 0) as total_clicks,
      COALESCE(SUM(success_clicks), 0) as success_clicks,
      COALESCE(SUM(failed_clicks), 0) as failed_clicks
    FROM click_farm_tasks
  `, []);

  const successRate = global.total_clicks > 0
    ? (global.success_clicks / global.total_clicks) * 100
    : 0;

  // 2️⃣ 今日统计（按每个任务的timezone判断）
  // 获取所有任务及其timezone和统计数据
  const allTasks = await db.query<{
    timezone: string;
    started_at: string | null;
    total_clicks: number;
    success_clicks: number;
    failed_clicks: number;
  }>(`
    SELECT timezone, started_at, total_clicks, success_clicks, failed_clicks
    FROM click_farm_tasks
    WHERE is_deleted = FALSE AND started_at IS NOT NULL
  `, []);

  // 🔧 在应用层按每个任务的timezone过滤"今日"数据
  const todayTasks = allTasks.filter(task => {
    if (!task.started_at) return false;
    const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone);
    const taskDate = getDateInTimezone(new Date(task.started_at), task.timezone);
    return taskDate === todayInTaskTimezone;
  });

  const today = {
    clicks: todayTasks.reduce((sum, t) => sum + t.total_clicks, 0),
    successClicks: todayTasks.reduce((sum, t) => sum + t.success_clicks, 0),
    failedClicks: todayTasks.reduce((sum, t) => sum + t.failed_clicks, 0),
  };

  const todaySuccessRate = today.clicks > 0
    ? (today.successClicks / today.clicks) * 100
    : 0;

  // 3️⃣ 任务状态分布统计（不含已删除任务）
  const statusDistribution = await db.query<{ status: string; count: number }>(`
    SELECT status, COUNT(*) as count
    FROM click_farm_tasks
    WHERE is_deleted = FALSE
    GROUP BY status
  `, []);

  // 构建状态分布对象
  const taskStatusDistribution = {
    pending: 0,
    running: 0,
    paused: 0,
    stopped: 0,
    completed: 0,
    total: 0
  };

  statusDistribution.forEach(row => {
    const status = row.status as ClickFarmTaskStatus;
    taskStatusDistribution[status] = row.count;
    taskStatusDistribution.total += row.count;
  });

  return {
    total_tasks: global.total_tasks,
    active_tasks: global.active_tasks,
    total_clicks: global.total_clicks,
    success_clicks: global.success_clicks,
    success_rate: parseFloat(successRate.toFixed(1)),
    today_clicks: today.clicks,
    today_traffic: estimateTraffic(today.clicks),  // 🔧 统一使用估算函数
    total_traffic: estimateTraffic(global.total_clicks),  // 🔧 统一使用估算函数
    taskStatusDistribution
  };
}

/**
 * 获取今日时间分布
 * 🔧 修复P1-5：从daily_history的hourly_breakdown中提取实际执行分布
 * 支持用户查看"配置分布" vs "实际执行分布"的对比
 */
export async function getHourlyDistribution(userId: number): Promise<HourlyDistribution> {
  const db = await getDatabase();

  // 获取今日所有任务的配置分布（汇总）
  const tasks = await db.query<any>(`
    SELECT hourly_distribution, timezone, daily_history, started_at
    FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = FALSE AND status IN ('running', 'completed')
  `, [userId]);

  const hourlyConfigured = new Array(24).fill(0);
  const hourlyActual = new Array(24).fill(0);
  const todayStr = getDateInTimezone(new Date(), 'UTC'); // 使用UTC作为参考

  // 聚合所有任务的配置和实际执行分布
  tasks.forEach((task: any) => {
    try {
      const distribution = JSON.parse(task.hourly_distribution);
      distribution.forEach((count: number, hour: number) => {
        hourlyConfigured[hour] += count;
      });

      // 🆕 P1-5：从daily_history的hourly_breakdown中提取实际执行数
      if (task.daily_history) {
        try {
          const dailyHistory = JSON.parse(task.daily_history);
          // 找到对应今天的daily_history条目
          // 这里使用任务的timezone来确定"今天"
          const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone);
          const todayEntry = dailyHistory.find((entry: DailyHistoryEntry) => entry.date === todayInTaskTimezone);

          if (todayEntry && todayEntry.hourly_breakdown) {
            todayEntry.hourly_breakdown.forEach((hourData: any, hour: number) => {
              hourlyActual[hour] += hourData.actual || 0;
            });
          }
        } catch (e) {
          console.warn(`[getHourlyDistribution] 解析daily_history失败:`, e);
        }
      }
    } catch (e) {
      console.warn(`[getHourlyDistribution] 解析hourly_distribution失败:`, e);
    }
  });

  // 计算匹配度
  const matchRate = calculateMatchRate(hourlyActual, hourlyConfigured);

  return {
    date: todayStr,
    hourlyActual,
    hourlyConfigured,
    matchRate
  };
}

/**
 * 计算匹配度
 */
function calculateMatchRate(actual: number[], configured: number[]): number {
  let totalDiff = 0;
  let totalConfigured = 0;

  for (let i = 0; i < 24; i++) {
    totalDiff += Math.abs(actual[i] - configured[i]);
    totalConfigured += configured[i];
  }

  if (totalConfigured === 0) return 100;

  const matchRate = ((totalConfigured - totalDiff) / totalConfigured) * 100;
  return Math.max(0, parseFloat(matchRate.toFixed(1)));
}

/**
 * 解析数据库任务对象
 */
function parseClickFarmTask(row: any): ClickFarmTaskListItem {
  const task: ClickFarmTaskListItem = {
    id: row.id,
    user_id: row.user_id,
    offer_id: row.offer_id,
    daily_click_count: row.daily_click_count,
    start_time: row.start_time,
    end_time: row.end_time,
    duration_days: row.duration_days,
    scheduled_start_date: row.scheduled_start_date,  // 🆕 添加scheduled_start_date字段
    hourly_distribution: JSON.parse(row.hourly_distribution),
    status: row.status,
    pause_reason: row.pause_reason,
    pause_message: row.pause_message,
    paused_at: row.paused_at,
    progress: row.progress,
    total_clicks: row.total_clicks,
    success_clicks: row.success_clicks,
    failed_clicks: row.failed_clicks,
    daily_history: JSON.parse(row.daily_history || '[]'),
    timezone: row.timezone,
    is_deleted: Boolean(row.is_deleted),
    deleted_at: row.deleted_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    next_run_at: row.next_run_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };

  // 🆕 如果有target_country字段（从JOIN查询返回），保留它用于前端显示
  if (row.target_country) {
    task.target_country = row.target_country;
  }

  return task;
}

/**
 * 初始化日历历史记录
 * 当任务首次执行时调用，为从scheduled_start_date到任务完成日期的每一天创建历史记录
 *
 * ⚠️ 时区处理：所有日期都相对于 task.timezone（任务的目标时区）
 * 例如：task.timezone = "Asia/Shanghai"，scheduled_start_date = "2024-12-30"
 * 则初始化的日期都是上海时间的本地日期
 *
 * ⚠️ 大跨度优化：对于无限期任务，只初始化最近7天而不是从开始日期到今天
 * 这样避免在初始化时创建数千条记录导致内存爆炸
 */
export async function initializeDailyHistory(task: ClickFarmTask): Promise<void> {
  const db = await getDatabase();

  // 如果daily_history已经有数据，说明已经初始化过，无需重复初始化
  if (task.daily_history && task.daily_history.length > 0) {
    return;
  }

  // 从scheduled_start_date开始
  let currentDateStr = task.scheduled_start_date;
  const dailyHistory: DailyHistoryEntry[] = [];

  // 计算应该创建的最后一天
  let endDateStr: string;
  if (task.duration_days > 0) {
    // 有限期任务：计算结束日期
    // 🔧 修复：使用createDateInTimezone确保日期计算在正确的时区
    const startDate = createDateInTimezone(
      task.scheduled_start_date,
      '00:00',
      task.timezone
    );
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + task.duration_days - 1);
    endDateStr = getDateInTimezone(endDate, task.timezone);
  } else {
    // 无限期任务：只初始化最近7天（P0-4修复）
    // 避免对于运行很久的任务初始化数千条记录
    const maxDaysToInit = 7;
    const today = getDateInTimezone(new Date(), task.timezone);
    const endDate = new Date(today);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - (maxDaysToInit - 1));

    currentDateStr = startDate.toISOString().split('T')[0];
    endDateStr = today;
  }

  // 为每一天创建历史记录
  while (currentDateStr <= endDateStr) {
    // 计算该天的目标点击数（基于hourly_distribution）
    const targetClicks = task.hourly_distribution.reduce((sum, count) => sum + count, 0);

    // 🆕 P1-5：初始化hourly_breakdown用于跟踪每小时的执行情况
    const hourlyBreakdown = task.hourly_distribution.map(target => ({
      target,
      actual: 0,
      success: 0,
      failed: 0
    }));

    dailyHistory.push({
      date: currentDateStr,  // ⚠️ 这个日期相对于 task.timezone（任务时区的本地日期）
      target: targetClicks,
      actual: 0,
      success: 0,
      failed: 0,
      hourly_breakdown: hourlyBreakdown  // 🆕 添加小时级别追踪
    });

    // 日期递增（直接操作字符串+1天）
    const [year, month, day] = currentDateStr.split('-').map(Number);
    const nextDate = new Date(year, month - 1, day);
    nextDate.setDate(nextDate.getDate() + 1);
    currentDateStr = nextDate.toISOString().split('T')[0];
  }

  // 更新任务的daily_history
  await db.exec(`
    UPDATE click_farm_tasks
    SET daily_history = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [JSON.stringify(dailyHistory), task.id]);
}

/**
 * 获取任务在特定时区的今天日期（YYYY-MM-DD格式）
 *
 * ⚠️ 时区处理：返回的日期是相对于 task.timezone 的本地日期
 * 例如：task.timezone = "Asia/Shanghai"，当前UTC = 2024-12-28 16:00:00
 * 则返回 "2024-12-29"（上海时间）
 */
function getTodayInTaskTimezone(task: ClickFarmTask): string {
  return getDateInTimezone(new Date(), task.timezone);
}

/**
 * 更新任务执行统计
 * 包括全局统计和每日历史记录
 *
 * 🔧 修复P1-1：使用原子操作避免竞态条件
 * 🔧 修复P1-5：同时更新hourly_breakdown用于实际执行分布追踪
 * 原问题：先UPDATE全局统计，再SELECT + UPDATE每日历史，两步操作之间可能被其他并发操作覆盖
 * 解决方案：在单个UPDATE中同时更新global_stats、daily_history和hourly_breakdown
 */
export async function updateTaskStats(
  id: number | string,
  success: boolean,
  currentHour?: number  // 可选：当前小时（用于更新hourly_breakdown）
): Promise<void> {
  const db = await getDatabase();

  // 先读取当前的daily_history和其他统计
  const taskRow = await db.queryOne<any>(`
    SELECT id, daily_history, hourly_distribution, timezone, started_at
    FROM click_farm_tasks
    WHERE id = ?
  `, [id]);

  if (!taskRow) {
    return;
  }

  const task = parseClickFarmTask(taskRow);
  const todayInTaskTimezone = getTodayInTaskTimezone(task);

  // 获取当前小时（如果没有传入的话）
  let hour = currentHour;
  if (hour === undefined) {
    hour = getHourInTimezone(new Date(), task.timezone);
  }

  // 更新每日历史
  let dailyHistory: DailyHistoryEntry[] = task.daily_history && task.daily_history.length > 0
    ? [...task.daily_history]
    : [];

  let todayEntry = dailyHistory.find(entry => entry.date === todayInTaskTimezone);
  if (!todayEntry) {
    todayEntry = {
      date: todayInTaskTimezone,
      target: task.hourly_distribution.reduce((sum, count) => sum + count, 0),
      actual: 0,
      success: 0,
      failed: 0,
      hourly_breakdown: task.hourly_distribution.map(target => ({
        target,
        actual: 0,
        success: 0,
        failed: 0
      }))
    };
    dailyHistory.push(todayEntry);
  }

  // 更新今天的统计
  todayEntry.actual += 1;
  if (success) {
    todayEntry.success += 1;
  } else {
    todayEntry.failed += 1;
  }

  // 🆕 P1-5：同时更新该小时的hourly_breakdown
  if (todayEntry.hourly_breakdown && todayEntry.hourly_breakdown[hour]) {
    const hourEntry = todayEntry.hourly_breakdown[hour];
    hourEntry.actual += 1;
    if (success) {
      hourEntry.success += 1;
    } else {
      hourEntry.failed += 1;
    }
  }

  // 🔧 原子操作：同时更新全局统计和daily_history
  // 这样避免了两步操作之间的竞态条件
  await db.exec(`
    UPDATE click_farm_tasks
    SET total_clicks = total_clicks + 1,
        ${success ? 'success_clicks = success_clicks + 1' : 'failed_clicks = failed_clicks + 1'},
        daily_history = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [JSON.stringify(dailyHistory), id]);
}

/**
 * 更新任务状态
 */
export async function updateTaskStatus(
  id: number | string,
  status: string,
  nextRunAt?: Date
): Promise<void> {
  const db = await getDatabase();

  if (nextRunAt) {
    await db.exec(`
      UPDATE click_farm_tasks
      SET status = ?,
          next_run_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [status, nextRunAt.toISOString(), id]);
  } else {
    await db.exec(`
      UPDATE click_farm_tasks
      SET status = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [status, id]);
  }
}

/**
 * 获取待执行的任务
 * 包括：pending（等待首次执行）+ running（进行中）
 */
export async function getPendingTasks(): Promise<ClickFarmTask[]> {
  const db = await getDatabase();

  const tasks = await db.query<any>(`
    SELECT * FROM click_farm_tasks
    WHERE status IN ('pending', 'running')
      AND is_deleted = FALSE
      AND (next_run_at IS NULL OR next_run_at <= datetime('now'))
    ORDER BY created_at ASC
    LIMIT 100
  `, []);

  return tasks.map(parseClickFarmTask);
}
