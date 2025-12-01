/**
 * Enhanced Playwright-based scraper with stealth mode
 * Bypasses anti-bot detection for Amazon and other protected sites
 *
 * P0优化: 集成playwright连接池，减少80-90%启动时间
 * P1优化: 智能等待策略，减少30%等待时间
 * P1优化: 代理失败快速失败+换新代理重试
 */
import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { getProxyIp, ProxyCredentials } from './proxy/fetch-proxy-ip'
import { getProxyPoolManager } from './proxy/proxy-pool'
import { getPlaywrightPool } from './playwright-pool'
import { normalizeBrandName } from './offer-utils'
import { smartWaitForLoad, assessPageComplexity, recordWaitOptimization } from './smart-wait-strategy'

// 标记是否使用连接池（便于测试和回退）
const USE_POOL = true

const PROXY_ENABLED = process.env.PROXY_ENABLED === 'true'
const PROXY_URL = process.env.PROXY_URL || ''

/**
 * 🔥 P1优化：判断是否为代理连接错误（全局可用）
 */
export function isProxyConnectionError(error: Error): boolean {
  const msg = error.message || ''

  // 明确的代理连接错误（保留）
  if (msg.includes('Proxy connection ended') ||
      msg.includes('net::ERR_PROXY') ||
      msg.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
    return true
  }

  // TCP连接错误（但需要包含proxy关键词才算代理问题）
  if ((msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED')) &&
      msg.toLowerCase().includes('proxy')) {
    return true
  }

  // ETIMEDOUT只在明确与代理相关时才算代理错误
  if (msg.includes('ETIMEDOUT') && msg.toLowerCase().includes('proxy')) {
    return true
  }

  // 🔥 新增：page.goto超时很可能是代理IP被Amazon封禁
  // Amazon会立即封禁代理IP，导致page.goto永远无法完成（不是网络慢，而是被墙）
  // 这种情况下应该立即换代理，而不是用同一代理重试3次
  if (msg.includes('page.goto: Timeout') && msg.includes('exceeded')) {
    // 检查URL是否为Amazon（避免误判其他站点的正常慢速加载）
    if (msg.includes('amazon.')) {
      return true  // Amazon超时 = 代理被封
    }
  }

  // 超时错误需要更明确的代理关键词
  if (msg.includes('Timeout') &&
      (msg.includes('proxy') || msg.includes('tunnel') || msg.includes('CONNECT'))) {
    return true
  }

  return false
}

/**
 * 🔥 P1优化：带代理换新重试的执行包装器
 * 当代理连接失败时，清理连接池并获取新代理重试
 *
 * @param fn - 需要执行的异步函数
 * @param maxProxyRetries - 最大代理重试次数（默认2）
 * @param operationName - 操作名称（用于日志）
 */
export async function withProxyRetry<T>(
  fn: () => Promise<T>,
  maxProxyRetries: number = 2,
  operationName: string = '操作'
): Promise<T> {
  let lastError: Error | undefined

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 ${operationName} - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池...`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        // 短暂延迟后重试
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      return await fn()
    } catch (error: any) {
      lastError = error
      console.error(`❌ ${operationName} 尝试 ${proxyAttempt + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (isProxyConnectionError(error) && proxyAttempt < maxProxyRetries) {
        console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
        continue
      }

      // 其他错误或已用尽重试次数
      throw error
    }
  }

  throw lastError || new Error(`${operationName}失败：已用尽所有代理重试`)
}

/**
 * User-Agent rotation pool (2024 browsers)
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
]

/**
 * Get random User-Agent
 */
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

/**
 * Random delay between min and max milliseconds (human-like behavior)
 */
function randomDelay(min: number = 1000, max: number = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise(resolve => setTimeout(resolve, delay))
}

/**
 * 🔥 P1优化: 根据URL动态计算超时时间
 * 基于页面复杂度自动调整，避免固定超时
 */
function getDynamicTimeout(url: string): number {
  const complexity = assessPageComplexity(url)
  console.log(`📊 页面复杂度: ${complexity.complexity}, 推荐timeout: ${complexity.recommendedTimeout}ms (URL: ${url})`)
  return complexity.recommendedTimeout
}

/**
 * Exponential backoff retry logic
 * 🔥 P1优化：添加代理连接失败的快速失败逻辑
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error
      const errorMsg = error.message || ''

      // 🔥 不重试的错误类型：
      // 1. HTTP 404/403 错误（页面不存在/被禁止）
      // 2. 代理连接失败（需要换代理，重试同一个代理无意义）
      if (errorMsg.includes('404') || errorMsg.includes('403')) {
        console.log(`❌ HTTP错误，不重试: ${errorMsg}`)
        throw error
      }

      // 🔥 P1优化：代理连接失败时快速失败，不进行无效重试
      // 因为retryWithBackoff使用同一个browserResult（同一代理），重试是无效的
      // 使用统一的isProxyConnectionError()函数判断
      if (isProxyConnectionError(error)) {
        console.log(`❌ 代理连接失败，跳过无效重试: ${errorMsg.substring(0, 100)}`)
        throw error
      }

      // Calculate exponential backoff delay
      const delay = baseDelay * Math.pow(2, attempt)
      const jitter = Math.random() * 1000 // Add jitter

      console.log(`Retry attempt ${attempt + 1}/${maxRetries}, waiting ${delay + jitter}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay + jitter))
    }
  }

  throw lastError || new Error('Max retries exceeded')
}

/**
 * 浏览器实例结果（支持连接池和独立创建两种模式）
 */
interface StealthBrowserResult {
  browser: Browser
  context: BrowserContext
  proxy?: ProxyCredentials
  instanceId?: string  // 连接池模式时有值
  fromPool: boolean    // 标记是否来自连接池
}

/**
 * Create stealth browser context
 * P0优化: 优先使用连接池，减少80-90%启动时间
 * P0优化: 集成代理IP池预热缓存，节省3-5s
 */
async function createStealthBrowser(proxyUrl?: string, targetCountry?: string): Promise<StealthBrowserResult> {
  // 🔴 根据需求10：必须使用代理，不允许降级为直连访问
  const effectiveProxyUrl = proxyUrl || PROXY_URL
  if (!effectiveProxyUrl) {
    throw new Error('❌ 代理配置缺失：根据需求10，必须配置代理URL(PROXY_URL环境变量或传入customProxyUrl参数)，不允许直连访问')
  }

  // 🔥 P0优化: 使用连接池获取实例
  if (USE_POOL) {
    try {
      const pool = getPlaywrightPool()
      const { browser, context, instanceId } = await pool.acquire(effectiveProxyUrl)
      console.log(`🔄 [连接池] 获取Playwright实例: ${instanceId}`)
      return { browser, context, instanceId, fromPool: true }
    } catch (poolError: any) {
      console.warn(`⚠️ 连接池获取失败，降级为独立创建: ${poolError.message}`)
      // 降级为传统方式
    }
  }

  // 传统方式：独立创建浏览器实例
  // 🔥 P0优化: 尝试使用代理IP池预热缓存（cache hit = 节省3-5s）
  let proxy: ProxyCredentials | null = null

  if (targetCountry) {
    try {
      const proxyPool = getProxyPoolManager()
      const cachedProxy = await proxyPool.getHealthyProxy(targetCountry)
      if (cachedProxy) {
        proxy = {
          ...cachedProxy,
          fullAddress: `${cachedProxy.host}:${cachedProxy.port}:${cachedProxy.username || ''}:${cachedProxy.password || ''}`
        }
        console.log(`🔥 [代理池] Cache HIT: ${proxy?.host}:${proxy?.port} (${targetCountry})`)
      }
    } catch (poolError: any) {
      console.warn(`⚠️ 代理池获取失败，降级为直接fetch: ${poolError.message}`)
    }
  }

  // 如果代理池未命中，降级为传统getProxyIp
  if (!proxy) {
    proxy = await getProxyIp(effectiveProxyUrl)
    console.log(`🔒 [独立] 使用代理: ${proxy.host}:${proxy.port}`)
  }

  // Launch browser with stealth settings
  const browser = await chromium.launch({
    headless: true, // Use headless for production
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
    ],
    proxy: {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
    },
  })

  const context = await browser.newContext({
    userAgent: getRandomUserAgent(),
  })

  return { browser, context, proxy, fromPool: false }
}

/**
 * 释放浏览器实例（连接池模式返回池，独立模式关闭）
 */
async function releaseBrowser(result: StealthBrowserResult): Promise<void> {
  if (result.fromPool && result.instanceId) {
    const pool = getPlaywrightPool()
    pool.release(result.instanceId)
    console.log(`✅ [连接池] 释放实例: ${result.instanceId}`)
  } else {
    await result.context?.close().catch(() => {})
    await result.browser?.close().catch(() => {})
    console.log(`✅ [独立] 关闭浏览器实例`)
  }
}

/**
 * Configure page with stealth settings
 * 🔥 增强反爬虫规避：更多浏览器指纹伪装和行为模拟
 * 🌍 支持根据目标国家动态配置语言
 */
async function configureStealthPage(page: Page, targetCountry?: string): Promise<void> {
  const userAgent = getRandomUserAgent()

  // 🌍 根据目标国家动态生成 Accept-Language
  let acceptLanguage = 'en-US,en;q=0.9'  // 默认英语
  let navigatorLanguages = ['en-US', 'en']  // 默认语言列表

  if (targetCountry) {
    const { getLanguageCodeForCountry, getAcceptLanguageHeader } = await import('./language-country-codes')
    const langCode = getLanguageCodeForCountry(targetCountry)
    acceptLanguage = getAcceptLanguageHeader(langCode)

    // 从 Accept-Language 解析出语言列表
    navigatorLanguages = acceptLanguage.split(',').map(lang => lang.split(';')[0].trim())

    console.log(`🌍 目标国家: ${targetCountry}, Accept-Language: ${acceptLanguage}`)
  }

  // Set user agent with realistic headers
  await page.setExtraHTTPHeaders({
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': acceptLanguage,  // 🌍 动态语言支持
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    // 🔥 添加DNT和真实Referer
    'DNT': '1',
    'Sec-CH-UA': '"Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
  })

  // 🔥 增强浏览器指纹伪装（需要将动态语言传入脚本）
  const languagesForScript = navigatorLanguages
  await page.addInitScript((langs: string[]) => {
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    })

    // 🔥 伪装Chrome运行时
    const win = window as any
    win.chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {}
    }

    // Override plugins with realistic values
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
      ],
    })

    // 🌍 动态语言列表（根据目标国家）
    Object.defineProperty(navigator, 'languages', {
      get: () => langs,
    })

    // 🔥 伪装真实屏幕分辨率和颜色深度
    Object.defineProperty(screen, 'colorDepth', {
      get: () => 24,
    })
    Object.defineProperty(screen, 'pixelDepth', {
      get: () => 24,
    })

    // 🔥 伪装真实硬件并发数
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    })

    // 🔥 伪装设备内存
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    })

    // Override permissions
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters)

    // 🔥 伪装Battery API
    Object.defineProperty(navigator, 'getBattery', {
      value: () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1.0,
      })
    })

    // 🔥 伪装Connection API
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        downlink: 10,
        rtt: 50,
        saveData: false,
      })
    })
  }, languagesForScript)  // 🌍 将动态语言列表传入脚本

  // 🔥 设置真实的viewport和屏幕分辨率
  await page.setViewportSize({ width: 1920, height: 1080 })

  // 🔥 模拟鼠标移动（人类行为）
  await page.mouse.move(Math.random() * 100, Math.random() * 100)
}

/**
 * Scrape URL with JavaScript rendering and stealth mode
 * P0优化: 使用连接池减少启动时间
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeUrlWithBrowser(
  url: string,
  customProxyUrl?: string,
  options: {
    waitForSelector?: string
    waitForTimeout?: number
    followRedirects?: boolean
    targetCountry?: string  // 🌍 目标国家参数
  } = {}
): Promise<{
  html: string
  title: string
  finalUrl: string
  redirectChain: string[]
  screenshot?: Buffer
}> {
  const browserResult = await createStealthBrowser(customProxyUrl)

  try {
    return await retryWithBackoff(async () => {
      // 连接池模式已有context，独立模式需要创建
      const page = await browserResult.context.newPage()
      await configureStealthPage(page, options.targetCountry)  // 🌍 传入目标国家

      // Track redirects
      const redirectChain: string[] = [url]
      page.on('response', response => {
        const status = response.status()
        if (status >= 300 && status < 400) {
          const location = response.headers()['location']
          if (location) {
            redirectChain.push(location)
          }
        }
      })

      console.log(`🌐 访问URL: ${url}`)

      // 🔥 增强人类行为模拟：导航前随机延迟
      await randomDelay(500, 1500)

      // Navigate with timeout
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options.waitForTimeout || getDynamicTimeout(url), // 🔥 P1优化: 动态超时
      })

      if (!response) {
        throw new Error('No response received')
      }

      const status = response.status()
      console.log(`📊 HTTP状态: ${status}`)

      if (status === 429) {
        throw new Error('429 Too Many Requests - 触发限流，将重试')
      }

      if (status >= 400) {
        throw new Error(`HTTP ${status} error`)
      }

      // 🔥 增强人类行为模拟：页面加载后模拟鼠标活动
      await page.mouse.move(
        Math.floor(Math.random() * 200) + 100,
        Math.floor(Math.random() * 200) + 100
      ).catch(() => {})

      // 🔥 模拟滚动行为（人类浏览习惯）
      await page.evaluate(() => {
        window.scrollTo(0, Math.floor(Math.random() * 500))
      }).catch(() => {})

      // Wait for specific selector if provided
      if (options.waitForSelector) {
        const selectorFound = await page.waitForSelector(options.waitForSelector, { timeout: 10000 })
          .then(() => true)
          .catch(() => false)

        if (!selectorFound) {
          console.warn(`⚠️ 选择器未找到: ${options.waitForSelector}`)

          // 🔥 检测是否遇到反爬虫保护页面
          const pageTitle = await page.title().catch(() => '')
          const pageUrl = page.url()

          // Cloudflare Challenge检测
          if (pageTitle.toLowerCase().includes('just a moment') ||
              pageTitle.toLowerCase().includes('attention required') ||
              pageTitle.toLowerCase().includes('please verify') ||
              pageUrl.includes('captcha') ||
              pageUrl.includes('challenge')) {
            console.error(`🚫 检测到反爬虫保护页面: "${pageTitle}"`)
            throw new Error(`遇到反爬虫保护页面: ${pageTitle}`)
          }

          // Amazon错误页面检测
          if (pageTitle.toLowerCase().includes('page not found') ||
              pageTitle.toLowerCase().includes('404') ||
              pageTitle.toLowerCase().includes('sorry')) {
            console.error(`📭 检测到Amazon错误页面: "${pageTitle}"`)
            throw new Error(`Amazon错误页面: ${pageTitle}`)
          }

          // 获取部分HTML用于调试（前500个字符）
          const htmlPreview = await page.content().then(html => html.substring(0, 500)).catch(() => '')
          console.warn(`📄 页面预览: ${htmlPreview}...`)

          // 如果没有明确的反爬虫特征，但选择器未找到，可能是页面结构变化
          console.warn(`⚠️ 页面加载成功但选择器未找到，可能是页面结构变化或内容未加载`)
        }
      } else {
        // 🔥 P1优化: 使用智能等待策略
        const waitStart = Date.now()
        const waitResult = await smartWaitForLoad(page, url).catch(() => ({
          waited: 10000,
          loadComplete: false,
          signals: []
        }))
        const waitTime = Date.now() - waitStart

        console.log(`⏱️ 智能等待完成: ${waitResult.waited}ms, 信号: ${waitResult.signals.join(', ')}`)

        // 记录优化效果（相比固定10秒networkidle）
        recordWaitOptimization(10000, waitResult.waited)
      }

      // Additional random delay (simulate reading)
      await randomDelay(1000, 2000)

      // Simulate human scrolling
      await page.evaluate(() => {
        window.scrollBy(0, Math.random() * 500)
      })

      await randomDelay(500, 1000)

      // Get final URL after all redirects
      const finalUrl = page.url()
      if (finalUrl !== url) {
        redirectChain.push(finalUrl)
      }

      console.log(`✅ 最终URL: ${finalUrl}`)
      console.log(`🔄 重定向次数: ${redirectChain.length - 1}`)

      // Extract data
      const html = await page.content()
      const title = await page.title()

      // Take screenshot for debugging (optional)
      let screenshot: Buffer | undefined
      try {
        screenshot = await page.screenshot({ fullPage: false })
      } catch (error) {
        console.warn('⚠️ 截图失败:', error)
      }

      // 关闭页面（context由releaseBrowser处理）
      await page.close().catch(() => {})

      return {
        html,
        title,
        finalUrl,
        redirectChain: Array.from(new Set(redirectChain)), // Remove duplicates
        screenshot,
      }
    })
  } finally {
    await releaseBrowser(browserResult)
  }
}

/**
 * Resolve affiliate link redirects
 * P0优化: 使用连接池减少启动时间
 * P0优化: 集成代理IP池预热缓存
 * P1优化: 代理失败时自动换新代理重试
 */
export async function resolveAffiliateLink(
  affiliateLink: string,
  customProxyUrl?: string,
  targetCountry?: string,
  maxProxyRetries: number = 2  // 代理失败最多重试2次
): Promise<{
  finalUrl: string
  finalUrlSuffix: string
  redirectChain: string[]
  redirectCount: number
}> {
  console.log(`🔗 解析推广链接: ${affiliateLink}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 链接解析 - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

  const browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)

  try {
    return await retryWithBackoff(async () => {
      const page = await browserResult.context.newPage()
      await configureStealthPage(page, targetCountry)  // 🌍 传入目标国家

      const redirectChain: string[] = [affiliateLink]

      // Track all redirects
      page.on('response', response => {
        const url = response.url()
        if (!redirectChain.includes(url)) {
          redirectChain.push(url)
        }
      })

      // Navigate and wait for final URL
      await randomDelay(500, 1500)

      await page.goto(affiliateLink, {
        waitUntil: 'domcontentloaded',
        timeout: getDynamicTimeout(affiliateLink), // 🔥 P1优化: 动态超时
      })

      // Wait for any JavaScript redirects
      // 🔥 P1优化: 使用智能等待策略
      const waitResult = await smartWaitForLoad(page, affiliateLink, { maxWaitTime: 15000 }).catch(() => ({
        waited: 15000,
        loadComplete: false,
        signals: []
      }))

      console.log(`⏱️ 链接解析等待: ${waitResult.waited}ms, 信号: ${waitResult.signals.join(', ')}`)
      recordWaitOptimization(15000, waitResult.waited)

      await randomDelay(1000, 2000)

      // 🔥 修复：使用page.evaluate获取完整URL，包括Cloudflare拦截页的URL
      // page.url()在某些情况下可能返回不完整的URL
      const finalUrl = await page.evaluate(() => window.location.href).catch(() => page.url())

      // Parse final URL and suffix
      const urlObj = new URL(finalUrl)
      const basePath = `${urlObj.origin}${urlObj.pathname}`
      const suffix = urlObj.search.substring(1) // Remove leading '?'

      console.log(`✅ 最终URL: ${basePath}`)
      console.log(`🔧 URL Suffix: ${suffix.substring(0, 100)}${suffix.length > 100 ? '...' : ''}`)

      // 🔥 新增：如果suffix为空但finalUrl包含查询参数，记录警告
      if (!suffix && finalUrl.includes('?')) {
        console.warn(`⚠️ URL Suffix提取警告: finalUrl包含?但suffix为空`)
        console.warn(`   finalUrl: ${finalUrl}`)
        console.warn(`   urlObj.search: ${urlObj.search}`)
      }

      await page.close().catch(() => {})

      return {
        finalUrl: basePath,
        finalUrlSuffix: suffix,
        redirectChain: Array.from(new Set(redirectChain)),
        redirectCount: redirectChain.length - 1,
      }
    })
  } finally {
    await releaseBrowser(browserResult)
  }

    } catch (error: any) {
      lastError = error
      console.error(`❌ 链接解析尝试 ${proxyAttempt + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (isProxyConnectionError(error) && proxyAttempt < maxProxyRetries) {
        console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
        continue
      }

      // 其他错误或已用尽重试次数
      throw error
    }
  }

  // 所有重试都失败
  throw lastError || new Error('推广链接解析失败：已用尽所有代理重试')
}

/**
 * Enhanced Amazon product data structure
 */
export interface AmazonProductData {
  productName: string | null
  productDescription: string | null
  productPrice: string | null
  originalPrice: string | null
  discount: string | null
  brandName: string | null
  features: string[]
  aboutThisItem: string[]  // Amazon "About this item" 产品详细描述
  imageUrls: string[]
  // New fields for AI creative generation
  rating: string | null
  reviewCount: string | null
  salesRank: string | null
  availability: string | null
  primeEligible: boolean
  reviewHighlights: string[]
  topReviews: string[]
  technicalDetails: Record<string, string>
  asin: string | null
  category: string | null
}

/**
 * Scrape Amazon product page with enhanced anti-bot bypass
 * Extracts comprehensive data for AI creative generation
 * 🔥 P1优化：代理失败时自动换新代理重试
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeAmazonProduct(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,  // 🌍 目标国家参数
  maxProxyRetries: number = 2  // 代理失败最多重试2次
): Promise<AmazonProductData> {
  console.log(`🛒 抓取Amazon产品: ${url}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        // 🔥 关键优化：清理连接池实例，避免复用已被Amazon标记的代理IP
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        // 🔥 额外等待，确保新代理IP被分配
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      // 🔥 P1优化：使用更短的超时进行快速失败检测
      const quickTimeout = 30000  // 30秒快速检测，如果失败立即换代理
      const result = await scrapeUrlWithBrowser(url, effectiveProxyUrl, {
        waitForSelector: '#productTitle',
        waitForTimeout: quickTimeout,  // 🔥 优先快速失败，避免等120秒
        targetCountry,  // 🌍 传入目标国家
      })

      // Parse HTML with cheerio
      const { load } = await import('cheerio')
      const $ = load(result.html)

  // 🎯 核心优化：限定选择器范围到核心产品区域，避免抓取推荐商品
  // 推荐商品区域关键词
  const recommendationKeywords = [
    'also bought', 'also viewed', 'frequently bought together',
    'customers who bought', 'related products', 'similar items',
    'sponsored products', 'customers also shopped for', 'compare with similar',
    'recommended for you', 'more items to explore'
  ]

  // 检查元素是否在推荐区域
  const isInRecommendationArea = (el: any): boolean => {
    const $el = $(el)
    const parents = $el.parents().toArray()

    for (const parent of parents) {
      const $parent = $(parent)
      const text = $parent.text().toLowerCase()
      const id = ($parent.attr('id') || '').toLowerCase()
      const className = ($parent.attr('class') || '').toLowerCase()

      // 检查文本内容
      if (recommendationKeywords.some(keyword => text.includes(keyword))) {
        return true
      }

      // 检查ID和类名
      if (id.includes('sims') || id.includes('related') || id.includes('sponsored') ||
          className.includes('sims') || className.includes('related') || className.includes('sponsored')) {
        return true
      }
    }
    return false
  }

  // Extract product features - 限定在核心产品区域
  const features: string[] = []
  const featureSelectors = [
    '#ppd #feature-bullets li',
    '#centerCol #feature-bullets li',
    '#dp-container #feature-bullets li',
    '#feature-bullets li:not([id*="sims"]):not([class*="sims"])',  // 排除sims相关
    '#featurebullets_feature_div li'
  ]

  for (const selector of featureSelectors) {
    if (features.length >= 10) break  // 限制最多10个特点

    $(selector).each((i, el) => {
      if (features.length >= 10) return false
      if (isInRecommendationArea(el)) return  // 跳过推荐区域

      const text = $(el).text().trim()
      if (text && text.length > 10 && !features.includes(text)) {
        features.push(text)
      }
    })
  }

  // ========== 图片提取已移除 ==========
  // 📝 说明：Google Search Ads仅显示文本（标题、描述、链接、附加信息），不展示图片
  // 因此移除了imageUrls提取逻辑，降低抓取复杂度和数据冗余
  const imageUrls: string[] = [] // 保留空数组以维持接口兼容性

  // Extract rating and review count
  const ratingText = $('#acrPopover').attr('title') ||
                     $('span[data-hook="rating-out-of-text"]').text().trim() ||
                     $('.a-icon-star span').first().text().trim()
  const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null

  const reviewCountText = $('#acrCustomerReviewText').text().trim() ||
                          $('span[data-hook="total-review-count"]').text().trim()
  const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null

  // Extract sales rank
  const salesRankText = $('#productDetails_detailBullets_sections1 tr:contains("Best Sellers Rank")').text().trim() ||
                        $('#SalesRank').text().trim() ||
                        $('th:contains("Best Sellers Rank")').next().text().trim()
  const salesRank = salesRankText ? salesRankText.match(/#[\d,]+/)?.[0] || null : null

  // Extract availability
  const availability = $('#availability span').text().trim() ||
                       $('#outOfStock span').text().trim() ||
                       null

  // Check Prime eligibility
  const primeEligible = $('#primeEligibilityMessage').length > 0 ||
                        $('.a-icon-prime').length > 0 ||
                        $('[data-feature-name="primeEligible"]').length > 0

  // Extract review highlights
  const reviewHighlights: string[] = []
  $('[data-hook="lighthut-term"]').each((i, el) => {
    const text = $(el).text().trim()
    if (text) reviewHighlights.push(text)
  })
  // Also try to get from review summary
  $('p[data-hook="review-collapsed"], span[data-hook="review-body"]').slice(0, 3).each((i, el) => {
    const text = $(el).text().trim().substring(0, 200)
    if (text && text.length > 20) reviewHighlights.push(text)
  })

  // Extract top reviews
  const topReviews: string[] = []
  $('[data-hook="review"]').slice(0, 5).each((i, el) => {
    const reviewText = $(el).find('[data-hook="review-body"]').text().trim().substring(0, 300)
    const reviewTitle = $(el).find('[data-hook="review-title"]').text().trim()
    const reviewRating = $(el).find('.a-icon-star').text().trim()
    if (reviewText) {
      topReviews.push(`${reviewRating} - ${reviewTitle}: ${reviewText}`)
    }
  })

  // Extract technical details
  const technicalDetails: Record<string, string> = {}
  $('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr').each((i, el) => {
    const key = $(el).find('th').text().trim()
    const value = $(el).find('td').text().trim()
    if (key && value && key !== 'Customer Reviews' && key !== 'Best Sellers Rank') {
      technicalDetails[key] = value
    }
  })
  // Also try detail bullets format
  $('#detailBullets_feature_div li').each((i, el) => {
    const text = $(el).text().trim()
    const match = text.match(/^([^:]+):\s*(.+)$/)
    if (match) {
      technicalDetails[match[1].trim()] = match[2].trim()
    }
  })

  // Extract ASIN
  const asin = url.match(/\/dp\/([A-Z0-9]+)/)?.[1] ||
               $('input[name="ASIN"]').val()?.toString() ||
               $('th:contains("ASIN")').next().text().trim() ||
               null

  // Extract category/breadcrumb
  const categoryParts: string[] = []
  $('#wayfinding-breadcrumbs_feature_div li a').each((i, el) => {
    const text = $(el).text().trim()
    if (text) categoryParts.push(text)
  })
  const category = categoryParts.join(' > ') || null

  // Extract prices
  const currentPrice = $('.a-price .a-offscreen').first().text().trim() ||
                       $('#priceblock_ourprice').text().trim() ||
                       $('#price_inside_buybox').text().trim() ||
                       null

  const originalPrice = $('.a-price[data-a-strike="true"] .a-offscreen').text().trim() ||
                        $('.priceBlockStrikePriceString').text().trim() ||
                        null

  const discount = $('.savingsPercentage').text().trim() ||
                   $('[data-hook="price-above-strike"] span').text().trim() ||
                   null

  // 🎯 优化产品名称提取 - 按优先级尝试核心产品区域
  const titleSelectors = [
    '#ppd #productTitle',
    '#centerCol #productTitle',
    '#dp-container #productTitle',
    '#productTitle'
  ]
  let productName: string | null = null
  for (const selector of titleSelectors) {
    const title = $(selector).text().trim()
    if (title && title.length > 5) {
      productName = title
      break
    }
  }

  // 🎯 优化产品描述提取 - 限定在核心产品区域
  const descriptionSelectors = [
    '#ppd #feature-bullets',
    '#centerCol #feature-bullets',
    '#dp-container #feature-bullets',
    '#feature-bullets',
    '#productDescription',
    '[data-feature-name="featurebullets"]'
  ]
  let productDescription: string | null = null
  for (const selector of descriptionSelectors) {
    const $el = $(selector)
    if ($el.length > 0 && !isInRecommendationArea($el[0])) {
      const desc = $el.text().trim()
      if (desc && desc.length > 20) {
        productDescription = desc
        break
      }
    }
  }

  // 🎯 优化品牌名提取 - 多源策略应对反爬虫
  let brandName: string | null = null

  // 策略1: 从核心产品区域的品牌链接提取（主要方法）
  const brandSelectors = [
    '#ppd #bylineInfo',
    '#centerCol #bylineInfo',
    '#dp-container #bylineInfo',
    '#bylineInfo',
    'a#bylineInfo',  // 新增：直接选择a标签
    '[data-feature-name="bylineInfo"]',  // 新增：通过data属性
    '#productOverview_feature_div tr:contains("Brand") td:last-child',  // 新增：从产品规格表
    '#detailBullets_feature_div li:contains("Brand") span:last-child',  // 新增：从产品详情
  ]
  for (const selector of brandSelectors) {
    const $el = $(selector)
    if ($el.length > 0 && !isInRecommendationArea($el[0])) {
      const brand = $el.text().trim()
        .replace('Visit the ', '')
        .replace(' Store', '')
        .replace(/^Brand:\s*/i, '')
        .replace(/^品牌:\s*/i, '')
      if (brand && brand.length > 1 && brand.length < 50) {
        brandName = brand
        console.log(`✅ 策略1成功: 从选择器${selector}提取品牌 "${brandName}"`)
        break
      }
    }
  }

  // 策略2: 从data属性获取
  if (!brandName) {
    const dataBrand = $('[data-brand]').attr('data-brand')
    if (dataBrand && dataBrand.length > 1 && dataBrand.length < 50) {
      brandName = dataBrand
      console.log(`✅ 策略2成功: 从data-brand属性提取 "${brandName}"`)
    }
  }

  // 策略2.5: 从technicalDetails.Brand提取（重要！Amazon产品规格中的官方品牌）
  if (!brandName && technicalDetails.Brand) {
    const techBrand = technicalDetails.Brand.toString().trim()
      .replace(/^‎/, '') // 移除Unicode左到右标记
      .replace(/^Brand:\s*/i, '')
    if (techBrand && techBrand.length > 1 && techBrand.length < 50) {
      brandName = techBrand
      console.log(`✅ 策略2.5成功: 从technicalDetails.Brand提取 "${brandName}"`)
    }
  }

  // 策略3: 从产品标题智能提取（适用于标题包含品牌名的情况）
  // 常见格式: "Brand Name - Product Description", "Brand Name Product Name"
  if (!brandName && productName) {
    // 提取标题开头的品牌名（通常在前3个单词内）
    const titleParts = productName.split(/[\s-,|]+/)
    if (titleParts.length > 0) {
      const potentialBrand = titleParts[0].trim()
      // 验证是否为合理的品牌名（允许全小写、全大写或首字母大写，长度2-20）
      if (potentialBrand.length >= 2 && potentialBrand.length <= 20) {
        const isValidBrand = /^[A-Za-z][A-Za-z0-9&\s-]*$/.test(potentialBrand) ||  // 允许小写开头
                            /^[A-Z0-9]+$/.test(potentialBrand)  // 全大写+数字
        if (isValidBrand) {
          brandName = potentialBrand
          console.log(`✅ 策略3成功: 从产品标题提取品牌 "${brandName}"`)
        }
      }
    }
  }

  // 策略4: 从Amazon URL中提取品牌提示
  // Amazon Store URL格式: /stores/BrandName/page/... 或 /BrandName/s?...
  if (!brandName) {
    const urlBrandMatch = url.match(/amazon\.com\/stores\/([^\/]+)/) ||
                          url.match(/amazon\.com\/([A-Z][A-Za-z0-9-]+)\/s\?/)
    if (urlBrandMatch && urlBrandMatch[1]) {
      const urlBrand = decodeURIComponent(urlBrandMatch[1])
        .replace(/-/g, ' ')
        .replace(/\+/g, ' ')
        .trim()
      if (urlBrand.length >= 2 && urlBrand.length <= 30 && !urlBrand.includes('page')) {
        brandName = urlBrand
        console.log(`✅ 策略4成功: 从URL提取品牌 "${brandName}"`)
      }
    }
  }

  // 策略5: 从meta标签提取
  if (!brandName) {
    const metaBrand = $('meta[property="og:brand"]').attr('content') ||
                     $('meta[name="brand"]').attr('content')
    if (metaBrand && metaBrand.length > 1 && metaBrand.length < 50) {
      brandName = metaBrand
      console.log(`✅ 策略5成功: 从meta标签提取品牌 "${brandName}"`)
    }
  }

  // 最后清洗：去除常见后缀
  if (brandName) {
    brandName = brandName
      .replace(/\s+(Official|Store|Shop|Brand)$/i, '')
      .trim()
  }

  if (!brandName) {
    console.warn('⚠️ 所有品牌提取策略均失败，返回null')
  }

  const productData: AmazonProductData = {
    productName,
    productDescription,
    productPrice: currentPrice,
    originalPrice,
    discount,
    brandName: brandName ? normalizeBrandName(brandName) : null,
    features,
    aboutThisItem: features,  // Amazon #feature-bullets 就是 "About this item"
    imageUrls: Array.from(new Set(imageUrls)).slice(0, 5),
    rating,
    reviewCount,
    salesRank,
    availability,
    primeEligible,
    reviewHighlights: reviewHighlights.slice(0, 10),
    topReviews: topReviews.slice(0, 5),
    technicalDetails,
    asin,
    category,
  }

  console.log(`✅ 抓取成功: ${productData.productName || 'Unknown'}`)
  console.log(`⭐ 评分: ${rating || 'N/A'}, 评论数: ${reviewCount || 'N/A'}, 销量排名: ${salesRank || 'N/A'}`)

  return productData

    } catch (error: any) {
      lastError = error
      console.error(`❌ 抓取尝试 ${proxyAttempt + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (isProxyConnectionError(error) && proxyAttempt < maxProxyRetries) {
        console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
        // 短暂延迟后重试
        await new Promise(resolve => setTimeout(resolve, 2000))
        continue
      }

      // 其他错误或已用尽重试次数
      throw error
    }
  }

  // 所有重试都失败
  throw lastError || new Error('Amazon产品抓取失败：已用尽所有代理重试')
}

/**
 * Amazon Store data structure
 */
export interface AmazonStoreData {
  storeName: string | null
  storeDescription: string | null
  brandName: string | null
  products: Array<{
    name: string
    price: string | null
    rating: string | null
    reviewCount: string | null
    asin: string | null
    hotScore?: number      // 🔥 新增：热销分数
    rank?: number          // 🔥 新增：热销排名
    isHot?: boolean        // 🔥 新增：是否为热销商品（Top 5）
    hotLabel?: string      // 🔥 新增：热销标签
    // 🎯 Phase 3: 数据维度增强
    promotion?: string | null       // 促销信息：折扣、优惠券、限时优惠
    badge?: string | null           // 徽章：Amazon's Choice、Best Seller、#1 in Category
    isPrime?: boolean               // Prime标识
  }>
  totalProducts: number
  storeUrl: string
  // 🔥 新增：热销洞察
  hotInsights?: {
    avgRating: number
    avgReviews: number
    topProductsCount: number
  }
}

/**
 * Scrape Amazon Store page with multiple products
 * Extracts store info and product listings for AI creative generation
 * P0优化: 使用连接池减少启动时间
 * P1优化: 代理失败时自动换新代理重试
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeAmazonStore(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,  // 🌍 目标国家参数
  maxProxyRetries: number = 2  // 代理失败最多重试2次
): Promise<AmazonStoreData> {
  console.log(`📦 抓取Amazon Store: ${url}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 Amazon Store抓取 - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

  // P0优化: 使用连接池获取浏览器实例
  const browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)

  try {
    const page = await browserResult.context.newPage()
    await configureStealthPage(page, targetCountry)  // 🌍 传入目标国家

    // 🔥 策略A优化：监听网络请求，提取Amazon Store API数据
    const apiProducts: Array<{
      asin: string
      name: string
      price: string | null
      rating: string | null
      reviewCount: string | null
    }> = []

    // 🔥 调试：监听所有JSON响应，找到产品数据API
    let apiRequestCount = 0
    page.on('response', async (response) => {
      try {
        const url = response.url()
        const contentType = response.headers()['content-type'] || ''

        // 只关注JSON响应
        if (contentType.includes('application/json') && response.status() === 200) {
          apiRequestCount++

          // 排除已知的非产品数据端点
          if (
            !url.includes('uedata') &&
            !url.includes('csm.js') &&
            !url.includes('/events/') &&
            !url.includes('rum-http-intake') &&
            !url.includes('metrics')
          ) {
            try {
              const json = await response.json()
              const jsonStr = JSON.stringify(json)

              // 如果JSON中包含产品相关关键词，记录下来
              if (
                jsonStr.includes('"asin"') ||
                jsonStr.includes('"ASIN"') ||
                jsonStr.includes('"product') ||
                jsonStr.includes('"item') ||
                jsonStr.includes('"dp/')
              ) {
                console.log(`📡 发现可能的产品API: ${url.substring(0, 100)}`)
                console.log(`📊 数据片段: ${jsonStr.substring(0, 300)}...`)
              }
            } catch (e) {
              // JSON解析失败，跳过
            }
          }
        }
      } catch (error) {
        // 忽略响应处理错误
      }
    })

    // 在页面加载完成后输出监听到的API总数
    setTimeout(() => {
      console.log(`📊 共监听到 ${apiRequestCount} 个JSON API请求`)
    }, 70000) // 70秒后输出（等待所有加载完成）

    console.log(`🌐 访问URL: ${url}`)

    // 🔥 关键优化：跟踪完整的重定向链，获取带推广参数的最终URL
    let finalUrlWithParams = url
    page.on('response', (response) => {
      const responseUrl = response.url()
      // 只记录Amazon域名的URL（包含完整参数）
      if (responseUrl.includes('amazon.com') && responseUrl.includes('?')) {
        finalUrlWithParams = responseUrl
        console.log(`📍 检测到带参数的URL: ${responseUrl.substring(0, 150)}...`)
      }
    })

    await randomDelay(500, 1500)

    // 🔥 P0优化：添加重试机制以处理代理连接问题
    const MAX_RETRIES = 3
    let response = null
    let lastError = null

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`🔄 尝试访问 (${attempt + 1}/${MAX_RETRIES})...`)

        response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: getDynamicTimeout(url), // 🔥 P1优化: 动态超时（Amazon复杂页面自动60s）
        })

        if (!response) throw new Error('No response received')
        console.log(`📊 HTTP状态: ${response.status()}`)

        // 🔥 检查是否被拦截（404 Page Not Found）
        const pageTitle = await page.title().catch(() => '')
        if (pageTitle.includes('Page Not Found') || response.status() === 404) {
          console.warn(`⚠️ 检测到404页面，尝试使用完整参数URL: ${finalUrlWithParams.substring(0, 150)}...`)

          // 如果有带参数的URL，尝试直接访问
          if (finalUrlWithParams !== url && finalUrlWithParams.includes('?')) {
            console.log(`🔄 重新访问带完整参数的URL...`)
            response = await page.goto(finalUrlWithParams, {
              waitUntil: 'domcontentloaded',
              timeout: getDynamicTimeout(finalUrlWithParams),
            })
            console.log(`📊 重访HTTP状态: ${response?.status()}`)
          }
        }

        // 成功，跳出重试循环
        lastError = null
        break
      } catch (error: any) {
        lastError = error
        console.error(`❌ 访问失败 (尝试 ${attempt + 1}/${MAX_RETRIES}): ${error.message}`)

        // 如果不是最后一次重试，等待后继续
        if (attempt < MAX_RETRIES - 1) {
          const waitTime = 2000 * (attempt + 1) // 指数退避: 2s, 4s, 6s
          console.log(`⏳ 等待 ${waitTime}ms 后重试...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }
    }

    // 如果所有重试都失败，抛出最后一个错误
    if (lastError) {
      throw new Error(`Amazon Store访问失败（${MAX_RETRIES}次重试后）: ${lastError.message}`)
    }

    // Wait for store content to load
    // 🔥 P1优化: 使用智能等待策略
    const waitResult = await smartWaitForLoad(page, url, { maxWaitTime: 15000 }).catch(() => ({
      waited: 15000,
      loadComplete: false,
      signals: []
    }))

    console.log(`⏱️ Store页面等待: ${waitResult.waited}ms, 信号: ${waitResult.signals.join(', ')}`)
    recordWaitOptimization(15000, waitResult.waited)

    // 🔥 P1优化：减少等待时间，从55-65秒降低到25-30秒
    console.log('⏳ 等待产品内容渲染（优化版）...')

    // 策略1: 快速滚动页面触发懒加载（减少次数和间隔）
    console.log('🔄 滚动页面触发懒加载...')
    for (let i = 0; i < 4; i++) {  // 从8次减少到4次
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
      await randomDelay(800, 1200)  // 从1500-2000ms减少到800-1200ms
    }

    // 策略2: 滚回顶部
    await page.evaluate(() => window.scrollTo(0, 0))
    await randomDelay(1000, 1500)  // 从2000-3000ms减少到1000-1500ms

    // 策略3: 再滚动一遍（减少次数）
    console.log('🔄 二次滚动...')
    for (let i = 0; i < 3; i++) {  // 从5次减少到3次
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
      await randomDelay(800, 1200)  // 从1500-2000ms减少到800-1200ms
    }

    // 策略4: 等待产品图片加载（减少超时）
    console.log('⏳ 等待产品图片渲染...')
    await page.waitForSelector('img[src*="images-amazon"]', { timeout: 8000 }).catch(() => {
      console.warn('⚠️ 产品图片加载超时，继续处理')
    })

    // 策略5: 短暂等待JavaScript完成（大幅减少）
    console.log('⏳ 等待JavaScript完成...')
    await randomDelay(1500, 2500)  // 从3000-5000ms减少到1500-2500ms

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0))
    await randomDelay(300, 500)  // 从500-1000ms减少到300-500ms

    const finalUrl = page.url()
    console.log(`✅ 最终URL: ${finalUrl}`)

    const html = await page.content()

    // 🔥 调试：保存HTML和screenshot到storage目录（临时）
    try {
      const fs = await import('fs')
      const path = await import('path')
      const storageDir = path.join(process.cwd(), 'storage')
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true })
      }

      const timestamp = Date.now()
      const htmlFile = path.join(storageDir, `debug-store-${timestamp}.html`)
      const screenshotFile = path.join(storageDir, `debug-store-${timestamp}.png`)

      fs.writeFileSync(htmlFile, html)
      await page.screenshot({ path: screenshotFile, fullPage: true })

      console.log(`📁 调试文件已保存:`)
      console.log(`  - HTML: ${htmlFile}`)
      console.log(`  - Screenshot: ${screenshotFile}`)
    } catch (error: any) {
      console.warn(`⚠️ 保存调试文件失败: ${error.message}`)
    }

    // 🔥 重要：不要在这里关闭context，等所有策略执行完毕后再关闭
    // await context.close() // 移到函数末尾

    // Parse HTML with cheerio
    const { load } = await import('cheerio')
    const $ = load(html)

  // Extract store name - 优化选择器优先级
  let storeName: string | null = null

  // 尝试从title提取（最可靠）
  const pageTitle = $('title').text().trim()
  if (pageTitle && !pageTitle.includes('results for')) {
    storeName = pageTitle.replace(' - Amazon.com', '').replace('.com', '').trim()
  }

  // 如果title不可用，尝试其他选择器
  if (!storeName) {
    storeName = $('[data-testid="store-name"]').text().trim() ||
                $('.stores-heading-desktop h1').text().trim() ||
                $('meta[property="og:title"]').attr('content')?.replace(' - Amazon.com', '').trim() ||
                null
  }

  // Extract store description
  const storeDescription = $('meta[name="description"]').attr('content') ||
                           $('meta[property="og:description"]').attr('content') ||
                           $('.stores-brand-description').text().trim() ||
                           null

  // Extract brand name - 优先从storeName提取（更可靠）
  let brandName: string | null = null

  // 🔥 优先级1: 从storeName提取（最可靠）
  if (storeName) {
    // 处理各种Amazon前缀格式
    brandName = storeName
      .replace(/^Amazon\.com:\s*/i, '')  // "Amazon.com: REOLINK"
      .replace(/^Amazon:\s*/i, '')       // "Amazon: REOLINK"
      .replace(/\s+Store$/i, '')         // "REOLINK Store"
      .replace(/\s+Official Store$/i, '') // "REOLINK Official Store"
      .trim()
  }

  // 🔥 优先级2: 从URL提取品牌名称 (e.g., /stores/Reolink/...)
  // 注意：跳过 /stores/page/ 这种结构
  if (!brandName) {
    const urlMatch = url.match(/\/stores\/([^\/]+)/)
    if (urlMatch && urlMatch[1] && urlMatch[1].toLowerCase() !== 'page') {
      brandName = decodeURIComponent(urlMatch[1]).replace(/-/g, ' ').trim()
    }
  }

  // 🔥 混合策略：先尝试从Store页面提取产品链接，如失败则降级为搜索策略
  const products: AmazonStoreData['products'] = []
  const productAsins: Set<string> = new Set() // 用于去重ASIN

  // 🔥 策略A0（优先）：从嵌入的JavaScript JSON中提取产品数据
  console.log('📍 策略A0: 从嵌入的JavaScript JSON中提取产品数据...')

  try {
    // 提取 liveFlagshipStates["amazonlive-react-shopping-carousel-data"] JSON
    const jsonMatch = html.match(/liveFlagshipStates\["amazonlive-react-shopping-carousel-data"\]\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);

    if (jsonMatch && jsonMatch[1]) {
      // 解析双重编码的JSON字符串
      const jsonStr = JSON.parse(jsonMatch[1])
      const carouselData = JSON.parse(jsonStr)

      console.log(`📊 找到嵌入的产品数据对象`)

      // 提取preloadProducts中的所有产品
      const preloadProducts = carouselData.preloadProducts || {}

      for (const [asin, productData] of Object.entries(preloadProducts) as [string, any][]) {
        products.push({
          name: productData.title || '',
          price: productData.formattedPriceV2 || null,
          rating: productData.ratingValue ? String(productData.ratingValue) : null,
          reviewCount: productData.totalReviewCount ? String(productData.totalReviewCount) : null,
          asin: asin,
          promotion: productData.dealBadge?.messageText || null,
          badge: productData.dealBadge?.labelText || null,
          isPrime: productData.eligibleForPrimeShipping || false
        })

        productAsins.add(asin)
        console.log(`  ✅ 提取产品: ${productData.title?.substring(0, 50)}... (${asin})`)
      }

      console.log(`📊 策略A0成功: 从JavaScript JSON提取 ${products.length} 个产品`)

      // 🔥 策略A0b：逐个提取deals数据（处理转义JSON）
      // 匹配转义的JSON格式: \"B0CM39K7CB\":{\"dealType\":\"BEST_DEAL\",...,\"dealPrice\":{\"wholeValue\":125,\"fractionalValue\":99,\"currencySymbol\":\"$\"},...}
      const dealPattern = /\\?"(B[A-Z0-9]{9})\\?":\s*\{\\?"dealType\\?".*?\\?"dealPrice\\?":\s*\{\\?"wholeValue\\?":(\d+),\\?"fractionalValue\\?":(\d+),\\?"currencySymbol\\?":\\?"([^"\\]+)\\?"\}/g

      let dealMatch
      let dealCount = 0
      while ((dealMatch = dealPattern.exec(html)) !== null) {
        const [, asin, wholeValue, fractionalValue, currencySymbol] = dealMatch

        // 检查是否已经有这个产品
        const existingProduct = products.find(p => p.asin === asin)
        if (!existingProduct) {
          const formattedPrice = `${currencySymbol}${wholeValue}.${String(fractionalValue).padStart(2, '0')}`

          // 尝试提取badge信息（单独匹配）
          const badgePattern = new RegExp(`${asin}[^}]*labelText[^:]*:[^"]*"([^"\\\\]+)"[^}]*messageText[^:]*:[^"]*"([^"\\\\]+)"`)
          const badgeMatch = html.match(badgePattern)
          const labelText = badgeMatch?.[1] || null
          const messageText = badgeMatch?.[2] || null

          products.push({
            name: `Product ${asin}`, // 占位符，后续selector会更新
            price: formattedPrice,
            rating: null,
            reviewCount: null,
            asin: asin,
            promotion: messageText || null,
            badge: labelText || null,
            isPrime: false
          })
          productAsins.add(asin)
          dealCount++
          console.log(`  ✅ A0b补充产品价格: ${asin} = ${formattedPrice} (${labelText || 'no badge'})`)
        }
      }

      if (dealCount > 0) {
        console.log(`📊 A0b成功: 补充 ${dealCount} 个产品的deal信息`)
      }
    } else {
      console.log('⚠️ 未找到嵌入的JavaScript产品数据')
    }
  } catch (error: any) {
    console.error(`❌ 解析JavaScript JSON失败: ${error.message}`)
  }

  // 策略A1：从Store页面HTML提取产品链接（ASIN）- 作为补充
  console.log('📍 策略A1: 从Store页面HTML提取产品ASIN...')

  // 提取所有/dp/链接中的ASIN
  $('a[href*="/dp/"]').each((i, el) => {
    const href = $(el).attr('href') || ''
    const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/)
    if (asinMatch && asinMatch[1]) {
      const asin = asinMatch[1]
      // 过滤掉Amazon自身产品（信用卡等）
      const text = $(el).text().toLowerCase()
      const isAmazonProduct = text.includes('amazon') && (text.includes('card') || text.includes('credit'))

      if (!isAmazonProduct) {
        productAsins.add(asin)
        console.log(`  ✅ 发现产品ASIN: ${asin}`)
      }
    }
  })

  console.log(`📊 策略A1结果: 找到 ${productAsins.size} 个产品ASIN`)

  // 🔥 策略B：如果产品少于5个，降级为搜索策略（临时禁用，因为搜索页面经常超时）
  if (products.length < 5 && brandName && false) { // 临时禁用
    console.log(`⚠️ Store页面产品不足（${products.length}个），启动策略B...`)
    console.log(`🔍 策略B: 通过Amazon搜索 "${brandName}" 获取产品列表...`)

    try {
      // 关闭当前页面，打开搜索页面
      const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(brandName || '')}`
      console.log(`🌐 访问搜索URL: ${searchUrl}`)

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: getDynamicTimeout(searchUrl), // 🔥 P1优化: 动态超时
      })

      // 🔥 P1优化: 使用智能等待策略
      const searchWaitResult = await smartWaitForLoad(page, searchUrl, { maxWaitTime: 15000 }).catch(() => ({
        waited: 15000,
        loadComplete: false,
        signals: []
      }))

      console.log(`⏱️ 搜索页面等待: ${searchWaitResult.waited}ms, 信号: ${searchWaitResult.signals.join(', ')}`)
      recordWaitOptimization(15000, searchWaitResult.waited)

      // 等待搜索结果加载
      await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 10000 }).catch(() => {
        console.warn('⚠️ 搜索结果加载超时')
      })

      await randomDelay(2000, 3000)

      // 获取搜索页面HTML
      const searchHtml = await page.content()
      const $search = load(searchHtml)

      // 从搜索结果提取产品ASIN
      $search('[data-component-type="s-search-result"]').each((i, el) => {
        if (productAsins.size >= 30) return false // 限制最多30个

        const asin = $search(el).attr('data-asin')
        if (asin && asin.length === 10) {
          productAsins.add(asin)
          console.log(`  ✅ 搜索结果ASIN: ${asin}`)
        }
      })

      console.log(`📊 策略B结果: 额外找到 ${productAsins.size} 个产品ASIN（累计）`)
    } catch (error: any) {
      console.error(`❌ 策略B失败: ${error.message}`)
    }
  }

  // 🔥 阶段2：批量抓取产品详情页（临时禁用，因为A0策略已提供完整数据且访问详情页经常超时）
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`📦 阶段2: 批量抓取产品详情页 (已禁用，使用A0策略数据)`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

  if (false) { // 临时禁用阶段2
  for (const asin of Array.from(productAsins).slice(0, 30)) {
    try {
      const productUrl = `https://www.amazon.com/dp/${asin}`
      console.log(`🛒 抓取产品 ${products.length + 1}/${Math.min(productAsins.size, 30)}: ${asin}`)

      // 访问产品页面
      await page.goto(productUrl, {
        waitUntil: 'domcontentloaded',
        timeout: getDynamicTimeout(productUrl), // 🔥 P1优化: 动态超时
      })

      // 🔥 P1优化: 使用智能等待策略
      const productWaitResult = await smartWaitForLoad(page, productUrl, { maxWaitTime: 10000 }).catch(() => ({
        waited: 10000,
        loadComplete: false,
        signals: []
      }))

      console.log(`⏱️ 产品页面等待: ${productWaitResult.waited}ms`)
      recordWaitOptimization(10000, productWaitResult.waited)

      await randomDelay(1000, 2000)

      // 获取产品页面HTML
      const productHtml = await page.content()
      const $product = load(productHtml)

      // 提取产品信息（使用与scrapeAmazonProduct相同的逻辑）
      const name = $product('#productTitle').text().trim() ||
                   $product('h1[id*="title"]').text().trim()

      const price = $product('.a-price .a-offscreen').first().text().trim() ||
                    $product('#priceblock_ourprice').text().trim() ||
                    null

      const ratingText = $product('#acrPopover').attr('title') ||
                         $product('span[data-hook="rating-out-of-text"]').text().trim()
      const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null

      const reviewCountText = $product('#acrCustomerReviewText').text().trim()
      const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null

      const imageUrl = $product('#landingImage').attr('src') ||
                       $product('#imgBlkFront').attr('src') ||
                       $product('.a-dynamic-image').first().attr('src') ||
                       null

      const primeEligible = $product('#primeEligibilityMessage').length > 0 ||
                            $product('.a-icon-prime').length > 0

      const promotion = $product('.a-badge-label').first().text().trim() || null
      const badge = $product('[aria-label*="Amazon\'s Choice"]').attr('aria-label') ||
                    $product('[aria-label*="Best Seller"]').attr('aria-label') ||
                    null

      if (name && name.length > 5) {
        products.push({
          name,
          price,
          rating,
          reviewCount,
          asin,
          promotion,
          badge,
          isPrime: primeEligible,
        })
        console.log(`  ✅ ${name.substring(0, 60)}... (${rating || 'N/A'}⭐, ${reviewCount || '0'} 评论)`)
      } else {
        console.log(`  ⚠️ 跳过: 产品名称不足`)
      }

      // 控制抓取速度，避免触发反爬虫
      await randomDelay(2000, 3000)

    } catch (error: any) {
      console.error(`  ❌ 抓取失败: ${error.message}`)
      continue
    }
  }
  } // 临时禁用阶段2的闭合大括号

  console.log(`\n✅ 产品数据提取完成: ${products.length} 个产品`)

  // Try multiple selectors for product cards - Amazon store specific selectors (保留原逻辑作为备用)
  const productSelectors = [
    // Store page specific selectors (优先级从高到低)
    'a.Overlay__overlay__LloCU[href*="/dp/"]', // Reolink Store实际结构（链接元素，可向上找容器）
    'a[href*="/dp/"][class*="EditorialTile"]', // 编辑瓦片布局
    'a[href*="/dp/"][class*="ImageBlock"]', // 图片块布局
    'a[href*="/dp/"]', // 通用产品链接
    '[class*="ProductCard"]',
    '[class*="product-card"]',
    '[data-csa-c-item-type="product"]',
    '[data-csa-c-type="item"]',
    'div[class*="sfkrT"]', // Common store product class
    'div[class*="ImageArea"]',
    // Search result selectors (for some store layouts)
    '[data-component-type="s-search-result"]',
    '.s-result-item[data-asin]',
    '.stores-widget-item',
    '[data-asin]'
  ]

  // 🔥 如果上述策略已经获取到足够产品，跳过原有的selector遍历逻辑
  if (products.length >= 5) {
    console.log(`✅ 已通过混合策略获取 ${products.length} 个产品，跳过selector遍历`)
  } else {
    console.log(`⚠️ 产品数量不足(${products.length}个)，尝试原有selector策略...`)

  for (const selector of productSelectors) {
    if (products.length >= 5) break // If we found some products, stop trying more selectors

    const matchCount = $(selector).length
    console.log(`🔍 尝试选择器"${selector}": 匹配${matchCount}个元素`)

    $(selector).each((i, el) => {
      if (products.length >= 30) return false // Limit to 30 products

      const $el = $(el)

      // 🔥 For Store pages: if element is a link, find its container for price/image extraction
      const $container = $el.is('a') ? $el.closest('[class*="EditorialTile"]') : $el
      const $searchScope = $container.length > 0 ? $container : $el

      // Extract ASIN from element attributes or href
      const href = $el.attr('href') || $el.find('a[href*="/dp/"]').attr('href') || ''
      const asin = $el.attr('data-asin') ||
                   $el.find('[data-asin]').attr('data-asin') ||
                   href.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ||
                   null

      // Try multiple name extraction methods
      // 如果是链接元素，优先从img alt或aria-label提取
      let name = ''
      if ($el.is('a')) {
        name = $el.find('img[alt]').first().attr('alt')?.trim() ||
               $el.attr('aria-label')?.trim() ||
               $el.find('[class*="Title"]').text().trim() ||
               ''
      } else {
        name = $el.find('h2 a span, .s-title-instructions-style span').text().trim() ||
               $el.find('[class*="ProductTitle"], [class*="product-title"]').text().trim() ||
               $el.find('span[class*="Title"]').text().trim() ||
               $el.find('img[alt]').first().attr('alt') ||
               ''
      }

      // Extract price (Store页面优先，然后搜索结果页面) - 从容器中查找
      const priceDataTestId = $searchScope.find('[data-testid^="$"]').attr('data-testid')
      const priceFromTestId = priceDataTestId ? priceDataTestId.replace(/^\$/, '') : null
      const priceWhole = $searchScope.find('.Price__whole__mQGs5').text().trim()
      const priceFractional = $searchScope.find('.Price__fractional__wJiJp').text().trim()
      const priceFromParts = (priceWhole && priceFractional) ? `$${priceWhole}.${priceFractional}` : null

      const price = priceFromTestId ||
                    priceFromParts ||
                    $searchScope.find('.a-price .a-offscreen').first().text().trim() ||
                    $searchScope.find('[class*="Price"] .a-offscreen').text().trim() ||
                    $searchScope.find('.a-color-price').text().trim() ||
                    $searchScope.find('[class*="price"]').first().text().trim() ||
                    null

      // Extract rating
      const ratingText = $el.find('.a-icon-star-small span, .a-icon-star span').text().trim() ||
                         $el.find('[class*="star"]').text().trim()
      const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null

      // Extract review count
      const reviewCountText = $el.find('[aria-label*="stars"]').attr('aria-label') ||
                              $el.find('.s-underline-text').text().trim() ||
                              $el.find('[class*="review"]').text().trim()
      const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null

      // Extract image (Store页面优先，然后搜索结果页面) - 从容器中查找
      // 🔥 已移除：Google Search Ads不展示图片，移除imageUrl提取逻辑

      // 🎯 Phase 3: Extract promotion information
      const promotionText = $el.find('.a-badge-label, .s-coupon-highlight-color, [aria-label*="coupon"]').text().trim() ||
                            $el.find('[class*="discount"], [class*="deal"], [class*="coupon"]').first().text().trim() ||
                            $el.find('.a-color-price.a-text-bold').text().trim() ||
                            null
      const promotion = promotionText && promotionText.length > 0 && promotionText.length < 100 ? promotionText : null

      // 🎯 Phase 3: Extract badge information
      const badgeText = $el.find('[aria-label*="Amazon\'s Choice"], [aria-label*="Best Seller"]').attr('aria-label') ||
                        $el.find('.a-badge-label:contains("Amazon\'s Choice")').text().trim() ||
                        $el.find('.a-badge-label:contains("Best Seller")').text().trim() ||
                        $el.find('.a-badge-label:contains("#1")').text().trim() ||
                        $el.find('[class*="choice-badge"], [class*="best-seller"]').text().trim() ||
                        null
      const badge = badgeText && badgeText.length > 0 && badgeText.length < 100 ? badgeText : null

      // 🎯 Phase 3: Extract Prime eligibility (Store页面优先) - 从容器中查找
      const isPrime = $searchScope.find('.PrimeBadges__badge__fQInt').length > 0 ||
                      $searchScope.find('.EditorialTileProduct__prime__jvG0c').length > 0 ||
                      $searchScope.find('[aria-label*="Prime"], .a-icon-prime, [class*="prime"]').length > 0

      // 🔧 Debug: Log extraction details
      if (name || asin) {
        console.log(`  📦 元素${i}: name="${name?.substring(0, 50)}" asin="${asin}" price="${price}" isPrime=${isPrime}`)
      }

      // 🔥 优化：检查是否存在A0b提取的占位产品，需要合并名称
      const existingProductByAsin = asin ? products.find(p => p.asin === asin) : null
      if (existingProductByAsin && existingProductByAsin.name.startsWith('Product ')) {
        // 合并selector提取的名称到已有产品
        if (name && name.length > 5) {
          console.log(`  🔄 合并产品: ${name.substring(0, 50)} -> ${asin}`)
          existingProductByAsin.name = name
          if (!existingProductByAsin.rating && rating) existingProductByAsin.rating = rating
          if (!existingProductByAsin.reviewCount && reviewCount) existingProductByAsin.reviewCount = reviewCount
        }
      } else if (name && name.length > 5 && !products.some(p => p.name === name || p.asin === asin)) {
        // 新产品
        console.log(`  ✅ 添加产品: ${name.substring(0, 50)}`)
        products.push({
          name,
          price,
          rating,
          reviewCount,
          asin,
          promotion,
          badge,
          isPrime,
        })
      } else if (name) {
        console.log(`  ⊗ 跳过产品: name长度${name.length} (需>5) 或已存在`)
      }
    })
  }

  // 🔥 已移除图片fallback提取逻辑
  // Enhanced fallback已被移除：Google Search Ads不展示图片，不需要从img[alt]提取产品
  } // 🔥 关闭 else 块

  // 🔥 过滤掉占位符名称的产品
  console.log(`📊 原始产品数量: ${products.length}`)
  const validProducts = products.filter(p => {
    // 过滤条件：名称不能是占位符格式 "Product BXXXXXXX"
    const isPlaceholder = /^Product [A-Z0-9]{10}$/.test(p.name)
    if (isPlaceholder) {
      console.log(`  ⊗ 过滤占位符产品: ${p.name} (ASIN: ${p.asin})`)
      return false
    }
    return true
  })
  console.log(`📊 过滤后产品数量: ${validProducts.length} (移除 ${products.length - validProducts.length} 个占位符)`)

  // 🔥 热销商品筛选逻辑
  // 计算热销分数：score = rating × log(reviewCount + 1)
  const productsWithScores = validProducts.map(p => {
    const rating = p.rating ? parseFloat(p.rating) : 0
    const reviewCount = p.reviewCount ? parseInt(p.reviewCount.replace(/,/g, '')) : 0

    // 热销分数公式：评分 × log(评论数 + 1)
    // 例如：4.5星 × log(1000) = 4.5 × 3 = 13.5
    const hotScore = rating > 0 && reviewCount > 0
      ? rating * Math.log10(reviewCount + 1)
      : 0

    return {
      ...p,
      hotScore,
      ratingNum: rating,
      reviewCountNum: reviewCount
    }
  })

  // 按热销分数降序排序
  productsWithScores.sort((a, b) => b.hotScore - a.hotScore)

  // 取前15-20个热销商品（如果商品总数少于15，则全部保留）
  const topCount = Math.min(15, productsWithScores.length)
  const topProducts = productsWithScores.slice(0, topCount)

  // 标注热销商品并格式化
  const enhancedProducts = topProducts.map((p, index) => ({
    name: p.name,
    price: p.price,
    rating: p.rating,
    reviewCount: p.reviewCount,
    asin: p.asin,
    hotScore: p.hotScore,
    rank: index + 1,
    isHot: index < 5,  // 前5名标记为"最热销"
    // 🎯 Phase 3: 保留新增字段
    promotion: p.promotion,
    badge: p.badge,
    isPrime: p.isPrime,
    hotLabel: index < 5 ? '🔥 热销商品' : '✅ 畅销商品'
  }))

  // 计算热销洞察
  const productsWithRatings = topProducts.filter(p => p.ratingNum > 0 && p.reviewCountNum > 0)
  const hotInsights = productsWithRatings.length > 0 ? {
    avgRating: productsWithRatings.reduce((sum, p) => sum + p.ratingNum, 0) / productsWithRatings.length,
    avgReviews: Math.round(productsWithRatings.reduce((sum, p) => sum + p.reviewCountNum, 0) / productsWithRatings.length),
    topProductsCount: topCount
  } : undefined

  const storeData: AmazonStoreData = {
    storeName,
    storeDescription,
    brandName: brandName ? normalizeBrandName(brandName) : null,
    products: enhancedProducts,
    totalProducts: enhancedProducts.length,
    storeUrl: finalUrl,
    hotInsights,
  }

  console.log(`✅ Store抓取成功: ${storeName}`)
  console.log(`📊 热销商品筛选: ${products.length} → ${enhancedProducts.length}`)
  if (hotInsights) {
    console.log(`💡 热销洞察: 平均评分 ${hotInsights.avgRating.toFixed(1)}⭐, 平均评论 ${hotInsights.avgReviews} 条`)
  }

  // 🔥 所有策略执行完毕，关闭页面
  await page.close().catch(() => {})

  return storeData
  } finally {
    await releaseBrowser(browserResult)
  }

    } catch (error: any) {
      lastError = error
      console.error(`❌ Amazon Store抓取尝试 ${proxyAttempt + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (isProxyConnectionError(error) && proxyAttempt < maxProxyRetries) {
        console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
        continue
      }

      // 其他错误或已用尽重试次数
      throw error
    }
  }

  // 所有重试都失败
  throw lastError || new Error('Amazon Store抓取失败：已用尽所有代理重试')
}

/**
 * Independent site store data structure
 */
export interface IndependentStoreData {
  storeName: string | null
  storeDescription: string | null
  logoUrl: string | null
  products: Array<{
    name: string
    price: string | null
    productUrl: string | null
  }>
  totalProducts: number
  storeUrl: string
  platform: string | null // shopify, woocommerce, generic
}

/**
 * Scrape independent e-commerce store page
 * Extracts brand info and product listings for AI creative generation
 * P0优化: 使用连接池减少启动时间
 * P1优化: 代理失败时自动换新代理重试
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeIndependentStore(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,  // 🌍 目标国家参数
  maxProxyRetries: number = 2  // 代理失败最多重试2次
): Promise<IndependentStoreData> {
  console.log(`🏪 抓取独立站店铺: ${url}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 独立站抓取 - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

  const browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)

  try {
    const page = await browserResult.context.newPage()
    await configureStealthPage(page, targetCountry)  // 🌍 传入目标国家

    console.log(`🌐 访问URL: ${url}`)
    await randomDelay(500, 1500)

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: getDynamicTimeout(url), // 🔥 P1优化: 动态超时
    })

    if (!response) throw new Error('No response received')
    console.log(`📊 HTTP状态: ${response.status()}`)

    // Wait for content to load
    // 🔥 P1优化: 使用智能等待策略
    const waitResult = await smartWaitForLoad(page, url, { maxWaitTime: 15000 }).catch(() => ({
      waited: 15000,
      loadComplete: false,
      signals: []
    }))

    console.log(`⏱️ 独立站页面等待: ${waitResult.waited}ms, 信号: ${waitResult.signals.join(', ')}`)
    recordWaitOptimization(15000, waitResult.waited)

    // Scroll down to trigger lazy loading of products
    console.log('🔄 滚动页面加载更多产品...')
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
      await randomDelay(600, 1000)
    }

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0))
    await randomDelay(500, 800)

    const finalUrl = page.url()
    console.log(`✅ 最终URL: ${finalUrl}`)

    const html = await page.content()
    await page.close().catch(() => {})

    // Parse HTML with cheerio
    const { load } = await import('cheerio')
    const $ = load(html)

    // Detect platform
    let platform: string | null = null
    if ($('script[src*="cdn.shopify.com"]').length > 0 || $('[data-shopify]').length > 0) {
      platform = 'shopify'
    } else if ($('script[src*="woocommerce"]').length > 0 || $('body.woocommerce').length > 0) {
      platform = 'woocommerce'
    } else if ($('[class*="bigcommerce"]').length > 0) {
      platform = 'bigcommerce'
    }

    console.log(`🔍 检测到平台: ${platform || 'generic'}`)

    // Extract store name
    const storeName = $('meta[property="og:site_name"]').attr('content') ||
                      $('meta[name="application-name"]').attr('content') ||
                      $('title').text().split(/[|\-–]/).pop()?.trim() ||
                      $('h1').first().text().trim() ||
                      null

    // Extract store description
    const storeDescription = $('meta[property="og:description"]').attr('content') ||
                             $('meta[name="description"]').attr('content') ||
                             null

    // Extract logo
    const logoUrl = $('meta[property="og:image"]').attr('content') ||
                    $('link[rel="icon"]').attr('href') ||
                    $('img[class*="logo"], img[alt*="logo" i], header img').first().attr('src') ||
                    null

    // Extract products - try multiple common e-commerce patterns
    const products: IndependentStoreData['products'] = []

    // Common product container selectors
    const productSelectors = [
      // Shopify
      '.product-card',
      '.product-item',
      '[class*="ProductItem"]',
      '[class*="product-grid"] > *',
      '.collection-product',
      // WooCommerce
      '.product',
      '.woocommerce-LoopProduct-link',
      // Generic
      '[class*="product"]',
      '[data-product-id]',
      '[data-product]',
      '.item',
      '.card',
      // Grid items
      '.grid-item',
      '[class*="grid"] > div',
      '[class*="collection"] > div',
    ]

    for (const selector of productSelectors) {
      if (products.length >= 5) break // If we found some products, stop trying

      $(selector).each((i, el) => {
        if (products.length >= 30) return false

        const $el = $(el)

        // Extract product name
        const name = $el.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim() ||
                     $el.find('a').first().text().trim() ||
                     $el.find('img').first().attr('alt') ||
                     ''

        // Extract price
        const priceText = $el.find('[class*="price"], .money, [data-price]').first().text().trim()
        const price = priceText || null

        // Extract image
        const imageUrl = $el.find('img').first().attr('src') ||
                         $el.find('img').first().attr('data-src') ||
                         null

        // Extract product link
        const productUrl = $el.find('a').first().attr('href') ||
                          $el.attr('href') ||
                          null

        // Add product if we have a valid name
        if (name && name.length > 3 && name.length < 200 && !products.some(p => p.name === name)) {
          products.push({
            name,
            price,
            productUrl: productUrl ? (productUrl.startsWith('http') ? productUrl : new URL(productUrl, finalUrl).href) : null,
          })
        }
      })
    }

    // Fallback: Extract from images with product-like alt text
    if (products.length < 5) {
      console.log('🔍 尝试从图片提取产品...')
      $('img[alt]').each((i, el) => {
        if (products.length >= 30) return false

        const alt = $(el).attr('alt')?.trim() || ''
        const src = $(el).attr('src') || $(el).attr('data-src') || ''

        // Filter for likely product images
        if (alt && alt.length > 5 && alt.length < 150 &&
            !alt.toLowerCase().includes('logo') &&
            !alt.toLowerCase().includes('banner') &&
            !alt.toLowerCase().includes('icon') &&
            src &&
            !products.some(p => p.name === alt)) {

          // Try to find price near image
          const $parent = $(el).closest('div, li, article').first()
          const nearbyPrice = $parent.find('[class*="price"], .money').first().text().trim() || null
          const nearbyLink = $parent.find('a[href*="/product"], a[href*="/collections"]').first().attr('href') || null

          products.push({
            name: alt,
            price: nearbyPrice,
            productUrl: nearbyLink ? (nearbyLink.startsWith('http') ? nearbyLink : new URL(nearbyLink, finalUrl).href) : null,
          })
        }
      })
    }

    const storeData: IndependentStoreData = {
      storeName: storeName ? normalizeBrandName(storeName) : null,
      storeDescription,
      logoUrl,
      products,
      totalProducts: products.length,
      storeUrl: finalUrl,
      platform,
    }

    console.log(`✅ 独立站抓取成功: ${storeName}`)
    console.log(`📊 发现 ${products.length} 个产品`)

    return storeData
  } finally {
    await releaseBrowser(browserResult)
  }

    } catch (error: any) {
      lastError = error
      console.error(`❌ 独立站抓取尝试 ${proxyAttempt + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (isProxyConnectionError(error) && proxyAttempt < maxProxyRetries) {
        console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
        continue
      }

      // 其他错误或已用尽重试次数
      throw error
    }
  }

  // 所有重试都失败
  throw lastError || new Error('独立站抓取失败：已用尽所有代理重试')
}
