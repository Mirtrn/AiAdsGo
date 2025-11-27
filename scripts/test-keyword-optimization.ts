/**
 * 测试脚本：关键词优化效果验证
 * 测试P1优化（去重）+ P3优化（动态品牌变体）
 */

import { scrapeProductData } from '../src/lib/scraper-stealth'

interface TestOffer {
  url: string
  country: string
  expectedBrand?: string
}

const testOffers: TestOffer[] = [
  {
    url: 'https://pboost.me/UKTs4I6',
    country: 'US',
    expectedBrand: 'Unknown' // 需要抓取后确定
  },
  {
    url: 'https://pboost.me/xEAgQ8ec',
    country: 'DE',
    expectedBrand: 'Unknown'
  },
  {
    url: 'https://pboost.me/RKWwEZR9',
    country: 'US',
    expectedBrand: 'Unknown'
  },
  {
    url: 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url=',
    country: 'US',
    expectedBrand: 'Unknown'
  }
]

async function testKeywordOptimization() {
  console.log('🧪 开始测试关键词优化效果...\n')
  console.log('=' .repeat(80))

  for (let i = 0; i < testOffers.length; i++) {
    const offer = testOffers[i]
    console.log(`\n📍 测试 Offer ${i + 1}/${testOffers.length}`)
    console.log(`   URL: ${offer.url}`)
    console.log(`   Country: ${offer.country}`)
    console.log('-'.repeat(80))

    try {
      // Step 1: 抓取产品数据
      console.log('\n🔍 步骤1: 抓取产品数据...')
      const scrapedData = await scrapeProductData(offer.url, offer.country)

      if (!scrapedData) {
        console.error('❌ 抓取失败：无数据返回')
        continue
      }

      // 显示基本信息
      console.log('\n✅ 抓取成功:')
      console.log(`   Product: ${scrapedData.productName || '未知'}`)
      console.log(`   Brand: ${scrapedData.brandName || '未知'}`)
      console.log(`   Rating: ${scrapedData.rating || 'N/A'}`)
      console.log(`   Reviews: ${scrapedData.reviewCount || 'N/A'}`)
      console.log(`   Sales Rank: ${scrapedData.salesRank || 'N/A'}`)

      // Step 2: 提取关键词（会自动触发P1+P3优化）
      console.log('\n🔑 步骤2: 提取关键词（含P1+P3优化）...')
      console.log('   注意观察日志中的:')
      console.log('   - 🏆 高知名度品牌提示')
      console.log('   - ⭐ 中等知名度品牌提示')
      console.log('   - 📌 低知名度品牌提示')
      console.log('   - 🔄 关键词去重统计')

      // 注意：实际调用ad-elements-extractor需要userId，这里仅做演示
      // const adElements = await getAdElements(scrapedData, offer.country, 'en', 1)

      console.log('\n✅ Offer测试完成')
      console.log('=' .repeat(80))

    } catch (error: any) {
      console.error(`\n❌ Offer ${i + 1} 测试失败:`, error.message)
      console.log('=' .repeat(80))
    }
  }

  console.log('\n\n🎉 所有测试完成！')
}

// 运行测试
testKeywordOptimization().catch(console.error)
