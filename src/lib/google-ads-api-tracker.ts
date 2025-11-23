/**
 * Google Ads API调用追踪器
 * 用于记录和监控API配额使用情况
 *
 * 根据 https://developers.google.com/google-ads/api/docs/best-practices/quotas
 * - 每天基础配额：15,000次操作
 * - Mutate操作权重更高
 * - Report/Search操作权重较低
 */

import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data', 'autoads.db')

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
export function trackApiUsage(record: ApiUsageRecord): void {
  try {
    const db = new Database(DB_PATH)
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    const stmt = db.prepare(`
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
    `)

    stmt.run(
      record.userId,
      record.operationType,
      record.endpoint,
      record.customerId || null,
      record.requestCount || 1,
      record.responseTimeMs || null,
      record.isSuccess ? 1 : 0,
      record.errorMessage || null,
      today
    )

    db.close()
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

export function getDailyUsageStats(userId: number, date?: string): DailyUsageStats {
  const db = new Database(DB_PATH, { readonly: true })
  const targetDate = date || new Date().toISOString().split('T')[0]

  try {
    // 获取汇总统计
    const summary = db.prepare(`
      SELECT
        SUM(request_count) as total_requests,
        COUNT(*) as total_operations,
        SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) as successful_operations,
        SUM(CASE WHEN is_success = 0 THEN 1 ELSE 0 END) as failed_operations,
        AVG(response_time_ms) as avg_response_time_ms,
        MAX(response_time_ms) as max_response_time_ms
      FROM google_ads_api_usage
      WHERE user_id = ? AND date = ?
    `).get(userId, targetDate) as any

    // 获取操作类型分布
    const breakdownRows = db.prepare(`
      SELECT
        operation_type,
        SUM(request_count) as count
      FROM google_ads_api_usage
      WHERE user_id = ? AND date = ?
      GROUP BY operation_type
    `).all(userId, targetDate) as any[]

    const operationBreakdown: { [key: string]: number } = {}
    breakdownRows.forEach(row => {
      operationBreakdown[row.operation_type] = row.count || 0
    })

    const totalRequests = summary?.total_requests || 0
    const quotaLimit = 15000 // 每天基础配额
    const quotaUsagePercent = (totalRequests / quotaLimit) * 100
    const quotaRemaining = Math.max(0, quotaLimit - totalRequests)

    return {
      date: targetDate,
      totalRequests,
      totalOperations: summary?.total_operations || 0,
      successfulOperations: summary?.successful_operations || 0,
      failedOperations: summary?.failed_operations || 0,
      avgResponseTimeMs: summary?.avg_response_time_ms || null,
      maxResponseTimeMs: summary?.max_response_time_ms || null,
      quotaUsagePercent,
      quotaLimit,
      quotaRemaining,
      operationBreakdown
    }
  } finally {
    db.close()
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

export function getUsageTrend(userId: number, days: number = 7): UsageTrend[] {
  const db = new Database(DB_PATH, { readonly: true })

  try {
    const rows = db.prepare(`
      SELECT
        date,
        SUM(request_count) as total_requests,
        SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
      FROM google_ads_api_usage
      WHERE user_id = ?
        AND date >= date('now', '-${days} days')
      GROUP BY date
      ORDER BY date DESC
    `).all(userId) as any[]

    return rows.map(row => ({
      date: row.date,
      totalRequests: row.total_requests || 0,
      successRate: row.success_rate || 0
    }))
  } finally {
    db.close()
  }
}

/**
 * 检查是否接近配额限制
 */
export function checkQuotaLimit(userId: number, warningThreshold: number = 0.8): {
  isNearLimit: boolean
  isOverLimit: boolean
  currentUsage: number
  limit: number
  percentUsed: number
} {
  const stats = getDailyUsageStats(userId)
  const percentUsed = stats.quotaUsagePercent / 100

  return {
    isNearLimit: percentUsed >= warningThreshold,
    isOverLimit: percentUsed >= 1.0,
    currentUsage: stats.totalRequests,
    limit: stats.quotaLimit,
    percentUsed: stats.quotaUsagePercent
  }
}
