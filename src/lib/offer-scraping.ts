/**
 * Offer抓取触发器
 * 通过直接调用抓取逻辑触发抓取，避免HTTP请求的认证问题
 *
 * 核心原则：直接调用抓取逻辑，确保异步抓取和手动抓取行为一致
 */

import { updateOfferScrapeStatus, findOfferById } from './offers'
import { scrapeUrl } from './scraper'
import { analyzeProductPage } from './ai'
import { getProxyUrlForCountry, isProxyEnabled } from './settings'

/**
 * 触发Offer抓取（异步，不阻塞）
 *
 * 此函数会立即返回，抓取在后台进行
 * 直接执行抓取逻辑，避免HTTP认证问题
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

      // 🔧 修复：直接执行简化的抓取逻辑，而不是导入route.ts中的函数
      // 获取代理配置
      const offer = findOfferById(offerId, userId)
      const targetCountry = offer?.target_country || 'US'
      const useProxy = isProxyEnabled(userId)
      const proxyUrl = useProxy ? getProxyUrlForCountry(targetCountry, userId) : undefined

      // 抓取网页内容
      console.log(`[OfferScraping] 开始抓取: ${url}`)
      const pageData = await scrapeUrl(url, proxyUrl)

      // AI分析
      console.log(`[OfferScraping] 开始AI分析...`)
      const analysis = await analyzeProductPage({
        url,
        brand,
        title: pageData.title || '',
        description: pageData.description || '',
        text: pageData.text,
        targetCountry,
      }, userId)

      // 更新Offer信息
      const { getSQLiteDatabase } = await import('./db')
      const db = getSQLiteDatabase()
      const stmt = db.prepare(`
        UPDATE offers
        SET brand_description = ?,
            unique_selling_points = ?,
            product_highlights = ?,
            target_audience = ?,
            scrape_status = 'completed',
            scraped_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `)
      stmt.run(
        analysis.brandDescription || null,
        analysis.uniqueSellingPoints || null,
        analysis.productHighlights || null,
        analysis.targetAudience || null,
        offerId,
        userId
      )

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
