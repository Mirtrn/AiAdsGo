// 补点击功能类型定义
// src/lib/click-farm-types.ts

/**
 * 任务状态
 */
export type ClickFarmTaskStatus =
  | 'pending'    // 等待开始
  | 'running'    // 运行中
  | 'paused'     // 已中止（代理缺失）
  | 'stopped'    // 已停止（用户手动）
  | 'completed'; // 已完成

/**
 * 中止原因
 */
export type PauseReason =
  | 'no_proxy'   // 缺少代理
  | 'manual'     // 手动中止
  | null;

/**
 * 补点击任务
 */
export interface ClickFarmTask {
  id: string;
  user_id: number;
  offer_id: number;

  // 任务配置
  daily_click_count: number;
  start_time: string;  // HH:mm格式
  end_time: string;
  duration_days: number;  // -1表示无限期
  hourly_distribution: number[];  // 24个整数

  // 状态管理
  status: ClickFarmTaskStatus;
  pause_reason: PauseReason;
  pause_message: string | null;
  paused_at: string | null;

  // 实时统计
  progress: number;  // 0-100百分比
  total_clicks: number;
  success_clicks: number;
  failed_clicks: number;

  // 历史数据
  daily_history: DailyHistoryEntry[];

  // 时区配置
  timezone: string;

  // 软删除
  is_deleted: boolean;
  deleted_at: string | null;

  // 时间戳
  started_at: string | null;
  completed_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 每日历史记录条目
 */
export interface DailyHistoryEntry {
  date: string;  // YYYY-MM-DD
  target: number;  // 目标点击数
  actual: number;  // 实际执行数
  success: number;  // 成功次数
  failed: number;  // 失败次数
}

/**
 * 创建任务请求
 */
export interface CreateClickFarmTaskRequest {
  offer_id: number;
  daily_click_count: number;  // 1-1000，默认216
  start_time: string;  // "06:00"，格式 HH:mm
  end_time: string;  // "24:00"
  duration_days: number;  // 7/14/30/-1(无限)
  hourly_distribution: number[];  // 24个整数
  timezone?: string;  // 默认 America/New_York
}

/**
 * 更新任务请求
 */
export interface UpdateClickFarmTaskRequest {
  daily_click_count?: number;
  start_time?: string;
  end_time?: string;
  duration_days?: number;
  hourly_distribution?: number[];
}

/**
 * 任务筛选条件
 */
export interface TaskFilters {
  status?: ClickFarmTaskStatus;
  offer_id?: number;
  page?: number;
  limit?: number;
}

/**
 * 任务统计数据
 */
export interface ClickFarmStats {
  today: {
    clicks: number;
    successClicks: number;
    failedClicks: number;
    successRate: number;  // 百分比
    traffic: number;  // bytes
  };
  cumulative: {
    clicks: number;
    successClicks: number;
    failedClicks: number;
    successRate: number;  // 百分比
    traffic: number;  // bytes
  };
}

/**
 * 时间分布数据
 */
export interface HourlyDistribution {
  date: string;  // YYYY-MM-DD
  hourlyActual: number[];  // 24个整数，实际执行次数
  hourlyConfigured: number[];  // 24个整数，配置分布
  matchRate: number;  // 匹配度百分比（保留字段，UI暂不显示）
}

/**
 * 子任务（Cron调度器使用）
 */
export interface SubTask {
  id: string;
  taskId: string;
  url: string;
  scheduledAt: Date;
  proxyCountry: string;
  status: 'pending' | 'success' | 'failed';
  errorCode?: string;
  errorMessage?: string;
}

/**
 * 点击结果
 */
export interface ClickResult {
  status: 'success' | 'failed';
  errorCode?: string;
  errorMessage?: string;
}

/**
 * API响应基础类型
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * 代理错误响应
 */
export interface ProxyRequiredError {
  error: 'proxy_required';
  message: string;
  suggestion: string;
  redirectTo: string;
}
