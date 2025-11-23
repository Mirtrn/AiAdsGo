/**
 * Offer抓取触发器
 * 提供直接函数调用方式触发抓取，避免HTTP请求的认证问题
 *
 * 核心原则：复用手动抓取的完整逻辑，确保异步抓取和手动抓取行为一致
 */

import { updateOfferScrapeStatus } from './offers'
import { performScrapeAndAnalysis } from '../app/api/offers/[id]/scrape/route'

/**
 * 触发Offer抓取（异步，不阻塞）
 *
 * 此函数会立即返回，抓取在后台进行
 * 使用与手动"开始抓取"按钮完全相同的抓取逻辑
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

  // 立即更新状态为 in_progress
  updateOfferScrapeStatus(offerId, userId, 'in_progress')

  // 后台执行抓取（使用与手动抓取完全相同的逻辑）
  performScrapeAndAnalysis(offerId, userId, url, brand).catch(error => {
    console.error(`[OfferScraping] 后台抓取任务失败:`, error)
  })
}
