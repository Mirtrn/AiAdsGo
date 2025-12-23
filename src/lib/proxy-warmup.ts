/**
 * Proxy warmup utilities for warming up affiliate links with multiple proxy IPs
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { maskProxyUrl } from './proxy/validate-url';

/**
 * 解析代理IP字符串
 * 格式：host:port:username:password
 * 示例：15.235.13.80:5959:com49692430-res-row-sid-867994980:Qxi9V59e3kNOW6pnRi3i
 */
interface ProxyCredentials {
  host: string;
  port: string;
  username: string;
  password: string;
  fullAddress: string;
}

function parseProxyIP(proxyIP: string): ProxyCredentials | null {
  try {
    const parts = proxyIP.split(':');
    if (parts.length !== 4) {
      console.error(`❌ 代理IP格式错误，应为 host:port:username:password，实际: ${proxyIP}`);
      return null;
    }

    const [host, port, username, password] = parts;
    return {
      host,
      port,
      username,
      password,
      fullAddress: `${host}:${port}`,
    };
  } catch (error) {
    console.error(`❌ 解析代理IP失败: ${proxyIP}`, error);
    return null;
  }
}

/**
 * 使用Playwright+Stealth从代理URL获取12个代理IP
 * 通过在URL中添加 &ips=12 参数来实现（仅适用于API格式的代理）
 *
 * @param proxyUrl - 原始代理URL
 * @returns 12个代理IP的数组，或空数组（如果失败）
 */
export async function fetch12ProxyIPs(proxyUrl: string): Promise<string[]> {
  try {
    // 🔥 检查代理URL格式，使用Provider系统
    const { ProxyProviderRegistry } = await import('./proxy/providers/provider-registry')

    let provider
    try {
      provider = ProxyProviderRegistry.getProvider(proxyUrl)
    } catch (error) {
      console.warn(`⚠️ 不支持的代理格式: ${proxyUrl}`)
      return []
    }

    console.log(`📋 检测到代理格式: ${provider.name}`)

    // 🔥 Oxylabs格式不需要预热（已经是直接的代理服务器）
    if (provider.name === 'Oxylabs') {
      console.log(`ℹ️ Oxylabs代理无需预热，直接使用`)
      return []
    }

    // 🔥 IPRocket格式：添加ips=12参数获取多个代理IP
    if (provider.name === 'IPRocket') {
      // 移除URL中已存在的ips参数，然后添加ips=12
      let modifiedUrl = proxyUrl

      // 移除已存在的ips参数
      modifiedUrl = modifiedUrl.replace(/[&?]ips=\d+/g, '')

      // 添加新的ips=12参数
      const separator = modifiedUrl.includes('?') ? '&' : '?'
      modifiedUrl = `${modifiedUrl}${separator}ips=12`

      console.log(`🌐 获取12个代理IP: ${modifiedUrl}`)

      // 🔥 使用增强版Stealth配置绕过CloudFlare
      const { chromium } = await import('playwright')
      const browser = await chromium.launch({
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

      let proxyIPs: string[] = []

      try {
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

        // 页面加载前等待
        await page.waitForTimeout(500)

        const response = await page.goto(modifiedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        })

        if (!response || response.status() !== 200) {
          console.error(`❌ 获取代理IP失败: HTTP ${response?.status() || 'unknown'}`)
          return []
        }

        // 等待内容加载
        await page.waitForTimeout(1000)

        // 获取页面文本内容
        const text = await page.textContent('body')

        if (!text) {
          console.error('❌ 代理API响应为空')
          return []
        }

        // 解析代理IP列表（每行一个）
        proxyIPs = text
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)

        console.log(`✅ 成功获取 ${proxyIPs.length} 个代理IP`)
      } finally {
        await browser.close().catch(() => {})
      }

      return proxyIPs
    }

    // 其他格式直接返回空数组
    console.warn(`⚠️ 不支持的代理格式: ${provider.name}`)
    return []
  } catch (error: any) {
    console.error('❌ 获取代理IP时发生错误:', error.message || error)
    return []
  }
}

/**
 * 使用多个代理IP发起推广链接访问（fire-and-forget模式）
 *
 * 注意：
 * - 此函数会真正通过每个代理IP发送HTTP请求访问推广链接
 * - 函数只负责发起访问，不等待访问完成（后台执行）
 * - 主要用于触发affiliate跟踪和链接预热
 *
 * @param proxyIPs - 代理IP数组（格式：host:port:username:password）
 * @param affiliateLink - 推广链接
 */
export async function triggerProxyVisits(
  proxyIPs: string[],
  affiliateLink: string
): Promise<void> {
  console.log(`🔥 开始触发 ${proxyIPs.length} 次推广链接访问（通过代理IP）...`);

  // 为每个代理IP创建一个访问Promise（不等待结果）
  const visitPromises = proxyIPs.map(async (proxyIP, index) => {
    try {
      // 解析代理IP
      const proxy = parseProxyIP(proxyIP);
      if (!proxy) {
        console.log(`✗ 访问 #${index + 1} 失败: 代理IP格式错误`);
        return;
      }

      // 创建 HttpsProxyAgent
      const proxyAgent = new HttpsProxyAgent(
        `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
      );

      // 创建配置了代理的 axios 客户端
      const client = axios.create({
        timeout: 5000, // 5秒超时
        httpsAgent: proxyAgent,
        httpAgent: proxyAgent as any,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
        },
        maxRedirects: 0, // 不跟随重定向，只触发初始请求即可
        validateStatus: () => true, // 接受所有HTTP状态码
      });

      // 使用代理发送请求
      await client.get(affiliateLink);

      console.log(`✓ 访问 #${index + 1} 已触发（代理: ${proxy.fullAddress}）`);
    } catch (error) {
      // 忽略错误，只记录日志
      // 即使访问失败，也不影响主流程
      console.log(`✗ 访问 #${index + 1} 失败:`, error instanceof Error ? error.message : String(error));
    }
  });

  // 不等待所有Promise完成，立即返回（fire-and-forget）
  // 让这些请求在后台执行
  Promise.allSettled(visitPromises).then((results) => {
    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    const failureCount = results.filter((r) => r.status === 'rejected').length;
    console.log(`✅ 所有访问请求已完成: 成功 ${successCount}/${proxyIPs.length}, 失败 ${failureCount}/${proxyIPs.length}`);
  });

  console.log(`✅ 已触发 ${proxyIPs.length} 次访问（通过代理IP），不等待访问完成`);
}

/**
 * 执行推广链接预热流程
 * 通过多个代理IP发起推广链接访问，用于触发affiliate跟踪
 *
 * 注意：此函数只等待访问发起，不等待访问完成（fire-and-forget模式）
 *
 * @param proxyUrl - 代理URL
 * @param affiliateLink - 推广链接
 * @returns 是否成功触发预热（true=已发起访问，false=获取代理IP失败）
 */
export async function warmupAffiliateLink(
  proxyUrl: string,
  affiliateLink: string
): Promise<boolean> {
  try {
    console.log(`🔥 开始推广链接预热: ${maskProxyUrl(proxyUrl)}`);

    // 步骤1: 获取12个代理IP（等待完成）
    const proxyIPs = await fetch12ProxyIPs(proxyUrl);

    if (proxyIPs.length === 0) {
      console.warn('⚠️ 未能获取到代理IP，预热失败');
      return false;
    }

    // 步骤2: 发起代理访问（fire-and-forget，不等待访问完成）
    await triggerProxyVisits(proxyIPs, affiliateLink);

    console.log(`✅ 推广链接预热已触发（${proxyIPs.length}个代理IP）`);
    return true;
  } catch (error) {
    console.error('❌ 推广链接预热流程失败:', error);
    return false;
  }
}
