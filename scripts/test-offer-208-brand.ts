/**
 * 测试Offer 208品牌提取问题诊断
 * URL: https://www.amazon.com/dp/B0DYDRDJVH
 */

import { scrapeAmazonProductWithPlaywright } from '../src/lib/scraper-stealth'

async function testOffer208Brand() {
  const url = 'https://www.amazon.com/dp/B0DYDRDJVH'
  const targetCountry = 'DE'

  console.log('🔍 开始诊断Offer 208品牌提取问题...')
  console.log(`URL: ${url}`)
  console.log(`Target Country: ${targetCountry}`)
  console.log('\n--- 开始抓取 ---\n')

  try {
    const result = await scrapeAmazonProductWithPlaywright(
      url,
      targetCountry,
      { saveDebugFiles: true }
    )

    console.log('\n--- 抓取结果 ---')
    console.log(`Page Type: ${result.pageType}`)

    if (result.pageType === 'product' && result.product) {
      console.log(`\n📦 产品信息:`)
      console.log(`  - 产品名: ${result.product.productName}`)
      console.log(`  - 品牌名: ${result.product.brandName || 'NULL'}`)
      console.log(`  - ASIN: ${result.product.asin}`)
      console.log(`  - 价格: ${result.product.productPrice}`)
      console.log(`  - 评分: ${result.product.rating}`)
      console.log(`  - 评论数: ${result.product.reviewCount}`)

      if (!result.product.brandName) {
        console.error('\n❌ 品牌名提取失败！')
        console.log('\n💡 请检查保存的HTML文件（storage/debug-store-*.html）')
        console.log('   手动查看页面中的品牌信息位置')
      } else {
        console.log('\n✅ 品牌名提取成功！')
      }
    }
  } catch (error: any) {
    console.error('\n❌ 抓取失败:', error.message)
    console.error(error.stack)
  }
}

testOffer208Brand().catch(console.error)
