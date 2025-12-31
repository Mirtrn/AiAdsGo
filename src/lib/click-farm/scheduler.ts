// 调度逻辑模块
// src/lib/click-farm/scheduler.ts

import type { ClickFarmTask, SubTask } from '../click-farm-types';
import crypto from 'crypto';
import { createDateInTimezone, getDateInTimezone, getHourInTimezone } from '../timezone-utils';

/**
 * 生成子任务
 * 将每小时的点击数分散到随机的秒级时间点
 *
 * ⚠️ 时区处理：targetHour 相对于 task.timezone（目标时区）的小时
 * 必须使用 createDateInTimezone 确保时间在正确的时区中构造
 *
 * @param task - 点击任务
 * @param targetHour - 目标小时（0-23，相对于task.timezone）
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
  // 获取任务时区中的当前日期
  const todayInTimezone = getDateInTimezone(new Date(), task.timezone);

  for (let i = 0; i < targetCount; i++) {
    // 随机分钟（0-59）
    const minute = Math.floor(Math.random() * 60);
    // 随机秒（0-59），避免整点整分整秒
    const second = Math.floor(Math.random() * 60);

    // 🔧 修复：使用 createDateInTimezone 在目标时区中构造时间
    // 这样确保 targetHour 相对于 task.timezone
    // 🆕 使用随机秒数，避免整点整分整秒的触发时间
    const scheduledAt = createDateInTimezone(
      todayInTimezone,
      `${targetHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
      task.timezone,
      second
    );

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
 * 检查当前时间是否在任务的执行时间范围内
 *
 * ⚠️ 时区处理：start_time 和 end_time 都是相对于 task.timezone（目标时区）的本地时间
 * 例如：task.timezone = "Asia/Shanghai"，start_time = "06:00"，end_time = "18:00"
 * 表示只在上海时间的 06:00 到 18:00 之间执行
 *
 * ⚠️ 支持跨越午夜的时间范围：
 * start_time = "22:00", end_time = "06:00" 表示从晚上22:00执行到早上06:00
 *
 * @param task - 点击任务
 * @returns 当前时间是否在 [start_time, end_time] 范围内
 */
export function isWithinExecutionTimeRange(task: ClickFarmTask): boolean {
  // 🔧 修复：防御性检查，确保 task 字段有有效值
  if (!task) return false;

  // 获取任务时区的当前小时和分钟
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    timeZone: task.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const [hourStr, minuteStr] = timeStr.split(':');
  const currentHour = parseInt(hourStr);
  const currentMinute = parseInt(minuteStr);

  // 解析 start_time (格式: "HH:mm")
  // 🔧 修复：防御性检查 start_time 是否为有效字符串
  const startTime = task.start_time || '06:00';
  const [startHourStr, startMinuteStr] = startTime.split(':');
  const startHour = parseInt(startHourStr);
  const startMinute = parseInt(startMinuteStr);

  // 解析 end_time (格式: "HH:mm" 或 "24:00")
  // 🔧 修复：防御性检查 end_time 是否为有效字符串
  const endTime = task.end_time || '24:00';
  const [endHourStr, endMinuteStr] = endTime.split(':');
  let endHour = parseInt(endHourStr);
  let endMinute = parseInt(endMinuteStr);

  // 特殊处理 end_time = "24:00"（表示整天到结束）
  if (endTime === '24:00') {
    endHour = 23;
    endMinute = 59;
  }

  // 转换为分钟进行比较
  const currentMinutes = currentHour * 60 + currentMinute;
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  // 🔧 修复：支持跨越午夜的时间范围
  if (startMinutes <= endMinutes) {
    // 正常范围（不跨越午夜）：[start_time, end_time]
    // 例如：[06:00, 18:00] 表示6点到18点
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // 跨越午夜范围：[start_time, 24:00) 或 [00:00, end_time]
    // 例如：[22:00, 06:00] 表示从晚上22点执行到早上06点
    // 包括：22:00-23:59 或 00:00-06:00
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

/**
 * 计算任务进度
 *
 * ⚠️ 时区处理：应该按照任务时区计算"完整日期数"，而不是按UTC秒数
 * 与 shouldCompleteTask 使用相同的时区感知逻辑
 *
 * @param task - 点击任务
 * @returns 进度百分比（0-100）
 */
export function calculateProgress(task: ClickFarmTask): number {
  if (task.duration_days === -1) {
    // 无限期任务不显示进度
    return 0;
  }

  // 如果任务还未开始，检查是否还未到开始日期
  if (!task.started_at) {
    // 如果还未开始，则进度为0%
    return 0;
  }

  // 🔧 修复：按任务时区计算"完整日期数"
  // 转换 started_at 为任务时区的本地日期
  const startedAtInTimezone = getDateInTimezone(new Date(task.started_at), task.timezone);
  // 转换 当前时间 为任务时区的本地日期
  const nowInTimezone = getDateInTimezone(new Date(), task.timezone);

  // 解析日期字符串 (格式: "YYYY-MM-DD")
  const [startYear, startMonth, startDay] = startedAtInTimezone.split('-').map(Number);
  const [nowYear, nowMonth, nowDay] = nowInTimezone.split('-').map(Number);

  // 创建纯日期对象（不涉及时间部分）
  const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
  const nowDate = new Date(nowYear, nowMonth - 1, nowDay, 0, 0, 0, 0);

  // 计算完整日期差
  const elapsedDays = Math.floor(
    (nowDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
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
 * ⚠️ 时区处理：duration_days 应该按照任务时区计算"完整日期数"，而不是按UTC秒数计算
 * 例如：
 * - task.timezone = "Asia/Shanghai"
 * - started_at = UTC 2024-12-29 22:00:00（对应上海 2024-12-30 06:00:00）
 * - 当前时间 = UTC 2025-01-01 15:00:00（对应上海 2025-01-02 23:00:00）
 * - duration_days = 3
 *
 * ❌ 错误做法：按UTC秒数计算，会得到 2.708...天，floor后是2天，不完成
 * ✅ 正确做法：按上海时区的日期计算，从 2024-12-30 到 2025-01-02 是3个完整日期，应该完成
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

  // 🔧 修复：按任务时区计算"完整日期数"
  // 转换 started_at 为任务时区的本地日期
  const startedAtInTimezone = getDateInTimezone(new Date(task.started_at), task.timezone);
  // 转换 当前时间 为任务时区的本地日期
  const nowInTimezone = getDateInTimezone(new Date(), task.timezone);

  // 解析日期字符串 (格式: "YYYY-MM-DD")
  const [startYear, startMonth, startDay] = startedAtInTimezone.split('-').map(Number);
  const [nowYear, nowMonth, nowDay] = nowInTimezone.split('-').map(Number);

  // 创建纯日期对象（不涉及时间部分）
  const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
  const nowDate = new Date(nowYear, nowMonth - 1, nowDay, 0, 0, 0, 0);

  // 计算完整日期差
  const elapsedDays = Math.floor(
    (nowDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  return elapsedDays >= task.duration_days;
}

/**
 * 生成下次执行时间
 *
 * ⚠️ 注意：此函数返回的是 Date 对象，其内部存储的是 UTC 时间戳
 * 在 updateTaskStatus 中会通过 toISOString() 转换为 ISO 8601 格式（UTC）存储到数据库
 * 数据库查询时使用 next_run_at <= datetime('now') 进行比较（datetime('now')返回UTC）
 *
 * 关于时区：
 * - 返回的 Date 对象虽然使用了服务器本地时间的 setHours()
 * - 但由于 Date 内部存储的始终是 UTC，toISOString() 会正确转换
 * - 最终存储和查询都是基于 UTC，所以逻辑是正确的
 *
 * @param timezone - 时区
 * @param task - 可选，任务对象（用于计算首次执行时间）
 * @returns 下次执行时间（Date对象，内部存储为UTC）
 */
export function generateNextRunAt(timezone: string, task?: ClickFarmTask): Date {
  const now = new Date();

  // 🔧 修复(2025-12-31): 防御性检查，确保 task 是有效对象
  if (!task || typeof task !== 'object') {
    console.warn('[generateNextRunAt] 无效的任务对象，返回下一个整点');
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    return nextHour;
  }

  // 如果提供了任务对象且任务未开始，计算首次执行时间
  if (task.scheduled_start_date && !task.started_at) {
    // 🔧 修复：使用 getDateInTimezone 获取任务时区的当前日期
    // ⚠️ 重要：scheduled_start_date 是相对于 task.timezone 的本地日期
    // 必须在同一时区进行比较，不能混合使用服务器本地时区
    const todayInTaskTimezone = getDateInTimezone(new Date(), timezone);

    // ✅ 正确：在同一时区（任务时区）进行日期对比
    // 🔧 修复(2025-12-31): 确保 scheduled_start_date 是字符串
    const scheduledStartDate = String(task.scheduled_start_date || '');
    if (scheduledStartDate < todayInTaskTimezone) {
      // 还没有到开始日期，返回下一个小时
      const nextHour = new Date(now);
      nextHour.setHours(now.getHours() + 1, 0, 0, 0);
      return nextHour;
    }

    // 如果已经到了或超过开始日期，计算首次执行时间
    // 找到第一个有点击数的小时
    const hourlyDistribution = task.hourly_distribution || [];
    const firstActiveHour = Array.isArray(hourlyDistribution)
      ? hourlyDistribution.findIndex(count => count > 0)
      : -1;

    if (firstActiveHour !== -1) {
      // 解析 start_time (格式: "HH:mm")
      // 🔧 修复(2025-12-31): 确保 start_time 是字符串
      const startTimeStr = String(task.start_time || '06:00');
      const [startHourStr] = startTimeStr.split(':');
      const startHour = parseInt(startHourStr) || 0;

      // 使用第一个活跃小时和start_time中较大的那个
      const targetHour = Math.max(firstActiveHour, startHour);

      // 使用createDateInTimezone正确构造timezone的时间
      const firstRunAt = createDateInTimezone(
        task.scheduled_start_date,
        `${targetHour}:00`,
        timezone
      );

      // 如果计算出的时间是过去，返回下一个整点
      if (firstRunAt <= now) {
        const nextHour = new Date(now);
        nextHour.setHours(now.getHours() + 1, 0, 0, 0);
        return nextHour;
      }

      return firstRunAt;
    }
  }

  // 默认逻辑：下一个整点
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  return nextHour;
}
