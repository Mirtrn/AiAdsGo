#!/usr/bin/env tsx

/**
 * 直接测试广告创意生成和评分
 * 绕过API认证，直接调用库函数
 */

import { getDatabase } from '../src/lib/db'
import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { createAdCreative } from '../src/lib/ad-creative'
import { evaluateCreativeAdStrength } from '../src/lib/scoring'

async function testDirectGeneration() {
  console.log('🧪 直接测试：广告创意生成和Ad Strength评估\n')
  console.log('=' .repeat(60))

  const db = getDatabase()
  const userId = 1
  const offerId = 51

  try {
    // 1. 获取Offer信息
    console.log('\n📦 步骤1: 获取Offer信息...')
    const offer = db.prepare(`
      SELECT * FROM offers WHERE id = ? AND user_id = ?
    `).get(offerId, userId) as any

    if (!offer) {
      throw new Error(`Offer ${offerId} 不存在`)
    }

    console.log(`   ✅ 找到Offer: ${offer.brand} - ${offer.product_name}`)

    // 2. 生成创意
    console.log('\n📝 步骤2: 生成广告创意...')
    const generatedData = await generateAdCreative(offerId, userId, {})

    console.log(`   ✅ 创意生成成功`)
    console.log(`   - Headlines: ${generatedData.headlines.length}`)
    console.log(`   - Descriptions: ${generatedData.descriptions.length}`)
    console.log(`   - Keywords: ${generatedData.keywords.length}`)

    // 3. Ad Strength评估
    console.log('\n📊 步骤3: Ad Strength评估...')

    const headlinesWithMetadata = generatedData.headlinesWithMetadata || generatedData.headlines.map(text => ({
      text,
      length: text.length
    }))
    const descriptionsWithMetadata = generatedData.descriptionsWithMetadata || generatedData.descriptions.map(text => ({
      text,
      length: text.length
    }))

    const evaluation = await evaluateCreativeAdStrength(
      headlinesWithMetadata,
      descriptionsWithMetadata,
      generatedData.keywords
    )

    console.log(`   ✅ 评估完成`)
    console.log(`   - 评级: ${evaluation.finalRating}`)
    console.log(`   - 总分: ${evaluation.finalScore}`)
    console.log(`   - 维度:`)
    console.log(`     • Diversity: ${evaluation.localEvaluation.dimensions.diversity.score} / 25`)
    console.log(`     • Relevance: ${evaluation.localEvaluation.dimensions.relevance.score} / 25`)
    console.log(`     • Completeness: ${evaluation.localEvaluation.dimensions.completeness.score} / 20`)
    console.log(`     • Quality: ${evaluation.localEvaluation.dimensions.quality.score} / 20`)
    console.log(`     • Compliance: ${evaluation.localEvaluation.dimensions.compliance.score} / 10`)

    // 4. 保存到数据库
    console.log('\n💾 步骤4: 保存到数据库...')

    const savedCreative = createAdCreative(userId, offerId, {
      headlines: generatedData.headlines,
      descriptions: generatedData.descriptions,
      keywords: generatedData.keywords,
      keywordsWithVolume: generatedData.keywordsWithVolume,
      callouts: generatedData.callouts,
      sitelinks: generatedData.sitelinks,
      theme: generatedData.theme,
      explanation: generatedData.explanation,
      final_url: offer.final_url || offer.url,
      final_url_suffix: offer.final_url_suffix || undefined,
      generation_round: 1,
      // 传入Ad Strength评估结果
      score: evaluation.finalScore,
      score_breakdown: {
        relevance: evaluation.localEvaluation.dimensions.relevance.score,
        quality: evaluation.localEvaluation.dimensions.quality.score,
        engagement: evaluation.localEvaluation.dimensions.completeness.score,
        diversity: evaluation.localEvaluation.dimensions.diversity.score,
        clarity: evaluation.localEvaluation.dimensions.compliance.score
      }
    })

    console.log(`   ✅ 保存成功`)
    console.log(`   - 创意ID: ${savedCreative.id}`)
    console.log(`   - 评分: ${savedCreative.score}`)

    // 5. 验证数据库
    console.log('\n🔍 步骤5: 验证数据库记录...')

    const dbCreative = db.prepare(`
      SELECT id, score, score_breakdown
      FROM ad_creatives
      WHERE id = ?
    `).get(savedCreative.id) as any

    const breakdown = JSON.parse(dbCreative.score_breakdown)

    console.log(`   ✅ 数据库验证`)
    console.log(`   - ID: ${dbCreative.id}`)
    console.log(`   - Score: ${dbCreative.score}`)
    console.log(`   - Breakdown:`)
    console.log(`     • Diversity: ${breakdown.diversity} / 25`)
    console.log(`     • Relevance: ${breakdown.relevance} / 25`)
    console.log(`     • Engagement: ${breakdown.engagement} / 20`)
    console.log(`     • Quality: ${breakdown.quality} / 20`)
    console.log(`     • Clarity: ${breakdown.clarity} / 10`)

    // 6. 检查是否超过最大值
    console.log('\n✅ 步骤6: 检查维度分数...')

    const violations: string[] = []

    if (breakdown.diversity > 25) violations.push(`diversity=${breakdown.diversity} > 25`)
    if (breakdown.relevance > 25) violations.push(`relevance=${breakdown.relevance} > 25`)
    if (breakdown.engagement > 20) violations.push(`engagement=${breakdown.engagement} > 20`)
    if (breakdown.quality > 20) violations.push(`quality=${breakdown.quality} > 20`)
    if (breakdown.clarity > 10) violations.push(`clarity=${breakdown.clarity} > 10`)

    if (violations.length > 0) {
      console.log(`   ❌ 发现 ${violations.length} 个超额评分:`)
      violations.forEach(v => console.log(`      - ${v}`))
    } else {
      console.log(`   ✅ 所有维度分数都在合法范围内`)
    }

    // 总结
    console.log('\n' + '='.repeat(60))
    console.log('\n📋 测试结果总结:\n')

    if (violations.length === 0) {
      console.log('✅ 迁移成功！')
      console.log('   - Ad Strength评估系统正常工作')
      console.log('   - 所有维度分数都在合法范围内')
      console.log('   - 评分正确保存到数据库')
      console.log('\n🎉 评分算法迁移完成！\n')
      process.exit(0)
    } else {
      console.log('❌ 迁移失败！')
      console.log('   - 发现维度分数超过最大值')
      console.log('   - ad-strength-evaluator.ts 的 Math.min() 可能未生效')
      console.log('\n⚠️ 请检查代码\n')
      process.exit(1)
    }

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
    console.error(error)
    process.exit(1)
  }
}

testDirectGeneration()
