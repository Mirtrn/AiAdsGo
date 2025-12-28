// 分布算法模块
// src/lib/click-farm/distribution.ts

/**
 * 电商购物访问曲线 - 全天版（00:00-24:00）
 * 特征: 10-12点（午休购物）和19-22点（晚间购物）为高峰
 */
const ECOMMERCE_FULL_DAY_WEIGHTS = [
  1, 1, 1, 1, 1, 2,      // 00:00-05:59 凌晨低谷
  3, 5, 7, 9, 11, 12,    // 06:00-11:59 早晨逐渐上升 + 午休高峰
  10, 8, 7, 6, 5, 6,     // 12:00-17:59 午后下降
  8, 10, 12, 11, 9, 6    // 18:00-23:59 晚间黄金时段
];

/**
 * 电商购物访问曲线 - 白天版（06:00-24:00）
 * 特征: 与全天版相同的高峰时段，但去除凌晨时段
 */
const ECOMMERCE_DAYTIME_WEIGHTS = [
  3, 5, 7, 9, 11, 12,    // 06:00-11:59 早晨逐渐上升 + 午休高峰
  10, 8, 7, 6, 5, 6,     // 12:00-17:59 午后下降
  8, 10, 12, 11, 9, 6    // 18:00-23:59 晚间黄金时段
];

/**
 * 归一化分布曲线
 * 确保总和等于目标值，同时保持相对比例
 *
 * @param distribution - 原始分布（24个整数）
 * @param targetTotal - 目标总和（每日点击数量）
 * @returns 归一化后的分布
 */
export function normalizeDistribution(
  distribution: number[],
  targetTotal: number
): number[] {
  // Step 1: 确保最小值为1（每小时至少1次）
  const minNormalized = distribution.map(count => Math.max(1, count));

  // Step 2: 按比例调整
  const currentTotal = minNormalized.reduce((sum, n) => sum + n, 0);
  const adjusted = minNormalized.map(n =>
    Math.round((n / currentTotal) * targetTotal)
  );

  // Step 3: 处理舍入误差
  const adjustedTotal = adjusted.reduce((sum, n) => sum + n, 0);
  const diff = targetTotal - adjustedTotal;

  if (diff !== 0) {
    // 将差额加到最大的值（对整体分布影响最小）
    const maxIndex = adjusted.indexOf(Math.max(...adjusted));
    adjusted[maxIndex] += diff;
  }

  return adjusted;
}

/**
 * 生成默认分布曲线
 *
 * @param dailyCount - 每日点击数量
 * @param startTime - 开始时间 "00:00" or "06:00"
 * @param endTime - 结束时间 "24:00"
 * @returns 24小时分布数组
 */
export function generateDefaultDistribution(
  dailyCount: number,
  startTime: string,  // "00:00" or "06:00"
  endTime: string     // "24:00"
): number[] {
  // 根据时间段选择对应的曲线
  const weights = startTime === "00:00"
    ? ECOMMERCE_FULL_DAY_WEIGHTS
    : ECOMMERCE_DAYTIME_WEIGHTS;

  const startHour = parseInt(startTime.split(':')[0]);
  const endHour = parseInt(endTime.split(':')[0]);

  const distribution = new Array(24).fill(0);

  // 只计算执行时间段内的权重
  let totalWeight = 0;
  const offset = startTime === "00:00" ? 0 : 6;
  for (let hour = startHour; hour < endHour; hour++) {
    totalWeight += weights[hour - offset];
  }

  // 按权重分配点击数
  for (let hour = startHour; hour < endHour; hour++) {
    const weight = weights[hour - offset];
    const count = Math.round((weight / totalWeight) * dailyCount);
    distribution[hour] = Math.max(1, count);
  }

  return normalizeDistribution(distribution, dailyCount);
}

/**
 * 验证分布曲线
 *
 * @param distribution - 分布数组
 * @param expectedTotal - 预期总和
 * @returns { valid: boolean, actualTotal: number, error?: string }
 */
export function validateDistribution(
  distribution: number[],
  expectedTotal: number
): { valid: boolean; actualTotal: number; error?: string } {
  if (!Array.isArray(distribution) || distribution.length !== 24) {
    return {
      valid: false,
      actualTotal: 0,
      error: '分布数组必须包含24个元素'
    };
  }

  const actualTotal = distribution.reduce((sum, n) => sum + n, 0);

  // 🔧 修复：先检查负数，再检查总和
  if (distribution.some(n => n < 0)) {
    return {
      valid: false,
      actualTotal,
      error: '分布数组不能包含负数'
    };
  }

  if (actualTotal !== expectedTotal) {
    return {
      valid: false,
      actualTotal,
      error: `分布总和 (${actualTotal}) 不等于每日点击数 (${expectedTotal})`
    };
  }

  return {
    valid: true,
    actualTotal
  };
}

/**
 * 格式化字节数为可读格式
 *
 * @param bytes - 字节数
 * @returns 格式化后的字符串
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 根据点击数估算流量消耗
 * 平均每次HTTP请求约200 bytes（请求行 + 请求头 + URL）
 *
 * @param clickCount - 点击次数
 * @returns 流量大小（bytes）
 */
export function estimateTraffic(clickCount: number): number {
  return clickCount * 200;
}
