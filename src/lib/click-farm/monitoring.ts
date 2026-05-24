/**
 * 补点击系统健康监控
 * src/lib/click-farm/monitoring.ts
 *
 * 用于监控系统在高负载下的表现（432k+ daily clicks）
 */

import { getDatabase, type DatabaseAdapter } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface ClickFarmHealth {
  timestamp: string;
  queueStats: {
    depth: number;
    avgProcessTime: number;  // 毫秒
    warning: boolean;
  };
  successRate: {
    today: number;  // 百分比
    last7days: number;
    warning: boolean;
  };
  taskStats: {
    activeTaskCount: number;
    totalClicks: number;
    projectedDaily: number;  // 基于当前时间推算的日总点击数
  };
  performanceMetrics: {
    cronExecutionTime: number;  // 毫秒
    avgClickLatency: number;    // 毫秒
    dbQueryTime: number;        // 毫秒
  };
  alerts: Array<{
    level: 'warning' | 'error' | 'info';
    message: string;
    timestamp: string;
  }>;
}

/**
 * 获取补点击系统健康状态
 */
export async function getClickFarmHealth(): Promise<ClickFarmHealth> {
  const db = await getDatabase();
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const alerts: ClickFarmHealth['alerts'] = [];

  // 1. 队列深度统计
  const queueStats = await getQueueStats(db, alerts);

  // 2. 点击成功率
  const successRate = await getSuccessRate(db, today, alerts);

  // 3. 任务统计
  const taskStats = await getTaskStats(db, today, alerts);

  // 4. 性能指标
  const performanceMetrics = await getPerformanceMetrics(db, alerts);

  return {
    timestamp: now.toISOString(),
    queueStats,
    successRate,
    taskStats,
    performanceMetrics,
    alerts
  };
}

/**
 * 获取队列统计信息
 * 注意：click_farm_queue 表在使用 Redis/Memory 队列时不存在，需容错处理
 */
async function getQueueStats(
  db: DatabaseAdapter,
  alerts: ClickFarmHealth['alerts']
): Promise<ClickFarmHealth['queueStats']> {
  let depth = 0;
  let avgProcessTime = 0;

  try {
    const oneHourAgoExpr = db.type === 'postgres'
      ? `(CURRENT_TIMESTAMP - INTERVAL '1 hour')`
      : `datetime('now', '-1 hour')`

    const pendingTasks = await db.queryOne<any>(`
      SELECT COUNT(*) as count FROM click_farm_queue WHERE status = 'pending'
    `);
    depth = Number(pendingTasks?.count || 0);

    // 计算平均处理时间（兼容 SQLite 和 PostgreSQL）
    let avgTimeRow: any;
    if (db.type === 'postgres') {
      avgTimeRow = await db.queryOne<any>(`
        SELECT
          AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000) as avgTime
        FROM click_farm_queue
        WHERE status = 'completed'
          AND completed_at >= ${oneHourAgoExpr}
      `);
    } else {
      avgTimeRow = await db.queryOne<any>(`
        SELECT
          AVG((strftime('%s', completed_at) - strftime('%s', created_at)) * 1000) as avgTime
        FROM click_farm_queue
        WHERE status = 'completed'
          AND completed_at >= ${oneHourAgoExpr}
      `);
    }
    avgProcessTime = Math.round(avgTimeRow?.avgTime || 0);
  } catch {
    // click_farm_queue 表不存在（使用 Redis/Memory 队列时），跳过统计
  }

  // 警告阈值
  let warning = false;
  if (depth > 50000) {
    warning = true;
    alerts.push({
      level: 'warning',
      message: `队列堆积严重: ${depth} 个待处理任务，建议增加executor并发数`,
      timestamp: new Date().toISOString()
    });
  }

  if (avgProcessTime > 5000) {
    warning = true;
    alerts.push({
      level: 'warning',
      message: `点击处理缓慢: 平均耗时 ${avgProcessTime}ms，检查代理性能`,
      timestamp: new Date().toISOString()
    });
  }

  return { depth, avgProcessTime, warning };
}

/**
 * 获取成功率
 */
async function getSuccessRate(
  db: DatabaseAdapter,
  today: string,
  alerts: ClickFarmHealth['alerts']
): Promise<ClickFarmHealth['successRate']> {
  // 今天的成功率：统计所有活跃/已完成任务的今日实际点击成功率
  const todayStats = await db.queryOne<any>(`
    SELECT
      SUM(total_clicks) as total,
      SUM(success_clicks) as successful
    FROM click_farm_tasks
    WHERE status IN ('running', 'completed', 'paused')
      AND IS_DELETED_FALSE
      AND total_clicks > 0
  `);

  const todayRate = todayStats?.total > 0
    ? Math.round(((todayStats.successful || 0) / todayStats.total) * 100)
    : 0;

  // 最近7天的成功率：使用 db.type 兼容 SQLite 和 PostgreSQL
  const sevenDaysAgoExpr = db.type === 'postgres'
    ? `(CURRENT_TIMESTAMP - INTERVAL '7 days')`
    : `datetime('now', '-7 days')`
  const last7days = await db.queryOne<any>(`
    SELECT
      SUM(total_clicks) as total,
      SUM(success_clicks) as successful
    FROM click_farm_tasks
    WHERE status IN ('running', 'completed', 'paused')
      AND IS_DELETED_FALSE
      AND total_clicks > 0
      AND updated_at >= ${sevenDaysAgoExpr}
  `);

  const last7daysRate = last7days?.total > 0
    ? Math.round(((last7days.successful || 0) / last7days.total) * 100)
    : 0;

  // 警告阈值
  if (todayRate < 90) {
    alerts.push({
      level: 'warning',
      message: `今日成功率过低: ${todayRate}%，检查代理配置或网络连接`,
      timestamp: new Date().toISOString()
    });
  }

  return {
    today: todayRate,
    last7days: last7daysRate,
    warning: todayRate < 90
  };
}

/**
 * 获取任务统计
 */
async function getTaskStats(
  db: DatabaseAdapter,
  today: string,
  alerts: ClickFarmHealth['alerts']
): Promise<ClickFarmHealth['taskStats']> {
  // 活跃任务数
  const activeTasks = await db.queryOne<any>(`
    SELECT COUNT(*) as count
    FROM click_farm_tasks
    WHERE status = 'running'
      AND IS_DELETED_FALSE
  `);

  // Bug #22 fix: PostgreSQL COUNT(*)/SUM() 返回 bigint 字符串，Number() 确保整数
  const activeTaskCount = Number(activeTasks?.count ?? 0);

  // 今日总点击数（所有运行中或已完成的任务累计）
  const totalClicks = await db.queryOne<any>(`
    SELECT SUM(total_clicks) as total
    FROM click_farm_tasks
    WHERE status IN ('running', 'completed', 'paused')
      AND IS_DELETED_FALSE
  `);

  const todayClicks = Number(totalClicks?.total ?? 0);

  // 推算日总点击数：使用 UTC 小时（服务器时间）做简单推算
  // 注意：仅供参考，实际分布受任务时区影响
  const now = new Date();
  const hoursElapsed = now.getUTCHours() + now.getUTCMinutes() / 60;
  const projectedDaily = hoursElapsed > 0
    ? Math.round(todayClicks / hoursElapsed * 24)
    : todayClicks;

  // 警告阈值
  if (projectedDaily > 500000) {
    alerts.push({
      level: 'info',
      message: `今日推算总点击数: ${projectedDaily}, 已接近高负载`,
      timestamp: new Date().toISOString()
    });
  }

  return {
    activeTaskCount,
    totalClicks: todayClicks,
    projectedDaily
  };
}

/**
 * 获取性能指标
 */
async function getPerformanceMetrics(
  db: DatabaseAdapter,
  alerts: ClickFarmHealth['alerts']
): Promise<ClickFarmHealth['performanceMetrics']> {
  // 数据库查询时间
  const dbStart = Date.now();
  await db.queryOne<any>(`SELECT 1`);
  const dbQueryTime = Date.now() - dbStart;

  const oneHourAgoExpr = db.type === 'postgres'
    ? `(CURRENT_TIMESTAMP - INTERVAL '1 hour')`
    : `datetime('now', '-1 hour')`

  // Cron执行时间（从日志中获取最近的执行记录，兼容 SQLite 和 PostgreSQL）
  let cronExecutionTime = 0;
  try {
    let cronLogs: any;
    if (db.type === 'postgres') {
      cronLogs = await db.queryOne<any>(`
        SELECT AVG(EXTRACT(EPOCH FROM (end_time - start_time)) * 1000) as avgTime
        FROM cron_execution_logs
        WHERE name = 'click-farm-scheduler'
          AND end_time >= ${oneHourAgoExpr}
      `);
    } else {
      cronLogs = await db.queryOne<any>(`
        SELECT AVG((strftime('%s', end_time) - strftime('%s', start_time)) * 1000) as avgTime
        FROM cron_execution_logs
        WHERE name = 'click-farm-scheduler'
          AND end_time >= ${oneHourAgoExpr}
      `);
    }
    cronExecutionTime = Math.round(cronLogs?.avgTime || 0);
  } catch {
    // cron_execution_logs 表不存在时忽略
  }

  // 平均点击延迟（click_farm_queue 表可能不存在，容错处理）
  let avgClickLatency = 0;
  try {
    let clickLatency: any;
    if (db.type === 'postgres') {
      clickLatency = await db.queryOne<any>(`
        SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000) as avgLatency
        FROM click_farm_queue
        WHERE completed_at >= ${oneHourAgoExpr}
      `);
    } else {
      clickLatency = await db.queryOne<any>(`
        SELECT AVG((strftime('%s', completed_at) - strftime('%s', created_at)) * 1000) as avgLatency
        FROM click_farm_queue
        WHERE completed_at >= ${oneHourAgoExpr}
      `);
    }
    avgClickLatency = Math.round(clickLatency?.avgLatency || 0);
  } catch {
    // click_farm_queue 表不存在时忽略
  }

  return {
    cronExecutionTime,
    avgClickLatency,
    dbQueryTime
  };
}

/**
 * 定期监控（建议每5分钟执行一次）
 */
export async function monitorClickFarmHealth() {
  try {
    const health = await getClickFarmHealth();

    // 记录到日志
    logger.info('[Click Farm Monitor] Health Check', {
      ...health,
      alertCount: health.alerts.length
    });

    // 如果有告警，发送通知
    if (health.alerts.length > 0) {
      const criticalAlerts = health.alerts.filter(a => a.level === 'error');
      if (criticalAlerts.length > 0) {
        await notifyAdmins(health.alerts);
      }
    }

    return health;
  } catch (error) {
    logger.error('[Click Farm Monitor] Health check failed:', error);
    throw error;
  }
}

/**
 * 通知管理员
 */
async function notifyAdmins(alerts: ClickFarmHealth['alerts']) {
  // 可以集成邮件、Slack、钉钉等通知系统
  logger.warn('[Click Farm Monitor] Sending alerts to admins', {
    alertCount: alerts.length,
    criticalCount: alerts.filter(a => a.level === 'error').length
  });
}

/**
 * 获取历史监控数据（用于仪表板展示）
 * 注意：click_farm_queue 表在使用 Redis/Memory 队列时不存在，会返回空数组
 */
export async function getClickFarmMetricsHistory(hours: number = 24) {
  const db = await getDatabase();

  try {
    let metrics: any[];
    if (db.type === 'postgres') {
      metrics = await db.query<any>(`
        SELECT
          date_trunc('hour', created_at) as hour,
          COUNT(*) as totalClicks,
          SUM(CASE WHEN success THEN 1 ELSE 0 END) as successClicks,
          AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000) as avgLatency
        FROM click_farm_queue
        WHERE created_at >= (CURRENT_TIMESTAMP - ($1 * INTERVAL '1 hour'))
        GROUP BY hour
        ORDER BY hour DESC
      `, [hours]);
    } else {
      metrics = await db.query<any>(`
        SELECT
          strftime('%Y-%m-%dT%H:00:00', created_at) as hour,
          COUNT(*) as totalClicks,
          SUM(CASE WHEN success THEN 1 ELSE 0 END) as successClicks,
          AVG((strftime('%s', completed_at) - strftime('%s', created_at)) * 1000) as avgLatency
        FROM click_farm_queue
        WHERE created_at >= datetime('now', '-' || ? || ' hours')
        GROUP BY hour
        ORDER BY hour DESC
      `, [hours]);
    }
    return metrics;
  } catch {
    // click_farm_queue 表不存在（使用 Redis/Memory 队列时），返回空
    return [];
  }
}
