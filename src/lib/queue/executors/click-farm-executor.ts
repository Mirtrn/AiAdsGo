// 补点击任务执行器
// src/lib/queue/executors/click-farm-executor.ts

import axios from 'axios';
import https from 'https';
import http from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Task } from '../types';
import { updateTaskStats } from '@/lib/click-farm';
import { getHourInTimezone } from '@/lib/timezone-utils';
import { getDatabase } from '@/lib/db';

/**
 * 补点击任务数据结构
 */
export interface ClickFarmTaskData {
  taskId: string;        // click_farm_tasks表的ID
  url: string;           // 要访问的affiliate链接
  proxyUrl: string;      // 代理URL
  offerId: number;       // Offer ID（用于日志）
  // 🆕 计划执行时间（用于将点击分散到1小时内不同时间点执行）
  scheduledAt?: string;  // ISO 8601 格式的时间戳字符串
  // 🆕 Referer配置
  refererConfig?: {
    type: 'none' | 'random' | 'specific';
    referer?: string;    // specific类型时的固定referer
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

  // 格式2: 直接格式 (host:port:user:password)
  const parts = trimmedUrl.split(':');
  if (parts.length >= 4) {
    const port = parseInt(parts[1]);
    if (!isNaN(port)) {
      return {
        host: parts[0],
        port: port,
        auth: {
          username: parts[2],
          password: parts[3]
        },
        protocol: 'http'
      };
    }
  }

  // 格式3: 简单格式 (host:port)
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
  const { taskId, url, proxyUrl, refererConfig, scheduledAt } = task.data;

  // 🆕 检查是否需要延迟执行
  if (scheduledAt) {
    const scheduledTime = new Date(scheduledAt).getTime();
    const now = Date.now();
    const delay = scheduledTime - now;

    if (delay > 0) {
      // 延迟到计划时间执行
      console.log(`[ClickFarm] 任务 ${taskId} 延迟执行，等待 ${Math.round(delay / 1000)} 秒 (计划: ${scheduledAt})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } else if (delay < -60000) {
      // 如果计划时间已经过去超过1分钟，说明任务严重延迟，直接跳过
      // 但仍然执行（不要丢失点击）
      console.log(`[ClickFarm] 警告: 任务 ${taskId} 计划时间已过去 ${Math.round(-delay / 1000)} 秒，仍将执行`);
    }
  }

  try {
    // 🔧 修复：使用HttpsProxyAgent（与offer爬取一致）
    const proxyParsed = parseProxyUrl(proxyUrl);
    if (!proxyParsed) {
      console.error(`[ClickFarm] 代理URL解析失败: ${proxyUrl}`);
      await updateTaskStats(taskId, false);
      return { success: false, traffic: 0 };
    }

    // 构建代理URL格式: http://user:pass@host:port
    const proxyAddress = proxyParsed.auth
      ? `http://${proxyParsed.auth.username}:${proxyParsed.auth.password}@${proxyParsed.host}:${proxyParsed.port}`
      : `http://${proxyParsed.host}:${proxyParsed.port}`;

    // 使用HttpsProxyAgent（与offer爬取相同的方案）
    const proxyAgent = new HttpsProxyAgent(proxyAddress);
    const httpAgent = new http.Agent();

    // 🆕 确定Referer
    let referer: string | undefined;
    if (refererConfig) {
      switch (refererConfig.type) {
        case 'specific':
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

    // 🔥 Fire & Forget：发起HTTP请求但不等待响应
    const startTime = Date.now();

    // 后台异步执行和追踪（不await）
    (async () => {
      try {
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

        // 🔧 使用HttpsProxyAgent（与offer爬取一致）
        // 禁用SSL验证以处理代理SSL问题
        const httpsAgent = new https.Agent({
          rejectUnauthorized: false,
          keepAlive: true,
          maxSockets: 50,
        });

        // 🔥 执行请求（使用HttpsProxyAgent）
        try {
          const response = await axios.get(url, {
            httpAgent,                  // HTTP请求使用代理
            httpsAgent,                 // HTTPS请求使用代理 + SSL验证禁用
            timeout: 2000,              // 优化：减少超时到2秒
            validateStatus: () => true, // 接受所有状态码
            maxRedirects: 0,            // 禁用重定向
            headers,
          });

          // 🔧 Fire & Forget模式 - 只要收到HTTP响应就算成功
          const isSuccess = response.status > 0;

          // 🆕 P0修复：从 scheduledAt 提取计划执行的小时数，而不是使用实际执行时间
          let scheduledHour: number | undefined;
          if (scheduledAt) {
            try {
              const db = await getDatabase();
              const taskRow = await db.queryOne<any>(`
                SELECT timezone FROM click_farm_tasks WHERE id = ?
              `, [taskId]);
              if (taskRow && taskRow.timezone) {
                scheduledHour = getHourInTimezone(new Date(scheduledAt), taskRow.timezone);
              }
            } catch (e) {
              console.warn(`[ClickFarm] 获取任务时区失败，使用实际时间:`, e);
            }
          }
          await updateTaskStats(taskId, isSuccess, scheduledHour);

          console.log(`[ClickFarm] 点击执行完成: ${url.substring(0, 50)}... (${response.status}) [${Date.now() - startTime}ms] [HTTPS]` +
            (referer ? ` [Referer: ${referer.substring(0, 30)}...]` : ''));
        } catch (error: any) {
          // 网络错误、超时等真正的失败
          // 🆕 P0修复：从 scheduledAt 提取计划执行的小时数
          let scheduledHour: number | undefined;
          if (scheduledAt) {
            try {
              const db = await getDatabase();
              const taskRow = await db.queryOne<any>(`
                SELECT timezone FROM click_farm_tasks WHERE id = ?
              `, [taskId]);
              if (taskRow && taskRow.timezone) {
                scheduledHour = getHourInTimezone(new Date(scheduledAt), taskRow.timezone);
              }
            } catch (e) {
              console.warn(`[ClickFarm] 获取任务时区失败，使用实际时间:`, e);
            }
          }
          await updateTaskStats(taskId, false, scheduledHour);
          console.log(`[ClickFarm] 点击执行失败: ${url.substring(0, 50)}... [${error.message}]`);
        }
      } catch (error: any) {
        // 外层错误处理
        console.error(`[ClickFarm] 点击执行异常: ${url.substring(0, 50)}...`, error);
      }
    })().catch(err => {
      // 捕获异步任务中的未处理错误
      console.error(`[ClickFarm] 后台追踪失败:`, err);
    });

    // 立即返回（Fire & Forget）
    return { success: true, traffic: url.length + 500 };

  } catch (error: any) {
    console.error(`[ClickFarm] 执行器错误:`, error);
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
