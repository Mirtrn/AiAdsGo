import { validateProxyUrl } from './validate-url'

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
 * 从代理服务商API获取代理IP（带重试机制）
 *
 * 代理服务商返回格式: host:port:username:password
 * 例如: 15.235.13.80:5959:com49692430-res-row-sid-867994980:Qxi9V59e3kNOW6pnRi3i
 *
 * @param proxyUrl - 代理服务商API URL
 * @param maxRetries - 最大重试次数，默认3次
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
export async function fetchProxyIp(proxyUrl: string, maxRetries = 3): Promise<ProxyCredentials> {
  // Step 1: 验证URL格式
  const validation = validateProxyUrl(proxyUrl)
  if (!validation.isValid) {
    throw new Error(`Proxy URL验证失败:\n${validation.errors.join('\n')}`)
  }

  // Step 2: 带重试的请求代理IP
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`尝试获取代理IP (${attempt}/${maxRetries})...`)

      const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        // 设置超时10秒
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        throw new Error(`获取代理IP失败: HTTP ${response.status} ${response.statusText}`)
      }

    // Step 3: 解析响应
    const responseText = await response.text()
    const proxyString = responseText.trim()

    // 如果返回多行，只取第一行
    const firstLine = proxyString.split('\n')[0].trim()

    // Step 4: 解析代理字符串 (格式: host:port:username:password)
    const parts = firstLine.split(':')

    if (parts.length !== 4) {
      throw new Error(
        `代理IP格式错误: 期望4个字段（host:port:username:password），实际${parts.length}个字段。\n响应内容: ${firstLine}`
      )
    }

    const [host, portStr, username, password] = parts

    // 验证host
    if (!host || host.length < 7) {
      // 最短IP: 1.1.1.1
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

      console.log(`成功获取代理IP: ${credentials.fullAddress}`)

      return credentials
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('未知错误')
      console.warn(`尝试 ${attempt}/${maxRetries} 失败: ${lastError.message}`)

      // 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        const waitTime = attempt * 1000 // 1秒、2秒、3秒
        console.log(`等待 ${waitTime}ms 后重试...`)
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
 * 获取代理IP（带缓存）
 *
 * 同一个Proxy URL在5分钟内会复用相同的代理IP，
 * 避免频繁请求代理服务商API
 *
 * @param proxyUrl - 代理服务商API URL
 * @param forceRefresh - 是否强制刷新（忽略缓存）
 * @returns 代理凭证信息
 */
export async function getProxyIp(
  proxyUrl: string,
  forceRefresh = false
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
