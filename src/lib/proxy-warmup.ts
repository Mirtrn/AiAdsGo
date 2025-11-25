/**
 * Proxy warmup utilities for warming up affiliate links with multiple proxy IPs
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

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
 * 从代理URL获取12个代理IP
 * 通过在URL中添加 &ips=12 参数来实现
 *
 * @param proxyUrl - 原始代理URL
 * @returns 12个代理IP的数组，或空数组（如果失败）
 */
export async function fetch12ProxyIPs(proxyUrl: string): Promise<string[]> {
  try {
    // 移除URL中已存在的ips参数，然后添加ips=12
    let modifiedUrl = proxyUrl;

    // 移除已存在的ips参数
    modifiedUrl = modifiedUrl.replace(/[&?]ips=\d+/g, '');

    // 添加新的ips=12参数
    const separator = modifiedUrl.includes('?') ? '&' : '?';
    modifiedUrl = `${modifiedUrl}${separator}ips=12`;

    console.log(`🌐 获取12个代理IP: ${modifiedUrl}`);

    // 发起HTTP请求获取代理IP列表
    const response = await fetch(modifiedUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      // 10秒超时
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`❌ 获取代理IP失败: HTTP ${response.status}`);
      return [];
    }

    // 响应格式通常是每行一个代理IP
    const text = await response.text();
    const proxyIPs = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    console.log(`✅ 成功获取 ${proxyIPs.length} 个代理IP`);
    return proxyIPs;
  } catch (error) {
    console.error('❌ 获取代理IP时发生错误:', error);
    return [];
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
    console.log(`🔥 开始推广链接预热流程...`);
    console.log(`   代理URL: ${proxyUrl}`);
    console.log(`   推广链接: ${affiliateLink}`);

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
