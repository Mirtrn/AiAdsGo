// 补点击任务执行器
// src/lib/queue/executors/click-farm-executor.ts

import axios from 'axios';
import type { Task, ProxyConfig } from '../types';
import { updateTaskStats } from '@/lib/click-farm';

/**
 * 补点击任务数据结构
 */
export interface ClickFarmTaskData {
  taskId: string;        // click_farm_tasks表的ID
  url: string;           // 要访问的affiliate链接
  proxyUrl: string;      // 代理URL
  offerId: number;       // Offer ID（用于日志）
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
 * 模拟不同浏览器和设备
 */
function getRandomUserAgent(): string {
  const userAgents = [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    // Chrome on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    // Safari on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    // Edge on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
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
 */
export async function executeClickFarmTask(
  task: Task<ClickFarmTaskData>
): Promise<{ success: boolean; traffic: number }> {
  const { taskId, url, proxyUrl, refererConfig } = task.data;

  try {
    // 🔧 修复：支持多种代理URL格式
    const proxyParsed = parseProxyUrl(proxyUrl);
    if (!proxyParsed) {
      console.error(`[ClickFarm] 代理URL解析失败: ${proxyUrl}`);
      await updateTaskStats(taskId, false);
      return { success: false, traffic: 0 };
    }

    const proxy = {
      host: proxyParsed.host,
      port: proxyParsed.port,
      auth: proxyParsed.auth
    };

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
        // 🆕 构建请求头（防爬优化）
        const headers: Record<string, string> = {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': getRandomAcceptLanguage(),
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
        };

        // 🆕 添加Referer头（如果配置了）
        if (referer) {
          headers['Referer'] = referer;
        }

        // 🔧 修复(2025-12-31): 处理HTTPS SSL错误，尝试降级到HTTP
        let targetUrl = url;
        let useHttps = url.startsWith('https://');

        const executeRequest = async (requestUrl: string, tryHttpFallback: boolean): Promise<{ success: boolean; status: number; isFallback: boolean }> => {
          try {
            const response = await axios.get(requestUrl, {
              proxy,
              timeout: 3000,
              validateStatus: () => true,
              maxRedirects: 0,
              headers,
            });
            return { success: response.status >= 200 && response.status < 400, status: response.status, isFallback: false };
          } catch (error: any) {
            // 🔧 SSL错误降级处理
            if (tryHttpFallback && error.message && error.message.includes('SSL')) {
              console.log(`[ClickFarm] HTTPS请求SSL错误，降级到HTTP: ${requestUrl.substring(0, 50)}...`);
              const httpUrl = requestUrl.replace('https://', 'http://');
              try {
                const response = await axios.get(httpUrl, {
                  proxy,
                  timeout: 3000,
                  validateStatus: () => true,
                  maxRedirects: 0,
                  headers,
                });
                return { success: response.status >= 200 && response.status < 400, status: response.status, isFallback: true };
              } catch (httpError: any) {
                console.log(`[ClickFarm] HTTP降级也失败: ${httpError.message}`);
                return { success: false, status: 0, isFallback: true };
              }
            }
            return { success: false, status: 0, isFallback: false };
          }
        };

        const result = await executeRequest(targetUrl, useHttps);
        const isSuccess = result.success;
        await updateTaskStats(taskId, isSuccess);

        const fallbackNote = result.isFallback ? ' [降级HTTP]' : '';
        console.log(`[ClickFarm] 点击执行完成: ${targetUrl.substring(0, 50)}... (${result.status}) [${Date.now() - startTime}ms]${fallbackNote}` +
          (referer ? ` [Referer: ${referer.substring(0, 30)}...]` : ''));
      } catch (error: any) {
        // 网络错误、超时等真正的失败
        await updateTaskStats(taskId, false);
        console.log(`[ClickFarm] 点击执行失败: ${url.substring(0, 50)}... [${error.message}]`);
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
