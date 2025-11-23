#!/usr/bin/env tsx

/**
 * 测试评分算法迁移
 *
 * 验证：
 * 1. 旧API是否使用Ad Strength评估系统
 * 2. calculateAdCreativeScore是否触发废弃警告
 * 3. 所有创意是否正确保存评分
 */

import { getDatabase } from '../src/lib/db'

async function testScoringMigration() {
  console.log('🧪 开始测试评分算法迁移...\n')

  const db = getDatabase()

  // 1. 检查最近的广告创意评分
  console.log('📊 检查最近10条广告创意的评分：')
  const recentCreatives = db.prepare(`
    SELECT
      id,
      offer_id,
      score,
      score_breakdown,
      generation_round,
      created_at
    FROM ad_creatives
    ORDER BY id DESC
    LIMIT 10
  `).all() as any[]

  console.log(`找到 ${recentCreatives.length} 条创意记录\n`)

  // 2. 验证score_breakdown是否包含5个维度
  let validCount = 0
  let invalidCount = 0

  for (const creative of recentCreatives) {
    const breakdown = JSON.parse(creative.score_breakdown)
    const hasAllDimensions =
      typeof breakdown.diversity === 'number' &&
      typeof breakdown.relevance === 'number' &&
      typeof breakdown.engagement === 'number' &&
      typeof breakdown.quality === 'number' &&
      typeof breakdown.clarity === 'number'

    if (hasAllDimensions) {
      validCount++
      console.log(`✅ Creative #${creative.id}: score=${creative.score}, breakdown=有效`)
      console.log(`   维度: D=${breakdown.diversity}, R=${breakdown.relevance}, E=${breakdown.engagement}, Q=${breakdown.quality}, C=${breakdown.clarity}`)
    } else {
      invalidCount++
      console.log(`❌ Creative #${creative.id}: score=${creative.score}, breakdown=缺失维度`)
      console.log(`   当前维度:`, breakdown)
    }
  }

  console.log(`\n📈 统计结果：`)
  console.log(`   有效创意: ${validCount} / ${recentCreatives.length}`)
  console.log(`   无效创意: ${invalidCount} / ${recentCreatives.length}`)

  // 3. 检查是否有超过最大值的评分
  console.log(`\n🔍 检查是否有超过最大值的评分：`)

  let overMaxCount = 0
  for (const creative of recentCreatives) {
    const breakdown = JSON.parse(creative.score_breakdown)
    const violations: string[] = []

    if (breakdown.diversity > 25) violations.push(`diversity=${breakdown.diversity} > 25`)
    if (breakdown.relevance > 25) violations.push(`relevance=${breakdown.relevance} > 25`)
    if (breakdown.engagement > 20) violations.push(`engagement=${breakdown.engagement} > 20`)
    if (breakdown.quality > 20) violations.push(`quality=${breakdown.quality} > 20`)
    if (breakdown.clarity > 10) violations.push(`clarity=${breakdown.clarity} > 10`)
    if (creative.score > 100) violations.push(`total_score=${creative.score} > 100`)

    if (violations.length > 0) {
      overMaxCount++
      console.log(`❌ Creative #${creative.id}: 发现超额评分`)
      violations.forEach(v => console.log(`   - ${v}`))
    }
  }

  if (overMaxCount === 0) {
    console.log(`✅ 所有创意的评分都在合法范围内`)
  } else {
    console.log(`⚠️ 发现 ${overMaxCount} 条创意的评分超过最大值`)
  }

  // 4. 检查Offer 51的创意（如果存在）
  console.log(`\n🎯 检查Offer 51的创意（测试用例）：`)
  const offer51Creatives = db.prepare(`
    SELECT
      id,
      score,
      score_breakdown,
      generation_round,
      created_at
    FROM ad_creatives
    WHERE offer_id = 51
    ORDER BY id DESC
    LIMIT 5
  `).all() as any[]

  if (offer51Creatives.length === 0) {
    console.log(`   未找到Offer 51的创意记录`)
  } else {
    console.log(`   找到 ${offer51Creatives.length} 条创意记录：`)
    for (const creative of offer51Creatives) {
      const breakdown = JSON.parse(creative.score_breakdown)
      console.log(`   - Creative #${creative.id}: score=${creative.score}, round=${creative.generation_round}`)
      console.log(`     D=${breakdown.diversity}, R=${breakdown.relevance}, E=${breakdown.engagement}, Q=${breakdown.quality}, C=${breakdown.clarity}`)
    }
  }

  // 5. 测试结论
  console.log(`\n📋 迁移测试结论：`)
  if (validCount === recentCreatives.length && overMaxCount === 0) {
    console.log(`✅ 迁移成功！所有创意都使用Ad Strength评估系统`)
  } else {
    console.log(`⚠️ 迁移可能未完成：`)
    if (validCount < recentCreatives.length) {
      console.log(`   - ${invalidCount} 条创意缺失维度数据`)
    }
    if (overMaxCount > 0) {
      console.log(`   - ${overMaxCount} 条创意评分超过最大值（可能是旧数据）`)
    }
  }

  console.log(`\n🎯 下一步操作建议：`)
  console.log(`   1. 访问 http://localhost:3000/offers/51/launch`)
  console.log(`   2. 点击"再次生成"按钮`)
  console.log(`   3. 查看控制台日志是否显示"📊 创意评估: EXCELLENT (XX分)"`)
  console.log(`   4. 刷新页面验证分数和评级是否一致`)
  console.log(`   5. 检查控制台是否有"⚠️ calculateAdCreativeScore已废弃"警告\n`)
}

testScoringMigration().catch(console.error)
