/**
 * API性能监控工具
 * 记录API响应时间和性能指标
 */

import { NextRequest, NextResponse } from 'next/server'

interface PerformanceMetric {
  path: string
  method: string
  duration: number
  timestamp: number
  statusCode: number
  userId?: number
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = []
  private maxMetrics: number = 1000 // 最多保留1000条记录

  /**
   * 记录性能指标
   */
  record(metric: PerformanceMetric): void {
    this.metrics.push(metric)

    // 超过最大记录数，删除最旧的
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift()
    }

    // 记录慢查询警告（>1秒）
    if (metric.duration > 1000) {
      console.warn(
        `[Performance Warning] Slow API: ${metric.method} ${metric.path} took ${metric.duration}ms`
      )
    }
  }

  /**
   * 获取最近的性能指标
   */
  getRecentMetrics(limit: number = 100): PerformanceMetric[] {
    return this.metrics.slice(-limit)
  }

  /**
   * 获取性能统计
   */
  getStats(path?: string): {
    avgDuration: number
    minDuration: number
    maxDuration: number
    totalRequests: number
    slowRequests: number
  } {
    let filteredMetrics = this.metrics
    if (path) {
      filteredMetrics = this.metrics.filter((m) => m.path === path)
    }

    if (filteredMetrics.length === 0) {
      return {
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        totalRequests: 0,
        slowRequests: 0,
      }
    }

    const durations = filteredMetrics.map((m) => m.duration)
    const sum = durations.reduce((a, b) => a + b, 0)
    const slowRequests = filteredMetrics.filter((m) => m.duration > 1000).length

    return {
      avgDuration: sum / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      totalRequests: filteredMetrics.length,
      slowRequests,
    }
  }

  /**
   * 清除所有指标
   */
  clear(): void {
    this.metrics = []
  }
}

// 导出单例实例
export const performanceMonitor = new PerformanceMonitor()

/**
 * API性能监控中间件
 */
export function withPerformanceMonitoring<T>(
  handler: (request: NextRequest) => Promise<NextResponse<T>>,
  options?: {
    path?: string
    logToConsole?: boolean
  }
): (request: NextRequest) => Promise<NextResponse<T>> {
  return async (request: NextRequest) => {
    const startTime = Date.now()
    const path = options?.path || request.nextUrl.pathname
    const method = request.method

    try {
      const response = await handler(request)
      const duration = Date.now() - startTime

      // 记录性能指标
      performanceMonitor.record({
        path,
        method,
        duration,
        timestamp: Date.now(),
        statusCode: response.status,
      })

      // 可选：控制台日志
      if (options?.logToConsole) {
        console.log(`[API] ${method} ${path} - ${duration}ms - ${response.status}`)
      }

      // 添加性能头部
      response.headers.set('X-Response-Time', `${duration}ms`)

      return response
    } catch (error) {
      const duration = Date.now() - startTime

      // 记录错误的性能指标
      performanceMonitor.record({
        path,
        method,
        duration,
        timestamp: Date.now(),
        statusCode: 500,
      })

      throw error
    }
  }
}

/**
 * 简化的性能监控装饰器
 */
export async function measurePerformance<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now()

  try {
    const result = await fn()
    const duration = Date.now() - startTime

    if (duration > 500) {
      console.warn(`[Performance] ${name} took ${duration}ms`)
    }

    return result
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[Performance Error] ${name} failed after ${duration}ms`)
    throw error
  }
}

/**
 * 批量操作性能监控
 */
export async function measureBatchPerformance<T>(
  items: T[],
  processFn: (item: T) => Promise<void>,
  batchSize: number = 10
): Promise<void> {
  const startTime = Date.now()
  let processedCount = 0

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    await Promise.all(batch.map(processFn))
    processedCount += batch.length

    const elapsed = Date.now() - startTime
    const avgTime = elapsed / processedCount
    console.log(
      `[Batch Performance] Processed ${processedCount}/${items.length} items, avg ${avgTime.toFixed(2)}ms/item`
    )
  }

  const totalDuration = Date.now() - startTime
  console.log(
    `[Batch Performance] Completed ${items.length} items in ${totalDuration}ms`
  )
}
