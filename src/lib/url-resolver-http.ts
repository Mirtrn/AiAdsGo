/**
 * HTTP请求方式解析URL（Level 1降级）
 * 优点：快速、成本低
 * 缺点：不支持JavaScript重定向
 */

import axios, { AxiosInstance } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getProxyIp } from './proxy/fetch-proxy-ip'
import type { ProxyCredentials } from './proxy/fetch-proxy-ip'

export interface HttpResolvedUrl {
  finalUrl: string
  finalUrlSuffix: string
  redirectChain: string[]
  redirectCount: number
  statusCode: number
}


/**
 * 使用HTTP请求解析Affiliate链接
 *
 * @param affiliateLink - Offer推广链接
 * @param proxyUrl - 可选的代理URL
 * @param maxRedirects - 最大重定向次数（默认10）
 * @returns 解析后的URL信息
 */
export async function resolveAffiliateLinkWithHttp(
  affiliateLink: string,
  proxyUrl?: string,
  maxRedirects = 10
): Promise<HttpResolvedUrl> {
  const redirectChain: string[] = [affiliateLink]
  let currentUrl = affiliateLink
  let redirectCount = 0
  let finalStatusCode = 200

  try {
    // 配置axios实例
    const axiosConfig: any = {
      maxRedirects: 0, // 手动处理重定向
      validateStatus: (status: number) => status >= 200 && status < 400, // 接受2xx和3xx
      timeout: 15000, // 15秒超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    }

    // 如果有代理URL，先获取真实代理IP
    if (proxyUrl) {
      try {
        console.log('🔄 获取代理IP...')
        const proxyCredentials = await getProxyIp(proxyUrl)

        // 配置代理
        const proxyAgent = new HttpsProxyAgent(
          `http://${proxyCredentials.username}:${proxyCredentials.password}@${proxyCredentials.host}:${proxyCredentials.port}`
        )
        axiosConfig.httpsAgent = proxyAgent
        axiosConfig.httpAgent = proxyAgent

        console.log(`✅ 使用代理: ${proxyCredentials.fullAddress}`)
      } catch (proxyError: any) {
        // 代理获取失败 → 抛出错误，触发降级到Playwright
        console.error('❌ 获取代理IP失败:', proxyError.message)
        throw new Error(`无法获取代理IP（将降级到Playwright）: ${proxyError.message}`)
      }
    }

    const client: AxiosInstance = axios.create(axiosConfig)

    // 手动跟踪重定向
    while (redirectCount < maxRedirects) {
      console.log(`HTTP请求: ${currentUrl} (重定向 ${redirectCount}/${maxRedirects})`)

      const response = await client.get(currentUrl, {
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 600, // 接受所有状态码
      })

      finalStatusCode = response.status

      // 检查是否是重定向状态码
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location || response.headers.Location

        if (!location) {
          console.warn('重定向响应缺少Location头')
          break
        }

        // 解析重定向URL（可能是相对路径）
        let nextUrl: string
        if (location.startsWith('http')) {
          nextUrl = location
        } else if (location.startsWith('/')) {
          const urlObj = new URL(currentUrl)
          nextUrl = `${urlObj.origin}${location}`
        } else {
          const urlObj = new URL(currentUrl)
          const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1)
          nextUrl = `${urlObj.origin}${basePath}${location}`
        }

        redirectChain.push(nextUrl)
        currentUrl = nextUrl
        redirectCount++

        // 添加随机延迟模拟人类行为
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300))
      } else if (response.status === 200) {
        // 成功到达最终页面
        break
      } else {
        throw new Error(`HTTP请求失败: 状态码 ${response.status}`)
      }
    }

    if (redirectCount >= maxRedirects) {
      throw new Error(`超过最大重定向次数: ${maxRedirects}`)
    }

    // 分离Final URL和Final URL suffix
    const finalFullUrl = currentUrl
    const urlObj = new URL(finalFullUrl)
    const finalUrl = `${urlObj.origin}${urlObj.pathname}`
    const finalUrlSuffix = urlObj.search.substring(1)

    console.log(`✅ HTTP解析完成: ${redirectCount}次重定向`)
    console.log(`   Final URL: ${finalUrl}`)

    return {
      finalUrl,
      finalUrlSuffix,
      redirectChain,
      redirectCount,
      statusCode: finalStatusCode,
    }
  } catch (error: any) {
    console.error('HTTP解析失败:', error.message)

    // 如果是超时或网络错误，抛出可重试的错误
    if (
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ECONNREFUSED' ||
      error.message.includes('timeout')
    ) {
      throw new Error(`HTTP请求超时或网络错误: ${error.message}`)
    }

    // 其他错误（如SSL错误、JavaScript重定向等）抛出不可重试的错误
    // 这些错误应该降级到Playwright
    throw new Error(`HTTP请求失败（可能需要Playwright）: ${error.message}`)
  }
}

/**
 * 验证URL是否可以使用HTTP方式解析
 *
 * 某些网站可能使用JavaScript重定向，HTTP方式无法处理
 * 返回true表示可以尝试HTTP，false表示直接使用Playwright
 */
export function canUseHttpResolver(url: string): boolean {
  // 已知需要JavaScript的域名黑名单
  const jsRequiredDomains = [
    // 可以根据实际情况添加
  ]

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    // 检查是否在黑名单中
    for (const domain of jsRequiredDomains) {
      if (hostname.includes(domain)) {
        console.log(`⚠️ ${hostname} 需要JavaScript，跳过HTTP解析`)
        return false
      }
    }

    return true
  } catch {
    return false
  }
}
