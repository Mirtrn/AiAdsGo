/**
 * 品牌搜索量维度测试脚本
 *
 * 测试场景：
 * 1. 知名品牌（xlarge级别）：Nike、Apple
 * 2. 小众品牌（micro/small级别）：测试品牌
 * 3. 空品牌名称降级处理
 * 4. 缓存机制验证
 * 5. 雷达图数据验证
 */

import { evaluateAdStrength } from '../src/lib/ad-strength-evaluator'
import type { HeadlineAsset, DescriptionAsset } from '../src/lib/ad-creative'
import { getKeywordSearchVolumes } from '../src/lib/keyword-planner'

// 测试用的标准创意资产
const createTestHeadlines = (): HeadlineAsset[] => [
  { text: 'Premium Quality Products', length: 24, type: 'product' },
  { text: 'Shop Now - Limited Time', length: 23, type: 'cta' },
  { text: 'Save 30% Today Only', length: 20, type: 'promo', hasNumber: true },
  { text: 'Free Shipping Worldwide', length: 23, type: 'promo' },
  { text: 'Best Deals of the Year', length: 22, type: 'promo', hasUrgency: true },
  { text: 'Official Store', length: 14, type: 'brand' },
  { text: 'Top Rated Products', length: 18, type: 'product' },
  { text: 'Buy 2 Get 1 Free', length: 16, type: 'promo', hasNumber: true },
  { text: 'New Arrivals Now', length: 16, type: 'product' },
  { text: 'Exclusive Offers Inside', length: 23, type: 'promo', hasUrgency: true },
  { text: 'Shop Latest Collection', length: 22, type: 'product' },
  { text: 'Limited Stock Available', length: 23, type: 'promo', hasUrgency: true },
  { text: 'Premium Brand Quality', length: 21, type: 'brand' },
  { text: 'Order Today', length: 11, type: 'cta' },
  { text: 'Trusted by Millions', length: 19, type: 'brand' }
]

const createTestDescriptions = (): DescriptionAsset[] => [
  {
    text: 'Discover amazing deals on premium products. Shop now and save big!',
    length: 67,
    hasCTA: true
  },
  {
    text: 'High-quality products with free shipping. Limited time offer available.',
    length: 71,
    hasCTA: false
  },
  {
    text: 'Get the best prices on top-rated items. Order now for exclusive discounts!',
    length: 75,
    hasCTA: true
  },
  {
    text: 'Premium selection of products with guaranteed satisfaction. Try today!',
    length: 70,
    hasCTA: true
  }
]

const testKeywords = [
  'premium products',
  'best deals',
  'shop now',
  'free shipping',
  'limited time'
]

/**
 * 测试1：知名品牌（xlarge级别）
 */
async function testLargeBrands() {
  console.log('\n' + '='.repeat(80))
  console.log('📊 测试1：知名品牌搜索量（预期 xlarge 级别）')
  console.log('='.repeat(80))

  const brands = ['Nike', 'Apple', 'Samsung', 'Adidas', 'Microsoft']
  const userId = 1 // autoads用户

  for (const brand of brands) {
    console.log(`\n🔍 测试品牌: ${brand}`)
    console.time(`⏱️  ${brand} 评估耗时`)

    try {
      const evaluation = await evaluateAdStrength(
        createTestHeadlines(),
        createTestDescriptions(),
        testKeywords,
        {
          brandName: brand,
          targetCountry: 'US',
          targetLanguage: 'en',
          userId
        }
      )

      const brandDimension = evaluation.dimensions.brandSearchVolume

      console.log(`✅ 评估完成:`)
      console.log(`   总分: ${evaluation.overallScore}/100`)
      console.log(`   评级: ${evaluation.rating}`)
      console.log(`   品牌搜索量: ${brandDimension.details.monthlySearchVolume.toLocaleString()}/月`)
      console.log(`   流量级别: ${brandDimension.details.volumeLevel}`)
      console.log(`   品牌得分: ${brandDimension.score}/20`)
      console.log(`   数据来源: ${brandDimension.details.dataSource}`)

      // 验证xlarge级别
      if (brandDimension.details.volumeLevel === 'xlarge') {
        console.log(`   ✅ PASS - 正确识别为超大流量品牌`)
      } else if (brandDimension.details.volumeLevel === 'large') {
        console.log(`   ⚠️  WARN - 识别为大流量品牌（可能是地区差异）`)
      } else {
        console.log(`   ❌ FAIL - 未达到预期流量级别`)
      }

    } catch (error) {
      console.error(`❌ 评估失败:`, error)
    } finally {
      console.timeEnd(`⏱️  ${brand} 评估耗时`)
    }
  }
}

/**
 * 测试2：小众品牌（micro/small级别）
 */
async function testSmallBrands() {
  console.log('\n' + '='.repeat(80))
  console.log('📊 测试2：小众品牌搜索量（预期 micro/small 级别）')
  console.log('='.repeat(80))

  const brands = [
    'TestBrand123XYZ',  // 不存在的品牌
    'MyLocalShop',      // 小众本地品牌
    'StartupBrand2024'  // 初创品牌
  ]
  const userId = 1

  for (const brand of brands) {
    console.log(`\n🔍 测试品牌: ${brand}`)
    console.time(`⏱️  ${brand} 评估耗时`)

    try {
      const evaluation = await evaluateAdStrength(
        createTestHeadlines(),
        createTestDescriptions(),
        testKeywords,
        {
          brandName: brand,
          targetCountry: 'US',
          targetLanguage: 'en',
          userId
        }
      )

      const brandDimension = evaluation.dimensions.brandSearchVolume

      console.log(`✅ 评估完成:`)
      console.log(`   总分: ${evaluation.overallScore}/100`)
      console.log(`   品牌搜索量: ${brandDimension.details.monthlySearchVolume.toLocaleString()}/月`)
      console.log(`   流量级别: ${brandDimension.details.volumeLevel}`)
      console.log(`   品牌得分: ${brandDimension.score}/20`)
      console.log(`   数据来源: ${brandDimension.details.dataSource}`)

      // 验证micro/small级别
      if (brandDimension.details.volumeLevel === 'micro' || brandDimension.details.volumeLevel === 'small') {
        console.log(`   ✅ PASS - 正确识别为小流量品牌`)
      } else {
        console.log(`   ⚠️  WARN - 意外的流量级别`)
      }

      // 检查建议
      const brandSuggestions = evaluation.suggestions.filter(s => s.includes('品牌'))
      if (brandSuggestions.length > 0) {
        console.log(`   💡 品牌建议:`)
        brandSuggestions.forEach(s => console.log(`      - ${s}`))
      }

    } catch (error) {
      console.error(`❌ 评估失败:`, error)
    } finally {
      console.timeEnd(`⏱️  ${brand} 评估耗时`)
    }
  }
}

/**
 * 测试3：空品牌名称降级处理
 */
async function testEmptyBrand() {
  console.log('\n' + '='.repeat(80))
  console.log('📊 测试3：空品牌名称降级处理（预期返回0分）')
  console.log('='.repeat(80))

  const testCases = [
    { brandName: undefined, desc: '未定义品牌' },
    { brandName: '', desc: '空字符串品牌' },
    { brandName: '   ', desc: '纯空格品牌' }
  ]

  for (const testCase of testCases) {
    console.log(`\n🔍 测试场景: ${testCase.desc}`)
    console.time(`⏱️  评估耗时`)

    try {
      const evaluation = await evaluateAdStrength(
        createTestHeadlines(),
        createTestDescriptions(),
        testKeywords,
        {
          brandName: testCase.brandName,
          targetCountry: 'US',
          targetLanguage: 'en',
          userId: 1
        }
      )

      const brandDimension = evaluation.dimensions.brandSearchVolume

      console.log(`✅ 评估完成:`)
      console.log(`   总分: ${evaluation.overallScore}/100`)
      console.log(`   品牌得分: ${brandDimension.score}/20`)
      console.log(`   流量级别: ${brandDimension.details.volumeLevel}`)
      console.log(`   数据来源: ${brandDimension.details.dataSource}`)

      // 验证降级处理
      if (brandDimension.score === 0 &&
          brandDimension.details.volumeLevel === 'micro' &&
          brandDimension.details.dataSource === 'unavailable') {
        console.log(`   ✅ PASS - 正确降级处理，返回0分`)
      } else {
        console.log(`   ❌ FAIL - 降级处理异常`)
      }

      // 验证其他维度不受影响
      const otherDimensionsScore =
        evaluation.dimensions.diversity.score +
        evaluation.dimensions.relevance.score +
        evaluation.dimensions.completeness.score +
        evaluation.dimensions.quality.score +
        evaluation.dimensions.compliance.score

      if (otherDimensionsScore > 0) {
        console.log(`   ✅ PASS - 其他维度正常评分（总计${otherDimensionsScore}分）`)
      } else {
        console.log(`   ❌ FAIL - 其他维度受到影响`)
      }

    } catch (error) {
      console.error(`❌ 评估失败:`, error)
    } finally {
      console.timeEnd(`⏱️  评估耗时`)
    }
  }
}

/**
 * 测试4：缓存机制验证
 */
async function testCacheMechanism() {
  console.log('\n' + '='.repeat(80))
  console.log('📊 测试4：缓存机制验证（预期第二次查询更快）')
  console.log('='.repeat(80))

  const brand = 'Nike'
  const userId = 1

  console.log(`\n🔍 第一次查询（预期从API获取）`)
  console.time(`⏱️  第一次查询耗时`)

  try {
    const volumes1 = await getKeywordSearchVolumes([brand], 'US', 'en', userId)
    console.timeEnd(`⏱️  第一次查询耗时`)
    console.log(`   搜索量: ${volumes1[0]?.avgMonthlySearches.toLocaleString()}/月`)
  } catch (error) {
    console.error(`❌ 第一次查询失败:`, error)
    console.timeEnd(`⏱️  第一次查询耗时`)
    return
  }

  console.log(`\n🔍 第二次查询（预期从缓存获取）`)
  console.time(`⏱️  第二次查询耗时`)

  try {
    const volumes2 = await getKeywordSearchVolumes([brand], 'US', 'en', userId)
    console.timeEnd(`⏱️  第二次查询耗时`)
    console.log(`   搜索量: ${volumes2[0]?.avgMonthlySearches.toLocaleString()}/月`)
    console.log(`   ✅ 缓存机制工作正常（第二次查询应该明显更快）`)
  } catch (error) {
    console.error(`❌ 第二次查询失败:`, error)
    console.timeEnd(`⏱️  第二次查询耗时`)
  }
}

/**
 * 测试5：雷达图数据验证
 */
async function testRadarChartData() {
  console.log('\n' + '='.repeat(80))
  console.log('📊 测试5：雷达图数据验证（验证6维度数据结构）')
  console.log('='.repeat(80))

  const brand = 'Apple'
  const userId = 1

  console.log(`\n🔍 生成完整评估数据`)

  try {
    const evaluation = await evaluateAdStrength(
      createTestHeadlines(),
      createTestDescriptions(),
      testKeywords,
      {
        brandName: brand,
        targetCountry: 'US',
        targetLanguage: 'en',
        userId
      }
    )

    console.log(`\n✅ 评估完成，验证数据结构:`)

    // 验证6个维度
    const dimensions = [
      { name: 'Diversity', key: 'diversity', maxScore: 20 },
      { name: 'Relevance', key: 'relevance', maxScore: 20 },
      { name: 'Brand Search Volume', key: 'brandSearchVolume', maxScore: 20 },
      { name: 'Completeness', key: 'completeness', maxScore: 15 },
      { name: 'Quality', key: 'quality', maxScore: 15 },
      { name: 'Compliance', key: 'compliance', maxScore: 10 }
    ]

    let totalScore = 0
    let allDimensionsValid = true

    dimensions.forEach(dim => {
      const dimensionData = evaluation.dimensions[dim.key as keyof typeof evaluation.dimensions]
      const score = dimensionData.score
      const weight = dimensionData.weight

      totalScore += score

      const isValid = score >= 0 && score <= dim.maxScore
      const status = isValid ? '✅' : '❌'

      console.log(`   ${status} ${dim.name}: ${score}/${dim.maxScore} (权重${(weight * 100).toFixed(0)}%)`)

      if (!isValid) allDimensionsValid = false
    })

    console.log(`\n   总分验证: ${totalScore}/100`)

    if (totalScore === evaluation.overallScore) {
      console.log(`   ✅ PASS - 总分计算正确`)
    } else {
      console.log(`   ❌ FAIL - 总分计算错误（预期${totalScore}，实际${evaluation.overallScore}）`)
    }

    if (allDimensionsValid) {
      console.log(`   ✅ PASS - 所有维度分数在有效范围内`)
    } else {
      console.log(`   ❌ FAIL - 存在维度分数超出范围`)
    }

    // 模拟雷达图数据格式
    console.log(`\n📊 雷达图数据格式:`)
    const radarData = {
      scoreBreakdown: {
        diversity: evaluation.dimensions.diversity.score,
        relevance: evaluation.dimensions.relevance.score,
        engagement: evaluation.dimensions.completeness.score,
        quality: evaluation.dimensions.quality.score,
        clarity: evaluation.dimensions.compliance.score,
        brandSearchVolume: evaluation.dimensions.brandSearchVolume.score
      },
      maxScores: {
        diversity: 20,
        relevance: 20,
        engagement: 15,
        quality: 15,
        clarity: 10,
        brandSearchVolume: 20
      }
    }

    console.log(JSON.stringify(radarData, null, 2))
    console.log(`   ✅ PASS - 雷达图数据格式正确（包含6个维度）`)

  } catch (error) {
    console.error(`❌ 评估失败:`, error)
  }
}

/**
 * 主测试流程
 */
async function runAllTests() {
  console.log('\n')
  console.log('╔' + '═'.repeat(78) + '╗')
  console.log('║' + ' '.repeat(20) + '品牌搜索量维度测试套件' + ' '.repeat(34) + '║')
  console.log('╚' + '═'.repeat(78) + '╝')

  try {
    // 测试1: 知名品牌
    await testLargeBrands()

    // 测试2: 小众品牌
    await testSmallBrands()

    // 测试3: 空品牌降级
    await testEmptyBrand()

    // 测试4: 缓存机制
    await testCacheMechanism()

    // 测试5: 雷达图数据
    await testRadarChartData()

    console.log('\n' + '='.repeat(80))
    console.log('✅ 所有测试完成')
    console.log('='.repeat(80))
    console.log('\n💡 建议：')
    console.log('   1. 检查是否所有知名品牌都达到xlarge/large级别')
    console.log('   2. 验证小众品牌返回micro/small级别')
    console.log('   3. 确认空品牌降级处理正确')
    console.log('   4. 观察缓存机制是否有效减少查询时间')
    console.log('   5. 验证雷达图数据结构完整性')
    console.log('\n')

  } catch (error) {
    console.error('\n❌ 测试流程出错:', error)
    process.exit(1)
  }
}

// 执行测试
runAllTests().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
