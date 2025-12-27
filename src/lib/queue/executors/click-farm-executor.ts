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
}

/**
 * 执行单次点击任务（Fire & Forget模式）
 *
 * 🔥 需求5：采用Fire & Forget模式（完全不等待）
 * - 发起HTTP请求后立即返回，不等待响应
 * - 提升并发效率，减少资源消耗
 * - 3秒超时（短超时确保快速释放连接）
 * - 乐观更新统计（默认成功）
 */
export async function executeClickFarmTask(
  task: Task<ClickFarmTaskData>
): Promise<{ success: boolean; traffic: number }> {
  const { taskId, url, proxyUrl } = task.data;

  try {
    // 解析代理URL
    const proxyUrlObj = new URL(proxyUrl);
    const proxy = {
      host: proxyUrlObj.hostname,
      port: parseInt(proxyUrlObj.port),
      auth: proxyUrlObj.username && proxyUrlObj.password ? {
        username: proxyUrlObj.username,
        password: proxyUrlObj.password
      } : undefined
    };

    // 🔥 Fire & Forget：发起HTTP请求但不等待响应
    const startTime = Date.now();
    axios.get(url, {
      proxy,
      timeout: 3000,  // 🔥 短超时（3秒）
      validateStatus: () => true,
      maxRedirects: 0,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    }).catch(() => {
      // 忽略错误（Fire & Forget模式不关心响应）
    });

    // 🔥 乐观更新统计（假设成功）
    await updateTaskStats(taskId, true);

    // 估算流量（仅请求头）
    const traffic = url.length + 500;

    console.log(`[ClickFarm] 触发点击（Fire & Forget）: ${url.substring(0, 50)}... (${Date.now() - startTime}ms)`);

    return { success: true, traffic };

  } catch (error: any) {
    // 即使失败也标记为成功（Fire & Forget模式）
    await updateTaskStats(taskId, true);

    console.log(`[ClickFarm] 触发点击（Fire & Forget）: ${url.substring(0, 50)}...`);

    return { success: true, traffic: url.length + 500 };
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
