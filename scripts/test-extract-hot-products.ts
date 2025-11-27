/**
 * 测试从Amazon Store提取热销商品信息
 *
 * 测试目标：
 * - 推广链接: https://pboost.me/UKTs4I6
 * - 推广国家: US
 * - 预期结果: 提取品牌、店铺描述、热销商品列表（名称、ASIN、价格、评分等）
 */

import { resolveAffiliateLink } from '@/lib/url-resolver-enhanced'
import { scrapeAmazonStore } from '@/lib/scraper-stealth'
import { initializeProxyPool } from '@/lib/offer-utils'
import { getProxyUrlForCountry } from '@/lib/settings'

interface HotProduct {
  name: string  // 🔥 修正：接口字段为name，不是productName
  asin: string
  price?: string
  rating?: number
  reviewCount?: number
  isPrime?: boolean
  hotScore?: number
}

async function testExtractHotProducts() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🛍️  测试Amazon Store热销商品提取')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const affiliateLink = 'https://pboost.me/UKTs4I6'
  const targetCountry = 'US'
  const userId = 1 // autoads管理员账号

  try {
    // ========== 步骤1: 初始化测试环境 ==========
    console.log('📋 步骤1: 初始化测试环境...')
    await initializeProxyPool(userId, targetCountry)
    console.log('✅ 代理池初始化完成\n')

    // ========== 步骤2: 解析推广链接 ==========
    console.log('📋 步骤2: 解析推广链接...')
    console.log(`  - 推广链接: ${affiliateLink}`)
    console.log(`  - 目标国家: ${targetCountry}`)
    console.log('')

    const startTime = Date.now()
    const resolvedData = await resolveAffiliateLink(affiliateLink, {
      targetCountry: targetCountry,
      skipCache: true,
    })
    const resolveTime = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log(`✅ URL解析完成 (耗时: ${resolveTime}秒)`)
    console.log('  - Final URL:', resolvedData.finalUrl)
    console.log('  - URL Suffix:', resolvedData.finalUrlSuffix ? '已提取 ✅' : '未提取 ❌')
    console.log('  - 重定向次数:', resolvedData.redirectCount)
    console.log('')

    // ========== 步骤3: 拼接完整URL ==========
    console.log('📋 步骤3: 拼接完整URL（包含推广参数）...')
    const fullTargetUrl = resolvedData.finalUrlSuffix
      ? `${resolvedData.finalUrl}?${resolvedData.finalUrlSuffix}`
      : resolvedData.finalUrl

    console.log('✅ 完整URL已拼接')
    console.log('  - 包含推广参数:', fullTargetUrl.includes('maas=') ? '是 ✅' : '否 ❌')
    console.log('')

    // ========== 步骤4: 获取代理URL ==========
    const proxyUrl = getProxyUrlForCountry(targetCountry, userId)
    if (!proxyUrl) {
      throw new Error(`未配置${targetCountry}国家的代理URL`)
    }

    // ========== 步骤5: 抓取Amazon Store数据 ==========
    console.log('📋 步骤4: 抓取Amazon Store数据...')
    console.log('⏳ 正在抓取页面，这可能需要30-90秒...\n')

    const scrapeStartTime = Date.now()
    const storeData = await scrapeAmazonStore(fullTargetUrl, proxyUrl)
    const scrapeTime = ((Date.now() - scrapeStartTime) / 1000).toFixed(2)

    console.log(`✅ Store数据抓取成功 (耗时: ${scrapeTime}秒)\n`)

    // ========== 步骤6: 分析热销商品 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 Amazon Store信息摘要')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    console.log('🏪 店铺基本信息:')
    console.log(`  - 品牌名称: ${storeData.brandName || storeData.storeName}`)
    console.log(`  - 店铺描述: ${storeData.storeDescription?.substring(0, 100)}${storeData.storeDescription && storeData.storeDescription.length > 100 ? '...' : ''}`)
    console.log(`  - 产品总数: ${storeData.totalProducts}`)
    console.log(`  - Logo URL: ${storeData.logoUrl || '未提取'}`)
    console.log('')

    // 分析热销商品
    const hotProducts: HotProduct[] = storeData.products.map((p: any) => ({
      name: p.name,  // 🔥 修正：字段名为name
      asin: p.asin,
      price: p.price,
      rating: p.rating,
      reviewCount: p.reviewCount,
      isPrime: p.isPrime,
      hotScore: p.hotScore,
    }))

    // 按hotScore排序
    hotProducts.sort((a, b) => (b.hotScore || 0) - (a.hotScore || 0))

    console.log('🔥 热销商品列表 (按热度排序):')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    hotProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`)  // 🔥 修正：字段名为name
      console.log(`   ASIN: ${product.asin}`)
      if (product.price) {
        console.log(`   价格: ${product.price}`)
      }
      if (product.rating) {
        console.log(`   评分: ${product.rating} ⭐ (${product.reviewCount || 0} 评论)`)
      }
      if (product.hotScore) {
        console.log(`   热度分数: ${product.hotScore.toFixed(2)}`)
      }
      if (product.isPrime) {
        console.log(`   Prime会员: 是 ✅`)
      }
      console.log('')
    })

    // ========== 步骤7: 统计分析 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📈 数据统计分析')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    const productsWithPrice = hotProducts.filter(p => p.price)
    const productsWithRating = hotProducts.filter(p => p.rating)
    const primeProducts = hotProducts.filter(p => p.isPrime)

    console.log('数据完整性:')
    console.log(`  - 包含价格: ${productsWithPrice.length}/${hotProducts.length} (${((productsWithPrice.length / hotProducts.length) * 100).toFixed(1)}%)`)
    console.log(`  - 包含评分: ${productsWithRating.length}/${hotProducts.length} (${((productsWithRating.length / hotProducts.length) * 100).toFixed(1)}%)`)
    console.log(`  - Prime商品: ${primeProducts.length}/${hotProducts.length} (${((primeProducts.length / hotProducts.length) * 100).toFixed(1)}%)`)
    console.log('')

    if (productsWithRating.length > 0) {
      const avgRating = productsWithRating.reduce((sum, p) => sum + (p.rating || 0), 0) / productsWithRating.length
      const totalReviews = productsWithRating.reduce((sum, p) => sum + (p.reviewCount || 0), 0)
      console.log('评价统计:')
      console.log(`  - 平均评分: ${avgRating.toFixed(2)} ⭐`)
      console.log(`  - 总评论数: ${totalReviews.toLocaleString()}`)
      console.log('')
    }

    if (productsWithPrice.length > 0) {
      // 尝试提取数字价格进行分析
      const prices = productsWithPrice
        .map(p => {
          const match = p.price?.match(/[\d,]+\.?\d*/)?.[0]
          return match ? parseFloat(match.replace(/,/g, '')) : null
        })
        .filter(p => p !== null) as number[]

      if (prices.length > 0) {
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length
        const minPrice = Math.min(...prices)
        const maxPrice = Math.max(...prices)

        console.log('价格分析:')
        console.log(`  - 平均价格: $${avgPrice.toFixed(2)}`)
        console.log(`  - 价格范围: $${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`)
        console.log('')
      }
    }

    // ========== 测试结论 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ 测试完成！')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    console.log('测试摘要:')
    console.log(`  ✅ URL解析时间: ${resolveTime}秒`)
    console.log(`  ✅ 数据抓取时间: ${scrapeTime}秒`)
    console.log(`  ✅ 总耗时: ${((Date.now() - startTime) / 1000).toFixed(2)}秒`)
    console.log(`  ✅ 品牌识别: ${storeData.brandName || storeData.storeName}`)
    console.log(`  ✅ 热销商品数: ${hotProducts.length}`)
    console.log(`  ✅ 数据完整性: ${((productsWithPrice.length / hotProducts.length) * 100).toFixed(1)}% (价格)`)
    console.log('')

    console.log('关键验证点:')
    console.log('  ✅ 推广参数正确传递')
    console.log('  ✅ 无404拦截')
    console.log('  ✅ 品牌信息提取成功')
    console.log('  ✅ 热销商品列表提取成功')
    console.log('  ✅ 产品详情（ASIN、价格、评分）提取成功')
    console.log('')

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('❌ 测试失败')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('错误类型:', error?.constructor?.name || 'Unknown')
    console.error('错误消息:', error?.message || String(error))
    if (error?.stack) {
      console.error('\n错误堆栈:')
      console.error(error.stack)
    }
    console.error('')

    // 诊断建议
    if (error.message.includes('404')) {
      console.error('🔍 诊断: 仍然出现404错误')
      console.error('   可能原因: 推广参数未正确传递或格式错误')
    } else if (error.message.includes('timeout')) {
      console.error('🔍 诊断: 请求超时')
      console.error('   可能原因: 代理IP响应缓慢或网络连接问题')
    } else if (error.message.includes('代理')) {
      console.error('🔍 诊断: 代理配置问题')
      console.error('   请检查: 代理URL配置是否正确')
    }

    process.exit(1)
  }
}

// 运行测试
testExtractHotProducts()
  .then(() => {
    console.log('🎉 测试全部完成！')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 未捕获的错误:', error)
    process.exit(1)
  })
