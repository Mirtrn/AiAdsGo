/**
 * 真实场景测试：完整的Offer提取流程（P0优化验证）
 */

import { extractOffer } from '../src/lib/offer-extraction-core'

async function testRealScenario() {
  console.log('🧪 P0优化真实场景测试：完整Offer提取流程\n')

  // 使用之前测试成功的Amazon链接
  const testUrl = 'https://www.amazon.com/dp/B0CX59V1C8'
  const targetCountry = 'US'

  console.log(`📍 Test URL: ${testUrl}`)
  console.log(`🌍 Target Country: ${targetCountry}\n`)

  // 测试1：使用P0优化（代理池 + 浏览器复用）
  console.log('═══════════════════════════════════════════')
  console.log('Test 1: WITH P0 Optimizations')
  console.log('- 代理池预热缓存（节省3-5s）')
  console.log('- 浏览器实例复用（节省5-10s）')
  console.log('═══════════════════════════════════════════\n')

  const start1 = Date.now()

  try {
    const result1 = await extractOffer({
      affiliateLink: testUrl,
      targetCountry,
    })

    const time1 = Date.now() - start1
    console.log(`\n✅ Test 1 Success: ${(time1/1000).toFixed(1)}s`)
    console.log(`   Product: ${result1.offer?.productName || 'N/A'}`)
    console.log(`   Brand: ${result1.offer?.brand || 'N/A'}`)
    console.log(`   Final URL: ${result1.offer?.finalUrl?.substring(0, 80) || 'N/A'}...`)
    console.log(`\n⏱️  Baseline (之前测试): 64s`)
    console.log(`⏱️  Current (P0优化): ${(time1/1000).toFixed(1)}s`)
    console.log(`📈 Performance Gain: ${((64 - time1/1000) / 64 * 100).toFixed(1)}% faster`)

    if (time1/1000 <= 50) {
      console.log(`✅ 达到预期目标 (45-50s)！`)
    } else {
      console.log(`⚠️  接近但未达到目标 (45-50s)，继续优化`)
    }
  } catch (error: any) {
    const time1 = Date.now() - start1
    console.log(`\n❌ Test 1 Failed: ${(time1/1000).toFixed(1)}s`)
    console.log(`   Error: ${error.message}`)
  }

  console.log('\n═══════════════════════════════════════════')
  console.log('📊 Performance Summary')
  console.log('═══════════════════════════════════════════')
  console.log('P0 Optimization #1: 代理池预热缓存 ✅')
  console.log('  - 状态: 已实现并集成')
  console.log('  - 预期: 节省3-5s (跳过健康检查)')
  console.log('')
  console.log('P0 Optimization #2: 浏览器实例复用 ✅')
  console.log('  - 状态: 已启用 (USE_POOL = true)')
  console.log('  - 预期: 节省5-10s (跳过浏览器启动)')
  console.log('')
  console.log('Combined Expected Gain: 8-15s (64s → 45-50s)')
}

testRealScenario().then(() => {
  console.log('\n✅ Test complete')
  process.exit(0)
}).catch((error) => {
  console.error('\n❌ Test failed:', error)
  process.exit(1)
})
