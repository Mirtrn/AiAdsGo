import { validateProxyUrl } from './validate-url'
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
 * 🔥 P0优化：测试代理IP健康状态（非阻塞版本）
 * 通过快速HTTP请求测试代理IP的连通性和响应时间
 *
 * @param credentials - 代理凭证
 * @param timeoutMs - 测试超时时间（默认3秒）
 * @returns 健康状态对象
 */
export async function testProxyHealth(
  credentials: ProxyCredentials,
  timeoutMs = 3000
): Promise<HealthCheckResult> {
  const startTime = Date.now()

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
      console.log(`\n🔍 [尝试 ${attempt}/${maxRetries}] 开始获取代理IP...`)
      console.log(`📍 URL: ${proxyUrl}`)

      // 🔥 最终解决方案：使用Playwright获取代理IP
      // 根本原因：CloudFlare的TLS指纹检测阻断了Node.js的所有网络方法
      // - fetch (undici): ❌ ECONNRESET
      // - axios: ❌ ECONNRESET
      // - Node.js原生https: ❌ ECONNRESET
      // - curl: ❌ ECONNRESET
      // - 浏览器手动访问: ✅ 成功（用户已验证）
      //
      // 诊断结论：IPRocket使用CloudFlare，能区分Node.js的OpenSSL和浏览器的BoringSSL
      // 解决方案：用Playwright（真实Chromium浏览器）获取代理IP

      const startTime = Date.now()
      console.log(`⏰ 开始时间: ${new Date(startTime).toISOString()}`)
      console.log(`🌐 使用Playwright（真实浏览器）获取代理IP...`)

      const { chromium } = await import('playwright')

      let proxyString: string
      let browser
      try {
        browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })

        const page = await browser.newPage({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        })

        console.log(`📡 访问代理URL...`)

        const response = await page.goto(proxyUrl, {
          waitUntil: 'networkidle',
          timeout: 15000,
        })

        const fetchTime = Date.now() - startTime
        console.log(`✅ 页面加载完成，耗时: ${fetchTime}ms`)
        console.log(`📊 HTTP状态码: ${response?.status() || 'unknown'}`)

        if (!response || response.status() !== 200) {
          throw new Error(`获取代理IP失败: HTTP ${response?.status() || 'unknown'}`)
        }

        // 获取页面文本内容
        const text = await page.textContent('body')
        if (!text) {
          throw new Error('代理IP响应为空')
        }

        proxyString = text

        const totalTime = Date.now() - startTime
        console.log(`✅ 内容提取完成，总耗时: ${totalTime}ms`)
        console.log(`📄 响应内容长度: ${proxyString.length} 字节`)
        console.log(`📄 响应原始内容: ${proxyString.substring(0, 200)}${proxyString.length > 200 ? '...' : ''}`)

      } finally {
        if (browser) {
          await browser.close().catch(() => {})
        }
      }

      // 如果返回多行，只取第一行
      const firstLine = proxyString.trim().split('\n')[0].trim()
      console.log(`📌 提取第一行: ${firstLine}`)

      // Step 4: 解析代理字符串 (格式: host:port:username:password)
      const parts = firstLine.split(':')
      console.log(`🔧 解析字段数量: ${parts.length}`)

      if (parts.length !== 4) {
        throw new Error(
          `代理IP格式错误: 期望4个字段（host:port:username:password），实际${parts.length}个字段。\n响应内容: ${firstLine}`
        )
      }

      const [host, portStr, username, password] = parts
      console.log(`🔧 解析结果:`)
      console.log(`   - host: ${host}`)
      console.log(`   - port: ${portStr}`)
      console.log(`   - username: ${username}`)
      console.log(`   - password: ${password.substring(0, 4)}***`)

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

      console.log(`✅ 成功解析代理凭证: ${credentials.fullAddress}`)

      // 🔥 P0优化：阻塞式健康检查，失败时重试获取新代理
      if (!skipHealthCheck) {
        console.log(`🏥 开始代理IP健康检查...`)
        const healthCheck = await testProxyHealth(credentials, 10000)
        if (!healthCheck.healthy) {
          console.warn(
            `⚠️ 代理IP质量检测未通过: ${credentials.fullAddress}\n` +
              `  - 响应时间: ${healthCheck.responseTime}ms\n` +
              `  - 错误: ${healthCheck.error || '响应过慢'}\n` +
              `  - 重试获取新代理IP...`
          )
          throw new Error(`代理IP健康检查失败: ${healthCheck.error || '响应过慢'}`)
        }
        console.log(`✅ 代理IP质量检测通过: ${credentials.fullAddress} (${healthCheck.responseTime}ms)`)
      }

      return credentials
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('未知错误')
      console.error(`\n❌ [尝试 ${attempt}/${maxRetries}] 失败`)
      console.error(`📛 错误信息: ${lastError.message}`)

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
    console.log(`已清除代理缓存: ${proxyUrl}`)
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
