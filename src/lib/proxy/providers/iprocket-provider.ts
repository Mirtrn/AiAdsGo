import type { ProxyProvider } from './base-provider'
import type { ProxyCredentials } from '../types'
import type { ValidationResult } from './base-provider'
import { validateProxyUrl } from '../validate-url'

/**
 * IPRocket代理提供商
 * 处理格式: https://api.iprocket.io/api?username=X&password=Y&cc=UK|CA|ROW&ips=1&proxyType=http&responseType=txt
 * 响应格式: host:port:username:password (文本)
 */
export class IPRocketProvider implements ProxyProvider {
  name = 'IPRocket'

  canHandle(url: string): boolean {
    return url.includes('api.iprocket.io')
  }

  validate(url: string): ValidationResult {
    return validateProxyUrl(url)
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    // 验证URL
    const validation = this.validate(url)
    if (!validation.isValid) {
      throw new Error(`IPRocket URL验证失败:\n${validation.errors.join('\n')}`)
    }

    // 使用Playwright获取代理IP
    const { chromium } = await import('playwright')

    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
          '--disable-ipc-flooding-protection',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=ScriptStreaming',
          '--disable-v8-idle-tasks',
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

      // Stealth脚本
      await page.addInitScript(() => {
        delete Object.getPrototypeOf(navigator).webdriver
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        })
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5].map((_, i) => ({
            name: 'Chrome PDF Plugin',
            filename: 'internal-pdf-viewer',
            description: 'Portable Document Format',
          })),
        })
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        })
      })

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      })

      if (!response || response.status() !== 200) {
        throw new Error(`获取代理IP失败: HTTP ${response?.status() || 'unknown'}`)
      }

      const text = await page.textContent('body')
      if (!text) {
        throw new Error('代理IP响应为空')
      }

      // 解析代理字符串 (格式: host:port:username:password)
      const firstLine = text.trim().split('\n')[0].trim()
      const parts = firstLine.split(':')

      if (parts.length !== 4) {
        throw new Error(
          `代理IP格式错误: 期望4个字段，实际${parts.length}个字段`
        )
      }

      const [host, portStr, username, password] = parts

      // 验证
      if (!host || host.length < 7) {
        throw new Error(`主机地址无效: ${host}`)
      }

      const port = parseInt(portStr)
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`端口号无效: ${portStr}（有效范围: 1-65535）`)
      }

      if (!username || username.length === 0) {
        throw new Error('用户名不能为空')
      }

      if (!password || password.length === 0) {
        throw new Error('密码不能为空')
      }

      return {
        host,
        port,
        username,
        password,
        fullAddress: `${host}:${port}`,
      }
    } finally {
      if (browser) {
        await browser.close().catch(() => {})
      }
    }
  }
}
