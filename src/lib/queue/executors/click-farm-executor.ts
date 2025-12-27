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
 * 执行单次点击任务
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

    // 发起HTTP请求
    const startTime = Date.now();
    const response = await axios.get(url, {
      proxy,
      timeout: 15000,
      validateStatus: () => true,  // 接受所有状态码
      maxRedirects: 0,              // 不跟随重定向
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    const duration = Date.now() - startTime;

    // 估算流量（请求头 + 响应体）
    const requestSize = url.length + 500; // 估算请求头大小
    const responseSize = response.data ? JSON.stringify(response.data).length : 0;
    const traffic = requestSize + responseSize;

    // 更新任务统计
    await updateTaskStats(taskId, true);

    console.log(`[ClickFarm] 成功执行点击: ${url.substring(0, 50)}... (${duration}ms, ${traffic} bytes)`);

    return { success: true, traffic };

  } catch (error: any) {
    // 更新任务统计（失败）
    await updateTaskStats(taskId, false);

    const errorMsg = error.code === 'ECONNABORTED'
      ? '请求超时'
      : error.message || '未知错误';

    console.error(`[ClickFarm] 点击失败: ${errorMsg}`, {
      taskId,
      url: url.substring(0, 50) + '...',
      error: error.code
    });

    throw new Error(`点击失败: ${errorMsg}`);
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
