/**
 * 采集测试脚本 - 直接调用 scrapeProductData 测试 Amazon 单品页和店铺页
 * 运行方式: node --experimental-vm-modules scripts/test-scraper.mjs
 * 或使用 tsx: npx tsx scripts/test-scraper.mjs
 */

// 使用 tsx 运行，直接 import TypeScript
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

// 测试 URL 列表
const TEST_URLS = [
  // Amazon 单品页
  {
    label: '🛒 Amazon 单品页 - DREO Tower Fan',
    url: 'https://www.amazon.com/DREO-Tower-Fan-Oscillating-Bladeless/dp/B0BNQ9ZFHX',
    type: 'product'
  },
  // Amazon 店铺主页
  {
    label: '🏪 Amazon 店铺页 - DREO Store',
    url: 'https://www.amazon.com/stores/DREO/page/B71B6B5A-7C4E-4B73-B1F7-D66E20C56588',
    type: 'store'
  }
]

async function runTest() {
  console.log('🚀 开始采集测试...\n')
  console.log('=' .repeat(60))

  // 动态加载 tsx 编译的模块
  let scrapeProductData
  try {
    // 尝试直接 require（在 tsx 环境下）
    const scraperPath = path.join(projectRoot, 'src/lib/scraper.ts')
    const mod = await import(pathToFileURL(scraperPath).href)
    scrapeProductData = mod.scrapeProductData
    console.log('✅ 成功加载 scraper.ts 模块\n')
  } catch (err) {
    console.error('❌ 无法直接导入 scraper.ts，请使用 npx tsx scripts/test-scraper.mjs')
    console.error('错误:', err.message)
    process.exit(1)
  }

  for (const testCase of TEST_URLS) {
    console.log(`\n📋 测试: ${testCase.label}`)
    console.log(`🔗 URL: ${testCase.url}`)
    console.log('-'.repeat(60))

    const startTime = Date.now()
    try {
      const result = await scrapeProductData(testCase.url, undefined, 'US', 30000)
      const elapsed = Date.now() - startTime

      console.log(`⏱️  耗时: ${elapsed}ms`)
      console.log('\n📦 采集结果:')
      console.log(`  productName:     ${result.productName || '(空)'}`)
      console.log(`  brandName:       ${result.brandName || '(空)'}`)
      console.log(`  productPrice:    ${result.productPrice || '(空)'}`)
      console.log(`  productCategory: ${(result.productCategory || '').slice(0, 80) || '(空)'}`)
      console.log(`  imageUrls:       ${result.imageUrls?.length || 0} 张`)
      if (result.imageUrls?.length > 0) {
        console.log(`    第一张: ${result.imageUrls[0]?.slice(0, 80)}`)
      }

      // 关键字段检查 - features/aboutThisItem
      const featureCount = result.aboutThisItem?.length || result.features?.length || result.productFeatures?.length || 0
      console.log(`\n🔑 卖点字段检查:`)
      console.log(`  aboutThisItem:   ${result.aboutThisItem?.length || 0} 条`)
      console.log(`  features:        ${result.features?.length || 0} 条`)
      console.log(`  rawAboutThisItem:${result.rawAboutThisItem?.length || 0} 条`)
      console.log(`  productFeatures: ${result.productFeatures?.length || 0} 条`)
      console.log(`  ✅ 合计可用卖点: ${featureCount} 条`)

      // 打印前3条卖点
      const bullets = result.aboutThisItem || result.features || result.productFeatures || []
      if (bullets.length > 0) {
        console.log('\n  前3条卖点:')
        bullets.slice(0, 3).forEach((b, i) => {
          console.log(`    [${i+1}] ${b.slice(0, 100)}`)
        })
      } else {
        console.log('\n  ⚠️  未提取到任何卖点！')
      }

      // 描述
      console.log(`\n  productDescription: ${result.productDescription ? result.productDescription.slice(0, 120) + '...' : '(空)'}`)
      console.log(`  metaTitle:          ${result.metaTitle ? result.metaTitle.slice(0, 80) : '(空)'}`)

    } catch (err) {
      const elapsed = Date.now() - startTime
      console.error(`❌ 采集失败 (${elapsed}ms): ${err.message}`)
    }

    console.log('='.repeat(60))
  }

  console.log('\n✅ 测试完成')
}

runTest().catch(err => {
  console.error('测试运行出错:', err)
  process.exit(1)
})
