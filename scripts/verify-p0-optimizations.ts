#!/usr/bin/env tsx
/**
 * P0优化验证脚本
 *
 * 测试内容:
 * 1. P0-1: 关键词分批处理（20个/批）
 * 2. P0-2: 缓存键包含页面类型
 */

import { getKeywordSearchVolumes } from '../src/lib/keyword-planner'
import { getCachedPageData, setCachedPageData } from '../src/lib/redis'
import { getRedisClient } from '../src/lib/redis'

console.log('🧪 P0优化验证测试开始...\n')

// ========================================
// P0-1: 关键词分批处理验证
// ========================================
async function testKeywordBatching() {
  console.log('📝 测试 P0-1: 关键词分批处理')
  console.log('=' .repeat(60))

  const testKeywords = Array.from({ length: 43 }, (_, i) => `test keyword ${i + 1}`)

  console.log(`测试场景: 43个关键词（预期3批：20 + 20 + 3）`)
  console.log(`关键词列表: ${testKeywords.slice(0, 3).join(', ')}...（共${testKeywords.length}个）\n`)

  try {
    console.log('⏳ 开始API调用...')
    const startTime = Date.now()

    const results = await getKeywordSearchVolumes(testKeywords, 'US', 'en')

    const elapsed = Date.now() - startTime

    console.log(`✅ API调用成功`)
    console.log(`   返回结果数: ${results.length}`)
    console.log(`   耗时: ${elapsed}ms`)
    console.log(`   预期批次: 3批（检查日志中的 "[KeywordPlanner] Processing batch X/3"）`)

    // 验证结果完整性
    if (results.length === testKeywords.length) {
      console.log(`✅ 结果完整: ${results.length}/${testKeywords.length}`)
    } else {
      console.log(`❌ 结果不完整: ${results.length}/${testKeywords.length}`)
    }

  } catch (error: any) {
    console.error(`❌ API调用失败:`, error.message)

    // 检查是否为预期的错误（如果没有分批则会触发）
    if (error.message.includes('only supports 20 items')) {
      console.log(`\n⚠️  检测到 "only supports 20 items" 错误`)
      console.log(`   这表明分批逻辑未生效！`)
    }
  }

  console.log('')
}

// ========================================
// P0-2: 缓存键优化验证
// ========================================
async function testCacheKeyOptimization() {
  console.log('📝 测试 P0-2: 缓存键优化')
  console.log('=' .repeat(60))

  const testUrl = 'https://www.amazon.com/test-product-12345'
  const language = 'en'

  console.log(`测试URL: ${testUrl}`)
  console.log(`语言: ${language}\n`)

  try {
    // 场景1: 保存Product类型缓存
    console.log('📦 场景1: 保存Product类型缓存')
    await setCachedPageData(testUrl, language, {
      title: 'Product Page Title',
      description: 'Product page description',
      text: 'Product page content',
      pageType: 'product'
    })
    console.log('✅ Product缓存已保存')

    // 场景2: 保存Store类型缓存（同一URL）
    console.log('\n📦 场景2: 保存Store类型缓存（同一URL）')
    await setCachedPageData(testUrl, language, {
      title: 'Store Page Title',
      description: 'Store page description',
      text: 'Store page content',
      pageType: 'store'
    })
    console.log('✅ Store缓存已保存')

    // 场景3: 读取Product缓存
    console.log('\n📖 场景3: 读取Product缓存')
    const productCache = await getCachedPageData(testUrl, language, 'product')
    if (productCache) {
      console.log(`✅ Product缓存命中`)
      console.log(`   标题: ${productCache.title}`)
      console.log(`   pageType: ${productCache.pageType}`)

      if (productCache.title === 'Product Page Title' && productCache.pageType === 'product') {
        console.log(`✅ Product缓存内容正确`)
      } else {
        console.log(`❌ Product缓存内容不正确`)
      }
    } else {
      console.log(`❌ Product缓存未命中`)
    }

    // 场景4: 读取Store缓存
    console.log('\n📖 场景4: 读取Store缓存')
    const storeCache = await getCachedPageData(testUrl, language, 'store')
    if (storeCache) {
      console.log(`✅ Store缓存命中`)
      console.log(`   标题: ${storeCache.title}`)
      console.log(`   pageType: ${storeCache.pageType}`)

      if (storeCache.title === 'Store Page Title' && storeCache.pageType === 'store') {
        console.log(`✅ Store缓存内容正确`)
      } else {
        console.log(`❌ Store缓存内容不正确`)
      }
    } else {
      console.log(`❌ Store缓存未命中`)
    }

    // 场景5: 验证缓存隔离
    console.log('\n🔍 场景5: 验证缓存隔离')
    if (productCache && storeCache) {
      if (productCache.title !== storeCache.title) {
        console.log(`✅ Product和Store缓存已隔离（不同内容）`)
        console.log(`   Product标题: "${productCache.title}"`)
        console.log(`   Store标题: "${storeCache.title}"`)
      } else {
        console.log(`❌ Product和Store缓存未隔离（相同内容）`)
      }
    }

    // 清理测试缓存
    console.log('\n🧹 清理测试缓存...')
    const redis = getRedisClient()
    await redis.del(`scrape:product:${language}:${Buffer.from(testUrl).toString('base64')}`)
    await redis.del(`scrape:store:${language}:${Buffer.from(testUrl).toString('base64')}`)
    console.log('✅ 测试缓存已清理')

  } catch (error: any) {
    console.error(`❌ 测试失败:`, error.message)
  }

  console.log('')
}

// ========================================
// 主测试流程
// ========================================
async function main() {
  try {
    // 测试P0-1
    await testKeywordBatching()

    // 测试P0-2
    await testCacheKeyOptimization()

    console.log('🎉 P0优化验证测试完成！')
    console.log('\n📋 验证清单:')
    console.log('  □ P0-1: 检查日志中是否出现 "[KeywordPlanner] Processing batch X/3"')
    console.log('  □ P0-1: 验证43个关键词全部返回结果')
    console.log('  □ P0-2: Product和Store缓存使用不同标题')
    console.log('  □ P0-2: 两种缓存类型都能正确命中')
    console.log('  □ 无 "only supports 20 items" 错误')
    console.log('  □ 无 "缓存页面类型不匹配" 警告')

  } catch (error: any) {
    console.error('❌ 测试过程出错:', error.message)
    process.exit(1)
  }

  process.exit(0)
}

main()
