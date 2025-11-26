/**
 * 临时测试脚本：触发Offer #166的抓取
 * 用于P0优化验证
 */

import { getSQLiteDatabase } from '../src/lib/db'
import { scrapeAmazonProduct } from '../src/lib/scraper-stealth'
import { updateOfferScrapeStatus } from '../src/lib/offers'

async function main() {
  const offerId = 166
  const userId = 1
  const url = 'https://www.amazon.com/dp/B08N5WRWNW'
  const brand = 'Amazon'

  console.log(`🚀 开始抓取 Offer #${offerId}: ${url}`)

  try {
    // 更新状态为进行中
    updateOfferScrapeStatus(offerId, userId, 'in_progress')

    // 抓取Amazon产品数据
    console.log('📡 正在抓取Amazon产品数据...')
    const productData = await scrapeAmazonProduct(url)

    console.log('✅ 抓取成功！')
    console.log('产品数据:', JSON.stringify(productData, null, 2))

    // 保存到数据库
    console.log('💾 保存数据到数据库...')
    const formatFieldForDB = (value: any): string | null => {
      if (value === null || value === undefined) return null
      if (typeof value === 'string') return value
      return JSON.stringify(value)
    }

    updateOfferScrapeStatus(offerId, userId, 'completed', undefined, {
      scraped_data: productData ? formatFieldForDB(productData) : undefined,
    })

    console.log('✅ Offer #166 抓取完成!')

    // 验证保存
    const db = getSQLiteDatabase()
    const result = db.prepare('SELECT scraped_data FROM offers WHERE id = ?').get(offerId) as any

    if (result?.scraped_data) {
      console.log('✅ scraped_data 已保存到数据库')
      const data = JSON.parse(result.scraped_data)
      console.log('📊 关键字段:')
      console.log('  - discount:', data.discount)
      console.log('  - salesRank:', data.salesRank)
      console.log('  - badge:', data.badge)
      console.log('  - primeEligible:', data.primeEligible)
      console.log('  - availability:', data.availability)
    } else {
      console.log('❌ scraped_data 未保存')
    }

  } catch (error: any) {
    console.error('❌ 抓取失败:', error.message)
    updateOfferScrapeStatus(offerId, userId, 'failed', error.message)
    process.exit(1)
  }
}

main()
