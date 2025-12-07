/**
 * 队列系统初始化API
 *
 * POST /api/queue/init
 *
 * 在应用启动时由QueueInitializer组件调用
 * 初始化统一队列系统（Redis优先 + 内存回退）
 */

import { NextResponse } from 'next/server'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'

// 全局标记：队列是否已初始化
let queueInitialized = false
let initializationPromise: Promise<void> | null = null

/**
 * 初始化队列系统（单例模式）
 */
async function ensureQueueInitialized(): Promise<{ success: boolean; message: string }> {
  // 已初始化，直接返回
  if (queueInitialized) {
    return { success: true, message: '队列系统已运行中' }
  }

  // 正在初始化，等待完成
  if (initializationPromise) {
    await initializationPromise
    return { success: true, message: '队列系统初始化完成（等待中）' }
  }

  // 开始初始化
  initializationPromise = (async () => {
    try {
      console.log('🚀 开始初始化统一队列系统...')

      // 获取队列管理器实例
      const queue = getQueueManager({
        globalConcurrency: parseInt(process.env.QUEUE_GLOBAL_CONCURRENCY || '5'),
        perUserConcurrency: parseInt(process.env.QUEUE_PER_USER_CONCURRENCY || '2'),
        maxQueueSize: parseInt(process.env.QUEUE_MAX_SIZE || '1000'),
        taskTimeout: parseInt(process.env.QUEUE_TASK_TIMEOUT || '60000'),
        defaultMaxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '3'),
        retryDelay: parseInt(process.env.QUEUE_RETRY_DELAY || '5000'),
        redisUrl: process.env.REDIS_URL,
        redisKeyPrefix: process.env.REDIS_KEY_PREFIX || 'autoads:queue:',
        proxyPool: [] // 代理在任务执行时按需加载
      })

      // 确保队列已启动（自动处理初始化）
      await queue.ensureStarted()

      // 安全注册所有任务执行器（只注册一次）
      await queue.registerAllExecutorsSafe()

      queueInitialized = true
      console.log('✅ 统一队列系统初始化完成')
    } catch (error: any) {
      console.error('❌ 队列系统初始化失败:', error.message)
      throw error
    }
  })()

  await initializationPromise
  return { success: true, message: '队列系统初始化成功' }
}

export async function POST() {
  try {
    const result = await ensureQueueInitialized()

    return NextResponse.json({
      success: result.success,
      message: result.message,
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('❌ 队列初始化API错误:', error.message)

    return NextResponse.json(
      {
        success: false,
        message: `队列初始化失败: ${error.message}`,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  // GET请求返回队列状态
  try {
    if (queueInitialized) {
      const queue = getQueueManager()
      const stats = await queue.getStats()

      return NextResponse.json({
        initialized: true,
        stats,
        timestamp: new Date().toISOString()
      })
    }

    return NextResponse.json({
      initialized: false,
      message: '队列系统尚未初始化',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        initialized: false,
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}
