// Cron调度器 - 每小时执行补点击任务
// /api/cron/click-farm-scheduler

import { NextRequest, NextResponse } from 'next/server';
import { getPendingTasks, updateTaskStats, updateTaskStatus, pauseClickFarmTask } from '@/lib/click-farm';
import { generateSubTasks, getHourInTimezone, shouldCompleteTask, generateNextRunAt } from '@/lib/click-farm/scheduler';
import { notifyTaskPaused, notifyTaskCompleted } from '@/lib/click-farm/notifications';
import { getDatabase } from '@/lib/db';
import axios from 'axios';

export async function GET(request: NextRequest) {
  try {
    // 验证Cron密钥
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401 }
      );
    }

    const db = await getDatabase();
    const tasks = await getPendingTasks();

    console.log(`[Cron] 开始执行补点击任务，找到 ${tasks.length} 个待处理任务`);

    const results = {
      processed: 0,
      success: 0,
      failed: 0,
      paused: 0,
      completed: 0
    };

    for (const task of tasks) {
      try {
        results.processed++;

        // 检查是否应该完成
        if (shouldCompleteTask(task)) {
          await updateTaskStatus(task.id, 'completed');
          results.completed++;
          console.log(`[Cron] 任务 ${task.id} 已完成`);

          // 🔔 发送任务完成通知
          await notifyTaskCompleted(
            task.user_id,
            task.id,
            task.total_clicks || 0,
            task.success_clicks || 0
          );

          continue;
        }

        // 获取Offer信息
        const offer = await db.queryOne<any>(`
          SELECT affiliate_link, target_country
          FROM offers
          WHERE id = ?
        `, [task.offer_id]);

        if (!offer) {
          console.error(`[Cron] Offer ${task.offer_id} 不存在`);
          continue;
        }

        // 检查代理配置
        const proxyConfig = await db.queryOne<any>(`
          SELECT proxy_url FROM system_settings
          WHERE user_id = ? AND key = ?
        `, [task.user_id, `proxy_${offer.target_country.toLowerCase()}`]);

        if (!proxyConfig || !proxyConfig.proxy_url) {
          // 代理缺失，中止任务
          await pauseClickFarmTask(
            task.id,
            'no_proxy',
            `缺少${offer.target_country}国家的代理配置`
          );
          results.paused++;
          console.log(`[Cron] 任务 ${task.id} 因代理缺失而中止`);

          // 🔔 发送任务中止通知
          await notifyTaskPaused(
            task.user_id,
            task.id,
            'no_proxy',
            `缺少${offer.target_country}国家的代理配置，请前往设置页面配置`
          );

          continue;
        }

        // 获取当前时区的小时
        const currentHour = getHourInTimezone(new Date(), task.timezone);

        // 获取该小时应该执行的点击数
        const clickCount = task.hourly_distribution[currentHour] || 0;

        if (clickCount === 0) {
          // 该小时无需执行
          await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone));
          continue;
        }

        // 生成子任务
        const subTasks = generateSubTasks(
          task,
          currentHour,
          clickCount,
          offer.affiliate_link,
          offer.target_country
        );

        console.log(`[Cron] 任务 ${task.id} 生成 ${subTasks.length} 个子任务`);

        // 执行子任务（简化版：直接执行，实际应放入队列）
        for (const subTask of subTasks) {
          try {
            await executeClickTask(subTask.url, proxyConfig.proxy_url);
            await updateTaskStats(task.id, true);
            results.success++;
          } catch (error) {
            console.error(`[Cron] 子任务执行失败:`, error);
            await updateTaskStats(task.id, false);
            results.failed++;
          }
        }

        // 更新下次执行时间
        await updateTaskStatus(task.id, 'running', generateNextRunAt(task.timezone));

      } catch (error) {
        console.error(`[Cron] 处理任务 ${task.id} 失败:`, error);
      }
    }

    console.log(`[Cron] 执行完成:`, results);

    return NextResponse.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('[Cron] 调度器执行失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '调度器执行失败' },
      { status: 500 }
    );
  }
}

/**
 * 执行点击任务
 */
async function executeClickTask(url: string, proxyUrl: string): Promise<void> {
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
    await axios.get(url, {
      proxy,
      timeout: 15000,
      validateStatus: () => true,
      maxRedirects: 0
    });

  } catch (error: any) {
    if (error.code === 'ECONNABORTED') {
      throw new Error('请求超时');
    }
    throw error;
  }
}
