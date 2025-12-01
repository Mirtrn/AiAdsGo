/**
 * Redis客户端单例
 *
 * 用于AI缓存和其他需要Redis的功能
 */

import Redis from 'ioredis'

let redisClient: Redis | null = null

/**
 * 获取Redis客户端实例（单例模式）
 */
export function getRedisClient(): Redis | null {
  // 如果已有实例，直接返回
  if (redisClient) {
    return redisClient
  }

  // 检查Redis URL配置
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.warn('⚠️ REDIS_URL 未配置，Redis缓存功能已禁用')
    return null
  }

  try {
    // 创建Redis客户端
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000)
        return delay
      },
    })

    // 监听连接事件
    redisClient.on('connect', () => {
      console.log('✅ Redis连接成功')
    })

    redisClient.on('error', (err) => {
      console.error('❌ Redis连接错误:', err)
    })

    redisClient.on('close', () => {
      console.warn('⚠️ Redis连接已关闭')
    })

    return redisClient
  } catch (error) {
    console.error('❌ Redis客户端初始化失败:', error)
    return null
  }
}

/**
 * 关闭Redis连接
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    console.log('✅ Redis连接已关闭')
  }
}

/**
 * 检查Redis是否可用
 */
export function isRedisAvailable(): boolean {
  return redisClient !== null && redisClient.status === 'ready'
}
