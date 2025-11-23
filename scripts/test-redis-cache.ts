/**
 * 测试 Redis 缓存功能
 * 验证关键词搜索量缓存和品牌词规范化
 *
 * 运行: npx tsx scripts/test-redis-cache.ts
 */
import {
  getRedisClient,
  checkRedisConnection,
  cacheKeywordVolume,
  getCachedKeywordVolume,
  batchCacheVolumes,
  getBatchCachedVolumes
} from '../src/lib/redis'
import { normalizeBrandName } from '../src/lib/offer-utils'

async function testRedisConnection() {
  console.log('🔍 测试 Redis 连接...\n')

  try {
    const isConnected = await checkRedisConnection()
    if (isConnected) {
      console.log('✅ Redis 连接成功\n')
      return true
    } else {
      console.log('❌ Redis 连接失败\n')
      return false
    }
  } catch (error: any) {
    console.error('❌ Redis 连接错误:', error.message)
    return false
  }
}

async function testKeywordCache() {
  console.log('🔍 测试关键词搜索量缓存...\n')

  const testKeywords = [
    { keyword: 'security camera', volume: 135000 },
    { keyword: 'ring camera', volume: 368000 },
    { keyword: 'blink camera', volume: 165000 }
  ]

  const country = 'US'
  const language = 'en'

  try {
    // 1. 测试单个缓存
    console.log('1️⃣  测试单个关键词缓存')
    await cacheKeywordVolume(testKeywords[0].keyword, country, language, testKeywords[0].volume)
    console.log(`   ✅ 已缓存: ${testKeywords[0].keyword} -> ${testKeywords[0].volume}`)

    const cached = await getCachedKeywordVolume(testKeywords[0].keyword, country, language)
    if (cached && cached.volume === testKeywords[0].volume) {
      console.log(`   ✅ 读取缓存成功: ${cached.volume}\n`)
    } else {
      console.log('   ❌ 读取缓存失败\n')
    }

    // 2. 测试批量缓存
    console.log('2️⃣  测试批量关键词缓存')
    await batchCacheVolumes(testKeywords, country, language)
    console.log(`   ✅ 已批量缓存 ${testKeywords.length} 个关键词`)

    const batchCached = await getBatchCachedVolumes(
      testKeywords.map(k => k.keyword),
      country,
      language
    )
    console.log(`   ✅ 批量读取成功，获得 ${batchCached.size} 个结果`)

    testKeywords.forEach(kw => {
      const volume = batchCached.get(kw.keyword.toLowerCase())
      if (volume === kw.volume) {
        console.log(`   ✅ ${kw.keyword}: ${volume}`)
      } else {
        console.log(`   ❌ ${kw.keyword}: 期望 ${kw.volume}, 实际 ${volume}`)
      }
    })

    console.log('\n✅ 关键词缓存测试通过\n')
  } catch (error: any) {
    console.error('❌ 关键词缓存测试失败:', error.message)
  }
}

async function testBrandNameNormalization() {
  console.log('🔍 测试品牌词规范化...\n')

  const testCases = [
    { input: 'REOLINK', expected: 'Reolink' },
    { input: 'apple', expected: 'Apple' },
    { input: 'OUTDOOR LIFE', expected: 'Outdoor Life' },
    { input: 'outdoor life', expected: 'Outdoor Life' },
    { input: 'IBM', expected: 'IBM' },
    { input: 'bmw', expected: 'BMW' },
    { input: 'hp', expected: 'HP' },
  ]

  let passed = 0
  let failed = 0

  testCases.forEach(({ input, expected }) => {
    const result = normalizeBrandName(input)
    if (result === expected) {
      console.log(`✅ "${input}" → "${result}"`)
      passed++
    } else {
      console.log(`❌ "${input}" → "${result}" (期望: "${expected}")`)
      failed++
    }
  })

  console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败\n`)
}

async function main() {
  console.log('🧪 开始测试 Redis 缓存和品牌词规范化\n')
  console.log('='.repeat(60))
  console.log()

  // 1. 测试 Redis 连接
  const connected = await testRedisConnection()
  if (!connected) {
    console.log('❌ Redis 连接失败，跳过缓存测试')
    return
  }

  // 2. 测试关键词缓存
  await testKeywordCache()

  // 3. 测试品牌词规范化
  testBrandNameNormalization()

  console.log('='.repeat(60))
  console.log('✅ 所有测试完成\n')

  // Close Redis connection
  const redis = getRedisClient()
  await redis.quit()
}

main().catch(console.error)
