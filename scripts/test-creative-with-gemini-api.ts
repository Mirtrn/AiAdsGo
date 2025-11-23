/**
 * 使用Gemini API生成多个广告创意并分析耗时
 * （autoads用户配置）
 */

import { findOfferById } from '../src/lib/offers'
import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { createAdCreative } from '../src/lib/ad-creative'
import { evaluateCreativeAdStrength } from '../src/lib/scoring'
import { findUserByUsername } from '../src/lib/auth'

interface TimingRecord {
  step: string
  duration: number
  details?: string
}

interface CreativeResult {
  creativeId: number
  round: number
  totalDuration: number
  timings: TimingRecord[]
  rating: string
  score: number
}

function createTimer() {
  const start = process.hrtime.bigint()
  return {
    elapsed: () => Number(process.hrtime.bigint() - start) / 1_000_000
  }
}

async function generateSingleCreative(
  offerId: number,
  userId: number,
  round: number,
  offer: any
): Promise<CreativeResult> {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`🎨 第 ${round} 次创意生成`)
  console.log(`${'═'.repeat(60)}`)

  const timings: TimingRecord[] = []
  const totalTimer = createTimer()

  // Step 1: AI生成创意
  console.log('📝 Step 1: AI生成创意...')
  let stepTimer = createTimer()

  const creative = await generateAdCreative(offerId, userId, {
    skipCache: round > 1
  })

  const aiDuration = stepTimer.elapsed()
  timings.push({
    step: 'AI生成创意',
    duration: aiDuration,
    details: `H:${creative.headlines.length} D:${creative.descriptions.length} K:${creative.keywords.length}`
  })
  console.log(`   ✅ ${aiDuration.toFixed(0)}ms`)
  console.log(`      - Headlines: ${creative.headlines.length}`)
  console.log(`      - Descriptions: ${creative.descriptions.length}`)
  console.log(`      - Keywords: ${creative.keywords.length}`)

  // Step 2: Ad Strength评估
  console.log('📊 Step 2: Ad Strength评估...')
  stepTimer = createTimer()

  const headlinesWithMetadata = creative.headlinesWithMetadata || creative.headlines.map(text => ({
    text,
    length: text.length
  }))
  const descriptionsWithMetadata = creative.descriptionsWithMetadata || creative.descriptions.map(text => ({
    text,
    length: text.length
  }))

  const evaluation = await evaluateCreativeAdStrength(
    headlinesWithMetadata,
    descriptionsWithMetadata,
    creative.keywords
  )

  const evalDuration = stepTimer.elapsed()
  timings.push({
    step: 'Ad Strength评估',
    duration: evalDuration,
    details: `${evaluation.finalRating} (${evaluation.finalScore}分)`
  })
  console.log(`   ✅ ${evalDuration.toFixed(0)}ms - ${evaluation.finalRating} (${evaluation.finalScore}分)`)

  // Step 3: 保存到数据库
  console.log('💾 Step 3: 保存到数据库...')
  stepTimer = createTimer()

  const savedCreative = createAdCreative(userId, offerId, {
    headlines: creative.headlines,
    descriptions: creative.descriptions,
    keywords: creative.keywords,
    keywordsWithVolume: creative.keywordsWithVolume,
    callouts: creative.callouts,
    sitelinks: creative.sitelinks,
    theme: creative.theme,
    explanation: creative.explanation,
    final_url: offer.final_url || offer.url,
    final_url_suffix: offer.final_url_suffix || undefined,
    score: evaluation.finalScore,
    score_breakdown: {
      relevance: evaluation.localEvaluation.dimensions.relevance.score,
      quality: evaluation.localEvaluation.dimensions.quality.score,
      engagement: evaluation.localEvaluation.dimensions.completeness.score,
      diversity: evaluation.localEvaluation.dimensions.diversity.score,
      clarity: evaluation.localEvaluation.dimensions.compliance.score
    },
    generation_round: round
  })

  const dbDuration = stepTimer.elapsed()
  timings.push({
    step: '数据库保存',
    duration: dbDuration,
    details: `ID: ${savedCreative.id}`
  })
  console.log(`   ✅ ${dbDuration.toFixed(0)}ms - Creative ID: ${savedCreative.id}`)

  const totalDuration = totalTimer.elapsed()

  return {
    creativeId: savedCreative.id,
    round,
    totalDuration,
    timings,
    rating: evaluation.finalRating,
    score: evaluation.finalScore
  }
}

async function main() {
  const OFFER_ID = 49
  const NUM_CREATIVES = 3

  console.log('═'.repeat(70))
  console.log('🚀 广告创意生成耗时分析（使用autoads配置）')
  console.log('═'.repeat(70))

  // 获取autoads用户
  console.log('\n🔐 验证用户身份...')
  const user = findUserByUsername('autoads')
  if (!user) {
    throw new Error('用户 autoads 不存在')
  }
  console.log(`   ✅ 用户: ${user.username} (ID: ${user.id})`)

  // 获取Offer信息
  console.log('\n📦 获取Offer信息...')
  const offer = findOfferById(OFFER_ID, user.id)
  if (!offer) {
    throw new Error(`Offer #${OFFER_ID} 不存在`)
  }
  console.log(`   ✅ 品牌: ${offer.brand}`)
  console.log(`   ✅ URL: ${offer.url}`)

  // 生成创意
  const results: CreativeResult[] = []
  const overallTimer = createTimer()

  for (let i = 1; i <= NUM_CREATIVES; i++) {
    try {
      const result = await generateSingleCreative(OFFER_ID, user.id, i, offer)
      results.push(result)

      if (i < NUM_CREATIVES) {
        console.log('\n⏳ 等待1秒后继续...')
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } catch (error: any) {
      console.error(`\n❌ 第${i}次生成失败:`, error.message)
      break
    }
  }

  const overallDuration = overallTimer.elapsed()

  if (results.length === 0) {
    console.error('\n❌ 所有创意生成均失败')
    return
  }

  // 分析报告
  console.log('\n\n' + '═'.repeat(70))
  console.log('📈 耗时分析报告')
  console.log('═'.repeat(70))

  console.log('\n📋 基本信息:')
  console.log(`   Offer: ${offer.brand} (#${OFFER_ID})`)
  console.log(`   成功生成: ${results.length}/${NUM_CREATIVES}`)
  console.log(`   总耗时: ${(overallDuration / 1000).toFixed(2)}秒`)

  console.log('\n📊 单次生成统计:')
  console.log('─'.repeat(70))
  console.log('序号'.padEnd(8) + '耗时(ms)'.padStart(12) + '评级'.padStart(12) + '分数'.padStart(8))
  console.log('─'.repeat(70))

  results.forEach(r => {
    console.log(
      `#${r.round}`.padEnd(8) +
      r.totalDuration.toFixed(0).padStart(12) +
      r.rating.padStart(12) +
      r.score.toString().padStart(8)
    )
  })

  // 步骤耗时分布
  console.log('\n📊 步骤耗时分布:')
  console.log('─'.repeat(70))

  const stepStats: Map<string, number[]> = new Map()
  results.forEach(r => {
    r.timings.forEach(t => {
      if (!stepStats.has(t.step)) {
        stepStats.set(t.step, [])
      }
      stepStats.get(t.step)!.push(t.duration)
    })
  })

  const totalAvgTime = results.reduce((sum, r) => sum + r.totalDuration, 0) / results.length

  console.log('步骤'.padEnd(25) + '平均(ms)'.padStart(12) + '最小'.padStart(10) + '最大'.padStart(10) + '占比'.padStart(10))
  console.log('─'.repeat(70))

  const stepAnalysis: { step: string; avg: number; pct: number }[] = []

  stepStats.forEach((durations, step) => {
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length
    const min = Math.min(...durations)
    const max = Math.max(...durations)
    const pct = (avg / totalAvgTime) * 100

    stepAnalysis.push({ step, avg, pct })

    const bar = '█'.repeat(Math.round(pct / 5))
    console.log(
      step.padEnd(25) +
      avg.toFixed(0).padStart(12) +
      min.toFixed(0).padStart(10) +
      max.toFixed(0).padStart(10) +
      `${pct.toFixed(1)}%`.padStart(10) +
      ` ${bar}`
    )
  })

  console.log('─'.repeat(70))
  console.log('总计'.padEnd(25) + totalAvgTime.toFixed(0).padStart(12) + ''.padStart(20) + '100.0%'.padStart(10))

  // 瓶颈分析
  console.log('\n🔴 性能瓶颈分析:')
  stepAnalysis.sort((a, b) => b.avg - a.avg)

  stepAnalysis.forEach((s, i) => {
    if (i === 0) {
      console.log(`   🔴 主要瓶颈: ${s.step} (${s.pct.toFixed(1)}%)`)
    } else if (s.pct > 10) {
      console.log(`   🟡 次要瓶颈: ${s.step} (${s.pct.toFixed(1)}%)`)
    }
  })

  // 优化建议
  console.log('\n💡 优化建议:')
  const aiStep = stepAnalysis.find(s => s.step.includes('AI'))

  if (aiStep && aiStep.pct > 60) {
    console.log('\n   🤖 AI生成优化:')
    console.log(`      当前占比: ${aiStep.pct.toFixed(1)}%`)
    console.log('      建议1: 切换到gemini-2.5-flash模型（速度提升2-3倍）')
    console.log('      建议2: 精简Prompt（减少20-30% token）')
    console.log('      建议3: 并行生成多个创意变体')

    const estimatedFlashTime = aiStep.avg * 0.35
    const estimatedTotal = totalAvgTime - aiStep.avg + estimatedFlashTime
    console.log(`\n      预期效果: ${totalAvgTime.toFixed(0)}ms → ${estimatedTotal.toFixed(0)}ms`)
    console.log(`      预期提升: ${((1 - estimatedTotal / totalAvgTime) * 100).toFixed(0)}%`)
  }

  console.log('\n✅ 分析完成！')
}

main().catch(error => {
  console.error('\n❌ 执行失败:', error.message)
  process.exit(1)
})
