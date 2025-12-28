// 补点击功能数据访问层
// src/lib/click-farm.ts

import { getDatabase } from './db';
import { generateNextRunAt } from './click-farm/scheduler';
import type {
  ClickFarmTask,
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

  const task = (await getClickFarmTaskById(result.lastInsertRowid as number, userId))!;

  // 🆕 计算并设置 next_run_at
  const nextRunAt = generateNextRunAt(task.timezone, task);
  await db.exec(`
    UPDATE click_farm_tasks
    SET next_run_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [nextRunAt.toISOString(), task.id]);

  // 重新获取更新后的任务
  return (await getClickFarmTaskById(result.lastInsertRowid as number, userId))!;
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
    WHERE id = ? AND user_id = ? AND is_deleted = 0
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
): Promise<{ tasks: ClickFarmTask[]; total: number }> {
  const db = await getDatabase();

  let query = 'SELECT * FROM click_farm_tasks WHERE user_id = ? AND is_deleted = 0';
  const params: any[] = [userId];

  if (filters.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }

  if (filters.offer_id) {
    query += ' AND offer_id = ?';
    params.push(filters.offer_id);
  }

  // 分页
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const offset = (page - 1) * limit;

  // 获取总数
  const countResult = await db.queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = 0
    ${filters.status ? 'AND status = ?' : ''}
    ${filters.offer_id ? 'AND offer_id = ?' : ''}
  `, params.slice(1));

  const total = countResult?.count || 0;

  // 获取任务列表
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
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

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  fields.push('updated_at = datetime(\'now\')');
  values.push(id, userId);

  await db.exec(`
    UPDATE click_farm_tasks
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ? AND is_deleted = 0
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
    SET is_deleted = 1, deleted_at = datetime('now'), updated_at = datetime('now')
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
 */
export async function getClickFarmStats(userId: number): Promise<ClickFarmStats> {
  const db = await getDatabase();

  // 今日统计
  const today = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(total_clicks), 0) as clicks,
      COALESCE(SUM(success_clicks), 0) as successClicks,
      COALESCE(SUM(failed_clicks), 0) as failedClicks
    FROM click_farm_tasks
    WHERE user_id = ?
      AND is_deleted = 0
      AND DATE(started_at) = DATE('now')
  `, [userId]);

  const todaySuccessRate = today.clicks > 0
    ? (today.successClicks / today.clicks) * 100
    : 0;

  // 累计统计（包含已删除任务的历史数据）
  const cumulative = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(total_clicks), 0) as clicks,
      COALESCE(SUM(success_clicks), 0) as successClicks,
      COALESCE(SUM(failed_clicks), 0) as failedClicks
    FROM click_farm_tasks
    WHERE user_id = ?
  `, [userId]);

  const cumulativeSuccessRate = cumulative.clicks > 0
    ? (cumulative.successClicks / cumulative.clicks) * 100
    : 0;

  // 🆕 任务状态分布统计（不含已删除任务）
  const statusDistribution = await db.query<{ status: string; count: number }>(`
    SELECT status, COUNT(*) as count
    FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = 0
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
      traffic: today.clicks * 200  // bytes
    },
    cumulative: {
      clicks: cumulative.clicks,
      successClicks: cumulative.successClicks,
      failedClicks: cumulative.failedClicks,
      successRate: parseFloat(cumulativeSuccessRate.toFixed(1)),
      traffic: cumulative.clicks * 200  // bytes
    },
    taskStatusDistribution  // 🆕 任务状态分布
  };
}

/**
 * 获取今日时间分布
 */
export async function getHourlyDistribution(userId: number): Promise<HourlyDistribution> {
  const db = await getDatabase();

  // 获取今日所有任务的配置分布（汇总）
  const tasks = await db.query<any>(`
    SELECT hourly_distribution
    FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = 0 AND status IN ('running', 'completed')
  `, [userId]);

  const hourlyConfigured = new Array(24).fill(0);
  tasks.forEach((task: any) => {
    const distribution = JSON.parse(task.hourly_distribution);
    distribution.forEach((count: number, hour: number) => {
      hourlyConfigured[hour] += count;
    });
  });

  // 获取今日实际执行分布（从daily_history中提取）
  const hourlyActual = new Array(24).fill(0);
  // TODO: 实际执行数据需要从Cron调度器中记录

  // 计算匹配度
  const matchRate = calculateMatchRate(hourlyActual, hourlyConfigured);

  return {
    date: new Date().toISOString().split('T')[0],
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
function parseClickFarmTask(row: any): ClickFarmTask {
  return {
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
}

/**
 * 更新任务执行统计
 */
export async function updateTaskStats(
  id: number | string,
  success: boolean
): Promise<void> {
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET total_clicks = total_clicks + 1,
        ${success ? 'success_clicks = success_clicks + 1' : 'failed_clicks = failed_clicks + 1'},
        updated_at = datetime('now')
    WHERE id = ?
  `, [id]);
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
 */
export async function getPendingTasks(): Promise<ClickFarmTask[]> {
  const db = await getDatabase();

  const tasks = await db.query<any>(`
    SELECT * FROM click_farm_tasks
    WHERE status = 'running'
      AND is_deleted = 0
      AND (next_run_at IS NULL OR next_run_at <= datetime('now'))
    ORDER BY next_run_at ASC
    LIMIT 100
  `, []);

  return tasks.map(parseClickFarmTask);
}
