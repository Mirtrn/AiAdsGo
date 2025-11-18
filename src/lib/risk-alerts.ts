/**
 * 风险提示系统
 *
 * 功能：
 * - 链接可用性检测
 * - 风险提示创建和管理
 * - 每日自动检查
 */

import { getDatabase } from '@/lib/db'

export interface RiskAlert {
  id: number
  userId: number
  alertType: string
  severity: 'critical' | 'warning' | 'info'
  resourceType: 'campaign' | 'creative' | 'offer' | null
  resourceId: number | null
  title: string
  message: string
  details: string | null
  status: 'active' | 'acknowledged' | 'resolved'
  createdAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  resolutionNote: string | null
}

export interface LinkCheckResult {
  id: number
  offerId: number
  url: string
  statusCode: number | null
  responseTime: number | null
  isAccessible: boolean
  isRedirected: boolean
  finalUrl: string | null
  checkCountry: string
  errorMessage: string | null
  checkedAt: string
}

/**
 * 检查单个链接的可用性
 */
export async function checkLink(
  url: string,
  country: string = 'US',
  timeout: number = 10000
): Promise<{
  isAccessible: boolean
  statusCode: number | null
  responseTime: number
  isRedirected: boolean
  finalUrl: string | null
  errorMessage: string | null
}> {
  const startTime = Date.now()

  try {
    // 设置请求选项
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    // 模拟目标国家的User-Agent
    const userAgents: Record<string, string> = {
      US: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      CN: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      UK: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      default: 'Mozilla/5.0 (compatible; GoogleBot/2.1; +http://www.google.com/bot.html)'
    }

    const response = await fetch(url, {
      method: 'HEAD', // 使用HEAD请求节省带宽
      headers: {
        'User-Agent': userAgents[country] || userAgents.default,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': country === 'CN' ? 'zh-CN,zh;q=0.9' : 'en-US,en;q=0.9'
      },
      signal: controller.signal,
      redirect: 'follow'
    })

    clearTimeout(timeoutId)
    const responseTime = Date.now() - startTime

    // 检查是否重定向
    const isRedirected = response.redirected
    const finalUrl = response.url !== url ? response.url : null

    // 2xx和3xx状态码视为可访问
    const isAccessible = response.status >= 200 && response.status < 400

    return {
      isAccessible,
      statusCode: response.status,
      responseTime,
      isRedirected,
      finalUrl,
      errorMessage: !isAccessible ? `HTTP ${response.status}` : null
    }
  } catch (error: any) {
    const responseTime = Date.now() - startTime

    return {
      isAccessible: false,
      statusCode: null,
      responseTime,
      isRedirected: false,
      finalUrl: null,
      errorMessage: error.name === 'AbortError'
        ? 'Request timeout'
        : error.message || 'Network error'
    }
  }
}

/**
 * 保存链接检查结果
 */
export function saveLinkCheckResult(
  userId: number,
  offerId: number,
  url: string,
  result: Awaited<ReturnType<typeof checkLink>>,
  country: string = 'US'
): number {
  const db = getDatabase()

  const stmt = db.prepare(`
    INSERT INTO link_check_history (
      user_id,
      offer_id,
      url,
      status_code,
      response_time,
      is_accessible,
      is_redirected,
      final_url,
      check_country,
      error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const info = stmt.run(
    userId,
    offerId,
    url,
    result.statusCode,
    result.responseTime,
    result.isAccessible ? 1 : 0,
    result.isRedirected ? 1 : 0,
    result.finalUrl,
    country,
    result.errorMessage
  )

  return info.lastInsertRowid as number
}

/**
 * 创建风险提示
 */
export function createRiskAlert(
  userId: number,
  alertType: string,
  severity: 'critical' | 'warning' | 'info',
  title: string,
  message: string,
  options?: {
    resourceType?: 'campaign' | 'creative' | 'offer'
    resourceId?: number
    details?: Record<string, any>
  }
): number {
  const db = getDatabase()

  // 检查是否已存在相同的活跃提示（避免重复）
  const existingStmt = db.prepare(`
    SELECT id FROM risk_alerts
    WHERE user_id = ?
      AND alert_type = ?
      AND status = 'active'
      AND (resource_id = ? OR (resource_id IS NULL AND ? IS NULL))
      AND created_at >= date('now', '-1 day')
  `)

  const existing = existingStmt.get(
    userId,
    alertType,
    options?.resourceId || null,
    options?.resourceId || null
  )

  if (existing) {
    // 已存在相同提示，不重复创建
    return (existing as any).id
  }

  // 创建新提示
  const stmt = db.prepare(`
    INSERT INTO risk_alerts (
      user_id,
      alert_type,
      severity,
      resource_type,
      resource_id,
      title,
      message,
      details
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const info = stmt.run(
    userId,
    alertType,
    severity,
    options?.resourceType || null,
    options?.resourceId || null,
    title,
    message,
    options?.details ? JSON.stringify(options.details) : null
  )

  return info.lastInsertRowid as number
}

/**
 * 获取用户的风险提示列表
 */
export function getUserRiskAlerts(
  userId: number,
  status?: 'active' | 'acknowledged' | 'resolved'
): RiskAlert[] {
  const db = getDatabase()

  let query = `
    SELECT * FROM risk_alerts
    WHERE user_id = ?
  `

  const params: any[] = [userId]

  if (status) {
    query += ` AND status = ?`
    params.push(status)
  }

  query += ` ORDER BY
    CASE severity
      WHEN 'critical' THEN 0
      WHEN 'warning' THEN 1
      WHEN 'info' THEN 2
    END,
    created_at DESC
  `

  const stmt = db.prepare(query)
  const alerts = stmt.all(...params) as any[]

  return alerts.map(a => ({
    id: a.id,
    userId: a.user_id,
    alertType: a.alert_type,
    severity: a.severity,
    resourceType: a.resource_type,
    resourceId: a.resource_id,
    title: a.title,
    message: a.message,
    details: a.details,
    status: a.status,
    createdAt: a.created_at,
    acknowledgedAt: a.acknowledged_at,
    resolvedAt: a.resolved_at,
    resolutionNote: a.resolution_note
  }))
}

/**
 * 更新风险提示状态
 */
export function updateAlertStatus(
  alertId: number,
  userId: number,
  status: 'acknowledged' | 'resolved',
  note?: string
): boolean {
  const db = getDatabase()

  const stmt = db.prepare(`
    UPDATE risk_alerts
    SET status = ?,
        ${status === 'acknowledged' ? 'acknowledged_at = datetime("now")' : ''},
        ${status === 'resolved' ? 'resolved_at = datetime("now")' : ''},
        resolution_note = ?
    WHERE id = ? AND user_id = ?
  `)

  const result = stmt.run(status, note || null, alertId, userId)
  return result.changes > 0
}

/**
 * 检查所有用户的Offer链接
 */
export async function checkAllUserLinks(userId: number): Promise<{
  totalChecked: number
  accessible: number
  broken: number
  redirected: number
  newAlerts: number
}> {
  const db = getDatabase()

  // 获取用户的所有活跃Offers
  const offersStmt = db.prepare(`
    SELECT id, affiliate_link, url, brand
    FROM offers
    WHERE user_id = ?
      AND affiliate_link IS NOT NULL
      AND affiliate_link != ''
  `)

  const offers = offersStmt.all(userId) as any[]

  let totalChecked = 0
  let accessible = 0
  let broken = 0
  let redirected = 0
  let newAlerts = 0

  for (const offer of offers) {
    const url = offer.affiliate_link || offer.url

    // 检查链接
    const result = await checkLink(url, 'US', 10000)

    // 保存检查结果
    saveLinkCheckResult(userId, offer.id, url, result, 'US')

    totalChecked++

    if (result.isAccessible) {
      accessible++
      if (result.isRedirected) {
        redirected++

        // 创建重定向提示
        createRiskAlert(
          userId,
          'link_redirect',
          'warning',
          `链接重定向 - ${offer.brand}`,
          `Offer "${offer.brand}" 的链接发生了重定向`,
          {
            resourceType: 'offer',
            resourceId: offer.id,
            details: {
              originalUrl: url,
              finalUrl: result.finalUrl
            }
          }
        )
        newAlerts++
      }
    } else {
      broken++

      // 创建链接失效提示
      const severity = result.errorMessage?.includes('timeout')
        ? 'warning'
        : 'critical'

      createRiskAlert(
        userId,
        result.errorMessage?.includes('timeout') ? 'link_timeout' : 'link_broken',
        severity,
        `链接${severity === 'critical' ? '失效' : '超时'} - ${offer.brand}`,
        `Offer "${offer.brand}" 的链接无法访问`,
        {
          resourceType: 'offer',
          resourceId: offer.id,
          details: {
            url,
            statusCode: result.statusCode,
            errorMessage: result.errorMessage
          }
        }
      )
      newAlerts++
    }
  }

  return {
    totalChecked,
    accessible,
    broken,
    redirected,
    newAlerts
  }
}

/**
 * 每日链接检查（所有用户）
 */
export async function dailyLinkCheck(): Promise<{
  totalUsers: number
  totalLinks: number
  totalAlerts: number
  results: Record<number, Awaited<ReturnType<typeof checkAllUserLinks>>>
}> {
  const db = getDatabase()

  // 获取所有有Offers的用户
  const usersStmt = db.prepare(`
    SELECT DISTINCT user_id
    FROM offers
    WHERE affiliate_link IS NOT NULL
      AND affiliate_link != ''
  `)

  const users = usersStmt.all() as { user_id: number }[]

  const results: Record<number, Awaited<ReturnType<typeof checkAllUserLinks>>> = {}
  let totalLinks = 0
  let totalAlerts = 0

  for (const user of users) {
    const result = await checkAllUserLinks(user.user_id)
    results[user.user_id] = result
    totalLinks += result.totalChecked
    totalAlerts += result.newAlerts
  }

  return {
    totalUsers: users.length,
    totalLinks,
    totalAlerts,
    results
  }
}

/**
 * 获取链接检查历史
 */
export function getLinkCheckHistory(
  userId: number,
  offerId?: number,
  limit: number = 50
): LinkCheckResult[] {
  const db = getDatabase()

  let query = `
    SELECT * FROM link_check_history
    WHERE user_id = ?
  `

  const params: any[] = [userId]

  if (offerId) {
    query += ` AND offer_id = ?`
    params.push(offerId)
  }

  query += ` ORDER BY checked_at DESC LIMIT ?`
  params.push(limit)

  const stmt = db.prepare(query)
  const history = stmt.all(...params) as any[]

  return history.map(h => ({
    id: h.id,
    offerId: h.offer_id,
    url: h.url,
    statusCode: h.status_code,
    responseTime: h.response_time,
    isAccessible: h.is_accessible === 1,
    isRedirected: h.is_redirected === 1,
    finalUrl: h.final_url,
    checkCountry: h.check_country,
    errorMessage: h.error_message,
    checkedAt: h.checked_at
  }))
}

/**
 * 获取风险统计
 */
export function getRiskStatistics(userId: number): {
  total: number
  active: number
  critical: number
  warning: number
  info: number
  byType: Record<string, number>
} {
  const db = getDatabase()

  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN severity = 'critical' AND status = 'active' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN severity = 'warning' AND status = 'active' THEN 1 ELSE 0 END) as warning,
      SUM(CASE WHEN severity = 'info' AND status = 'active' THEN 1 ELSE 0 END) as info,
      alert_type,
      COUNT(*) as type_count
    FROM risk_alerts
    WHERE user_id = ?
      AND created_at >= date('now', '-30 days')
    GROUP BY alert_type
  `)

  const rows = stmt.all(userId) as any[]

  const byType: Record<string, number> = {}
  let total = 0
  let active = 0
  let critical = 0
  let warning = 0
  let info = 0

  rows.forEach(row => {
    byType[row.alert_type] = row.type_count
    total += row.total
    active += row.active
    critical += row.critical
    warning += row.warning
    info += row.info
  })

  return {
    total,
    active,
    critical,
    warning,
    info,
    byType
  }
}
