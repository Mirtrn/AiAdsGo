/**
 * 增强的URL解析模块
 * 集成：多代理池管理 + Redis缓存 + 智能重试 + 降级方案
 */

import { getRedisClient } from './redis'
import { resolveAffiliateLinkWithPlaywright } from './url-resolver-playwright'
import type { PlaywrightResolvedUrl } from './url-resolver-playwright'
import { resolveAffiliateLinkWithHttp } from './url-resolver-http'
import { getOptimalResolver, extractDomain } from './resolver-domains'

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
  private lastHealthCheckTime: number = 0
  private isHealthCheckRunning: boolean = false

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

  /**
   * 主动健康检测：ping测试代理是否可用
   */
  async checkProxyHealth(proxyUrl: string, timeout: number = 5000): Promise<boolean> {
    try {
      const axios = (await import('axios')).default
      const { HttpsProxyAgent } = await import('https-proxy-agent')

      const agent = new HttpsProxyAgent(proxyUrl)
      const testUrl = 'https://www.amazon.com' // 使用Amazon作为测试目标

      const startTime = Date.now()
      await axios.head(testUrl, {
        httpsAgent: agent,
        httpAgent: agent as any,
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      const responseTime = Date.now() - startTime

      console.log(`✅ 代理健康检测通过: ${proxyUrl} (${responseTime}ms)`)
      return true
    } catch (error: any) {
      console.error(`❌ 代理健康检测失败: ${proxyUrl}, 错误: ${error.message}`)
      return false
    }
  }

  /**
   * 批量检测所有代理的健康状态
   * @param force 是否强制检测（忽略时间间隔限制）
   */
  async performHealthCheck(force: boolean = false): Promise<void> {
    const now = Date.now()

    // 检查是否需要执行健康检测
    if (!force && this.isHealthCheckRunning) {
      console.log('⏳ 健康检测正在进行中，跳过...')
      return
    }

    if (!force && now - this.lastHealthCheckTime < this.HEALTH_CHECK_INTERVAL) {
      const remainingTime = Math.floor((this.HEALTH_CHECK_INTERVAL - (now - this.lastHealthCheckTime)) / 1000 / 60)
      console.log(`⏳ 距离下次健康检测还有 ${remainingTime} 分钟`)
      return
    }

    this.isHealthCheckRunning = true
    this.lastHealthCheckTime = now

    console.log(`🔍 开始批量健康检测 (${this.proxies.size}个代理)...`)

    // 并行检测所有代理
    const healthCheckPromises = Array.from(this.proxies.entries()).map(async ([url, proxy]) => {
      const isHealthy = await this.checkProxyHealth(url, 10000)

      if (isHealthy) {
        // 健康检测通过，重置失败计数
        proxy.failureCount = Math.max(0, proxy.failureCount - 1)
        proxy.isHealthy = true
        proxy.lastFailureTime = null
      } else {
        // 健康检测失败，增加失败计数
        proxy.failureCount++
        proxy.lastFailureTime = Date.now()

        if (proxy.failureCount >= this.MAX_FAILURES_THRESHOLD) {
          proxy.isHealthy = false
          console.warn(`⚠️ 代理标记为不健康: ${url} (健康检测失败)`)
        }
      }
    })

    await Promise.all(healthCheckPromises)

    this.isHealthCheckRunning = false

    // 统计结果
    const healthyCount = Array.from(this.proxies.values()).filter(p => p.isHealthy).length
    const unhealthyCount = this.proxies.size - healthyCount

    console.log(`✅ 健康检测完成: ${healthyCount}个健康, ${unhealthyCount}个不健康`)
  }

  /**
   * 获取最佳可用代理（优先健康代理，必要时触发健康检测）
   */
  async getBestProxyWithHealthCheck(targetCountry: string): Promise<ProxyConfig | null> {
    // 检查是否需要健康检测
    const now = Date.now()
    if (now - this.lastHealthCheckTime > this.HEALTH_CHECK_INTERVAL && !this.isHealthCheckRunning) {
      // 后台异步执行健康检测（不阻塞当前请求）
      this.performHealthCheck().catch(err => {
        console.error('后台健康检测失败:', err)
      })
    }

    // 返回当前最佳代理
    return this.getBestProxyForCountry(targetCountry)
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
  const result = await resolveAffiliateLinkWithHttp(affiliateLink, proxyUrl, 10)

  return {
    finalUrl: result.finalUrl,
    finalUrlSuffix: result.finalUrlSuffix,
    brand: null, // 需要后续AI识别
    redirectChain: result.redirectChain,
    redirectCount: result.redirectCount,
    pageTitle: null, // HTTP方式无法获取页面标题
    statusCode: result.statusCode,
    resolveMethod: 'http',
    proxyUsed: proxyUrl,
  }
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

      // ========== 步骤4: 智能路由降级方案 ==========
      let result: ResolvedUrlData

      // 使用智能路由决策
      const resolverMethod = getOptimalResolver(affiliateLink)
      const domain = extractDomain(affiliateLink)
      console.log(`   智能路由决策: ${domain} → ${resolverMethod}`)

      if (resolverMethod === 'playwright') {
        // 已知JavaScript重定向域名，直接使用Playwright
        console.log(`   直接使用Playwright（已知需要JavaScript）`)
        result = await resolveWithPlaywright(affiliateLink, proxy.url)
      } else if (resolverMethod === 'http') {
        // 已知HTTP重定向域名（包括Meta Refresh），先使用HTTP
        try {
          console.log(`   尝试HTTP解析（已知HTTP/Meta Refresh重定向）`)
          result = await resolveWithHttp(affiliateLink, proxy.url)

          // KISS降级策略：检查是否停在了tracking URL
          const isTrackingUrl = /\/track|\/click|\/redirect|\/go|\/out|partnermatic|tradedoubler|awin|impact|cj\.com/i.test(result.finalUrl)

          if (isTrackingUrl) {
            console.log(`   ⚠️ 检测到tracking URL，可能需要继续追踪`)
            console.log(`   降级到Playwright完成后续重定向...`)
            const playwrightResult = await resolveWithPlaywright(result.finalUrl, proxy.url)

            // 合并重定向链
            result = {
              ...playwrightResult,
              redirectChain: [...result.redirectChain, ...playwrightResult.redirectChain.slice(1)],
              redirectCount: result.redirectCount + playwrightResult.redirectCount,
            }
          }
        } catch (httpError: any) {
          // 🔥 修复：HTTP失败时降级到Playwright
          console.log(`   HTTP失败: ${httpError.message}`)
          console.log(`   降级到Playwright...`)
          result = await resolveWithPlaywright(affiliateLink, proxy.url)
        }
      } else {
        // 未知域名，先尝试HTTP，失败则降级到Playwright
        try {
          console.log(`   尝试HTTP解析（未知域名）...`)
          result = await resolveWithHttp(affiliateLink, proxy.url)

          // 检查是否真的有重定向（如果redirectCount=0可能需要Playwright）
          if (result.redirectCount === 0 && affiliateLink !== result.finalUrl) {
            // URL改变了但redirectCount为0，可能是JavaScript重定向
            console.log(`   检测到可能的JavaScript重定向，降级到Playwright`)
            result = await resolveWithPlaywright(affiliateLink, proxy.url)
          } else if (result.redirectCount === 0) {
            // URL没变且无重定向，可能是短链接服务
            console.log(`   ⚠️ 无重定向检测到，尝试Playwright验证`)
            const playwrightResult = await resolveWithPlaywright(affiliateLink, proxy.url)
            // 如果Playwright获得了不同的结果，使用Playwright结果
            if (playwrightResult.finalUrl !== result.finalUrl || playwrightResult.redirectCount > 0) {
              console.log(`   ✅ Playwright发现了额外的重定向`)
              result = playwrightResult
            }
          }
        } catch (httpError: any) {
          console.log(`   HTTP失败: ${httpError.message}`)
          console.log(`   降级到Playwright...`)
          result = await resolveWithPlaywright(affiliateLink, proxy.url)
        }
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
