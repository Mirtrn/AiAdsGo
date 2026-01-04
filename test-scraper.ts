/**
 * 测试scraper对mydaysoutdoor.com页面的数据抓取能力
 */

import { scrapeProductData } from './src/lib/scraper'

const testUrls = [
  'https://mydaysoutdoor.com/products/oversized-camping-chair',
  'https://mydaysoutdoor.com/products/heated-pet-house',
  'https://mydaysoutdoor.com/products/portable-heated-seat-cushion',
]

async function testScraping() {
  for (const url of testUrls) {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`测试URL: ${url}`)
    console.log('='.repeat(80))

    try {
      const data = await scrapeProductData(url)

      console.log('\n✅ 抓取成功！')
      console.log('\n📋 商品名称:', data.productName || '(未获取到)')
      console.log('\n💰 价格:', data.productPrice || '(未获取到)')
      console.log('\n🏷️ 品牌:', data.brandName || '(未获取到)')
      console.log('\n📝 商品描述:',data.productDescription
        ? data.productDescription.slice(0, 200) + (data.productDescription.length > 200 ? '...' : '')
        : '(未获取到)')
      console.log('\n🎯 核心特性数量:', data.coreFeatures?.length || 0)
      console.log('\n🔍 次要特性数量:', data.secondaryFeatures?.length || 0)
      console.log('\n❓ FAQ数量:', data.faqs?.length || 0)
      console.log('\n📊 技术规格数量:', Object.keys(data.specifications || {}).length)
      console.log('\n💬 评论数量:', data.reviews?.length || 0)

      if (data.reviews && data.reviews.length > 0) {
        console.log('\n📝 第一条评论:')
        const review = data.reviews[0]
        console.log(`   - 评分: ${review.rating}/5`)
        console.log(`   - 作者: ${review.author}`)
        console.log(`   - 标题: ${review.title}`)
        console.log(`   - 正文: ${review.body.slice(0, 100)}...`)
        console.log(`   - 验证购买: ${review.verifiedBuyer ? '是' : '否'}`)
      }

    } catch (error: any) {
      console.error('\n❌ 抓取失败:', error.message)
    }
  }
}

testScraping().catch(console.error)
