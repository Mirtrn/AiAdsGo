// 补点击任务执行器
// src/lib/queue/executors/click-farm-executor.ts

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Task } from '../types';
import { updateTaskStats } from '@/lib/click-farm';
import { getHourInTimezone } from '@/lib/timezone-utils';
import { getDatabase } from '@/lib/db';
import { getAllProxyUrls } from '@/lib/settings';
import { getProxyIp } from '@/lib/proxy/fetch-proxy-ip';
import { ProxyProviderRegistry } from '@/lib/proxy/providers/provider-registry';
import { maskProxyUrl } from '@/lib/proxy/validate-url';

/**
 * 补点击任务数据结构
 */
export interface ClickFarmTaskData {
  taskId: string;        // click_farm_tasks表的ID
  url: string;           // 要访问的affiliate链接
  proxyUrl: string;      // 代理URL
  offerId: number;       // Offer ID（用于日志）
  timezone?: string;     // 🆕 任务时区（用于按 scheduledAt 统计到正确小时，避免每次点击再查库）
  // 🆕 计划执行时间（用于将点击分散到1小时内不同时间点执行）
  scheduledAt?: string;  // ISO 8601 格式的时间戳字符串
  // 🆕 Referer配置
  refererConfig?: {
    type: 'none' | 'random' | 'specific' | 'custom';
    referer?: string;    // specific/custom类型时的固定referer
  };
}

/**
 * 社交媒体Referer列表
 * 用于防止反爬检测，模拟真实用户来源
 */
export const SOCIAL_MEDIA_REFERRERS = [
  { name: 'Facebook', url: 'https://www.facebook.com/', pattern: 'facebook' },
  { name: 'Twitter/X', url: 'https://twitter.com/search?q=', pattern: 'twitter' },
  { name: 'Instagram', url: 'https://www.instagram.com/', pattern: 'instagram' },
  { name: 'YouTube', url: 'https://www.youtube.com/', pattern: 'youtube' },
  { name: 'TikTok', url: 'https://www.tiktok.com/', pattern: 'tiktok' },
  { name: 'Pinterest', url: 'https://www.pinterest.com/search/pins/?q=', pattern: 'pinterest' },
  { name: 'Reddit', url: 'https://www.reddit.com/search/?q=', pattern: 'reddit' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/search/results/all/?keyword=', pattern: 'linkedin' },
  { name: 'Medium', url: 'https://medium.com/search?q=', pattern: 'medium' },
  { name: 'WhatsApp', url: 'https://wa.me/', pattern: 'whatsapp' },
  { name: 'Snapchat', url: 'https://www.snapchat.com/', pattern: 'snapchat' },
  { name: 'Quora', url: 'https://www.quora.com/search?q=', pattern: 'quora' },
];

/**
 * 🆕 从社媒列表中随机获取一个referer
 */
export function getRandomSocialReferer(): string {
  const randomIndex = Math.floor(Math.random() * SOCIAL_MEDIA_REFERRERS.length);
  return SOCIAL_MEDIA_REFERRERS[randomIndex].url;
}

const MAX_PROXY_AGENT_CACHE_SIZE = 50
const proxyAgentCache = new Map<string, HttpsProxyAgent<string>>()

function getProxyAgent(proxyAddress: string): HttpsProxyAgent<string> {
  const cached = proxyAgentCache.get(proxyAddress)
  if (cached) {
    // 简单LRU：Map迭代顺序即插入顺序
    proxyAgentCache.delete(proxyAddress)
    proxyAgentCache.set(proxyAddress, cached)
    return cached
  }

  const agent = new HttpsProxyAgent(proxyAddress, {
    keepAlive: true,
    maxSockets: 50,
    rejectUnauthorized: false,
  } as any)

  proxyAgentCache.set(proxyAddress, agent)
  if (proxyAgentCache.size > MAX_PROXY_AGENT_CACHE_SIZE) {
    const oldestKey = proxyAgentCache.keys().next().value
    if (oldestKey) proxyAgentCache.delete(oldestKey)
  }
  return agent
}

async function resolveProxyAddress(proxyUrl: string): Promise<string | null> {
  const trimmed = proxyUrl.trim()
  if (!trimmed) return null

  // 优先支持“代理provider URL”（如 IPRocket API / Oxylabs / Abcproxy 等），统一解析成真实代理IP再使用。
  if (ProxyProviderRegistry.isSupported(trimmed)) {
    const creds = await getProxyIp(trimmed, false)
    return `http://${creds.username}:${creds.password}@${creds.host}:${creds.port}`
  }

  const parsed = parseProxyUrl(trimmed)
  if (!parsed) return null
  return parsed.auth
    ? `http://${parsed.auth.username}:${parsed.auth.password}@${parsed.host}:${parsed.port}`
    : `http://${parsed.host}:${parsed.port}`
}

type ReleaseFn = () => void
class SimpleSemaphore {
  private inFlight = 0
  private waiters: Array<(release: ReleaseFn) => void> = []

  constructor(private readonly maxInFlight: number) {}

  async acquire(): Promise<ReleaseFn> {
    if (this.inFlight < this.maxInFlight) {
      this.inFlight++
      return () => this.release()
    }

    return await new Promise<ReleaseFn>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  private release() {
    this.inFlight = Math.max(0, this.inFlight - 1)
    const next = this.waiters.shift()
    if (next) {
      this.inFlight++
      next(() => this.release())
    }
  }
}

// click-farm 需要“快速发起请求即算成功”，但同时必须避免堆出海量并发请求。
// 这里用一个轻量级信号量控制真实 in-flight 请求数；任务不等待响应结果，但会等待“拿到发起名额”。
const clickFarmSemaphore = new SimpleSemaphore(
  Math.max(1, parseInt(process.env.CLICK_FARM_MAX_INFLIGHT || '50', 10) || 50)
)

/**
 * 解析代理URL - 支持多种格式
 *
 * 支持的格式：
 * 1. URL格式: http://host:port
 * 2. URL格式: https://user:pass@host:port
 * 3. 直接格式: host:port:user:pass
 * 4. 简单格式: host:port
 */
function parseProxyUrl(proxyUrl: string): {
  host: string;
  port: number;
  auth?: { username: string; password: string };
  protocol: string;
} | null {
  if (!proxyUrl || !proxyUrl.trim()) {
    return null;
  }

  const trimmedUrl = proxyUrl.trim();

  // 格式0: 直连格式（可选带 http(s):// 前缀）: host:port:user:pass
  const directUrl = trimmedUrl.replace(/^https?:\/\//, '');
  const directParts = directUrl.split(':');
  if (directParts.length >= 4) {
    const port = parseInt(directParts[1]);
    if (!isNaN(port)) {
      return {
        host: directParts[0],
        port: port,
        auth: {
          username: directParts[2],
          password: directParts[3]
        },
        protocol: 'http'
      };
    }
  }

  // 格式1: 标准URL (http:// 或 https://)
  if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
    try {
      const url = new URL(trimmedUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port) || (url.protocol === 'https' ? 443 : 80),
        auth: url.username && url.password ? {
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password)
        } : undefined,
        protocol: url.protocol.replace(':', '')
      };
    } catch (error) {
      console.error(`[ClickFarm] 代理URL解析失败: ${trimmedUrl}`, error);
      return null;
    }
  }

  // 格式2: 简单格式 (host:port)
  const parts = trimmedUrl.split(':');
  if (parts.length === 2) {
    const port = parseInt(parts[1]);
    if (!isNaN(port)) {
      return {
        host: parts[0],
        port: port,
        protocol: 'http'
      };
    }
  }

  console.error(`[ClickFarm] 不支持的代理URL格式: ${trimmedUrl}`);
  return null;
}

/**
 * 生成随机的User-Agent
 * 模拟不同浏览器和设备（使用最新版本）
 */
function getRandomUserAgent(): string {
  const userAgents = [
    // Chrome on Windows (最新版本)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    // Chrome on macOS (最新版本)
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    // Firefox on Windows (最新版本)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    // Safari on macOS (最新版本)
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    // Edge on Windows (最新版本)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  ];

  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * 生成随机的Accept-Language
 */
function getRandomAcceptLanguage(): string {
  const languages = [
    'en-US,en;q=0.9',
    'en-US,en;q=0.9,zh-CN;q=0.8',
    'en-US,en;q=0.9,de;q=0.8',
    'en-US,en;q=0.9,fr;q=0.8',
    'en-US,en;q=0.9,es;q=0.8',
    'en-GB,en;q=0.9,en-US;q=0.8',
  ];

  return languages[Math.floor(Math.random() * languages.length)];
}

/**
 * 执行单次点击任务
 *
 * 🔥 需求5：采用Fire & Forget模式（发起请求但异步追踪结果）
 * - 发起HTTP请求后立即返回
 * - 后台异步监听响应，根据HTTP状态码判断成功/失败
 * - 3秒超时（短超时确保快速释放连接）
 * - 准确记录统计（不依赖乐观假设）
 *
 * 🆕 防爬优化：
 * - 随机User-Agent（模拟不同浏览器）
 * - 随机Accept-Language
 * - 可配置的Referer（模拟不同来源）
 * - 随机请求间隔（避免固定频率）
 *
 * 🆕 时间分散执行：
 * - 支持 scheduledAt 字段，将点击分散到1小时内的不同时间点执行
 * - 如果当前时间早于 scheduledAt，延迟执行
 */
export async function executeClickFarmTask(
  task: Task<ClickFarmTaskData>
): Promise<{ success: boolean; traffic: number }> {
  const { taskId, url, refererConfig, scheduledAt, timezone } = task.data;

  // 🔧 修复：动态获取代理URL（重试时会清除旧代理，需要重新获取）
  let proxyUrl = task.data.proxyUrl
  if (!proxyUrl) {
    console.log(`[ClickFarm] 任务 ${taskId} 未配置代理，尝试动态获取...`)
    try {
      // 获取任务信息以确定目标国家
      const db = await getDatabase()
      const taskRow = await db.queryOne<any>(`
        SELECT t.user_id, o.target_country
        FROM click_farm_tasks t
        JOIN offers o ON t.offer_id = o.id
        WHERE t.id = ?
      `, [taskId])

      if (taskRow) {
        const proxyUrls = await getAllProxyUrls(taskRow.user_id)
        const targetCountry = taskRow.target_country?.toUpperCase()
        const proxyConfig = proxyUrls?.find(p => p.country.toUpperCase() === targetCountry)

        if (proxyConfig && proxyConfig.url) {
          proxyUrl = proxyConfig.url
          console.log(`[ClickFarm] 任务 ${taskId} 动态获取到代理: ${targetCountry} (${proxyUrl.substring(0, 30)}...)`)
        }
      }
    } catch (error: any) {
      console.error(`[ClickFarm] 动态获取代理失败: ${error.message}`)
    }
  }

  // 如果仍然没有代理，记录错误
  if (!proxyUrl) {
    console.error(`[ClickFarm] 任务 ${taskId} 缺少代理配置，无法执行`)
    await updateTaskStats(taskId, false)
    return { success: false, traffic: 0 }
  }

  try {
    // 🔧 关键修复：支持 IPRocket 这类“provider URL”，先解析出真实代理IP再使用
    let proxyAddress: string | null = null
    try {
      proxyAddress = await resolveProxyAddress(proxyUrl)
    } catch (e: any) {
      console.error(`[ClickFarm] 代理解析失败: ${maskProxyUrl(proxyUrl)} - ${e?.message || String(e)}`)
    }
    if (!proxyAddress) {
      console.error(`[ClickFarm] 代理URL解析失败: ${maskProxyUrl(proxyUrl)}`);
      await updateTaskStats(taskId, false);
      return { success: false, traffic: 0 };
    }

    // 控制真实 in-flight 请求数，避免同时堆出大量 HTTP 请求
    const release = await clickFarmSemaphore.acquire()
    let released = false
    const safeRelease = () => {
      if (released) return
      released = true
      release()
    }

    const proxyAgent = getProxyAgent(proxyAddress)

    // 🆕 确定Referer
    let referer: string | undefined;
    if (refererConfig) {
      switch (refererConfig.type) {
        case 'specific':
        case 'custom':
          referer = refererConfig.referer;
          break;
        case 'random':
          referer = getRandomSocialReferer();
          break;
        case 'none':
        default:
          referer = undefined;
      }
    }

    const startTime = Date.now();

    // 🆕 构建请求头（完整的浏览器指纹，绕过反爬虫）
    const userAgent = getRandomUserAgent();
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': getRandomAcceptLanguage(),
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      'DNT': '1',
    };

    // 🆕 添加Chrome特征头（Sec-CH-UA系列）
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      const chromeVersion = userAgent.match(/Chrome\/(\d+)/)?.[1] || '131';
      headers['Sec-CH-UA'] = `"Not_A Brand";v="8", "Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}"`;
      headers['Sec-CH-UA-Mobile'] = '?0';
      headers['Sec-CH-UA-Platform'] = userAgent.includes('Windows') ? '"Windows"' : '"macOS"';
    } else if (userAgent.includes('Edg')) {
      const edgeVersion = userAgent.match(/Edg\/(\d+)/)?.[1] || '131';
      headers['Sec-CH-UA'] = `"Not_A Brand";v="8", "Chromium";v="${edgeVersion}", "Microsoft Edge";v="${edgeVersion}"`;
      headers['Sec-CH-UA-Mobile'] = '?0';
      headers['Sec-CH-UA-Platform'] = '"Windows"';
    }

    // 🆕 添加Referer头（如果配置了）
    if (referer) {
      headers['Referer'] = referer;
    }

    // 🆕 P0修复：从 scheduledAt 提取计划执行的小时数，而不是使用实际执行时间
    let scheduledHour: number | undefined;
    if (scheduledAt) {
      const tz = timezone || 'America/New_York'
      scheduledHour = getHourInTimezone(new Date(scheduledAt), tz);
    }

    // 需求：只要“成功发起请求”就算成功；不等待访问结果
    // 这里将“发起成功”定义为：请求已被创建并进入发送流程（axios 调用不抛同步错误）。
    // 真实网络是否返回/是否成功不影响成功统计，但会影响 in-flight 释放。
    const requestPromise = axios.get(url, {
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent,
      proxy: false,
      timeout: 2000,
      validateStatus: () => true,
      maxRedirects: 0,
      headers,
      responseType: 'stream',
    })

    // 🔥 释放名额：不等待结果返回给队列，但仍然跟踪请求结束以控制并发
    const hardReleaseTimer = setTimeout(() => {
      safeRelease()
    }, 5000)

    requestPromise
      .then((response) => {
        try {
          response.data?.destroy?.()
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // ignore：不影响“发起成功”判定
      })
      .finally(() => {
        clearTimeout(hardReleaseTimer)
        safeRelease()
      })

    try {
      await updateTaskStats(taskId, true, scheduledHour)
    } catch (error) {
      console.warn(`[ClickFarm] 统计更新失败: ${taskId}`, error)
    }

    console.log(
      `[ClickFarm] 请求已发起: ${url.substring(0, 50)}... [${Date.now() - startTime}ms]` +
        (referer ? ` [Referer: ${referer.substring(0, 30)}...]` : '')
    );

    return { success: true, traffic: url.length + 500 };

  } catch (error: any) {
    console.error(`[ClickFarm] 执行器错误:`, error?.message || error);
    // 同步阶段失败（例如代理URL解析失败之外的异常），记为失败
    try {
      let scheduledHour: number | undefined;
      if (scheduledAt) {
        const tz = timezone || 'America/New_York'
        scheduledHour = getHourInTimezone(new Date(scheduledAt), tz);
      }
      await updateTaskStats(taskId, false, scheduledHour);
    } catch {
      // ignore
    }
    return { success: false, traffic: 0 };
  }
}

/**
 * 创建队列系统的ClickFarm执行器
 */
export function createClickFarmExecutor() {
  return async (task: Task<ClickFarmTaskData>) => {
    return await executeClickFarmTask(task);
  };
}
