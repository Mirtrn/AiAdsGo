/**
 * 智能等待策略
 *
 * 目标: 减少30%等待时间
 * 原理: 根据页面复杂度动态调整等待策略
 * KISS: 简单的启发式规则，无机器学习
 */

import { Page } from 'playwright'

/**
 * 页面复杂度评估
 */
interface PageComplexity {
  complexity: 'simple' | 'medium' | 'complex'
  estimatedLoadTime: number      // 预估加载时间（毫秒）
  recommendedWaitTime: number    // 推荐额外等待时间（毫秒）
  recommendedTimeout: number     // 推荐总超时时间（毫秒）
}

/**
 * 根据URL评估页面复杂度
 */
export function assessPageComplexity(url: string): PageComplexity {
  const urlLower = url.toLowerCase()

  // 简单页面：静态内容、搜索引擎
  if (
    urlLower.includes('google.com') ||
    urlLower.includes('bing.com') ||
    urlLower.includes('wikipedia.org') ||
    urlLower.endsWith('.html') ||
    urlLower.endsWith('.txt')
  ) {
    return {
      complexity: 'simple',
      estimatedLoadTime: 2000,
      recommendedWaitTime: 1000,
      recommendedTimeout: 30000,
    }
  }

  // 复杂页面：电商、社交媒体、SPA应用
  if (
    urlLower.includes('amazon.com') ||
    urlLower.includes('ebay.com') ||
    urlLower.includes('facebook.com') ||
    urlLower.includes('twitter.com') ||
    urlLower.includes('instagram.com') ||
    urlLower.includes('app.') ||
    urlLower.includes('/app/')
  ) {
    return {
      complexity: 'complex',
      estimatedLoadTime: 8000,
      recommendedWaitTime: 5000,
      recommendedTimeout: 60000,
    }
  }

  // 中等复杂度：默认情况
  return {
    complexity: 'medium',
    estimatedLoadTime: 4000,
    recommendedWaitTime: 2000,
    recommendedTimeout: 45000,
  }
}

/**
 * 智能等待页面加载完成
 *
 * 相比固定的waitUntil: 'networkidle'，这个策略更灵活：
 * 1. 根据页面复杂度动态调整
 * 2. 使用多个信号判断加载完成
 * 3. 提前检测完成，避免不必要的等待
 */
export async function smartWaitForLoad(
  page: Page,
  url: string,
  options?: {
    maxWaitTime?: number        // 最大等待时间
    checkInterval?: number      // 检查间隔
  }
): Promise<{
  waited: number                // 实际等待时间
  loadComplete: boolean         // 是否加载完成
  signals: string[]             // 检测到的完成信号
}> {
  const complexity = assessPageComplexity(url)
  const maxWaitTime = options?.maxWaitTime || complexity.recommendedWaitTime
  const checkInterval = options?.checkInterval || 500

  const startTime = Date.now()
  const signals: string[] = []

  // 等待基础DOM加载
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 })
    signals.push('dom-loaded')
  } catch (error) {
    console.warn('DOM加载超时')
  }

  // 等待网络空闲（短超时）
  try {
    await page.waitForLoadState('networkidle', { timeout: complexity.estimatedLoadTime })
    signals.push('network-idle')
  } catch (error) {
    // 网络空闲超时不是问题，继续检测其他信号
  }

  // 动态检测页面加载完成的信号
  let loadComplete = false
  const endTime = startTime + maxWaitTime

  while (Date.now() < endTime && !loadComplete) {
    try {
      // 检查1: 文档就绪状态
      const readyState = await page.evaluate(() => document.readyState)
      if (readyState === 'complete') {
        signals.push('document-ready')
        loadComplete = true
        break
      }

      // 检查2: 没有pending的请求（简化版）
      const pendingRequests = await page.evaluate(() => {
        return (performance as any).getEntriesByType?.('resource')
          .filter((r: any) => r.responseEnd === 0).length || 0
      })

      if (pendingRequests === 0) {
        signals.push('no-pending-requests')
        loadComplete = true
        break
      }

      // 检查3: 主要内容已渲染（有body且有内容）
      const hasContent = await page.evaluate(() => {
        const body = document.body
        return body && body.textContent && body.textContent.trim().length > 100
      })

      if (hasContent) {
        signals.push('content-rendered')
        // 内容已渲染，但给一点额外时间加载图片等资源
        await page.waitForTimeout(500)
        loadComplete = true
        break
      }

      // 等待一小段时间后再次检查
      await page.waitForTimeout(checkInterval)
    } catch (error) {
      console.warn('智能等待检测错误:', error)
      break
    }
  }

  const waited = Date.now() - startTime

  return {
    waited,
    loadComplete,
    signals,
  }
}

/**
 * 智能等待特定元素出现
 *
 * 使用自适应超时，避免过长等待
 */
export async function smartWaitForSelector(
  page: Page,
  selector: string,
  url: string
): Promise<{
  found: boolean
  waited: number
}> {
  const complexity = assessPageComplexity(url)
  const timeout = Math.min(complexity.recommendedTimeout / 2, 15000) // 最多15秒

  const startTime = Date.now()

  try {
    await page.waitForSelector(selector, { timeout })
    return {
      found: true,
      waited: Date.now() - startTime,
    }
  } catch (error) {
    return {
      found: false,
      waited: Date.now() - startTime,
    }
  }
}

/**
 * 批量智能等待（等待任一元素出现）
 */
export async function smartWaitForAnySelector(
  page: Page,
  selectors: string[],
  url: string
): Promise<{
  foundSelector: string | null
  waited: number
}> {
  const complexity = assessPageComplexity(url)
  const timeout = Math.min(complexity.recommendedTimeout / 2, 15000)

  const startTime = Date.now()

  try {
    // 使用Promise.race等待任一选择器
    const results = await Promise.race(
      selectors.map((selector) =>
        page
          .waitForSelector(selector, { timeout })
          .then(() => selector)
          .catch(() => null)
      )
    )

    return {
      foundSelector: results,
      waited: Date.now() - startTime,
    }
  } catch (error) {
    return {
      foundSelector: null,
      waited: Date.now() - startTime,
    }
  }
}

/**
 * 获取优化统计
 */
let totalWaitTime = 0
let totalOptimizedWaitTime = 0
let callCount = 0

export function recordWaitOptimization(
  originalWaitTime: number,
  optimizedWaitTime: number
): void {
  totalWaitTime += originalWaitTime
  totalOptimizedWaitTime += optimizedWaitTime
  callCount++
}

export function getWaitOptimizationStats(): {
  totalCalls: number
  avgOriginalWait: number
  avgOptimizedWait: number
  timeSaved: number
  improvementPercent: number
} {
  if (callCount === 0) {
    return {
      totalCalls: 0,
      avgOriginalWait: 0,
      avgOptimizedWait: 0,
      timeSaved: 0,
      improvementPercent: 0,
    }
  }

  const avgOriginal = totalWaitTime / callCount
  const avgOptimized = totalOptimizedWaitTime / callCount
  const timeSaved = totalWaitTime - totalOptimizedWaitTime
  const improvement = ((timeSaved / totalWaitTime) * 100)

  return {
    totalCalls: callCount,
    avgOriginalWait: Math.round(avgOriginal),
    avgOptimizedWait: Math.round(avgOptimized),
    timeSaved: Math.round(timeSaved),
    improvementPercent: Math.round(improvement),
  }
}
