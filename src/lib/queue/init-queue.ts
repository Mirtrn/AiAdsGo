/**
 * 队列系统初始化脚本
 *
 * 在应用启动时自动初始化统一队列管理器
 *
 * 代理配置说明：
 * - 代理不在初始化时全局加载，而是在任务执行时按需加载
 * - 每个用户使用自己配置的代理，不使用全局代理
 * - 只有特定任务类型（如scrape）需要代理
 */

import { getQueueManager } from './index'
import { registerAllExecutors } from './executors'

/**
 * 初始化统一队列系统
 */
export async function initializeQueue() {
  try {
    console.log('🚀 初始化统一队列系统...')

    // 获取队列管理器实例
    // 注意：不再在初始化时加载代理池，代理在任务执行时按需加载
    const queue = getQueueManager({
      // 从环境变量读取配置
      globalConcurrency: parseInt(process.env.QUEUE_GLOBAL_CONCURRENCY || '5'),
      perUserConcurrency: parseInt(process.env.QUEUE_PER_USER_CONCURRENCY || '2'),
      maxQueueSize: parseInt(process.env.QUEUE_MAX_SIZE || '1000'),
      taskTimeout: parseInt(process.env.QUEUE_TASK_TIMEOUT || '60000'),
      defaultMaxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '3'),
      retryDelay: parseInt(process.env.QUEUE_RETRY_DELAY || '5000'),
      redisUrl: process.env.REDIS_URL,
      redisKeyPrefix: process.env.REDIS_KEY_PREFIX || 'autoads:queue:',
      // 代理池为空，代理在任务执行时按需从用户配置加载
      proxyPool: []
    })

    // 连接存储适配器（Redis优先，失败则回退内存）
    await queue.initialize()

    // 注册任务执行器
    registerAllExecutors(queue)

    // 启动队列处理循环
    await queue.start()

    console.log('✅ 统一队列系统已启动')
    console.log('📝 代理配置：任务执行时按需从用户设置加载')

    return queue
  } catch (error: any) {
    console.error('❌ 队列系统初始化失败:', error.message)
    throw error
  }
}

/**
 * 优雅关闭队列系统
 */
export async function shutdownQueue() {
  try {
    console.log('⏹️ 关闭队列系统...')
    const queue = getQueueManager()
    await queue.stop()
    console.log('✅ 队列系统已关闭')
  } catch (error: any) {
    console.error('❌ 队列系统关闭失败:', error.message)
  }
}

// 处理进程退出信号
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    console.log('\n收到SIGINT信号...')
    await shutdownQueue()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\n收到SIGTERM信号...')
    await shutdownQueue()
    process.exit(0)
  })
}
