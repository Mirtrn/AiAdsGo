/**
 * 增强的URL解析模块
 * 集成：多代理池管理 + Redis缓存 + 智能重试 + 降级方案
 */

import { getRedisClient } from './redis'
import { resolveAffiliateLinkWithPlaywright } from './url-resolver-playwright'
import type { PlaywrightResolvedUrl } from './url-resolver-playwright'

// ==================== 类型定义 ====================

export interface ProxyConfig {
  url: string
  country: string
  priority: 'primary' | 'fallback' | 'emergency'
  failureCount: number
  lastFailureTime: number | null
  successCount: number
  avgResponseTime: number
  isHealthy: boolean
}

export interface ResolvedUrlData {
  finalUrl: string
  finalUrlSuffix: string
  brand: string | null
  redirectChain: string[]
  redirectCount: number
  pageTitle: string | null
  statusCode: number | null
  cachedAt?: number
  resolveMethod?: 'http' | 'playwright' | 'cache'
  proxyUsed?: string
}

interface RetryConfig {
  maxRetries: number
  baseDelay: number // 初始延迟（ms）
  maxDelay: number // 最大延迟（ms）
  retryableErrors: string[] // 可重试的错误类型
}

// ==================== 代理池管理 ====================

export class ProxyPoolManager {
  private proxies: Map<string, ProxyConfig> = new Map()
  private readonly HEALTH_CHECK_INTERVAL = 3600000 // 1小时
  private readonly MAX_FAILURES_THRESHOLD = 3
  private readonly FAILURE_RESET_TIME = 3600000 // 1小时后重置失败计数

  /**
   * 从settings中加载代理配置
   */
  async loadProxies(settingsProxies: Array<{ url: string; country: string; is_default: boolean }>): Promise<void> {
    this.proxies.clear()

    // 分类代理：主代理、备用代理、兜底代理
    const primaryProxies: ProxyConfig[] = []
    const fallbackProxies: ProxyConfig[] = []
    let defaultProxy: ProxyConfig | null = null

    for (const proxy of settingsProxies) {
      const config: ProxyConfig = {
        url: proxy.url,
        country: proxy.country,
        priority: 'fallback',
        failureCount: 0,
        lastFailureTime: null,
        successCount: 0,
        avgResponseTime: 0,
        isHealthy: true,
      }

      if (proxy.is_default) {
        config.priority = 'emergency'
        defaultProxy = config
      } else {
        primaryProxies.push(config)
      }

      this.proxies.set(proxy.url, config)
    }

    // 如果有兜底代理，确保它是emergency优先级
    if (defaultProxy) {
      this.proxies.set(defaultProxy.url, defaultProxy)
    }

    console.log(`✅ 代理池已加载: ${this.proxies.size}个代理`)
  }

  /**
   * 根据国家获取最佳代理
   */
  getBestProxyForCountry(targetCountry: string): ProxyConfig | null {
    // 1. 优先使用目标国家的健康代理
    const countryProxies = Array.from(this.proxies.values())
      .filter(p => p.country === targetCountry && p.isHealthy && p.priority !== 'emergency')
      .sort((a, b) => a.failureCount - b.failureCount || a.avgResponseTime - b.avgResponseTime)

    if (countryProxies.length > 0) {
      return countryProxies[0]
    }

    // 2. 使用其他健康代理
    const healthyProxies = Array.from(this.proxies.values())
      .filter(p => p.isHealthy && p.priority !== 'emergency')
      .sort((a, b) => a.failureCount - b.failureCount || a.avgResponseTime - b.avgResponseTime)

    if (healthyProxies.length > 0) {
      return healthyProxies[0]
    }

    // 3. 使用兜底代理
    const emergencyProxy = Array.from(this.proxies.values()).find(p => p.priority === 'emergency')
    return emergencyProxy || null
  }

  /**
   * 记录代理成功
   */
  recordSuccess(proxyUrl: string, responseTime: number): void {
    const proxy = this.proxies.get(proxyUrl)
    if (!proxy) return

    proxy.successCount++
    proxy.failureCount = Math.max(0, proxy.failureCount - 1) // 成功后减少失败计数
    proxy.avgResponseTime = (proxy.avgResponseTime + responseTime) / 2
    proxy.isHealthy = true

    console.log(`✅ 代理成功: ${proxyUrl} (${responseTime}ms)`)
  }

  /**
   * 记录代理失败
   */
  recordFailure(proxyUrl: string, error: string): void {
    const proxy = this.proxies.get(proxyUrl)
    if (!proxy) return

    proxy.failureCount++
    proxy.lastFailureTime = Date.now()

    // 超过阈值则标记为不健康
    if (proxy.failureCount >= this.MAX_FAILURES_THRESHOLD) {
      proxy.isHealthy = false
      console.warn(`⚠️ 代理标记为不健康: ${proxyUrl} (${proxy.failureCount}次失败)`)
    }

    console.error(`❌ 代理失败: ${proxyUrl}, 错误: ${error}`)
  }

  /**
   * 重置长时间未失败的代理健康状态
   */
  resetOldFailures(): void {
    const now = Date.now()
    for (const proxy of this.proxies.values()) {
      if (
        proxy.lastFailureTime &&
        now - proxy.lastFailureTime > this.FAILURE_RESET_TIME
      ) {
        proxy.failureCount = 0
        proxy.isHealthy = true
        proxy.lastFailureTime = null
        console.log(`🔄 代理健康状态已重置: ${proxy.url}`)
      }
    }
  }

  /**
   * 获取所有代理的健康状态
   */
  getProxyHealth(): Array<{ url: string; country: string; isHealthy: boolean; failureCount: number; successCount: number }> {
    return Array.from(this.proxies.values()).map(p => ({
      url: p.url,
      country: p.country,
      isHealthy: p.isHealthy,
      failureCount: p.failureCount,
      successCount: p.successCount,
    }))
  }
}

// 全局代理池实例
let proxyPoolInstance: ProxyPoolManager | null = null

export function getProxyPool(): ProxyPoolManager {
  if (!proxyPoolInstance) {
    proxyPoolInstance = new ProxyPoolManager()
  }
  return proxyPoolInstance
}

// ==================== Redis缓存管理 ====================

const CACHE_KEY_PREFIX = 'redirect:'
const CACHE_TTL = 7 * 24 * 60 * 60 // 7天（秒）

/**
 * 生成缓存键
 */
function getCacheKey(affiliateLink: string, targetCountry: string): string {
  return `${CACHE_KEY_PREFIX}${targetCountry}:${affiliateLink}`
}

/**
 * 从Redis获取缓存的重定向结果
 */
export async function getCachedRedirect(
  affiliateLink: string,
  targetCountry: string
): Promise<ResolvedUrlData | null> {
  try {
    const redis = getRedisClient()
    const cacheKey = getCacheKey(affiliateLink, targetCountry)
    const cached = await redis.get(cacheKey)

    if (cached) {
      const data = JSON.parse(cached) as ResolvedUrlData
      console.log(`✅ 缓存命中: ${affiliateLink}`)
      return { ...data, resolveMethod: 'cache' }
    }

    return null
  } catch (error) {
    console.error('Redis缓存读取失败:', error)
    return null
  }
}

/**
 * 将重定向结果存入Redis缓存
 */
export async function setCachedRedirect(
  affiliateLink: string,
  targetCountry: string,
  data: ResolvedUrlData
): Promise<void> {
  try {
    const redis = getRedisClient()
    const cacheKey = getCacheKey(affiliateLink, targetCountry)
    const cacheData = { ...data, cachedAt: Date.now() }

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(cacheData))
    console.log(`✅ 缓存已保存: ${affiliateLink} (TTL: ${CACHE_TTL}s)`)
  } catch (error) {
    console.error('Redis缓存写入失败:', error)
  }
}

// ==================== 智能重试策略 ====================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 2000, // 2秒
  maxDelay: 16000, // 16秒
  retryableErrors: [
    'timeout',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENETUNREACH',
    'ERR_NAME_NOT_RESOLVED',
  ],
}

/**
 * 指数退避计算延迟时间
 */
function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay)
  // 添加随机抖动（±20%）避免雷鸣羊群效应
  const jitter = delay * (0.8 + Math.random() * 0.4)
  return Math.floor(jitter)
}

/**
 * 判断错误是否可重试
 */
function isRetryableError(error: any, config: RetryConfig): boolean {
  const errorMessage = error.message || String(error)
  return config.retryableErrors.some(err => errorMessage.includes(err))
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ==================== HTTP请求方式（Level 1） ====================

async function resolveWithHttp(
  affiliateLink: string,
  proxyUrl: string
): Promise<ResolvedUrlData> {
  // TODO: 实现基础HTTP请求跟踪重定向
  // 这里暂时抛出错误，强制降级到Playwright
  throw new Error('HTTP请求暂未实现，降级到Playwright')
}

// ==================== Playwright方式（Level 2） ====================

async function resolveWithPlaywright(
  affiliateLink: string,
  proxyUrl: string
): Promise<ResolvedUrlData> {
  const result = await resolveAffiliateLinkWithPlaywright(affiliateLink, proxyUrl, 5000)

  return {
    finalUrl: result.finalUrl,
    finalUrlSuffix: result.finalUrlSuffix,
    brand: null, // 需要后续AI识别
    redirectChain: result.redirectChain,
    redirectCount: result.redirectCount,
    pageTitle: result.pageTitle,
    statusCode: result.statusCode,
    resolveMethod: 'playwright',
    proxyUsed: proxyUrl,
  }
}

// ==================== 核心解析函数（集成所有优化） ====================

export interface ResolveOptions {
  targetCountry: string
  skipCache?: boolean
  retryConfig?: Partial<RetryConfig>
}

/**
 * 增强的URL解析函数
 * 集成：缓存 → 多代理池 → 智能重试 → 降级方案
 */
export async function resolveAffiliateLink(
  affiliateLink: string,
  options: ResolveOptions
): Promise<ResolvedUrlData> {
  const { targetCountry, skipCache = false, retryConfig: customRetryConfig } = options
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...customRetryConfig }

  // ========== 步骤1: 检查Redis缓存 ==========
  if (!skipCache) {
    const cached = await getCachedRedirect(affiliateLink, targetCountry)
    if (cached) {
      return cached
    }
  }

  // ========== 步骤2: 获取代理池 ==========
  const proxyPool = getProxyPool()
  proxyPool.resetOldFailures() // 重置长时间未失败的代理

  let lastError: Error | null = null
  let attempt = 0

  // ========== 步骤3: 智能重试循环 ==========
  while (attempt <= retryConfig.maxRetries) {
    try {
      // 获取最佳代理
      const proxy = proxyPool.getBestProxyForCountry(targetCountry)
      if (!proxy) {
        throw new Error('没有可用的代理')
      }

      console.log(`🔄 尝试解析 (${attempt + 1}/${retryConfig.maxRetries + 1}): ${affiliateLink}`)
      console.log(`   使用代理: ${proxy.country} (${proxy.priority})`)

      const startTime = Date.now()

      // ========== 步骤4: 降级方案 ==========
      let result: ResolvedUrlData

      try {
        // Level 1: HTTP请求（快速但功能有限）
        result = await resolveWithHttp(affiliateLink, proxy.url)
      } catch (httpError) {
        console.log(`   HTTP失败，降级到Playwright`)
        // Level 2: Playwright（慢但功能强大）
        result = await resolveWithPlaywright(affiliateLink, proxy.url)
      }

      const responseTime = Date.now() - startTime

      // 记录代理成功
      proxyPool.recordSuccess(proxy.url, responseTime)

      // ========== 步骤5: 保存到缓存 ==========
      await setCachedRedirect(affiliateLink, targetCountry, result)

      console.log(`✅ 解析成功: ${result.finalUrl} (${responseTime}ms)`)
      return result
    } catch (error: any) {
      lastError = error
      console.error(`❌ 解析失败 (尝试 ${attempt + 1}):`, error.message)

      // 获取当前使用的代理并记录失败
      const currentProxy = proxyPool.getBestProxyForCountry(targetCountry)
      if (currentProxy) {
        proxyPool.recordFailure(currentProxy.url, error.message)
      }

      // 判断是否可重试
      if (!isRetryableError(error, retryConfig)) {
        console.error(`❌ 不可重试的错误，终止重试`)
        break
      }

      // 最后一次尝试失败，不再延迟
      if (attempt >= retryConfig.maxRetries) {
        break
      }

      // 计算延迟并等待
      const backoffDelay = calculateBackoffDelay(attempt, retryConfig)
      console.log(`⏳ 等待 ${backoffDelay}ms 后重试...`)
      await delay(backoffDelay)

      attempt++
    }
  }

  // ========== 所有重试都失败 ==========
  throw new Error(
    `URL解析失败（${retryConfig.maxRetries + 1}次尝试后）: ${lastError?.message || '未知错误'}`
  )
}

// ==================== 代理健康监控 ====================

/**
 * 获取代理池健康状态（供管理员页面使用）
 */
export function getProxyPoolHealth() {
  const proxyPool = getProxyPool()
  return proxyPool.getProxyHealth()
}

/**
 * 手动禁用不健康的代理
 */
export function disableProxy(proxyUrl: string): void {
  const proxyPool = getProxyPool()
  const proxies = (proxyPool as any).proxies as Map<string, ProxyConfig>
  const proxy = proxies.get(proxyUrl)
  if (proxy) {
    proxy.isHealthy = false
    console.log(`⚠️ 代理已手动禁用: ${proxyUrl}`)
  }
}

/**
 * 手动启用代理
 */
export function enableProxy(proxyUrl: string): void {
  const proxyPool = getProxyPool()
  const proxies = (proxyPool as any).proxies as Map<string, ProxyConfig>
  const proxy = proxies.get(proxyUrl)
  if (proxy) {
    proxy.isHealthy = true
    proxy.failureCount = 0
    proxy.lastFailureTime = null
    console.log(`✅ 代理已手动启用: ${proxyUrl}`)
  }
}
