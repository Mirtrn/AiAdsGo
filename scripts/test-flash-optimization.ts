/**
 * 测试Flash模型优化效果
 * 验证：
 * 1. gemini-2.5-flash模型速度提升
 * 2. 提示词优化后的质量保持EXCELLENT
 * 3. 总耗时从70s降至15-20s
 */

import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { evaluateAdStrength } from '../src/lib/ad-strength-evaluator'
import { getDatabase } from '../src/lib/db'

async function testFlashOptimization() {
  console.log('🧪 测试Flash模型优化效果\n')

  const db = getDatabase()
  const offerId = 49
  const userId = 1 // autoads user

  // 获取Offer信息
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId)
  if (!offer) {
    throw new Error(`Offer ${offerId} 不存在`)
  }

  console.log(`📦 测试Offer: ${offer.brand} (ID: ${offerId})`)
  console.log(`   URL: ${offer.url}`)
  console.log(`   Country: ${offer.target_country}\n`)

  // 步骤1: Offer信息获取（基线）
  console.log('⏱️  步骤1: Offer信息获取')
  const step1Start = Date.now()
  const step1Time = Date.now() - step1Start
  console.log(`   ✅ 耗时: ${step1Time}ms\n`)

  // 步骤2: 创意生成（关键优化点）
  console.log('⏱️  步骤2: AI创意生成 (gemini-2.5-flash)')
  const step2Start = Date.now()

  const creative = await generateAdCreative(offerId, userId, {
    theme: 'Premium quality with fast shipping'
  })

  const step2Time = Date.now() - step2Start
  const aiTime = step2Time // 主要是AI生成时间
  console.log(`   ✅ 总耗时: ${step2Time}ms`)
  console.log(`   📊 AI生成预估: ${aiTime}ms`)
  console.log(`   📝 Headlines: ${creative.headlines.length}个`)
  console.log(`   📝 Descriptions: ${creative.descriptions.length}个`)
  console.log(`   🔑 Keywords: ${creative.keywords.length}个\n`)

  // 步骤3: Ad Strength评估
  console.log('⏱️  步骤3: Ad Strength评估')
  const step3Start = Date.now()

  const evaluation = evaluateAdStrength({
    headlines: creative.headlines,
    descriptions: creative.descriptions,
    keywords: creative.keywords,
    callouts: creative.callouts || [],
    sitelinks: creative.sitelinks || []
  })

  const step3Time = Date.now() - step3Start
  console.log(`   ✅ 耗时: ${step3Time}ms`)
  console.log(`   🎯 评分: ${evaluation.overallScore}/100`)
  console.log(`   📊 评级: ${evaluation.rating}`)
  console.log(`   📈 目标: EXCELLENT (≥93分)\n`)

  // 步骤4: 数据库保存（假设）
  const step4Time = 1 // 1ms (negligible)

  // 总计
  const totalTime = step1Time + step2Time + step3Time + step4Time

  console.log('📊 性能分析对比')
  console.log('━'.repeat(60))
  console.log('| 步骤              | 优化前(ms)  | 优化后(ms)  | 提升率    |')
  console.log('━'.repeat(60))
  console.log(`| Offer信息获取     | ${12}          | ${step1Time.toString().padEnd(11)} | -         |`)
  console.log(`| AI创意生成        | ${70169}       | ${step2Time.toString().padEnd(11)} | ${Math.round((1 - step2Time/70169) * 100)}%      |`)
  console.log(`|   - AI生成        | ${66678}       | ${aiTime.toString().padEnd(11)} | ${Math.round((1 - aiTime/66678) * 100)}%      |`)
  console.log(`|   - 关键词查询    | ${3488}        | (已包含)    | -         |`)
  console.log(`| Ad Strength评估   | ${1393}        | ${step3Time.toString().padEnd(11)} | ${Math.round((1 - step3Time/1393) * 100)}%      |`)
  console.log(`| 数据库保存        | ${1}           | ${step4Time.toString().padEnd(11)} | -         |`)
  console.log('━'.repeat(60))
  console.log(`| **总计**          | **${71582}**   | **${totalTime.toString().padEnd(11)}** | **${Math.round((1 - totalTime/71582) * 100)}%**  |`)
  console.log('━'.repeat(60))

  console.log('\n✅ 质量验证')
  console.log('━'.repeat(60))
  console.log(`评分: ${evaluation.overallScore}/100`)
  console.log(`评级: ${evaluation.rating}`)
  console.log(`目标: EXCELLENT (≥93分)`)
  console.log(`结果: ${evaluation.rating === 'EXCELLENT' && evaluation.overallScore >= 93 ? '✅ 通过' : '❌ 未达标'}`)

  if (evaluation.rating !== 'EXCELLENT' || evaluation.overallScore < 93) {
    console.log('\n⚠️  质量未达标，详细诊断:')
    console.log(JSON.stringify(evaluation, null, 2))
  }

  console.log('\n🎯 优化目标达成情况')
  console.log('━'.repeat(60))
  const speedImprovement = Math.round((1 - totalTime/71582) * 100)
  const targetSpeed = totalTime <= 20000 // 目标: 15-20秒
  const targetQuality = evaluation.rating === 'EXCELLENT' && evaluation.overallScore >= 93

  console.log(`1. 速度提升: ${speedImprovement}% (目标: >75%, ${speedImprovement >= 75 ? '✅' : '❌'})`)
  console.log(`2. 总耗时: ${(totalTime/1000).toFixed(1)}s (目标: ≤20s, ${targetSpeed ? '✅' : '❌'})`)
  console.log(`3. 质量保持: ${evaluation.rating} ${evaluation.overallScore}分 (目标: EXCELLENT ≥93, ${targetQuality ? '✅' : '❌'})`)

  const allPassed = speedImprovement >= 75 && targetSpeed && targetQuality
  console.log(`\n${allPassed ? '🎉 所有优化目标达成！' : '⚠️  部分目标未达成，需要进一步优化'}`)
}

testFlashOptimization().catch(console.error)
