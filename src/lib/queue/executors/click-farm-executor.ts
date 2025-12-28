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
 *
 * 🔥 需求5：采用Fire & Forget模式（发起请求但异步追踪结果）
 * - 发起HTTP请求后立即返回
 * - 后台异步监听响应，根据HTTP状态码判断成功/失败
 * - 3秒超时（短超时确保快速释放连接）
 * - 准确记录统计（不依赖乐观假设）
 *
 * 改进说明：
 * 相比之前的完全乐观统计，新方案通过异步回调的方式来追踪实际结果
 * 这样既保持了Fire & Forget的性能优势，又确保了统计数据的准确性
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

    // 后台异步执行和追踪（不await）
    (async () => {
      try {
        const response = await axios.get(url, {
          proxy,
          timeout: 3000,  // 🔥 短超时（3秒）
          validateStatus: () => true,  // 接受所有状态码
          maxRedirects: 0,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          }
        });

        // 🔧 修复：根据HTTP状态码判断成功/失败
        // 2xx-3xx 表示成功，其他状态码表示失败
        const isSuccess = response.status >= 200 && response.status < 400;
        await updateTaskStats(taskId, isSuccess);

        console.log(`[ClickFarm] 点击执行完成: ${url.substring(0, 50)}... (${response.status}) [${Date.now() - startTime}ms]`);
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
