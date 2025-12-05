/**
 * 从用户设置中获取代理配置
 *
 * 复用/settings页面中用户配置的"代理设置"
 * 数据存储在 system_settings 表中，category='proxy', key='urls'
 *
 * 重要：代理配置只使用用户自己的配置，不使用全局配置
 */

import { getAllProxyUrls } from '@/lib/settings'

/**
 * 代理配置接口（与settings页面保持一致）
 */
export interface ProxyUrlConfig {
  country: string
  url: string
}

/**
 * 队列系统使用的代理配置格式
 */
export interface QueueProxyConfig {
  host: string
  port: number
  username?: string
  password?: string
  protocol: 'http' | 'https' | 'socks5'
  country?: string
  userId?: number
  // 保留原始URL，用于IPRocket等动态代理服务
  originalUrl?: string
}

/**
 * 需要代理的任务类型
 * - scrape: 网页抓取需要代理以避免IP封禁
 *
 * 不需要代理的任务类型：
 * - ai-analysis: AI分析调用内部API，不需要代理
 * - sync: Google Ads数据同步使用官方API，不需要代理
 * - backup: 备份任务是内部操作
 * - email: 邮件发送使用邮件服务商
 * - export: 导出任务是内部操作
 */
export const PROXY_REQUIRED_TASK_TYPES = ['scrape'] as const

/**
 * 检查任务类型是否需要代理
 */
export function isProxyRequiredForTaskType(taskType: string): boolean {
  return PROXY_REQUIRED_TASK_TYPES.includes(taskType as any)
}

/**
 * 将用户代理配置转换为统一队列系统使用的ProxyConfig格式
 *
 * 注意：IPRocket等动态代理服务的URL是API端点，不是传统的代理服务器地址
 * 需要保留原始URL以便在实际使用时调用API获取代理IP
 */
export function convertUserProxiesToQueueFormat(proxies: ProxyUrlConfig[]): QueueProxyConfig[] {
  return proxies.map(proxy => {
    try {
      // 解析URL
      const url = new URL(proxy.url)

      // 提取用户名和密码（如果URL中包含）
      const username = url.username || undefined
      const password = url.password || undefined

      // 提取host和port
      const host = url.hostname
      const port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80)

      // 确定协议
      let protocol: 'http' | 'https' | 'socks5' = 'http'
      if (url.protocol === 'https:') {
        protocol = 'https'
      } else if (url.protocol === 'socks5:') {
        protocol = 'socks5'
      }

      return {
        host,
        port,
        username,
        password,
        protocol,
        country: proxy.country,
        // 保留原始URL，用于IPRocket等动态代理服务
        originalUrl: proxy.url
      }
    } catch (error) {
      console.warn(`解析代理URL失败: ${proxy.url}`, error)
      return null
    }
  }).filter((proxy): proxy is NonNullable<typeof proxy> => proxy !== null)
}

/**
 * 获取用户的代理配置（用于队列系统）
 *
 * 重要：只返回用户自己配置的代理，不使用全局配置
 *
 * @param userId - 用户ID
 * @returns 转换后的代理配置列表
 */
export async function getUserProxiesForQueue(userId: number): Promise<QueueProxyConfig[]> {
  // getAllProxyUrls 会优先返回用户配置，如果没有则返回全局配置
  // 但我们只需要用户自己的配置，所以需要直接查询用户级配置
  const userProxies = await getUserOnlyProxyUrls(userId)
  const queueProxies = convertUserProxiesToQueueFormat(userProxies)

  // 添加userId标识
  return queueProxies.map(proxy => ({
    ...proxy,
    userId
  }))
}

/**
 * 获取用户自己的代理配置（不包含全局配置）
 *
 * @param userId - 用户ID
 * @returns 用户自己配置的代理URL列表
 */
async function getUserOnlyProxyUrls(userId: number): Promise<ProxyUrlConfig[]> {
  try {
    // 动态导入数据库模块
    const { getDatabase } = await import('@/lib/db')
    const db = await getDatabase()

    // 只查询用户级配置（user_id = userId），不包含全局配置（user_id IS NULL）
    const query = `
      SELECT config_value, encrypted_value, is_sensitive
      FROM system_settings
      WHERE category = 'proxy' AND config_key = 'urls' AND user_id = ?
      LIMIT 1
    `
    const row = await db.queryOne(query, [userId]) as {
      config_value: string | null
      encrypted_value: string | null
      is_sensitive: number | boolean
    } | undefined

    if (!row) {
      return []
    }

    // 获取配置值（处理加密情况）
    const isSensitive = row.is_sensitive === true || row.is_sensitive === 1
    let value = row.config_value

    if (isSensitive && row.encrypted_value) {
      const { decrypt } = await import('@/lib/crypto')
      value = decrypt(row.encrypted_value)
    }

    if (!value) {
      return []
    }

    const proxies = JSON.parse(value)
    if (Array.isArray(proxies)) {
      return proxies.filter((p: any) =>
        p && typeof p.country === 'string' && typeof p.url === 'string'
      )
    }

    return []
  } catch (error: any) {
    console.error(`获取用户 ${userId} 代理配置失败:`, error.message)
    return []
  }
}

/**
 * 获取指定国家的代理配置
 *
 * @param targetCountry - 目标国家代码
 * @param userId - 用户ID
 * @returns 匹配的代理配置，如果没有匹配则返回第一个作为兜底
 */
export async function getProxyForCountry(
  targetCountry: string,
  userId: number
): Promise<QueueProxyConfig | undefined> {
  const proxies = await getUserProxiesForQueue(userId)

  if (proxies.length === 0) {
    return undefined
  }

  // 查找匹配的国家
  const countryUpper = targetCountry.toUpperCase()
  const matched = proxies.find(proxy =>
    proxy.country?.toUpperCase() === countryUpper
  )

  if (matched) {
    return matched
  }

  // 没有找到匹配的国家，返回第一个作为兜底
  return proxies[0]
}

/**
 * 检查用户是否配置了代理
 *
 * @param userId - 用户ID
 * @returns 是否配置了代理
 */
export async function hasUserProxy(userId: number): Promise<boolean> {
  const proxies = await getUserProxiesForQueue(userId)
  return proxies.length > 0
}
