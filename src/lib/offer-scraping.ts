/**
 * Offer抓取触发器
 * 通过直接调用抓取逻辑触发抓取，避免HTTP请求的认证问题
 *
 * 核心原则：直接调用统一的核心抓取函数，确保异步抓取和手动抓取行为一致
 * 🔥 重构优化：调用 offer-scraping-core.ts 的统一抓取流程
 * 🚀 队列管理：使用队列管理器控制并发，防止服务器过载
 */

import { updateOfferScrapeStatus } from './offers'
import { performScrapeAndAnalysis } from './offer-scraping-core'
import { getQueueManager } from './scrape-queue-manager'
import { getQueueConfig } from './queue-config'

/**
 * 🎯 优化: Offer抓取优先级枚举
 * 用于区分不同场景的重要性，优化用户体验
 */
export enum OfferScrapingPriority {
  URGENT = 10,        // 用户手动创建（立即需要，最高优先级）
  HIGH = 7,           // SSE流式创建（用户等待中）
  NORMAL = 5,         // 默认优先级
  LOW = 3,            // 批量导入（后台慢慢处理）
  BACKGROUND = 1      // 定期重新抓取或系统任务
}

/**
 * 触发Offer抓取（异步，不阻塞）
 *
 * 此函数会立即返回，抓取在后台进行
 * 调用统一的核心抓取函数，包含所有增强模块和scraped_products持久化
 * 🚀 使用队列管理器控制并发，防止服务器过载
 *
 * @param offerId Offer ID
 * @param userId User ID
 * @param url 要抓取的URL
 * @param brand 品牌名称
 * @param priority 优先级（1-10，数字越大优先级越高，默认5）
 */
export function triggerOfferScraping(
  offerId: number,
  userId: number,
  url: string,
  brand: string,
  priority: number = OfferScrapingPriority.NORMAL
): void {
  console.log(`[OfferScraping] 触发异步抓取 Offer #${offerId}`)
  console.log(`[OfferScraping] URL: ${url}, Brand: ${brand}, UserId: ${userId}, Priority: ${priority}`)

  // 立即更新状态为 pending（等待队列处理）
  updateOfferScrapeStatus(offerId, userId, 'pending')
  console.log(`[OfferScraping] 状态已更新为 pending（等待队列处理）`)

  // 使用 setImmediate 在下一个事件循环中执行，确保不阻塞当前请求
  setImmediate(async () => {
    try {
      // 🚀 获取队列管理器（加载用户配置）
      const queueConfig = await getQueueConfig(userId)
      const queueManager = getQueueManager(queueConfig)

      console.log(`[OfferScraping] 添加到队列: Offer #${offerId}`)

      // 添加到队列（会自动控制并发）
      await queueManager.addTask(
        {
          userId,
          offerId,
          priority,
        },
        async () => {
          // 更新状态为 in_progress（开始执行）
          updateOfferScrapeStatus(offerId, userId, 'in_progress')
          console.log(`[OfferScraping] 开始执行抓取任务 Offer #${offerId}`)

          // 🔥 重构优化：调用统一的核心抓取函数
          // 包含完整的抓取流程：
          // - 推广链接解析
          // - 网页抓取（Amazon Store/Product/独立站）
          // - AI分析
          // - 评论分析
          // - 竞品分析
          // - 广告元素提取
          // - scraped_products持久化
          await performScrapeAndAnalysis(offerId, userId, url, brand)

          console.log(`[OfferScraping] ✅ 后台抓取任务完成 Offer #${offerId}`)
        }
      )
    } catch (error: any) {
      console.error(`[OfferScraping] ❌ 后台抓取任务失败 Offer #${offerId}:`, error)
      console.error(`[OfferScraping] 错误类型: ${error.name}`)
      console.error(`[OfferScraping] 错误详情: ${error.message}`)
      if (error.stack) {
        console.error(`[OfferScraping] 错误堆栈:`, error.stack)
      }

      // 更新状态为失败
      try {
        updateOfferScrapeStatus(offerId, userId, 'failed', `抓取失败: ${error.message}`)
        console.log(`[OfferScraping] 已更新Offer #${offerId}状态为failed`)
      } catch (updateError: any) {
        console.error(`[OfferScraping] ⚠️  更新失败状态时出错:`, updateError.message)
      }
    }
  })

  console.log(`[OfferScraping] 异步任务已添加到队列，主流程继续执行`)
}
