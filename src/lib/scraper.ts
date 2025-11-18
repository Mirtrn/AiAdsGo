import axios from 'axios'
import { load } from 'cheerio'
import { HttpsProxyAgent } from 'https-proxy-agent'

const PROXY_ENABLED = process.env.PROXY_ENABLED === 'true'
const PROXY_URL = process.env.PROXY_URL || ''

/**
 * 获取代理配置
 */
async function getProxyAgent(): Promise<HttpsProxyAgent<string> | undefined> {
  if (!PROXY_ENABLED || !PROXY_URL) {
    return undefined
  }

  try {
    // 从代理服务获取代理IP
    const response = await axios.get(PROXY_URL, { timeout: 10000 })
    const proxyList = response.data.trim().split('\n')

    if (proxyList.length === 0) {
      console.warn('代理列表为空，使用直连')
      return undefined
    }

    // 使用第一个代理
    const proxyIp = proxyList[0].trim()
    console.log('使用代理:', proxyIp)

    return new HttpsProxyAgent(`http://${proxyIp}`)
  } catch (error) {
    console.error('获取代理失败，使用直连:', error)
    return undefined
  }
}

/**
 * 抓取网页内容
 */
export async function scrapeUrl(url: string): Promise<{
  html: string
  title: string
  description: string
  text: string
}> {
  try {
    const proxyAgent = await getProxyAgent()

    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      ...(proxyAgent && { httpsAgent: proxyAgent }),
    })

    const html = response.data
    const $ = load(html)

    // 提取页面标题
    const title = $('title').text() || $('h1').first().text() || ''

    // 提取meta描述
    const description = $('meta[name="description"]').attr('content') ||
                       $('meta[property="og:description"]').attr('content') || ''

    // 移除script和style标签
    $('script, style, noscript').remove()

    // 提取纯文本内容（用于AI分析）
    const text = $('body').text()
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 10000) // 限制文本长度

    return {
      html,
      title,
      description,
      text,
    }
  } catch (error: any) {
    console.error('抓取URL失败:', error)
    throw new Error(`抓取失败: ${error.message}`)
  }
}

/**
 * 验证URL是否可访问
 */
export async function validateUrl(url: string): Promise<{
  isAccessible: boolean
  statusCode?: number
  error?: string
}> {
  try {
    const proxyAgent = await getProxyAgent()

    const response = await axios.head(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      ...(proxyAgent && { httpsAgent: proxyAgent }),
      validateStatus: () => true, // 不抛出错误
    })

    return {
      isAccessible: response.status >= 200 && response.status < 400,
      statusCode: response.status,
    }
  } catch (error: any) {
    return {
      isAccessible: false,
      error: error.message,
    }
  }
}
