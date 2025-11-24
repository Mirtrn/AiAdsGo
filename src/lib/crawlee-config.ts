/**
 * Crawlee框架全局配置
 *
 * 用于SaaS多用户并发场景的爬虫优化
 * 预期性能提升：10用户并发从250秒→30秒（-88%）
 */

import { PlaywrightCrawlerOptions } from '@crawlee/playwright';
import { getProxyIp, clearProxyCache } from './proxy/fetch-proxy-ip';

/**
 * 代理连接错误类型
 * 用于识别需要更换代理IP的错误
 */
export const PROXY_CONNECTION_ERRORS = [
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_PROXY_CONNECTION_FAILED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ERR_SOCKET_NOT_CONNECTED',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_RESET',
  'ERR_SSL_PROTOCOL_ERROR',
  'ERR_CERT_AUTHORITY_INVALID',
  'net::ERR_TUNNEL_CONNECTION_FAILED',
  'net::ERR_PROXY_CONNECTION_FAILED',
];

/**
 * 检查错误是否为代理连接错误
 * @param error - 错误信息或Error对象
 * @returns 是否为代理连接错误
 */
export function isProxyConnectionError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return PROXY_CONNECTION_ERRORS.some(
    (errType) =>
      errorMessage.includes(errType) ||
      errorMessage.toLowerCase().includes('proxy') ||
      errorMessage.toLowerCase().includes('tunnel')
  );
}

/**
 * User-Agent轮换池（与当前实现一致）
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
];

/**
 * 获取随机User-Agent
 */
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Crawlee并发控制配置
 *
 * 根据SaaS场景优化：
 * - maxConcurrency: 10 (最多10个并发请求)
 * - desiredConcurrency: 10 (期望并发数)
 * - desiredConcurrencyRatio: 0.8 (80%利用率)
 */
export const CRAWLEE_CONCURRENCY_CONFIG = {
  maxConcurrency: 10,
  autoscaledPoolOptions: {
    desiredConcurrency: 10,
    desiredConcurrencyRatio: 0.8,
    scaleUpStepRatio: 0.1,
    scaleDownStepRatio: 0.05,
    // 自动扩展间隔
    maybeRunIntervalSecs: 5,
  },
};

/**
 * SessionPool配置（自动Session管理和封号检测）
 *
 * 功能：
 * - 自动Cookie管理
 * - Session轮换
 * - 封号检测和Session淘汰
 */
export const CRAWLEE_SESSION_CONFIG = {
  useSessionPool: true,
  persistCookiesPerSession: true,
  sessionPoolOptions: {
    maxPoolSize: 100,
    sessionOptions: {
      maxAgeSecs: 1800, // Session最大存活时间30分钟
      maxUsageCount: 50, // 每个Session最多使用50次
    },
  },
};

/**
 * BrowserPool配置（浏览器实例管理）
 *
 * 功能：
 * - 浏览器实例复用
 * - 自动实例淘汰
 * - 内存优化
 */
export const CRAWLEE_BROWSER_CONFIG = {
  browserPoolOptions: {
    maxOpenPagesPerBrowser: 4, // 每个浏览器最多4个页面
    retireBrowserAfterPageCount: 50, // 使用50次后淘汰浏览器
  },
};

/**
 * 失败重试配置
 *
 * 功能：
 * - 自动失败重试
 * - 指数退避
 * - 错误处理
 */
export const CRAWLEE_RETRY_CONFIG = {
  maxRequestRetries: 3,
  maxRequestsPerMinute: 60, // 每分钟最多60个请求（更保守避免429）
  minConcurrency: 1,
};

/**
 * 请求间隔配置（避免429错误）
 *
 * 功能：
 * - 随机延迟避免检测
 * - 智能限速
 */
export const CRAWLEE_REQUEST_INTERVAL_CONFIG = {
  // 请求之间的最小延迟（毫秒）
  minDelayBetweenRequests: 2000,
  // 请求之间的最大延迟（毫秒）
  maxDelayBetweenRequests: 5000,
};

/**
 * 获取随机请求延迟（毫秒）
 */
export function getRandomRequestDelay(): number {
  const { minDelayBetweenRequests, maxDelayBetweenRequests } =
    CRAWLEE_REQUEST_INTERVAL_CONFIG;
  return Math.floor(
    Math.random() * (maxDelayBetweenRequests - minDelayBetweenRequests) +
      minDelayBetweenRequests
  );
}

/**
 * 创建Crawlee基础配置
 *
 * @param proxyUrl - 可选的代理URL
 * @returns PlaywrightCrawlerOptions配置对象
 */
export function createCrawleeConfig(
  proxyConfig?: string
): Partial<PlaywrightCrawlerOptions> {
  // 解析代理配置（格式：server|username|password）
  let proxyOptions = {};
  if (proxyConfig) {
    const [server, username, password] = proxyConfig.split('|');
    proxyOptions = {
      proxy: {
        server,
        ...(username && password && { username, password }),
      },
    };
  }

  return {
    ...CRAWLEE_CONCURRENCY_CONFIG,
    ...CRAWLEE_SESSION_CONFIG,
    ...CRAWLEE_BROWSER_CONFIG,
    ...CRAWLEE_RETRY_CONFIG,

    // Playwright启动选项
    launchContext: {
      launchOptions: {
        headless: true,
        // 代理配置
        ...proxyOptions,
        // 🎭 浏览器指纹伪装（与当前实现完全一致）
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
        ],
      },
      // 🎭 User-Agent轮换（与当前实现一致）
      userAgent: getRandomUserAgent(),
    },

    // 🚀 preNavigationHooks：完整stealth配置 + 人类行为模拟
    preNavigationHooks: [
      async ({ page }) => {
        const userAgent = getRandomUserAgent();

        // 🎯 0. 导航前随机延迟（500-1500ms）- 模拟人类操作速度
        const preNavDelay = Math.floor(Math.random() * 1000 + 500);
        console.log(`⏳ 导航前延迟 ${preNavDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, preNavDelay));

        // 1. 设置完整HTTP头（与当前实现一致）
        await page.setExtraHTTPHeaders({
          'User-Agent': userAgent,
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
        });

        // 2. 覆盖navigator.webdriver（最关键！防止被检测为自动化浏览器）
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
          });

          // Override plugins
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
          });

          // Override languages
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
          });

          // Override permissions
          const originalQuery = window.navigator.permissions.query;
          window.navigator.permissions.query = (parameters: any) =>
            parameters.name === 'notifications'
              ? Promise.resolve({
                  state: Notification.permission,
                } as PermissionStatus)
              : originalQuery(parameters);
        });

        // 3. 设置viewport（与当前实现一致）
        await page.setViewportSize({ width: 1920, height: 1080 });

        // 🔥 移除资源阻止：与原Playwright实现保持一致
        // 原版不阻止任何资源，阻止字体/媒体可能触发Amazon的反爬检测
      },
    ],
  };
}

/**
 * 为Amazon Store创建专用配置
 *
 * 针对Amazon Store页面的特殊优化：
 * - 更长的等待时间
 * - 更谨慎的并发控制
 * - 智能滚动支持
 * - 请求间隔延迟（避免429）
 */
export function createAmazonStoreConfig(
  proxyUrl?: string
): Partial<PlaywrightCrawlerOptions> {
  const baseConfig = createCrawleeConfig(proxyUrl);

  return {
    ...baseConfig,
    // Amazon Store特定配置
    maxConcurrency: 3, // 降低到3个并发避免封号（更保守）
    minConcurrency: 1,
    navigationTimeoutSecs: 60, // 增加导航超时时间
    requestHandlerTimeoutSecs: 180, // 增加处理超时时间
    maxRequestsPerMinute: 30, // 每分钟最多30个请求（更保守）

    // AutoscaledPool优化配置
    autoscaledPoolOptions: {
      desiredConcurrency: 3,
      desiredConcurrencyRatio: 0.6, // 60%利用率（更保守）
      scaleUpStepRatio: 0.05, // 缓慢扩容
      scaleDownStepRatio: 0.1, // 快速缩容
      maybeRunIntervalSecs: 10, // 扩展间隔10秒
    },
  };
}

/**
 * 获取Crawlee代理配置
 *
 * 集成现有的代理池系统，支持用户级别配置
 * 注意：必须使用代理，且必须从用户配置获取
 *
 * @param userId - 用户ID（必需），从用户配置获取代理
 * @param targetCountry - 目标国家代码（可选，默认US）
 * @param forceRefresh - 是否强制刷新代理IP（默认true，每次获取新IP）
 * @returns Playwright格式的代理配置 (server|username|password)
 */
export async function getCrawleeProxyConfig(
  userId: number,
  targetCountry: string = 'US',
  forceRefresh: boolean = true
): Promise<string> {
  // 导入用户配置函数
  const { getProxyUrlForCountry, isProxyEnabled } = await import('./settings');

  // 检查用户是否启用代理
  if (!isProxyEnabled(userId)) {
    throw new Error(
      `❌ 用户 ${userId} 未启用代理。请在用户设置中配置代理URL`
    );
  }

  // 获取用户配置的代理URL
  const PROXY_URL = getProxyUrlForCountry(targetCountry, userId);
  if (!PROXY_URL) {
    throw new Error(
      `❌ 用户 ${userId} 未配置${targetCountry}国家的代理URL`
    );
  }

  console.log(`📌 使用用户 ${userId} 的代理配置 (${targetCountry})${forceRefresh ? ' [强制刷新]' : ''}`);

  try {
    const proxyCredentials = await getProxyIp(PROXY_URL, forceRefresh);
    // Playwright代理格式：server|username|password （用|分隔）
    const proxyConfig = `http://${proxyCredentials.fullAddress}|${proxyCredentials.username}|${proxyCredentials.password}`;
    console.log(`✅ Crawlee代理配置成功: ${proxyCredentials.fullAddress}`);
    return proxyConfig;
  } catch (error) {
    console.error('❌ 获取代理失败:', error);
    throw new Error(`代理获取失败，无法继续执行: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 刷新代理IP（用于代理连接失败时重新获取）
 *
 * @param userId - 用户ID
 * @param targetCountry - 目标国家代码
 * @returns 新的代理配置
 */
export async function refreshProxyConfig(
  userId: number,
  targetCountry: string = 'US'
): Promise<string> {
  const { getProxyUrlForCountry } = await import('./settings');
  const PROXY_URL = getProxyUrlForCountry(targetCountry, userId);

  if (PROXY_URL) {
    // 清除该URL的缓存
    clearProxyCache(PROXY_URL);
    console.log(`🔄 代理缓存已清除，正在获取新的代理IP...`);
  }

  // 强制获取新IP
  return getCrawleeProxyConfig(userId, targetCountry, true);
}

/**
 * 带代理重试的执行器
 *
 * 当代理连接失败时，自动获取新的代理IP并重试
 *
 * @param operation - 要执行的异步操作，接收proxyConfig参数
 * @param userId - 用户ID
 * @param targetCountry - 目标国家代码
 * @param maxRetries - 最大重试次数（默认3次）
 * @returns 操作结果
 */
export async function executeWithProxyRetry<T>(
  operation: (proxyConfig: string) => Promise<T>,
  userId: number,
  targetCountry: string = 'US',
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 第一次使用正常获取，后续使用强制刷新
      const proxyConfig = attempt === 1
        ? await getCrawleeProxyConfig(userId, targetCountry, true)
        : await refreshProxyConfig(userId, targetCountry);

      const [server] = proxyConfig.split('|');
      console.log(`🚀 尝试 ${attempt}/${maxRetries}，使用代理: ${server}`);

      // 执行操作
      const result = await operation(proxyConfig);

      if (attempt > 1) {
        console.log(`✅ 代理重试成功（第${attempt}次尝试）`);
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 检查是否为代理连接错误
      if (isProxyConnectionError(error)) {
        console.warn(`⚠️ 代理连接失败 (${attempt}/${maxRetries}): ${lastError.message}`);

        if (attempt < maxRetries) {
          // 等待后重试（递增延迟：1s, 2s, 3s...）
          const waitTime = attempt * 1000;
          console.log(`⏳ 等待 ${waitTime}ms 后获取新代理重试...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      } else {
        // 非代理错误，直接抛出
        console.error(`❌ 非代理错误，终止重试: ${lastError.message}`);
        throw lastError;
      }
    }
  }

  // 所有重试都失败
  throw new Error(
    `代理连接失败（已重试${maxRetries}次）: ${lastError?.message || '未知错误'}`
  );
}

/**
 * Crawlee环境变量配置
 *
 * 用于控制Crawlee的运行时行为
 */
export const CRAWLEE_ENV_CONFIG = {
  // 禁用Crawlee默认存储（使用自定义数据库）
  CRAWLEE_STORAGE_DIR: './crawlee_storage',
  // 日志级别
  CRAWLEE_LOG_LEVEL: process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG',
  // 禁用遥测
  CRAWLEE_DISABLE_TELEMETRY: 'true',
};
