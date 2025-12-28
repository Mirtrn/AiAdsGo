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
 * @param task - 可选，任务对象（用于计算首次执行时间）
 * @returns 下次执行时间
 */
export function generateNextRunAt(timezone: string, task?: ClickFarmTask): Date {
  const now = new Date();

  // 如果提供了任务对象且任务未开始，计算首次执行时间
  if (task && task.scheduled_start_date && !task.started_at) {
    const scheduledDate = new Date(task.scheduled_start_date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 如果scheduled_start_date是今天或未来日期
    if (scheduledDate >= today) {
      // 找到第一个有点击数的小时
      const firstActiveHour = task.hourly_distribution.findIndex(count => count > 0);

      if (firstActiveHour !== -1) {
        // 解析 start_time (格式: "HH:mm")
        const [startHourStr] = task.start_time.split(':');
        const startHour = parseInt(startHourStr);

        // 使用第一个活跃小时和start_time中较大的那个
        const targetHour = Math.max(firstActiveHour, startHour);

        // 构造首次执行时间：scheduled_start_date + targetHour:00:00
        const firstRunAt = new Date(task.scheduled_start_date + `T${targetHour.toString().padStart(2, '0')}:00:00`);

        // 如果计算出的时间是过去，返回下一个整点
        if (firstRunAt <= now) {
          const nextHour = new Date(now);
          nextHour.setHours(now.getHours() + 1, 0, 0, 0);
          return nextHour;
        }

        return firstRunAt;
      }
    }
  }

  // 默认逻辑：下一个整点
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  return nextHour;
}
