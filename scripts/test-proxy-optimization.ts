/**
 * Test P0 Optimization: Proxy Pool + Browser Reuse
 *
 * This test measures extraction time with optimizations enabled
 */

import { resolveAffiliateLinkWithPlaywright } from '../src/lib/url-resolver-playwright'

async function testOptimization() {
  console.log('🧪 Testing P0 Optimizations: Proxy Pool + Browser Reuse\n')

  // Test Offer Link (from previous session)
  const testLink = 'https://collabs.shop.app/shop/product/66a9e0ee06e1764afa0ff18a'

  console.log(`📍 Test Link: ${testLink}\n`)

  // Test 1: With proxy pool (cache hit scenario)
  console.log('Test 1: With targetCountry (proxy pool attempt)')
  const start1 = Date.now()

  try {
    const result1 = await resolveAffiliateLinkWithPlaywright(
      testLink,
      undefined,
      5000,
      'US' // This triggers proxy pool lookup
    )
    const time1 = Date.now() - start1
    console.log(`✅ Success: ${(time1/1000).toFixed(1)}s`)
    console.log(`   Final URL: ${result1.finalUrl}`)
    console.log(`   Redirects: ${result1.redirectCount}`)
  } catch (error: any) {
    const time1 = Date.now() - start1
    console.log(`❌ Failed: ${(time1/1000).toFixed(1)}s - ${error.message}`)
  }

  console.log('')

  // Test 2: Without targetCountry (traditional flow)
  console.log('Test 2: Without targetCountry (traditional flow)')
  const start2 = Date.now()

  try {
    const result2 = await resolveAffiliateLinkWithPlaywright(
      testLink,
      undefined,
      5000
    )
    const time2 = Date.now() - start2
    console.log(`✅ Success: ${(time2/1000).toFixed(1)}s`)
    console.log(`   Final URL: ${result2.finalUrl}`)
    console.log(`   Redirects: ${result2.redirectCount}`)
  } catch (error: any) {
    const time2 = Date.now() - start2
    console.log(`❌ Failed: ${(time2/1000).toFixed(1)}s - ${error.message}`)
  }

  console.log('\n📊 Summary:')
  console.log('Both tests use browser instance reuse (P0 optimization #2)')
  console.log('Test 1 also attempts proxy pool cache (P0 optimization #1)')
  console.log('Proxy pool fallback gracefully to traditional getProxyIp if cache miss')
}

testOptimization().then(() => {
  console.log('\n✅ Test complete')
  process.exit(0)
}).catch((error) => {
  console.error('\n❌ Test failed:', error)
  process.exit(1)
})
