/**
 * 测试脚本：从Amazon Store提取热销商品
 * 测试链接: https://pboost.me/UKTs4I6 (推广国家: US)
 *
 * 🔥 简化版：直接抓取已知的Amazon Store URL
 */

import { scrapeAmazonStore } from '../src/lib/scraper-stealth'

async function main() {
  // 已知这个推广链接会重定向到这个Amazon Store URL
  const storeUrl = 'https://www.amazon.com/stores/page/201E3A4F-C63F-48A6-87B7-524F985330DA'
  const targetCountry = 'US'
  const proxyUrl = process.env.PROXY_URL // 从环境变量获取代理URL

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🧪 Amazon Store热销商品提取测试')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`店铺URL: ${storeUrl}`)
  console.log(`目标国家: ${targetCountry}`)
  console.log(`代理配置: ${proxyUrl ? '✅ 已配置' : '❌ 未配置'}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (!proxyUrl) {
    console.error('❌ 错误: 未配置PROXY_URL环境变量')
    console.log('💡 解决方法: 确保.env文件中已配置PROXY_URL')
    process.exit(1)
  }

  try {
    // 抓取Amazon Store数据（增加调试输出）
    console.log('📍 开始抓取Amazon Store数据...')
    console.log('⏳ 正在访问店铺页面（使用Playwright + Stealth模式）...\n')

    // 临时修改：直接调用scrapeAmazonStore并保存HTML/截图
    const fs = await import('fs')
    const path = await import('path')

    // 创建storage目录（如果不存在）
    const storageDir = path.join(process.cwd(), 'storage')
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true })
    }

    const storeData = await scrapeAmazonStore(storeUrl, proxyUrl)

    // 保存结果到文件，方便分析
    const timestamp = Date.now()
    const resultFile = path.join(storageDir, `store-test-result-${timestamp}.json`)
    fs.writeFileSync(resultFile, JSON.stringify(storeData, null, 2))
    console.log(`📁 测试结果已保存到: ${resultFile}\n`)

    // 步骤3: 输出店铺信息
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 店铺基本信息')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`店铺名称: ${storeData.storeName || 'N/A'}`)
    console.log(`品牌名称: ${storeData.brandName || 'N/A'}`)
    console.log(`店铺描述: ${storeData.storeDescription ? storeData.storeDescription.substring(0, 100) + '...' : 'N/A'}`)
    console.log(`商品总数: ${storeData.totalProducts}`)
    console.log(`店铺URL: ${storeData.storeUrl}\n`)

    // 步骤4: 热销洞察
    if (storeData.hotInsights) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('🔥 热销商品洞察')
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log(`平均评分: ${storeData.hotInsights.avgRating.toFixed(2)} ⭐`)
      console.log(`平均评论数: ${storeData.hotInsights.avgReviews} 条`)
      console.log(`热销商品数量: ${storeData.hotInsights.topProductsCount} 个\n`)
    }

    // 步骤5: 输出热销商品列表
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('🏆 热销商品排行榜 (TOP 15)')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    storeData.products.forEach((product, index) => {
      console.log(`${product.hotLabel || '✅'} #${product.rank || index + 1}`)
      console.log(`  商品名称: ${product.name}`)
      console.log(`  价格: ${product.price || 'N/A'}`)
      console.log(`  评分: ${product.rating || 'N/A'} ⭐ (${product.reviewCount || '0'} 评论)`)
      console.log(`  热销分数: ${product.hotScore ? product.hotScore.toFixed(2) : 'N/A'}`)
      console.log(`  ASIN: ${product.asin || 'N/A'}`)

      if (product.promotion) {
        console.log(`  促销信息: ${product.promotion}`)
      }
      if (product.badge) {
        console.log(`  徽章: ${product.badge}`)
      }
      if (product.isPrime) {
        console.log(`  Prime: ✅`)
      }

      console.log('')
    })

    // 步骤6: 输出TOP 5热销商品详情（用于AI创意生成）
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('🔥 TOP 5 热销商品详细信息（用于AI创意生成）')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    const top5 = storeData.products.filter(p => p.isHot).slice(0, 5)

    if (top5.length === 0) {
      console.log('⚠️ 未找到热销商品（可能缺少评分或评论数据）\n')
    } else {
      top5.forEach((product, index) => {
        console.log(`🔥 TOP ${index + 1}: ${product.name}`)
        console.log(`  - 价格: ${product.price || 'N/A'}`)
        console.log(`  - 评分: ${product.rating || 'N/A'} ⭐`)
        console.log(`  - 评论数: ${product.reviewCount || 'N/A'}`)
        console.log(`  - 热销分数: ${product.hotScore?.toFixed(2) || 'N/A'}`)
        console.log(`  - 图片: ${product.imageUrl ? '✅' : '❌'}`)
        console.log(`  - ASIN: ${product.asin || 'N/A'}`)
        console.log('')
      })
    }

    // 步骤7: 输出热销分数计算公式说明
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📐 热销分数计算公式')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('公式: Hot Score = Rating × log₁₀(ReviewCount + 1)')
    console.log('示例: 4.5 ⭐ × log₁₀(1000 + 1) ≈ 4.5 × 3.0 = 13.5')
    console.log('')
    console.log('排序策略:')
    console.log('  1. 按热销分数降序排序')
    console.log('  2. 取TOP 15商品')
    console.log('  3. 前5名标记为"🔥 热销商品"')
    console.log('  4. 6-15名标记为"✅ 畅销商品"\n')

    // 步骤8: 测试总结
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ 测试完成')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`品牌识别: ${storeData.brandName ? '✅' : '❌'}`)
    console.log(`商品提取: ${storeData.totalProducts > 0 ? '✅' : '❌'} (${storeData.totalProducts}个)`)
    console.log(`热销分析: ${top5.length > 0 ? '✅' : '❌'} (${top5.length}个热销商品)`)
    console.log(`数据完整性: ${storeData.hotInsights ? '✅' : '❌'}`)
    console.log('')

  } catch (error: any) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('❌ 测试失败')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('错误类型:', error?.constructor?.name || 'Unknown')
    console.error('错误消息:', error?.message || String(error))
    console.error('堆栈跟踪:', error?.stack || 'N/A')
    console.error('')
    process.exit(1)
  }
}

main()
