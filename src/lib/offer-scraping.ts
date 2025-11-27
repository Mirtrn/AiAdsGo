/**
 * Offer抓取触发器
 * 提供直接函数调用方式触发抓取，避免HTTP请求的认证问题
 *
 * 核心原则：直接调用 performScrapeAndAnalysis，确保异步抓取和手动抓取行为一致
 */

import { updateOfferScrapeStatus } from './offers'
import { performScrapeAndAnalysis } from '../app/api/offers/[id]/scrape/route'

/**
 * 触发Offer抓取（异步，不阻塞）
 *
 * 此函数会立即返回，抓取在后台进行
 * 直接调用 performScrapeAndAnalysis 函数，避免HTTP认证问题
 *
 * @param offerId Offer ID
 * @param userId User ID
 * @param url 要抓取的URL
 * @param brand 品牌名称
 */
export function triggerOfferScraping(
  offerId: number,
  userId: number,
  url: string,
  brand: string
): void {
  console.log(`[OfferScraping] 触发异步抓取 Offer #${offerId}`)
  console.log(`[OfferScraping] URL: ${url}, Brand: ${brand}, UserId: ${userId}`)

  // 立即更新状态为 in_progress
  updateOfferScrapeStatus(offerId, userId, 'in_progress')
  console.log(`[OfferScraping] 状态已更新为 in_progress`)

  // 使用 setImmediate 在下一个事件循环中执行，确保不阻塞当前请求
  setImmediate(async () => {
    try {
      console.log(`[OfferScraping] 开始执行后台抓取任务...`)

      // 直接调用 performScrapeAndAnalysis 函数
      await performScrapeAndAnalysis(offerId, userId, url, brand)

      console.log(`[OfferScraping] ✅ 后台抓取任务完成 Offer #${offerId}`)
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

  console.log(`[OfferScraping] 异步任务已排队，主流程继续执行`)
}
