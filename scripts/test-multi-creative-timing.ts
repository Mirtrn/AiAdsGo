/**
 * 多创意生成耗时分析脚本
 *
 * 功能：
 * 1. 使用autoads用户身份
 * 2. 为offer 49生成多个广告创意
 * 3. 详细记录每个步骤的耗时
 * 4. 分析耗时分布并提出优化方案
 *
 * 运行: npx tsx scripts/test-multi-creative-timing.ts
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

interface CreativeGenerationResult {
  creativeId: number
  round: number
  totalDuration: number
  timings: TimingRecord[]
  rating: string
  score: number
  headlines: number
  descriptions: number
  keywords: number
}

interface AnalysisReport {
  offerId: number
  userId: number
  brand: string
  totalRuns: number
  results: CreativeGenerationResult[]
  aggregateAnalysis: {
    avgTotalTime: number
    minTotalTime: number
    maxTotalTime: number
    stepBreakdown: {
      step: string
      avgDuration: number
      percentage: number
      minDuration: number
      maxDuration: number
    }[]
  }
  bottlenecks: string[]
  optimizations: string[]
}

// 精确计时工具
function createTimer() {
  const start = process.hrtime.bigint()
  return {
    elapsed: () => Number(process.hrtime.bigint() - start) / 1_000_000 // 转换为毫秒
  }
}

async function generateSingleCreative(
  offerId: number,
  userId: number,
  round: number,
  offer: any
): Promise<CreativeGenerationResult> {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`🎨 第 ${round} 次创意生成`)
  console.log(`${'─'.repeat(60)}`)

  const timings: TimingRecord[] = []
  const totalTimer = createTimer()

  // Step 1: AI生成创意
  console.log('📝 Step 1: AI生成创意...')
  let stepTimer = createTimer()

  const creative = await generateAdCreative(offerId, userId, {
    skipCache: round > 1 // 第2次及以后跳过缓存
  })

  const aiDuration = stepTimer.elapsed()
  timings.push({
    step: 'AI生成创意',
    duration: aiDuration,
    details: `H:${creative.headlines.length} D:${creative.descriptions.length} K:${creative.keywords.length}`
  })
  console.log(`   ✅ ${aiDuration.toFixed(0)}ms - Headlines: ${creative.headlines.length}, Descriptions: ${creative.descriptions.length}`)

  // Step 2: 评估Ad Strength
  console.log('📊 Step 2: 评估Ad Strength...')
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
    score: evaluation.finalScore,
    headlines: creative.headlines.length,
    descriptions: creative.descriptions.length,
    keywords: creative.keywords.length
  }
}

async function main() {
  const OFFER_ID = 49
  const NUM_CREATIVES = 3 // 生成3个创意进行分析

  console.log('═'.repeat(70))
  console.log('🚀 多创意生成耗时分析')
  console.log('═'.repeat(70))
  console.log(`\n📋 配置:`)
  console.log(`   Offer ID: ${OFFER_ID}`)
  console.log(`   生成数量: ${NUM_CREATIVES}`)
  console.log(`   时间: ${new Date().toISOString()}`)

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
    throw new Error(`Offer #${OFFER_ID} 不存在或无权访问`)
  }
  console.log(`   ✅ 品牌: ${offer.brand}`)
  console.log(`   ✅ URL: ${offer.url}`)

  // 生成多个创意
  const results: CreativeGenerationResult[] = []
  const overallTimer = createTimer()

  for (let i = 1; i <= NUM_CREATIVES; i++) {
    const result = await generateSingleCreative(OFFER_ID, user.id, i, offer)
    results.push(result)

    // 生成之间等待1秒，避免API限流
    if (i < NUM_CREATIVES) {
      console.log('\n⏳ 等待1秒后继续...')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  const overallDuration = overallTimer.elapsed()

  // ═══════════════════════════════════════════════════════════════════
  // 分析报告
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n\n' + '═'.repeat(70))
  console.log('📈 耗时分析报告')
  console.log('═'.repeat(70))

  // 1. 基本信息
  console.log('\n📋 基本信息:')
  console.log(`   Offer: ${offer.brand} (#${OFFER_ID})`)
  console.log(`   用户: ${user.username} (ID: ${user.id})`)
  console.log(`   总生成次数: ${NUM_CREATIVES}`)
  console.log(`   总耗时: ${(overallDuration / 1000).toFixed(2)}秒`)

  // 2. 单次生成耗时统计
  console.log('\n📊 单次生成耗时统计:')
  console.log('─'.repeat(70))
  console.log('序号'.padEnd(8) + '总耗时(ms)'.padStart(12) + '评级'.padStart(12) + '分数'.padStart(8) + 'H'.padStart(4) + 'D'.padStart(4) + 'K'.padStart(4))
  console.log('─'.repeat(70))

  results.forEach(r => {
    console.log(
      `#${r.round}`.padEnd(8) +
      r.totalDuration.toFixed(0).padStart(12) +
      r.rating.padStart(12) +
      r.score.toString().padStart(8) +
      r.headlines.toString().padStart(4) +
      r.descriptions.toString().padStart(4) +
      r.keywords.toString().padStart(4)
    )
  })

  // 3. 步骤耗时分布
  console.log('\n📊 步骤耗时分布:')
  console.log('─'.repeat(70))

  // 聚合各步骤的耗时
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

  const stepAnalysis: { step: string; avg: number; min: number; max: number; pct: number }[] = []

  stepStats.forEach((durations, step) => {
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length
    const min = Math.min(...durations)
    const max = Math.max(...durations)
    const pct = (avg / totalAvgTime) * 100

    stepAnalysis.push({ step, avg, min, max, pct })

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
  console.log('总计'.padEnd(25) + totalAvgTime.toFixed(0).padStart(12) + ''.padStart(10) + ''.padStart(10) + '100.0%'.padStart(10))

  // 4. 瓶颈分析
  console.log('\n🔴 性能瓶颈:')

  // 按耗时排序
  stepAnalysis.sort((a, b) => b.avg - a.avg)

  const bottlenecks: string[] = []

  if (stepAnalysis[0].pct > 50) {
    const msg = `主要瓶颈: ${stepAnalysis[0].step} 占用 ${stepAnalysis[0].pct.toFixed(1)}% 时间 (平均 ${stepAnalysis[0].avg.toFixed(0)}ms)`
    bottlenecks.push(msg)
    console.log(`   🔴 ${msg}`)
  }

  if (stepAnalysis[0].max - stepAnalysis[0].min > stepAnalysis[0].avg * 0.5) {
    const msg = `性能不稳定: ${stepAnalysis[0].step} 耗时波动大 (${stepAnalysis[0].min.toFixed(0)}-${stepAnalysis[0].max.toFixed(0)}ms)`
    bottlenecks.push(msg)
    console.log(`   ⚠️ ${msg}`)
  }

  // 5. 详细优化建议
  console.log('\n💡 耗时优化方案:')
  console.log('─'.repeat(70))

  const aiStep = stepAnalysis.find(s => s.step.includes('AI生成'))
  const evalStep = stepAnalysis.find(s => s.step.includes('评估'))
  const dbStep = stepAnalysis.find(s => s.step.includes('数据库'))

  // AI生成优化
  if (aiStep && aiStep.pct > 60) {
    console.log('\n🤖 【优先级P0】AI生成优化 (占比最大):')
    console.log('   当前耗时: ' + aiStep.avg.toFixed(0) + 'ms (' + aiStep.pct.toFixed(1) + '%)')
    console.log('')
    console.log('   1. 模型选择优化:')
    console.log('      - 使用 gemini-1.5-flash 替代 gemini-1.5-pro')
    console.log('      - 预期提升: 2-3倍速度提升，质量损失<5%')
    console.log('      - 实现: 修改 src/lib/gemini.ts 中的模型配置')
    console.log('')
    console.log('   2. Prompt精简优化:')
    console.log('      - 精简系统提示词，减少不必要的示例')
    console.log('      - 使用JSON Mode替代XML格式输出')
    console.log('      - 预期提升: 20-30% token减少')
    console.log('')
    console.log('   3. 并行生成策略:')
    console.log('      - 同时发起多个AI请求，取最佳结果')
    console.log('      - 使用 Promise.allSettled 处理失败')
    console.log('      - 预期提升: 多变体场景下3倍吞吐量')
    console.log('')
    console.log('   4. 缓存策略优化:')
    console.log('      - 相似Offer复用已生成的创意模板')
    console.log('      - 基于品牌+品类的智能缓存key')
    console.log('      - 预期提升: 重复场景100%命中')
  }

  // Ad Strength评估优化
  if (evalStep && evalStep.avg > 500) {
    console.log('\n📊 【优先级P1】Ad Strength评估优化:')
    console.log('   当前耗时: ' + evalStep.avg.toFixed(0) + 'ms (' + evalStep.pct.toFixed(1) + '%)')
    console.log('')
    console.log('   1. 异步评估:')
    console.log('      - 生成完成后异步评估，用户可先预览')
    console.log('      - 使用WebSocket推送评估结果')
    console.log('      - 预期提升: 用户感知延迟降低50%')
    console.log('')
    console.log('   2. 评估算法优化:')
    console.log('      - 缓存评估规则编译结果')
    console.log('      - 使用增量评估（仅重评变化部分）')
    console.log('      - 预期提升: 30-40%计算时间减少')
  }

  // 数据库操作优化
  if (dbStep && dbStep.avg > 100) {
    console.log('\n💾 【优先级P2】数据库操作优化:')
    console.log('   当前耗时: ' + dbStep.avg.toFixed(0) + 'ms (' + dbStep.pct.toFixed(1) + '%)')
    console.log('')
    console.log('   1. 批量写入:')
    console.log('      - 合并多个INSERT为批量操作')
    console.log('      - 使用事务减少锁竞争')
    console.log('      - 预期提升: 多创意场景下50%减少')
    console.log('')
    console.log('   2. 写入延迟:')
    console.log('      - 使用Write-Behind缓存模式')
    console.log('      - 异步写入，立即返回结果')
    console.log('      - 预期提升: 用户等待时间降低90%')
  }

  // 综合优化方案
  console.log('\n⚡ 【综合优化方案】并行化改造:')
  console.log('')
  console.log('   当前流程（串行）:')
  console.log('   AI生成 → 关键词搜索量 → Ad Strength评估 → 数据库保存')
  console.log(`   总耗时: ${totalAvgTime.toFixed(0)}ms`)
  console.log('')
  console.log('   优化后流程（并行）:')
  console.log('   ┌─ AI生成 ──────────┐')
  console.log('   │                    ├→ 合并结果 → 数据库保存')
  console.log('   └─ 关键词预热缓存 ──┘')
  console.log('              ↓')
  console.log('        异步Ad Strength评估')
  console.log('')

  const estimatedOptimizedTime = aiStep ? aiStep.avg * 0.4 + (evalStep?.avg || 0) * 0.3 + (dbStep?.avg || 0) * 0.5 : totalAvgTime * 0.5
  console.log(`   预期优化后耗时: ${estimatedOptimizedTime.toFixed(0)}ms`)
  console.log(`   预期提升: ${((1 - estimatedOptimizedTime / totalAvgTime) * 100).toFixed(0)}%`)

  // 6. 实施优先级
  console.log('\n📋 实施优先级建议:')
  console.log('─'.repeat(70))
  console.log('')
  console.log('   第一阶段（快速见效，1-2天）:')
  console.log('   ✅ 切换到 gemini-1.5-flash 模型')
  console.log('   ✅ 精简Prompt模板')
  console.log('   预期效果: 总耗时降低50%')
  console.log('')
  console.log('   第二阶段（中期优化，3-5天）:')
  console.log('   ✅ 实现异步Ad Strength评估')
  console.log('   ✅ 添加创意模板缓存')
  console.log('   预期效果: 用户感知延迟降低60%')
  console.log('')
  console.log('   第三阶段（深度优化，1-2周）:')
  console.log('   ✅ 并行生成+并行评估架构')
  console.log('   ✅ 智能缓存预热系统')
  console.log('   预期效果: 多创意场景吞吐量提升3倍')

  // 7. 评级分布
  console.log('\n📊 创意质量分布:')
  const ratingCounts: Record<string, number> = {}
  results.forEach(r => {
    ratingCounts[r.rating] = (ratingCounts[r.rating] || 0) + 1
  })
  Object.entries(ratingCounts).forEach(([rating, count]) => {
    const pct = (count / results.length * 100).toFixed(1)
    console.log(`   ${rating}: ${count}/${results.length} (${pct}%)`)
  })

  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length
  console.log(`   平均分数: ${avgScore.toFixed(1)}`)

  console.log('\n' + '═'.repeat(70))
  console.log('✅ 分析完成！')
  console.log('═'.repeat(70))
}

main().catch(error => {
  console.error('\n❌ 执行失败:', error.message)
  console.error(error.stack)
  process.exit(1)
})
