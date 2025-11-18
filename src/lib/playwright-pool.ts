/**
 * Playwright浏览器连接池
 *
 * 目标: 减少50%启动时间（10秒 → 5秒）
 * 原理: 复用浏览器实例和context
 * KISS: 简单的连接池实现，无外部依赖
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright'

/**
 * 连接池配置
 */
const POOL_CONFIG = {
  maxInstances: 5,              // 最大浏览器实例数
  maxIdleTime: 5 * 60 * 1000,   // 5分钟空闲后释放
  launchTimeout: 30000,         // 启动超时30秒
}

/**
 * 浏览器实例信息
 */
interface BrowserInstance {
  browser: Browser
  context: BrowserContext
  proxyKey: string              // 代理配置的唯一标识
  createdAt: number
  lastUsedAt: number
  inUse: boolean
}

/**
 * 连接池
 */
class PlaywrightPool {
  private instances: Map<string, BrowserInstance> = new Map()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // 启动定期清理任务
    this.startCleanupTask()
  }

  /**
   * 获取或创建浏览器实例
   */
  async acquire(proxyUrl?: string): Promise<{ browser: Browser; context: BrowserContext }> {
    const proxyKey = proxyUrl || 'no-proxy'

    // 1. 尝试复用现有实例
    const existing = this.instances.get(proxyKey)
    if (existing && !existing.inUse) {
      try {
        // 验证实例是否仍然有效
        const isConnected = existing.browser.isConnected()
        if (isConnected) {
          existing.inUse = true
          existing.lastUsedAt = Date.now()
          console.log(`复用Playwright实例: ${proxyKey}`)
          return { browser: existing.browser, context: existing.context }
        } else {
          // 实例已断开，清理
          console.log(`实例已断开，清理: ${proxyKey}`)
          this.instances.delete(proxyKey)
        }
      } catch (error) {
        console.warn('实例验证失败，清理:', error)
        this.instances.delete(proxyKey)
      }
    }

    // 2. 检查连接池大小限制
    if (this.instances.size >= POOL_CONFIG.maxInstances) {
      // 尝试清理空闲实例
      await this.cleanupIdleInstances()

      // 如果仍然超限，清理最旧的实例
      if (this.instances.size >= POOL_CONFIG.maxInstances) {
        await this.cleanupOldestInstance()
      }
    }

    // 3. 创建新实例
    console.log(`创建新Playwright实例: ${proxyKey}`)
    const { browser, context } = await this.createInstance(proxyUrl)

    const instance: BrowserInstance = {
      browser,
      context,
      proxyKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: true,
    }

    this.instances.set(proxyKey, instance)

    return { browser, context }
  }

  /**
   * 释放浏览器实例（标记为可复用）
   */
  release(proxyUrl?: string): void {
    const proxyKey = proxyUrl || 'no-proxy'
    const instance = this.instances.get(proxyKey)

    if (instance) {
      instance.inUse = false
      instance.lastUsedAt = Date.now()
      console.log(`释放Playwright实例: ${proxyKey}`)
    }
  }

  /**
   * 创建新的浏览器实例
   */
  private async createInstance(proxyUrl?: string): Promise<{ browser: Browser; context: BrowserContext }> {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      timeout: POOL_CONFIG.launchTimeout,
    })

    let contextOptions: any = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    }

    // 如果提供了代理URL，获取代理凭证
    if (proxyUrl) {
      try {
        const { getProxyIp } = await import('./proxy/fetch-proxy-ip')
        const proxy = await getProxyIp(proxyUrl)

        contextOptions.proxy = {
          server: `http://${proxy.host}:${proxy.port}`,
          username: proxy.username,
          password: proxy.password,
        }

        console.log(`Playwright实例使用代理: ${proxy.fullAddress}`)
      } catch (error) {
        console.warn('获取代理失败，使用直连:', error)
      }
    }

    const context = await browser.newContext(contextOptions)

    return { browser, context }
  }

  /**
   * 清理空闲实例
   */
  private async cleanupIdleInstances(): Promise<void> {
    const now = Date.now()
    const instancesToClean: string[] = []

    for (const [key, instance] of this.instances.entries()) {
      if (!instance.inUse && now - instance.lastUsedAt > POOL_CONFIG.maxIdleTime) {
        instancesToClean.push(key)
      }
    }

    for (const key of instancesToClean) {
      await this.closeInstance(key)
    }

    if (instancesToClean.length > 0) {
      console.log(`清理${instancesToClean.length}个空闲Playwright实例`)
    }
  }

  /**
   * 清理最旧的实例
   */
  private async cleanupOldestInstance(): Promise<void> {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, instance] of this.instances.entries()) {
      if (!instance.inUse && instance.lastUsedAt < oldestTime) {
        oldestKey = key
        oldestTime = instance.lastUsedAt
      }
    }

    if (oldestKey) {
      console.log(`清理最旧的Playwright实例: ${oldestKey}`)
      await this.closeInstance(oldestKey)
    }
  }

  /**
   * 关闭指定实例
   */
  private async closeInstance(key: string): Promise<void> {
    const instance = this.instances.get(key)
    if (!instance) return

    try {
      await instance.context.close().catch(() => {})
      await instance.browser.close().catch(() => {})
    } catch (error) {
      console.warn(`关闭实例失败: ${key}`, error)
    }

    this.instances.delete(key)
  }

  /**
   * 启动定期清理任务
   */
  private startCleanupTask(): void {
    // 每分钟清理一次
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleInstances()
    }, 60 * 1000)
  }

  /**
   * 停止清理任务
   */
  private stopCleanupTask(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * 关闭连接池，清理所有实例
   */
  async closeAll(): Promise<void> {
    this.stopCleanupTask()

    console.log(`关闭Playwright连接池，共${this.instances.size}个实例`)

    const closePromises = Array.from(this.instances.keys()).map((key) =>
      this.closeInstance(key)
    )

    await Promise.all(closePromises)

    this.instances.clear()
  }

  /**
   * 获取连接池统计信息
   */
  getStats(): {
    totalInstances: number
    inUseInstances: number
    idleInstances: number
    instances: Array<{
      proxyKey: string
      inUse: boolean
      ageSeconds: number
      idleSeconds: number
    }>
  } {
    const now = Date.now()
    const instances = Array.from(this.instances.entries()).map(([key, instance]) => ({
      proxyKey: key,
      inUse: instance.inUse,
      ageSeconds: Math.floor((now - instance.createdAt) / 1000),
      idleSeconds: Math.floor((now - instance.lastUsedAt) / 1000),
    }))

    return {
      totalInstances: this.instances.size,
      inUseInstances: instances.filter((i) => i.inUse).length,
      idleInstances: instances.filter((i) => !i.inUse).length,
      instances,
    }
  }
}

// 全局单例连接池
let globalPool: PlaywrightPool | null = null

/**
 * 获取全局连接池实例
 */
export function getPlaywrightPool(): PlaywrightPool {
  if (!globalPool) {
    globalPool = new PlaywrightPool()
  }
  return globalPool
}

/**
 * 关闭全局连接池（用于测试或应用关闭）
 */
export async function closePlaywrightPool(): Promise<void> {
  if (globalPool) {
    await globalPool.closeAll()
    globalPool = null
  }
}

/**
 * 获取连接池统计信息
 */
export function getPlaywrightPoolStats() {
  if (!globalPool) {
    return {
      totalInstances: 0,
      inUseInstances: 0,
      idleInstances: 0,
      instances: [],
    }
  }
  return globalPool.getStats()
}
