/**
 * 测试Coziley品牌提取
 * 验证scraper能否从https://www.amazon.com/dp/B0DYDRDJVH提取品牌"Coziley"
 */

import { scrapeAmazonProduct } from '../src/lib/scraper-stealth'

async function testCozilleyBrand() {
  const url = 'https://www.amazon.com/dp/B0DYDRDJVH'

  console.log('🔍 测试Coziley品牌提取...')
  console.log(`URL: ${url}`)
  console.log('\n--- 开始抓取 ---\n')

  try {
    const product = await scrapeAmazonProduct(url)

    console.log('\n--- 抓取结果 ---')
    console.log(`产品名: ${product.productName}`)
    console.log(`品牌名: ${product.brandName || 'NULL ❌'}`)
    console.log(`ASIN: ${product.asin}`)
    console.log(`价格: ${product.productPrice}`)

    if (product.brandName === 'Coziley' || product.brandName?.toLowerCase() === 'coziley') {
      console.log('\n✅ 品牌提取成功！')
    } else {
      console.error('\n❌ 品牌提取失败！')
      console.error(`期望: "Coziley", 实际: "${product.brandName}"`)
      process.exit(1)
    }
  } catch (error: any) {
    console.error('\n❌ 抓取失败:', error.message)
    process.exit(1)
  }
}

testCozilleyBrand()
