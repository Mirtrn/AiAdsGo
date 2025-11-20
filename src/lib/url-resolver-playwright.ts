import { Browser, BrowserContext, Page } from 'playwright'
import { getPlaywrightPool } from './playwright-pool'
import { smartWaitForLoad, assessPageComplexity, recordWaitOptimization } from './smart-wait-strategy'

/**
 * User-Agent rotation pool (2024 browsers)
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
]

/**
 * Get random User-Agent
 */
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

/**
 * Configure page with stealth settings to bypass anti-bot detection
 */
async function configureStealthPage(page: Page): Promise<void> {
  const userAgent = getRandomUserAgent()

  // Set enhanced headers
  await page.setExtraHTTPHeaders({
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  })

  // Override navigator.webdriver and other bot detection signals
  await page.addInitScript(() => {
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

    // Override chrome property
    ;(window as any).chrome = {
      runtime: {},
    }

    // Override permissions
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters)
  })

  // Set viewport to common desktop resolution
  await page.setViewportSize({ width: 1920, height: 1080 })
}

/**
 * Random delay for human-like behavior
 */
function randomDelay(min: number = 500, max: number = 1500): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise(resolve => setTimeout(resolve, delay))
}

/**
 * 使用Playwright解析URL（适用于需要JavaScript执行的场景）
 */
export interface PlaywrightResolvedUrl {
  finalUrl: string
  finalUrlSuffix: string
  redirectChain: string[]
  redirectCount: number
  pageTitle: string | null
  statusCode: number | null
}

/**
 * 从连接池获取浏览器上下文（复用实例，减少启动时间）
 */
async function getBrowserFromPool(proxyUrl?: string): Promise<{ browser: Browser; context: BrowserContext; fromPool: boolean }> {
  const pool = getPlaywrightPool()
  const { browser, context } = await pool.acquire(proxyUrl)

  return { browser, context, fromPool: true }
}

/**
 * 释放浏览器回连接池
 */
function releaseBrowserToPool(proxyUrl?: string): void {
  const pool = getPlaywrightPool()
  pool.release(proxyUrl)
}

/**
 * 使用Playwright解析Affiliate链接
 * 支持JavaScript重定向和动态内容
 *
 * @param affiliateLink - Offer推广链接
 * @param proxyUrl - 可选的代理URL
 * @param waitTime - 等待页面稳定的时间（毫秒），默认5000
 * @returns 解析后的URL信息
 */
export async function resolveAffiliateLinkWithPlaywright(
  affiliateLink: string,
  proxyUrl?: string,
  waitTime = 5000
): Promise<PlaywrightResolvedUrl> {
  let page: Page | null = null
  let fromPool = false

  try {
    // 从连接池获取浏览器（复用实例，减少启动时间50%）
    const { browser, context, fromPool: pooled } = await getBrowserFromPool(proxyUrl)
    fromPool = pooled

    // 创建页面
    page = await context.newPage()

    // Apply stealth configuration to bypass anti-bot detection
    await configureStealthPage(page)
    console.log('✅ Stealth配置已应用')

    // Add random delay before navigation (human-like behavior)
    await randomDelay(500, 1500)

    // 记录重定向链
    const redirectChain: string[] = [affiliateLink]

    // 监听页面导航事件
    page.on('framenavigated', (frame) => {
      if (frame === page!.mainFrame()) {
        const url = frame.url()
        if (url !== redirectChain[redirectChain.length - 1]) {
          redirectChain.push(url)
        }
      }
    })

    // 访问推广链接
    console.log(`Playwright访问: ${affiliateLink}`)

    // 使用智能等待策略评估页面复杂度
    const complexity = assessPageComplexity(affiliateLink)
    console.log(`页面复杂度: ${complexity.complexity}, 推荐timeout: ${complexity.recommendedTimeout}ms`)

    const gotoStartTime = Date.now()

    // 基础导航（使用domcontentloaded而不是networkidle，更快）
    const response = await page.goto(affiliateLink, {
      waitUntil: 'domcontentloaded',  // 更快的等待策略
      timeout: complexity.recommendedTimeout,
    })

    // 使用智能等待策略等待页面真正加载完成
    const smartWait = await smartWaitForLoad(page, affiliateLink, {
      maxWaitTime: waitTime > 0 ? waitTime : complexity.recommendedWaitTime,
    })

    // Simulate human behavior: scrolling and reading
    await randomDelay(800, 1500)
    await page.evaluate(() => {
      window.scrollBy(0, Math.random() * 500)
    }).catch(() => {})
    await randomDelay(500, 1000)

    const totalWaitTime = Date.now() - gotoStartTime

    console.log(`智能等待完成: ${smartWait.waited}ms, 信号: ${smartWait.signals.join(', ')}`)

    // 记录优化效果（相比固定等待networkidle + waitTime）
    const traditionalWaitTime = 60000  // 传统方式固定60秒
    recordWaitOptimization(traditionalWaitTime, totalWaitTime)

    // 获取最终URL
    const finalFullUrl = page.url()
    const pageTitle = await page.title()
    const statusCode = response?.status() || null

    // 分离Final URL和Final URL suffix
    const urlObj = new URL(finalFullUrl)
    const finalUrl = `${urlObj.origin}${urlObj.pathname}`
    const finalUrlSuffix = urlObj.search.substring(1)

    const redirectCount = redirectChain.length - 1

    console.log(`Playwright解析完成: ${redirectCount}次重定向`)
    console.log(`Final URL: ${finalUrl}`)

    return {
      finalUrl,
      finalUrlSuffix,
      redirectChain,
      redirectCount,
      pageTitle,
      statusCode,
    }
  } catch (error: any) {
    console.error('Playwright解析失败:', error)
    throw new Error(`Playwright解析失败: ${error.message}`)
  } finally {
    // 清理页面资源
    if (page) await page.close().catch(() => {})

    // 释放浏览器回连接池（而不是关闭）
    if (fromPool) {
      releaseBrowserToPool(proxyUrl)
    }
  }
}

/**
 * 验证Final URL是否包含预期的品牌信息
 *
 * @param finalUrl - Final URL
 * @param expectedBrand - 预期的品牌名称
 * @param proxyUrl - 可选的代理URL
 * @returns 验证结果
 */
export async function verifyBrandInFinalUrl(
  finalUrl: string,
  expectedBrand: string,
  proxyUrl?: string
): Promise<{ found: boolean; score: number; matches: string[] }> {
  let page: Page | null = null
  let fromPool = false

  try {
    const { browser, context, fromPool: pooled } = await getBrowserFromPool(proxyUrl)
    fromPool = pooled
    page = await context.newPage()

    await page.goto(finalUrl, {
      waitUntil: 'networkidle',
      timeout: 60000, // 增加到60秒
    })

    // 提取页面文本
    const pageText = await page.evaluate(() => document.body.innerText)
    const pageTitle = await page.title()
    const metaDescription =
      (await page.getAttribute('meta[name="description"]', 'content')) || ''

    // 品牌匹配检测
    const brandLower = expectedBrand.toLowerCase()
    const matches: string[] = []

    // 检查URL
    if (finalUrl.toLowerCase().includes(brandLower)) {
      matches.push('URL包含品牌名')
    }

    // 检查标题
    if (pageTitle.toLowerCase().includes(brandLower)) {
      matches.push('页面标题包含品牌名')
    }

    // 检查meta描述
    if (metaDescription.toLowerCase().includes(brandLower)) {
      matches.push('Meta描述包含品牌名')
    }

    // 检查页面内容
    if (pageText.toLowerCase().includes(brandLower)) {
      matches.push('页面内容包含品牌名')
    }

    const found = matches.length > 0
    const score = matches.length / 4 // 最多4个匹配项，满分1.0

    return { found, score, matches }
  } catch (error: any) {
    console.error('品牌验证失败:', error)
    return { found: false, score: 0, matches: [] }
  } finally {
    if (page) await page.close().catch(() => {})
    if (fromPool) {
      releaseBrowserToPool(proxyUrl)
    }
  }
}

/**
 * 截取Final URL的截图（用于调试和风险检测）
 *
 * @param finalUrl - Final URL
 * @param outputPath - 截图保存路径
 * @param proxyUrl - 可选的代理URL
 */
export async function captureScreenshot(
  finalUrl: string,
  outputPath: string,
  proxyUrl?: string
): Promise<void> {
  let page: Page | null = null
  let fromPool = false

  try {
    const { browser, context, fromPool: pooled } = await getBrowserFromPool(proxyUrl)
    fromPool = pooled
    page = await context.newPage()

    await page.goto(finalUrl, {
      waitUntil: 'networkidle',
      timeout: 60000, // 增加到60秒
    })

    await page.screenshot({
      path: outputPath,
      fullPage: true,
    })

    console.log(`截图已保存: ${outputPath}`)
  } catch (error: any) {
    console.error('截图失败:', error)
    throw new Error(`截图失败: ${error.message}`)
  } finally {
    if (page) await page.close().catch(() => {})
    if (fromPool) {
      releaseBrowserToPool(proxyUrl)
    }
  }
}
