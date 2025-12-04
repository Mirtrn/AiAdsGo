/**
 * Google Ads API调用追踪器
 * 用于记录和监控API配额使用情况
 *
 * 根据 https://developers.google.com/google-ads/api/docs/best-practices/quotas
 * - 每天基础配额：15,000次操作
 * - Mutate操作权重更高
 * - Report/Search操作权重较低
 */

import { getDatabase } from './db'

/**
 * API操作类型
 * 根据Google Ads API配额文档分类
 */
export enum ApiOperationType {
  // 查询操作（权重：1）
  SEARCH = 'search',
  SEARCH_STREAM = 'search_stream',

  // 变更操作（权重：取决于操作数量）
  MUTATE = 'mutate',
  MUTATE_BATCH = 'mutate_batch',

  // 报告操作（权重：1）
  REPORT = 'report',

  // 其他操作
  GET_RECOMMENDATIONS = 'get_recommendations',
  GET_KEYWORD_IDEAS = 'get_keyword_ideas',
  GET_AD_STRENGTH = 'get_ad_strength',

  // OAuth和账号操作（不计入配额）
  OAUTH = 'oauth',
  LIST_ACCOUNTS = 'list_accounts',
}

export interface ApiUsageRecord {
  userId: number
  operationType: ApiOperationType
  endpoint: string
  customerId?: string
  requestCount?: number // 实际API操作计数（mutate操作可能>1）
  responseTimeMs?: number
  isSuccess: boolean
  errorMessage?: string
}

/**
 * 记录API调用
 */
export async function trackApiUsage(record: ApiUsageRecord): Promise<void> {
  try {
    const db = getDatabase()
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    await db.exec(`
      INSERT INTO google_ads_api_usage (
        user_id,
        operation_type,
        endpoint,
        customer_id,
        request_count,
        response_time_ms,
        is_success,
        error_message,
        date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      record.userId,
      record.operationType,
      record.endpoint,
      record.customerId || null,
      record.requestCount || 1,
      record.responseTimeMs || null,
      record.isSuccess ? 1 : 0,
      record.errorMessage || null,
      today
    ])
  } catch (error) {
    // 不阻塞主流程，但记录错误
    console.error('Failed to track API usage:', error)
  }
}

/**
 * 获取今天的API使用统计
 */
export interface DailyUsageStats {
  date: string
  totalRequests: number
  totalOperations: number
  successfulOperations: number
  failedOperations: number
  avgResponseTimeMs: number | null
  maxResponseTimeMs: number | null
  quotaUsagePercent: number
  quotaLimit: number
  quotaRemaining: number
  operationBreakdown: {
    [key: string]: number
  }
}

export async function getDailyUsageStats(userId: number, date?: string): Promise<DailyUsageStats> {
  const db = getDatabase()
  const targetDate = date || new Date().toISOString().split('T')[0]

  // 根据数据库类型调整 SQL（PostgreSQL 使用 BOOLEAN，SQLite 使用 INTEGER）
  const isSuccessCondition = db.type === 'postgres'
    ? "CASE WHEN is_success = true THEN 1 ELSE 0 END"
    : "CASE WHEN is_success = 1 THEN 1 ELSE 0 END"

  const isFailureCondition = db.type === 'postgres'
    ? "CASE WHEN is_success = false THEN 1 ELSE 0 END"
    : "CASE WHEN is_success = 0 THEN 1 ELSE 0 END"

  // 获取汇总统计
  const summary = await db.queryOne(`
    SELECT
      SUM(request_count) as total_requests,
      COUNT(*) as total_operations,
      SUM(${isSuccessCondition}) as successful_operations,
      SUM(${isFailureCondition}) as failed_operations,
      AVG(response_time_ms) as avg_response_time_ms,
      MAX(response_time_ms) as max_response_time_ms
    FROM google_ads_api_usage
    WHERE user_id = ? AND date = ?
  `, [userId, targetDate]) as any

  // 获取操作类型分布
  const breakdownRows = await db.query(`
    SELECT
      operation_type,
      SUM(request_count) as count
    FROM google_ads_api_usage
    WHERE user_id = ? AND date = ?
    GROUP BY operation_type
  `, [userId, targetDate]) as any[]

  const operationBreakdown: { [key: string]: number } = {}
  breakdownRows.forEach(row => {
    operationBreakdown[row.operation_type] = Number(row.count) || 0
  })

  const totalRequests = Number(summary?.total_requests) || 0
  const quotaLimit = 15000 // 每天基础配额
  const quotaUsagePercent = (totalRequests / quotaLimit) * 100
  const quotaRemaining = Math.max(0, quotaLimit - totalRequests)

  return {
    date: targetDate,
    totalRequests,
    totalOperations: Number(summary?.total_operations) || 0,
    successfulOperations: Number(summary?.successful_operations) || 0,
    failedOperations: Number(summary?.failed_operations) || 0,
    avgResponseTimeMs: summary?.avg_response_time_ms ? Number(summary.avg_response_time_ms) : null,
    maxResponseTimeMs: summary?.max_response_time_ms ? Number(summary.max_response_time_ms) : null,
    quotaUsagePercent,
    quotaLimit,
    quotaRemaining,
    operationBreakdown
  }
}

/**
 * 获取最近N天的使用趋势
 */
export interface UsageTrend {
  date: string
  totalRequests: number
  successRate: number
}

export async function getUsageTrend(userId: number, days: number = 7): Promise<UsageTrend[]> {
  const db = getDatabase()

  // 根据数据库类型调整 SQL
  const isSuccessCondition = db.type === 'postgres'
    ? "CASE WHEN is_success = true THEN 1 ELSE 0 END"
    : "CASE WHEN is_success = 1 THEN 1 ELSE 0 END"

  // PostgreSQL 和 SQLite 的日期函数不同
  const dateCondition = db.type === 'postgres'
    ? `date >= CURRENT_DATE - INTERVAL '${days} days'`
    : `date >= date('now', '-${days} days')`

  const rows = await db.query(`
    SELECT
      date,
      SUM(request_count) as total_requests,
      SUM(${isSuccessCondition}) * 100.0 / COUNT(*) as success_rate
    FROM google_ads_api_usage
    WHERE user_id = ?
      AND ${dateCondition}
    GROUP BY date
    ORDER BY date DESC
  `, [userId]) as any[]

  return rows.map(row => ({
    date: row.date,
    totalRequests: Number(row.total_requests) || 0,
    successRate: Number(row.success_rate) || 0
  }))
}

/**
 * 检查是否接近配额限制
 */
export async function checkQuotaLimit(userId: number, warningThreshold: number = 0.8): Promise<{
  isNearLimit: boolean
  isOverLimit: boolean
  currentUsage: number
  limit: number
  percentUsed: number
}> {
  const stats = await getDailyUsageStats(userId)
  const percentUsed = stats.quotaUsagePercent / 100

  return {
    isNearLimit: percentUsed >= warningThreshold,
    isOverLimit: percentUsed >= 1.0,
    currentUsage: stats.totalRequests,
    limit: stats.quotaLimit,
    percentUsed: stats.quotaUsagePercent
  }
}
