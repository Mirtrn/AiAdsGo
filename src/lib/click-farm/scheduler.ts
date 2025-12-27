// 调度逻辑模块
// src/lib/click-farm/scheduler.ts

import type { ClickFarmTask, SubTask } from '../click-farm-types';
import crypto from 'crypto';

/**
 * 生成子任务
 * 将每小时的点击数分散到随机的秒级时间点
 *
 * @param task - 点击任务
 * @param targetHour - 目标小时（0-23）
 * @param targetCount - 该小时的点击数
 * @returns 子任务数组
 */
export function generateSubTasks(
  task: ClickFarmTask,
  targetHour: number,
  targetCount: number,
  affiliateLink: string,
  targetCountry: string
): SubTask[] {
  if (targetCount <= 0) return [];

  const tasks: SubTask[] = [];

  for (let i = 0; i < targetCount; i++) {
    // 随机分钟（0-59）
    const minute = Math.floor(Math.random() * 60);
    // 随机秒（0-59）
    const second = Math.floor(Math.random() * 60);

    // 构造调度时间（当地时区）
    const scheduledAt = new Date();
    scheduledAt.setHours(targetHour, minute, second, 0);

    tasks.push({
      id: crypto.randomUUID(),
      taskId: task.id,
      url: affiliateLink,
      scheduledAt,
      proxyCountry: targetCountry,
      status: 'pending'
    });
  }

  // 按时间排序
  return tasks.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/**
 * 获取指定时区的小时数
 *
 * @param date - 日期对象
 * @param timezone - 时区字符串（如 'America/New_York'）
 * @returns 小时数（0-23）
 */
export function getHourInTimezone(date: Date, timezone: string): number {
  return parseInt(
    date.toLocaleString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false
    })
  );
}

/**
 * 计算任务进度
 *
 * @param task - 点击任务
 * @returns 进度百分比（0-100）
 */
export function calculateProgress(task: ClickFarmTask): number {
  if (task.duration_days === -1) {
    // 无限期任务，按总点击数计算
    return 0; // 无限期任务不显示进度
  }

  const startDate = task.started_at ? new Date(task.started_at) : new Date(task.created_at);
  const now = new Date();
  const elapsedDays = Math.floor(
    (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const progress = Math.min(
    100,
    Math.round((elapsedDays / task.duration_days) * 100)
  );

  return progress;
}

/**
 * 检查任务是否应该完成
 *
 * @param task - 点击任务
 * @returns 是否应该完成
 */
export function shouldCompleteTask(task: ClickFarmTask): boolean {
  if (task.duration_days === -1) {
    // 无限期任务不会自动完成
    return false;
  }

  if (!task.started_at) {
    return false;
  }

  const startDate = new Date(task.started_at);
  const now = new Date();
  const elapsedDays = Math.floor(
    (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  return elapsedDays >= task.duration_days;
}

/**
 * 生成下次执行时间
 *
 * @param timezone - 时区
 * @returns 下次执行时间（整点）
 */
export function generateNextRunAt(timezone: string): Date {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  return nextHour;
}
