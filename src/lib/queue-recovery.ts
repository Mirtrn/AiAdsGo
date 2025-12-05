/**
 * 队列恢复模块
 *
 * 用于服务重启后恢复未完成的抓取任务
 * 这个模块独立于 instrumentation.ts，避免在构建时分析复杂依赖
 */

import { triggerOfferScraping, OfferScrapingPriority } from './offer-scraping'

/**
 * 执行队列恢复（由API路由调用）
 *
 * 在首次API请求时调用此函数，安全地恢复队列任务
 */
export async function executeQueueRecoveryIfNeeded() {
  if (!global.__queueRecoveryPending || !global.__queueRecoveryData) {
    return
  }

  // 标记为已处理，避免重复恢复
  global.__queueRecoveryPending = false
  const offersToRecover = global.__queueRecoveryData
  global.__queueRecoveryData = undefined

  console.log(`🚀 开始恢复 ${offersToRecover.length} 个队列任务...`)

  let recovered = 0
  let failed = 0

  for (const offer of offersToRecover) {
    try {
      // 恢复任务使用NORMAL优先级（不阻塞新的URGENT任务）
      triggerOfferScraping(
        Number(offer.id),
        offer.user_id,
        offer.url || '',
        offer.brand || '提取中...',
        OfferScrapingPriority.NORMAL
      )
      recovered++
    } catch (error: any) {
      console.error(`⚠️ 恢复任务失败 Offer #${offer.id}:`, error.message)
      failed++
    }
  }

  console.log(`✅ 队列恢复完成: 成功 ${recovered} 个，失败 ${failed} 个`)
}
