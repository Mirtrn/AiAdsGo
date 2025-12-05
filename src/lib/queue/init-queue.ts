/**
 * 队列系统初始化脚本
 *
 * 在应用启动时自动初始化统一队列管理器
 */

import { getQueueManager } from './index'

/**
 * 初始化统一队列系统
 */
export async function initializeQueue() {
  try {
    console.log('🚀 初始化统一队列系统...')

    // 获取队列管理器实例
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
      proxyPool: parseProxyPool(process.env.PROXY_POOL)
    })

    // 连接存储适配器（Redis优先，失败则回退内存）
    await queue.initialize()

    // 启动队列处理循环
    await queue.start()

    console.log('✅ 统一队列系统已启动')

    return queue
  } catch (error: any) {
    console.error('❌ 队列系统初始化失败:', error.message)
    throw error
  }
}

/**
 * 解析代理池配置
 *
 * 格式: host1:port1:username1:password1,host2:port2:username2:password2
 */
function parseProxyPool(proxyPoolStr?: string) {
  if (!proxyPoolStr) return []

  try {
    return proxyPoolStr.split(',').map((proxy) => {
      const [host, port, username, password] = proxy.trim().split(':')
      return {
        host,
        port: parseInt(port),
        username,
        password,
        protocol: 'http' as const
      }
    })
  } catch (error: any) {
    console.warn('⚠️ 解析代理池配置失败:', error.message)
    return []
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
