/**
 * Playwright浏览器连接池 v2
 *
 * 目标: 支持更高并发抓取
 * 优化:
 * - 扩容到10个实例
 * - 支持同一代理多实例（并发抓取）
 * - 添加等待队列机制
 * - 预热功能
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright'

/**
 * 连接池配置
 */
const POOL_CONFIG = {
  maxInstances: 10,             // 最大浏览器实例数 (从5扩容到10)
  maxInstancesPerProxy: 3,      // 每个代理最大实例数（支持并发）
  maxIdleTime: 5 * 60 * 1000,   // 5分钟空闲后释放
  launchTimeout: 30000,         // 启动超时30秒
  acquireTimeout: 60000,        // 获取实例超时60秒
  warmupCount: 2,               // 预热实例数
}

/**
 * 浏览器实例信息
 */
interface BrowserInstance {
  id: string                    // 实例唯一ID
  browser: Browser
  context: BrowserContext
  contextOptions: any           // 保存context配置供复用
  proxyKey: string              // 代理配置的唯一标识
  createdAt: number
  lastUsedAt: number
  inUse: boolean
}

/**
 * 等待队列项
 */
interface WaitingRequest {
  proxyKey: string
  resolve: (result: { browser: Browser; context: BrowserContext; instanceId: string }) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

/**
 * 连接池 v2
 */
class PlaywrightPool {
  private instances: Map<string, BrowserInstance> = new Map()
  private waitingQueue: WaitingRequest[] = []
  private cleanupInterval: NodeJS.Timeout | null = null
  private instanceCounter = 0

  constructor() {
    // 启动定期清理任务
    this.startCleanupTask()
  }

  /**
   * 生成唯一实例ID
   */
  private generateInstanceId(): string {
    return `instance_${++this.instanceCounter}_${Date.now()}`
  }

  /**
   * 🔥 为context添加stealth脚本（与scraper-stealth.ts一致）
   */
  private async addStealthScripts(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
      // Override navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      })

      // Override plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      })

      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      })

      // Override permissions
      const originalQuery = window.navigator.permissions.query
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters)
    })
  }

  /**
   * 统计指定代理的实例数
   */
  private countInstancesForProxy(proxyKey: string): number {
    let count = 0
    for (const instance of this.instances.values()) {
      if (instance.proxyKey === proxyKey) {
        count++
      }
    }
    return count
  }

  /**
   * 查找可复用的空闲实例
   */
  private findIdleInstance(proxyKey: string): BrowserInstance | null {
    for (const instance of this.instances.values()) {
      if (instance.proxyKey === proxyKey && !instance.inUse) {
        return instance
      }
    }
    return null
  }

  /**
   * 获取或创建浏览器实例
   * @param proxyUrl - 代理API URL（会调用getProxyIp获取凭证）
   * @param proxyCredentials - 直接传入的代理凭证（来自代理池缓存，跳过API调用）
   */
  async acquire(proxyUrl?: string, proxyCredentials?: { host: string; port: number; username: string; password: string }): Promise<{ browser: Browser; context: BrowserContext; instanceId: string }> {
    // 生成proxyKey用于实例匹配
    const proxyKey = proxyCredentials
      ? `${proxyCredentials.host}:${proxyCredentials.port}`
      : (proxyUrl || 'no-proxy')

    // 1. 尝试复用现有空闲实例
    const existing = this.findIdleInstance(proxyKey)
    if (existing) {
      try {
        // 验证实例是否仍然有效
        const isConnected = existing.browser.isConnected()
        if (isConnected) {
          // 关闭旧context，创建新context（避免状态污染）
          await existing.context.close().catch(() => {})
          const newContext = await existing.browser.newContext(existing.contextOptions)

          // 🔥 关键：为复用的context添加stealth脚本
          await this.addStealthScripts(newContext)

          existing.context = newContext
          existing.inUse = true
          existing.lastUsedAt = Date.now()
          console.log(`🔄 复用Playwright实例: ${existing.id} (${proxyKey})`)
          return { browser: existing.browser, context: newContext, instanceId: existing.id }
        } else {
          // 实例已断开，清理
          console.log(`❌ 实例已断开，清理: ${existing.id}`)
          this.instances.delete(existing.id)
        }
      } catch (error) {
        console.warn('实例验证失败，清理:', error)
        this.instances.delete(existing.id)
      }
    }

    // 2. 检查是否可以创建新实例
    const proxyInstanceCount = this.countInstancesForProxy(proxyKey)
    const canCreateForProxy = proxyInstanceCount < POOL_CONFIG.maxInstancesPerProxy
    const canCreateGlobal = this.instances.size < POOL_CONFIG.maxInstances

    if (canCreateForProxy && canCreateGlobal) {
      // 直接创建新实例
      return await this.createAndRegisterInstance(proxyUrl, proxyCredentials)
    }

    // 3. 尝试清理空闲实例腾出空间
    if (!canCreateGlobal) {
      await this.cleanupIdleInstances()

      if (this.instances.size < POOL_CONFIG.maxInstances) {
        return await this.createAndRegisterInstance(proxyUrl)
      }

      // 清理最旧的实例
      await this.cleanupOldestInstance()
      if (this.instances.size < POOL_CONFIG.maxInstances) {
        return await this.createAndRegisterInstance(proxyUrl)
      }
    }

    // 4. 加入等待队列
    console.log(`⏳ 实例池已满，加入等待队列: ${proxyKey}`)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingQueue.findIndex(w => w.resolve === resolve)
        if (index !== -1) {
          this.waitingQueue.splice(index, 1)
        }
        reject(new Error(`获取Playwright实例超时 (${POOL_CONFIG.acquireTimeout}ms)`))
      }, POOL_CONFIG.acquireTimeout)

      this.waitingQueue.push({
        proxyKey,
        resolve,
        reject,
        timeout,
      })
    })
  }

  /**
   * 创建并注册新实例
   */
  private async createAndRegisterInstance(proxyUrl?: string, proxyCredentials?: { host: string; port: number; username: string; password: string }): Promise<{ browser: Browser; context: BrowserContext; instanceId: string }> {
    const proxyKey = proxyCredentials
      ? `${proxyCredentials.host}:${proxyCredentials.port}`
      : (proxyUrl || 'no-proxy')
    const instanceId = this.generateInstanceId()

    console.log(`🚀 创建新Playwright实例: ${instanceId} (${proxyKey})`)
    const { browser, context, contextOptions } = await this.createInstance(proxyUrl, proxyCredentials)

    const instance: BrowserInstance = {
      id: instanceId,
      browser,
      context,
      contextOptions,
      proxyKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: true,
    }

    this.instances.set(instanceId, instance)
    console.log(`📊 连接池状态: ${this.instances.size}/${POOL_CONFIG.maxInstances} 实例`)

    return { browser, context, instanceId }
  }

  /**
   * 释放浏览器实例（标记为可复用）
   */
  release(instanceId: string): void {
    const instance = this.instances.get(instanceId)

    if (instance) {
      instance.inUse = false
      instance.lastUsedAt = Date.now()
      console.log(`✅ 释放Playwright实例: ${instanceId}`)

      // 检查等待队列，唤醒等待的请求
      this.processWaitingQueue()
    }
  }

  /**
   * 🔥 P1优化：作废并关闭指定实例（用于代理失效场景）
   * 当检测到代理连接问题时调用此方法，强制关闭失效实例
   */
  async invalidate(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId)
    if (instance) {
      console.log(`🗑️ 作废并关闭失效实例: ${instanceId}`)
      try {
        await instance.context?.close().catch(() => {})
        await instance.browser?.close().catch(() => {})
      } catch (e) {
        // 忽略关闭错误
      }
      this.instances.delete(instanceId)
    }
  }

  /**
   * 🔥 P1优化：清理所有空闲实例（public方法，用于代理重试场景）
   */
  async clearIdleInstances(): Promise<number> {
    let clearedCount = 0
    const idleInstances = Array.from(this.instances.entries())
      .filter(([_, instance]) => !instance.inUse)

    for (const [key, instance] of idleInstances) {
      try {
        await instance.context?.close().catch(() => {})
        await instance.browser?.close().catch(() => {})
        this.instances.delete(key)
        clearedCount++
      } catch (e) {
        // 忽略关闭错误
      }
    }

    if (clearedCount > 0) {
      console.log(`🧹 清理了 ${clearedCount} 个空闲实例`)
    }
    return clearedCount
  }

  /**
   * 处理等待队列
   */
  private async processWaitingQueue(): Promise<void> {
    if (this.waitingQueue.length === 0) return

    // 查找可以服务的等待请求
    for (let i = 0; i < this.waitingQueue.length; i++) {
      const waiting = this.waitingQueue[i]
      const idleInstance = this.findIdleInstance(waiting.proxyKey)

      if (idleInstance) {
        // 移除等待请求
        this.waitingQueue.splice(i, 1)
        clearTimeout(waiting.timeout)

        try {
          // 复用实例
          await idleInstance.context.close().catch(() => {})
          const newContext = await idleInstance.browser.newContext(idleInstance.contextOptions)

          // 🔥 关键：为复用的context添加stealth脚本
          await this.addStealthScripts(newContext)

          idleInstance.context = newContext
          idleInstance.inUse = true
          idleInstance.lastUsedAt = Date.now()

          console.log(`🔄 从队列唤醒，复用实例: ${idleInstance.id}`)
          waiting.resolve({ browser: idleInstance.browser, context: newContext, instanceId: idleInstance.id })
        } catch (error) {
          waiting.reject(error as Error)
        }
        return
      }
    }
  }

  /**
   * 创建新的浏览器实例
   */
  private async createInstance(proxyUrl?: string, proxyCredentials?: { host: string; port: number; username: string; password: string }): Promise<{ browser: Browser; context: BrowserContext; contextOptions: any }> {
    // 🔥 代理必须在browser.launch时配置，无法在newContext时动态配置
    let launchOptions: any = {
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled', // 🔥 反爬虫关键参数
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
      ],
      timeout: POOL_CONFIG.launchTimeout,
    }

    // 如果提供了直接的代理凭证（来自代理池缓存），直接使用
    let proxy: any = null
    if (proxyCredentials) {
      proxy = proxyCredentials
      console.log(`🔒 [缓存] 使用代理: ${proxy.host}:${proxy.port}`)
    } else if (proxyUrl) {
      // 如果提供了代理URL，获取代理凭证并在launch时配置
      const { getProxyIp } = await import('./proxy/fetch-proxy-ip')
      // 🔥 严禁降级为直连，代理获取失败应该抛出错误（需求10）
      // 🔥 P1修复: 每次都获取新IP，避免重复使用被封禁的代理
      proxy = await getProxyIp(proxyUrl, true) // forceRefresh=true 总是获取新IP
      console.log(`🔒 [独立] 使用代理: ${proxy.host}:${proxy.port}`)
    }

    if (proxy) {
      launchOptions.proxy = {
        server: `http://${proxy.host}:${proxy.port}`,
        username: proxy.username,
        password: proxy.password,
      }

      const proxySource = proxyCredentials ? '[缓存]' : '[独立]'
      console.log(`✅ Playwright实例使用代理 ${proxySource}: ${proxy.host}:${proxy.port}`)
    }

    const browser = await chromium.launch(launchOptions)

    // 🔥 关键：使用与scraper-stealth.ts相同的User-Agent轮换池
    const USER_AGENTS = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    ]
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]

    let contextOptions: any = {
      userAgent: randomUserAgent,
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    }

    const context = await browser.newContext(contextOptions)

    // 🔥 关键：添加stealth脚本到context（与scraper-stealth.ts一致）
    await this.addStealthScripts(context)

    return { browser, context, contextOptions }
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
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupIdleInstances()

      // 🔥 P2优化: 定期检测泄露
      const leaks = this.detectLeaks()
      if (leaks.hasLeaks) {
        console.warn(`⚠️ 连接池泄露检测报告:`)
        leaks.warnings.forEach(w => console.warn(`   - ${w}`))

        // 自动强制释放泄露实例
        await this.forceReleaseLeaks()
      } else if (leaks.warnings.length > 0) {
        // 即使没有泄露，也打印警告
        leaks.warnings.forEach(w => console.warn(`⚠️ ${w}`))
      }
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

  /**
   * 🔥 P2优化: 资源泄露检测
   * 检测长时间inUse的实例（可能忘记release）
   */
  detectLeaks(): {
    hasLeaks: boolean
    leakedInstances: Array<{
      id: string
      proxyKey: string
      inUseDuration: number  // 使用中的时长（秒）
      ageSeconds: number     // 实例年龄（秒）
    }>
    warnings: string[]
  } {
    const now = Date.now()
    const leakedInstances: Array<{
      id: string
      proxyKey: string
      inUseDuration: number
      ageSeconds: number
    }> = []
    const warnings: string[] = []

    // 检测1: 长时间inUse的实例（超过10分钟）
    const LEAK_THRESHOLD = 10 * 60 * 1000  // 10分钟

    for (const [key, instance] of this.instances.entries()) {
      if (instance.inUse) {
        const inUseDuration = now - instance.lastUsedAt

        if (inUseDuration > LEAK_THRESHOLD) {
          leakedInstances.push({
            id: instance.id,
            proxyKey: instance.proxyKey,
            inUseDuration: Math.floor(inUseDuration / 1000),
            ageSeconds: Math.floor((now - instance.createdAt) / 1000),
          })
          warnings.push(`实例 ${instance.id} 已使用 ${Math.floor(inUseDuration / 60000)} 分钟，可能未正确释放`)
        }
      }
    }

    // 检测2: 实例总数接近上限
    if (this.instances.size >= POOL_CONFIG.maxInstances * 0.8) {
      warnings.push(`连接池使用率达到 ${Math.round((this.instances.size / POOL_CONFIG.maxInstances) * 100)}%，接近上限`)
    }

    // 检测3: 等待队列过长
    if (this.waitingQueue.length > 5) {
      warnings.push(`等待队列有 ${this.waitingQueue.length} 个请求等待，可能需要扩容`)
    }

    return {
      hasLeaks: leakedInstances.length > 0,
      leakedInstances,
      warnings,
    }
  }

  /**
   * 🔥 P2优化: 强制释放泄露的实例
   */
  async forceReleaseLeaks(): Promise<number> {
    const leaks = this.detectLeaks()

    if (!leaks.hasLeaks) {
      return 0
    }

    console.warn(`⚠️ 检测到 ${leaks.leakedInstances.length} 个泄露实例，强制释放...`)

    for (const leak of leaks.leakedInstances) {
      const instance = Array.from(this.instances.values()).find(i => i.id === leak.id)
      if (instance) {
        console.warn(`⚠️ 强制释放: ${leak.id} (使用时长: ${leak.inUseDuration}秒)`)

        // 强制标记为空闲
        instance.inUse = false
        instance.lastUsedAt = Date.now()

        // 重新创建context（清理可能的页面资源）
        try {
          await instance.context.close().catch(() => {})
          instance.context = await instance.browser.newContext(instance.contextOptions)
        } catch (error) {
          console.error(`⚠️ 重建context失败: ${leak.id}`, error)
          // 如果重建失败，直接关闭实例
          await this.closeInstance(leak.id)
        }
      }
    }

    return leaks.leakedInstances.length
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
