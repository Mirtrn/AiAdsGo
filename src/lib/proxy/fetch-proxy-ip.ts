import { validateProxyUrl, maskProxyUrl } from './validate-url'
import axios from 'axios'

/**
 * 代理凭证信息
 */
export interface ProxyCredentials {
  host: string          // 代理服务器地址
  port: number          // 代理服务器端口
  username: string      // 认证用户名
  password: string      // 认证密码
  fullAddress: string   // 完整地址格式 (host:port)
}

/**
 * 健康检查结果
 */
export interface HealthCheckResult {
  healthy: boolean
  responseTime?: number
  error?: string
}

/**
 * 🔥 P1优化：快速TCP连接测试
 * 使用纯TCP连接测试代理IP的连通性，比HTTP请求快5-10倍
 *
 * @param host - 代理服务器地址
 * @param port - 代理服务器端口
 * @param timeoutMs - 超时时间（默认2秒）
 * @returns 连接耗时（毫秒），失败返回-1
 */
export async function tcpPing(host: string, port: number, timeoutMs = 2000): Promise<number> {
  const net = await import('net')

  return new Promise((resolve) => {
    const startTime = Date.now()
    const socket = new net.Socket()

    socket.setTimeout(timeoutMs)

    socket.on('connect', () => {
      const elapsed = Date.now() - startTime
      socket.destroy()
      resolve(elapsed)
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve(-1)
    })

    socket.on('error', () => {
      socket.destroy()
      resolve(-1)
    })

    socket.connect(port, host)
  })
}

/**
 * 🔥 P0优化：测试代理IP健康状态
 * 支持两种模式：
 * - 快速模式（默认）：仅TCP连接测试，耗时1-2秒
 * - 完整模式：HTTP请求测试，耗时3-10秒
 *
 * @param credentials - 代理凭证
 * @param timeoutMs - 测试超时时间（默认3秒）
 * @param fullCheck - 是否进行完整HTTP检查（默认false，仅TCP测试）
 * @returns 健康状态对象
 */
export async function testProxyHealth(
  credentials: ProxyCredentials,
  timeoutMs = 3000,
  fullCheck = false
): Promise<HealthCheckResult> {
  const startTime = Date.now()

  // 🔥 快速模式：仅TCP连接测试
  if (!fullCheck) {
    const tcpTime = await tcpPing(credentials.host, credentials.port, timeoutMs)
    const responseTime = Date.now() - startTime

    if (tcpTime === -1) {
      console.warn(`❌ 代理TCP连接失败: ${credentials.fullAddress} (${responseTime}ms)`)
      return {
        healthy: false,
        responseTime,
        error: 'TCP connection failed',
      }
    }

    // TCP连接成功，响应时间小于阈值则认为健康
    const healthy = tcpTime < 3000 // TCP连接小于3秒认为健康

    if (healthy) {
      console.log(`✅ 代理TCP测试通过: ${credentials.fullAddress} (${tcpTime}ms)`)
    } else {
      console.warn(`⚠️ 代理TCP响应慢: ${credentials.fullAddress} (${tcpTime}ms)`)
    }

    return {
      healthy,
      responseTime: tcpTime,
    }
  }

  // 完整模式：HTTP请求测试
  try {
    // 🔥 使用Amazon本身测试，因为我们的目标就是访问Amazon
    // 使用robots.txt作为测试端点（轻量级，无反爬虫）
    const testUrl = 'https://www.amazon.com/robots.txt'
    const proxyUrl = `http://${credentials.username}:${credentials.password}@${credentials.host}:${credentials.port}`

    // 使用node-fetch + https-proxy-agent测试
    // @ts-ignore - node-fetch类型声明问题
    const { default: fetch } = await import('node-fetch')
    const { HttpsProxyAgent } = await import('https-proxy-agent')

    const agent = new HttpsProxyAgent(proxyUrl)

    // 🔥 修复：使用AbortController代替AbortSignal.timeout (更可靠的超时控制)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(testUrl, {
        method: 'GET', // 使用GET获取实际内容，确保代理真实可用
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/plain,*/*',
        },
        agent,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseTime = Date.now() - startTime

      // 健康标准：
      // 1. HTTP状态码正常 (200-399)
      // 2. 响应时间 < 8秒（放宽阈值，提高代理可用率）
      const healthy = response.ok && responseTime < 8000

      if (healthy) {
        console.log(`✅ 代理IP健康检查通过: ${credentials.fullAddress} (${responseTime}ms)`)
      } else {
        console.warn(`⚠️ 代理IP响应慢: ${credentials.fullAddress} (${responseTime}ms)`)
      }

      return {
        healthy,
        responseTime,
        error: !response.ok ? `HTTP ${response.status}` : undefined,
      }
    } catch (fetchError: any) {
      // 清理超时定时器
      clearTimeout(timeoutId)
      throw fetchError
    }
  } catch (error: any) {
    const responseTime = Date.now() - startTime
    console.warn(`❌ 代理IP健康检查失败: ${credentials.fullAddress} - ${error.message} (${responseTime}ms)`)

    return {
      healthy: false,
      responseTime,
      error: error.message || String(error),
    }
  }
}

/**
 * 🔥 P0优化：异步健康检查（不阻塞主流程）
 * 在后台执行健康检查，返回Promise供调用者选择是否等待
 */
export function testProxyHealthAsync(
  credentials: ProxyCredentials,
  timeoutMs = 3000
): Promise<HealthCheckResult> {
  // 直接返回Promise，调用者可以选择await或忽略
  return testProxyHealth(credentials, timeoutMs)
}

/**
 * 从代理服务商API获取代理IP（带重试机制和健康检查）
 *
 * 🔥 P1优化：新增代理IP质量过滤机制
 * - 自动测试代理IP连通性和响应时间
 * - 过滤掉慢速或不可用的代理IP
 * - 减少SSL错误和连接超时问题
 *
 * 代理服务商返回格式: host:port:username:password
 * 例如: 15.235.13.80:5959:com49692430-res-row-sid-867994980:Qxi9V59e3kNOW6pnRi3i
 *
 * @param proxyUrl - 代理服务商API URL
 * @param maxRetries - 最大重试次数，默认3次
 * @param skipHealthCheck - 跳过健康检查（默认false，启用质量过滤）
 * @returns 代理凭证信息
 * @throws 如果获取失败或格式错误
 *
 * @example
 * const proxy = await fetchProxyIp(proxyUrl)
 * // {
 * //   host: '15.235.13.80',
 * //   port: 5959,
 * //   username: 'com49692430-res-row-sid-867994980',
 * //   password: 'Qxi9V59e3kNOW6pnRi3i',
 * //   fullAddress: '15.235.13.80:5959'
 * // }
 */
export async function fetchProxyIp(
  proxyUrl: string,
  maxRetries = 3,
  skipHealthCheck = false
): Promise<ProxyCredentials> {
  // Step 1: 验证URL格式
  const validation = validateProxyUrl(proxyUrl)
  if (!validation.isValid) {
    throw new Error(`Proxy URL验证失败:\n${validation.errors.join('\n')}`)
  }

  // Step 2: 带重试的请求代理IP
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 🔥 KISS优化：精简日志，只保留关键信息
      console.log(`🔍 [代理IP ${attempt}/${maxRetries}] 开始获取...`)

      // 🔥 最终解决方案：使用Playwright获取代理IP
      // 根本原因：CloudFlare的TLS指纹检测阻断了Node.js的所有网络方法

      const startTime = Date.now()

      const { chromium } = await import('playwright')

      let proxyString: string
      let browser
      try {
        // 🔥 使用增强版Stealth配置绕过CloudFlare
        browser = await chromium.launch({
          headless: true,
          args: [
            // 基础安全参数
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',

            // 反检测参数
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
            '--disable-ipc-flooding-protection',

            // User-Agent和语言
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',

            // 性能优化
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=ScriptStreaming',
            '--disable-v8-idle-tasks',

            // WebGL和Canvas指纹防护
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
          ],
        })

        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          viewport: { width: 1920, height: 1080 },
          locale: 'en-US',
          timezoneId: 'America/New_York',
          colorScheme: 'light',
          extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Sec-Ch-Ua': '"Google Chrome";v="130", "Chromium";v="130", "Not?A_Brand";v="24"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
          },
        })

        const page = await context.newPage()

        // ========== 核心Stealth脚本 ==========
        // @ts-ignore - 此代码在浏览器端执行，非Node.js环境
        await page.addInitScript(() => {
          // 1. 移除webdriver特征
          // @ts-ignore
          delete Object.getPrototypeOf(navigator).webdriver

          // 2. 修改navigator信息
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
          })

          // 3. 修改plugins（显示为真实Chrome）
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5].map((_, i) => ({
              name: 'Chrome PDF Plugin',
              filename: 'internal-pdf-viewer',
              description: 'Portable Document Format',
            })),
          })

          // 4. 修改languages
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
          })

          // 5. 修改permissions（通知权限）
          // @ts-ignore - 浏览器端类型与Node.js不同
          const originalQuery = window.navigator.permissions.query
          // @ts-ignore
          window.navigator.permissions.query = (parameters: any) => (
            parameters.name === 'notifications' ?
              Promise.resolve({ state: Notification.permission }) :
              originalQuery(parameters)
          )

          // 6. 修改Chrome运行时信息
          // @ts-ignore - chrome对象仅存在于浏览器端
          window.chrome = {
            runtime: {},
            loadTimes: function() {},
            csi: function() {},
            onConnect: null,
            onMessage: null,
          }

          // 7. 移除automation属性
          Object.defineProperty(navigator, 'automation', {
            get: () => undefined,
          })

          // 8. 修改屏幕信息
          Object.defineProperty(screen, 'availWidth', {
            get: () => 1920,
          })
          Object.defineProperty(screen, 'availHeight', {
            get: () => 1080,
          })

          // 9. 覆盖toString方法
          window.navigator.toString = function() {
            return '[object Navigator]'
          }

          // 10. 修改内部属性
          try {
            // @ts-ignore - __proto__在浏览器端存在
            const proto = window.navigator.__proto__
            delete proto.webdriver
          } catch (e) {}
        })

        // 🔥 KISS优化：移除不必要的等待，直接访问API
        const response = await page.goto(proxyUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        })

        if (!response || response.status() !== 200) {
          throw new Error(`获取代理IP失败: HTTP ${response?.status() || 'unknown'}`)
        }

        // 🔥 KISS优化：文本API不需要额外等待，直接读取内容
        const text = await page.textContent('body')
        if (!text) {
          throw new Error('代理IP响应为空')
        }

        proxyString = text
        const fetchTime = Date.now() - startTime
        console.log(`✅ [代理IP] 获取成功 (${fetchTime}ms)`)

      } finally {
        if (browser) {
          await browser.close().catch(() => {})
        }
      }

      // 如果返回多行，只取第一行
      const firstLine = proxyString.trim().split('\n')[0].trim()

      // Step 4: 解析代理字符串 (格式: host:port:username:password)
      const parts = firstLine.split(':')
      if (parts.length !== 4) {
        throw new Error(
          `代理IP格式错误: 期望4个字段，实际${parts.length}个字段`
        )
      }

      const [host, portStr, username, password] = parts

      // 验证host
      if (!host || host.length < 7) {
        throw new Error(`主机地址无效: ${host}`)
      }

      // 验证port
      const port = parseInt(portStr)
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`端口号无效: ${portStr}（有效范围: 1-65535）`)
      }

      // 验证username和password
      if (!username || username.length === 0) {
        throw new Error('用户名不能为空')
      }

      if (!password || password.length === 0) {
        throw new Error('密码不能为空')
      }

      const credentials: ProxyCredentials = {
        host,
        port,
        username,
        password,
        fullAddress: `${host}:${port}`,
      }

      // 🔥 P0优化：阻塞式健康检查，失败时重试获取新代理
      if (!skipHealthCheck) {
        const healthCheck = await testProxyHealth(credentials, 10000)
        if (!healthCheck.healthy) {
          console.warn(`⚠️ 代理IP健康检查失败: ${credentials.fullAddress} (${healthCheck.error || '响应过慢'})`)
          throw new Error(`代理IP健康检查失败: ${healthCheck.error || '响应过慢'}`)
        }
        console.log(`✅ [代理IP] ${credentials.fullAddress} 健康检查通过 (${healthCheck.responseTime}ms)`)
      } else {
        console.log(`✅ [代理IP] ${credentials.fullAddress} (跳过健康检查)`)
      }

      return credentials
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('未知错误')
      console.error(`❌ [代理IP ${attempt}/${maxRetries}] ${lastError.message}`)

      // 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        const waitTime = attempt * 1000
        console.log(`⏳ 等待 ${waitTime}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }
    }
  }

  // 所有重试都失败
  throw new Error(`获取代理IP失败（已重试${maxRetries}次）: ${lastError?.message || '未知错误'}`)
}

/**
 * 代理IP缓存
 * 避免频繁请求代理服务商API
 */
interface CachedProxy {
  credentials: ProxyCredentials
  fetchedAt: number
  expiresAt: number
}

const proxyCache = new Map<string, CachedProxy>()
const CACHE_DURATION = 5 * 60 * 1000 // 5分钟

/**
 * 🔥 P1优化：并行获取多个代理IP并选择最快的
 * 同时获取N个代理IP，通过TCP ping测试选择响应最快的
 *
 * @param proxyUrl - 代理服务商API URL
 * @param concurrency - 并行获取数量（默认3）
 * @param timeoutMs - TCP ping超时（默认2000ms）
 * @returns 最快的代理凭证，如果全部失败则抛出错误
 */
export async function fetchFastestProxy(
  proxyUrl: string,
  concurrency = 3,
  timeoutMs = 2000
): Promise<ProxyCredentials> {
  console.log(`\n🚀 并行获取 ${concurrency} 个代理IP，选择最快的...`)
  const startTime = Date.now()

  // 并行获取多个代理IP（跳过健康检查，后面统一测试）
  const fetchPromises: Promise<ProxyCredentials | null>[] = []
  for (let i = 0; i < concurrency; i++) {
    fetchPromises.push(
      fetchProxyIp(proxyUrl, 1, true)  // 单次尝试，跳过健康检查
        .then((creds) => {
          console.log(`✅ [${i + 1}] 获取成功: ${creds.fullAddress}`)
          return creds
        })
        .catch((err) => {
          console.warn(`⚠️ [${i + 1}] 获取失败: ${err.message}`)
          return null
        })
    )
  }

  // 等待所有获取完成
  const results = await Promise.all(fetchPromises)
  const validCredentials = results.filter((c): c is ProxyCredentials => c !== null)

  if (validCredentials.length === 0) {
    throw new Error(`获取代理IP失败：${concurrency}个并行请求全部失败`)
  }

  console.log(`📊 成功获取 ${validCredentials.length}/${concurrency} 个代理IP`)

  // 如果只有1个，直接返回
  if (validCredentials.length === 1) {
    const creds = validCredentials[0]
    // 做一次快速健康检查
    const health = await testProxyHealth(creds, timeoutMs, false)
    if (!health.healthy) {
      throw new Error(`唯一的代理IP健康检查失败: ${health.error}`)
    }
    console.log(`✅ 代理IP选中: ${creds.fullAddress} (${health.responseTime}ms)`)
    return creds
  }

  // 并行TCP ping测试所有代理
  console.log(`🏃 并行测试 ${validCredentials.length} 个代理IP的响应速度...`)
  const pingPromises = validCredentials.map(async (creds) => {
    const pingTime = await tcpPing(creds.host, creds.port, timeoutMs)
    return { creds, pingTime }
  })

  const pingResults = await Promise.all(pingPromises)

  // 过滤健康的代理并按响应时间排序
  const healthyProxies = pingResults
    .filter((r) => r.pingTime > 0)
    .sort((a, b) => a.pingTime - b.pingTime)

  if (healthyProxies.length === 0) {
    throw new Error(`所有代理IP的TCP连接测试均失败`)
  }

  // 选择最快的
  const fastest = healthyProxies[0]
  const totalTime = Date.now() - startTime

  console.log(`\n🏆 最快代理IP: ${fastest.creds.fullAddress}`)
  console.log(`   - TCP响应: ${fastest.pingTime}ms`)
  console.log(`   - 总耗时: ${totalTime}ms`)
  console.log(`   - 淘汰: ${validCredentials.length - healthyProxies.length} 个慢速/失败`)

  // 输出所有测试结果
  pingResults.forEach((r, i) => {
    const status = r.pingTime > 0 ? `${r.pingTime}ms` : '❌失败'
    const selected = r === fastest ? ' 👈 选中' : ''
    console.log(`   [${i + 1}] ${r.creds.fullAddress}: ${status}${selected}`)
  })

  return fastest.creds
}

/**
 * 获取代理IP（默认不使用缓存）
 *
 * 默认每次都获取最新的代理IP，确保代理有效性
 * 如需使用缓存（5分钟），设置 forceRefresh = false
 *
 * @param proxyUrl - 代理服务商API URL
 * @param forceRefresh - 是否强制刷新（默认true，总是获取新IP）
 * @returns 代理凭证信息
 */
export async function getProxyIp(
  proxyUrl: string,
  forceRefresh = true
): Promise<ProxyCredentials> {
  const now = Date.now()

  // 检查缓存
  if (!forceRefresh) {
    const cached = proxyCache.get(proxyUrl)
    if (cached && now < cached.expiresAt) {
      console.log(`使用缓存的代理IP: ${cached.credentials.fullAddress}`)
      return cached.credentials
    }
  }

  // 获取新IP
  const credentials = await fetchProxyIp(proxyUrl)

  // 更新缓存
  proxyCache.set(proxyUrl, {
    credentials,
    fetchedAt: now,
    expiresAt: now + CACHE_DURATION,
  })

  return credentials
}

/**
 * 清除代理IP缓存
 *
 * @param proxyUrl - 可选，指定要清除的Proxy URL，不指定则清除所有
 */
export function clearProxyCache(proxyUrl?: string): void {
  if (proxyUrl) {
    proxyCache.delete(proxyUrl)
    console.log(`已清除代理缓存: ${maskProxyUrl(proxyUrl)}`)
  } else {
    const size = proxyCache.size
    proxyCache.clear()
    console.log(`已清除所有代理缓存 (${size}个)`)
  }
}

/**
 * 获取代理缓存统计信息
 */
export function getProxyCacheStats(): {
  totalCached: number
  validCached: number
  expiredCached: number
} {
  const now = Date.now()
  let validCount = 0
  let expiredCount = 0

  proxyCache.forEach((cached) => {
    if (now < cached.expiresAt) {
      validCount++
    } else {
      expiredCount++
    }
  })

  return {
    totalCached: proxyCache.size,
    validCached: validCount,
    expiredCached: expiredCount,
  }
}
