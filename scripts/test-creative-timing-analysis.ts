/**
 * 广告创意生成耗时分析脚本
 *
 * 分析各步骤耗时：
 * 1. 获取Offer信息
 * 2. 获取AI配置
 * 3. 构建Prompt
 * 4. AI生成创意（Gemini/Vertex）
 * 5. 解析AI响应
 * 6. 获取关键词搜索量（Redis + API）
 * 7. 评估Ad Strength
 * 8. 保存���数据库
 *
 * 运行: npx tsx scripts/test-creative-timing-analysis.ts
 */

import { getDatabase } from '../src/lib/db'
import { findOfferById } from '../src/lib/offers'
import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { createAdCreative } from '../src/lib/ad-creative'
import { evaluateCreativeAdStrength } from '../src/lib/scoring'
import { getKeywordSearchVolumes } from '../src/lib/keyword-planner'

interface TimingResult {
  step: string
  duration: number
  percentage?: number
  details?: string
}

interface AnalysisReport {
  offerId: number
  brand: string
  totalDuration: number
  timings: TimingResult[]
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

async function analyzeCreativeGeneration(offerId: number, userId: number): Promise<AnalysisReport> {
  console.log('='.repeat(70))
  console.log(`🎯 广告创意生成耗时分析 - Offer #${offerId}`)
  console.log('='.repeat(70))

  const timings: TimingResult[] = []
  const totalTimer = createTimer()

  // =====================================================
  // Step 1: 获取Offer信息
  // =====================================================
  console.log('\n📋 Step 1: 获取Offer信息...')
  let stepTimer = createTimer()

  const offer = findOfferById(offerId, userId)
  if (!offer) {
    throw new Error(`Offer #${offerId} 不存在`)
  }

  timings.push({
    step: '1. 获取Offer信息',
    duration: stepTimer.elapsed(),
    details: `品牌: ${offer.brand}, 国家: ${offer.target_country}`
  })
  console.log(`   ✅ ${timings[timings.length - 1].duration.toFixed(0)}ms - ${offer.brand}`)

  // =====================================================
  // Step 2: 生成广告创意（包含AI调用+关键词搜索量）
  // =====================================================
  console.log('\n📝 Step 2: 生成广告创意（核心步骤）...')
  stepTimer = createTimer()

  // 内部计时点
  const creativeGenerationStart = Date.now()

  const creative = await generateAdCreative(offerId, userId, {
    skipCache: true // 跳过缓存，强制重新生成
  })

  const creativeGenerationDuration = stepTimer.elapsed()
  timings.push({
    step: '2. AI生成创意（含关键词搜索量）',
    duration: creativeGenerationDuration,
    details: `Headlines: ${creative.headlines.length}, Descriptions: ${creative.descriptions.length}, Keywords: ${creative.keywords.length}`
  })
  console.log(`   ✅ ${creativeGenerationDuration.toFixed(0)}ms`)
  console.log(`      - Headlines: ${creative.headlines.length}个`)
  console.log(`      - Descriptions: ${creative.descriptions.length}个`)
  console.log(`      - Keywords: ${creative.keywords.length}个`)
  if (creative.keywordsWithVolume) {
    const withVolume = creative.keywordsWithVolume.filter(k => k.searchVolume > 0).length
    console.log(`      - ��搜索量的关键词: ${withVolume}/${creative.keywordsWithVolume.length}`)
  }

  // =====================================================
  // Step 3: 评估Ad Strength
  // =====================================================
  console.log('\n📊 Step 3: 评估Ad Strength...')
  stepTimer = createTimer()

  // 确保有metadata
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
    creative.keywords,
    {
      brandName: offer.brand,
      targetCountry: offer.target_country || 'US',
      targetLanguage: offer.target_language || 'en',
      userId: userId
    }
  )

  timings.push({
    step: '3. 评估Ad Strength',
    duration: stepTimer.elapsed(),
    details: `评级: ${evaluation.finalRating}, 分数: ${evaluation.finalScore}`
  })
  console.log(`   ✅ ${timings[timings.length - 1].duration.toFixed(0)}ms - ${evaluation.finalRating} (${evaluation.finalScore}分)`)

  // =====================================================
  // Step 4: 保存到数据库
  // =====================================================
  console.log('\n💾 Step 4: 保存到数据库...')
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
    generation_round: 1
  })

  timings.push({
    step: '4. 保存到数据库',
    duration: stepTimer.elapsed(),
    details: `Creative ID: ${savedCreative.id}`
  })
  console.log(`   ✅ ${timings[timings.length - 1].duration.toFixed(0)}ms - Creative ID: ${savedCreative.id}`)

  // =====================================================
  // 汇总分析
  // =====================================================
  const totalDuration = totalTimer.elapsed()

  // 计算百分比
  timings.forEach(t => {
    t.percentage = (t.duration / totalDuration) * 100
  })

  // 识别瓶颈
  const bottlenecks: string[] = []
  const sortedByDuration = [...timings].sort((a, b) => b.duration - a.duration)

  if (sortedByDuration[0].percentage! > 50) {
    bottlenecks.push(`🔴 主要瓶颈: ${sortedByDuration[0].step} 占用 ${sortedByDuration[0].percentage!.toFixed(1)}% 时间`)
  }

  // 生成优化建议
  const optimizations: string[] = []

  // 根据耗时分布给出优化建议
  timings.forEach(t => {
    if (t.step.includes('AI生成') && t.duration > 5000) {
      optimizations.push('💡 AI生成耗时过长，建议：使用更快的模型（如gemini-1.5-flash）或并行生成多个创意')
    }
    if (t.step.includes('关键词搜索量') && t.duration > 3000) {
      optimizations.push('💡 关键词搜索量耗时较长，建议：预热Redis缓存、批量查询优化')
    }
    if (t.step.includes('Ad Strength') && t.duration > 1000) {
      optimizations.push('💡 Ad Strength评估可优化，建议：简化评估算法或使用缓存')
    }
  })

  return {
    offerId,
    brand: offer.brand,
    totalDuration,
    timings,
    bottlenecks,
    optimizations
  }
}

// 单独测试关键词搜索量的耗时
async function analyzeKeywordVolumeTime(keywords: string[], country: string, language: string) {
  console.log('\n' + '='.repeat(70))
  console.log('🔍 关键词搜索量获取耗时分析')
  console.log('='.repeat(70))

  const timer = createTimer()

  // 测试批量获取
  console.log(`\n📊 测试 ${keywords.length} 个关键词的搜索量获取...`)
  const volumes = await getKeywordSearchVolumes(keywords, country, language, 1)

  const duration = timer.elapsed()
  const avgPerKeyword = duration / keywords.length

  console.log(`   总耗时: ${duration.toFixed(0)}ms`)
  console.log(`   平均每个关键词: ${avgPerKeyword.toFixed(1)}ms`)
  console.log(`   获取到搜索量的关键词: ${volumes.size}/${keywords.length}`)

  // 分析缓存命中情况
  let cached = 0
  let api = 0
  volumes.forEach((vol, kw) => {
    if (vol > 0) cached++
    else api++
  })

  return {
    totalKeywords: keywords.length,
    duration,
    avgPerKeyword,
    cacheHits: cached,
    apiCalls: api
  }
}

async function main() {
  const OFFER_ID = 49
  const USER_ID = 1

  console.log('\n🚀 开始广告创意生成耗时分析\n')
  console.log(`   Offer ID: ${OFFER_ID}`)
  console.log(`   User ID: ${USER_ID}`)
  console.log(`   时间: ${new Date().toISOString()}`)

  try {
    // 主要分析
    const report = await analyzeCreativeGeneration(OFFER_ID, USER_ID)

    // 输出报告
    console.log('\n' + '='.repeat(70))
    console.log('📈 耗时分析报告')
    console.log('='.repeat(70))

    console.log(`\n🎯 Offer: ${report.brand} (#${report.offerId})`)
    console.log(`⏱️  总耗时: ${(report.totalDuration / 1000).toFixed(2)}秒`)

    console.log('\n📊 各步骤耗时分布:')
    console.log('-'.repeat(70))
    console.log('步骤'.padEnd(40) + '耗时(ms)'.padStart(12) + '占比'.padStart(10))
    console.log('-'.repeat(70))

    report.timings.forEach(t => {
      const bar = '█'.repeat(Math.round(t.percentage! / 5))
      console.log(
        t.step.padEnd(40) +
        t.duration.toFixed(0).padStart(12) +
        `${t.percentage!.toFixed(1)}%`.padStart(10) +
        ` ${bar}`
      )
    })
    console.log('-'.repeat(70))
    console.log('总计'.padEnd(40) + report.totalDuration.toFixed(0).padStart(12) + '100.0%'.padStart(10))

    // 瓶颈分析
    if (report.bottlenecks.length > 0) {
      console.log('\n🔴 性能瓶颈:')
      report.bottlenecks.forEach(b => console.log(`   ${b}`))
    }

    // 优化建议
    console.log('\n💡 优化建议:')

    // 基于实际数据的优化建议
    const aiStep = report.timings.find(t => t.step.includes('AI生成'))
    const evalStep = report.timings.find(t => t.step.includes('Ad Strength'))
    const dbStep = report.timings.find(t => t.step.includes('数据库'))

    const suggestions = [
      {
        category: '🤖 AI生成优化',
        items: [
          '使用 gemini-1.5-flash 替代 gemini-1.5-pro（速度提升约2-3倍）',
          '并行生成多个创意变体，取最佳结果',
          '缓存相似Offer的创意模板，减少重复生成',
          '精简Prompt长度，减少token消耗'
        ]
      },
      {
        category: '🔍 关键词搜索量优化',
        items: [
          '预热热门关键词的Redis缓存（每日定时任务）',
          '增加本��内存缓存层（LRU Cache，10分钟有效期）',
          '批量API调用合并（当前已实现，可进一步优化批次大小）',
          '使用关键词相似度匹配，复用已有搜索量数据'
        ]
      },
      {
        category: '📊 评估优化',
        items: [
          '简化Ad Strength评估算法，减少计算复杂度',
          '缓存评估规则，避免重复编译',
          '异步评估（生成完成后台评估，用户可先预览）'
        ]
      },
      {
        category: '⚡ 并行化优化',
        items: [
          'AI生成和关键词搜索量获取并行执行',
          '多创意变体并行生成+并行评估',
          '使用Web Worker或子进程处理CPU密集型任务'
        ]
      }
    ]

    suggestions.forEach(s => {
      console.log(`\n   ${s.category}:`)
      s.items.forEach(item => console.log(`      - ${item}`))
    })

    // 预估优化效果
    console.log('\n📈 预估优化效果:')
    console.log('-'.repeat(70))

    if (aiStep) {
      const optimizedAI = aiStep.duration * 0.4 // 使用flash模型预估节省60%
      console.log(`   AI生成: ${aiStep.duration.toFixed(0)}ms → ${optimizedAI.toFixed(0)}ms (使用flash模型)`)
    }

    console.log(`   总体: ${report.totalDuration.toFixed(0)}ms → ${(report.totalDuration * 0.5).toFixed(0)}ms (预估节省50%)`)

    console.log('\n✅ 分析完成！')

  } catch (error: any) {
    console.error('\n❌ 分析失败:', error.message)
    console.error(error.stack)
  }
}

main().catch(console.error)
