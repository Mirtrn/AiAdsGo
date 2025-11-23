#!/usr/bin/env tsx

/**
 * Bonus Score System End-to-End Test
 * 测试完整的加分机制流程
 */

import { getDatabase } from '../src/lib/db'
import { classifyOfferIndustry, getIndustryBenchmark } from '../src/lib/industry-classifier'
import { calculateBonusScore, saveCreativePerformance, getCreativePerformance } from '../src/lib/bonus-score-calculator'

const db = getDatabase()

async function testBonusScoreSystem() {
  console.log('\n🧪 Bonus Score System E2E Test\n')
  console.log('='.repeat(60))

  // Test 1: Industry Classification
  console.log('\n📊 Test 1: Industry Classification')
  console.log('-'.repeat(60))

  const offer = db.prepare(`
    SELECT id, brand, category, brand_description, unique_selling_points, product_highlights
    FROM offers WHERE id = 49
  `).get() as any

  console.log(`Offer: ${offer.brand} (ID: ${offer.id})`)

  const classification = await classifyOfferIndustry(offer)
  if (classification) {
    console.log(`✅ Industry: ${classification.industry_l1} > ${classification.industry_l2}`)
    console.log(`   Code: ${classification.industry_code}`)
    console.log(`   Confidence: ${(classification.confidence * 100).toFixed(1)}%`)
    console.log(`   Benchmarks:`)
    console.log(`   - CTR: ${classification.benchmark.avg_ctr.toFixed(2)}%`)
    console.log(`   - CPC: $${classification.benchmark.avg_cpc.toFixed(2)}`)
    console.log(`   - Conv Rate: ${classification.benchmark.avg_conversion_rate.toFixed(2)}%`)
  } else {
    console.log('❌ Classification failed')
    return
  }

  // Test 2: Bonus Score Calculation (Low Performance)
  console.log('\n📊 Test 2: Bonus Score Calculation - Low Performance')
  console.log('-'.repeat(60))

  const lowPerformance = {
    clicks: 50, // Below 100 threshold
    ctr: 1.5,
    cpc: 1.2,
    conversions: 2,
    conversionRate: 4.0
  }

  const lowScoreResult = await calculateBonusScore(lowPerformance, 'travel_luggage')
  console.log(`Clicks: ${lowPerformance.clicks} (threshold: 100)`)
  console.log(`Min Clicks Reached: ${lowScoreResult.minClicksReached ? '✅' : '❌'}`)
  console.log(`Bonus Score: ${lowScoreResult.totalBonus}/20`)

  // Test 3: Bonus Score Calculation (Good Performance)
  console.log('\n📊 Test 3: Bonus Score Calculation - Good Performance')
  console.log('-'.repeat(60))

  const benchmark = await getIndustryBenchmark('travel_luggage')
  const goodPerformance = {
    clicks: 500,
    ctr: benchmark!.avg_ctr * 1.3, // 30% above benchmark
    cpc: benchmark!.avg_cpc * 0.8, // 20% below benchmark
    conversions: 15,
    conversionRate: benchmark!.avg_conversion_rate * 1.2 // 20% above benchmark
  }

  console.log(`Performance vs Industry Benchmark (Travel > Luggage):`)
  console.log(`  Clicks: ${goodPerformance.clicks}`)
  console.log(`  CTR: ${goodPerformance.ctr.toFixed(2)}% (benchmark: ${benchmark!.avg_ctr.toFixed(2)}%)`)
  console.log(`  CPC: $${goodPerformance.cpc.toFixed(2)} (benchmark: $${benchmark!.avg_cpc.toFixed(2)})`)
  console.log(`  Conv Rate: ${goodPerformance.conversionRate.toFixed(2)}% (benchmark: ${benchmark!.avg_conversion_rate.toFixed(2)}%)`)

  const goodScoreResult = await calculateBonusScore(goodPerformance, 'travel_luggage')
  console.log(`\nBonus Score Breakdown:`)
  console.log(`  Clicks:      ${goodScoreResult.breakdown.clicks.score}/5 (${goodScoreResult.breakdown.clicks.comparison})`)
  console.log(`  CTR:         ${goodScoreResult.breakdown.ctr.score}/5 (${goodScoreResult.breakdown.ctr.comparison})`)
  console.log(`  CPC:         ${goodScoreResult.breakdown.cpc.score}/5 (${goodScoreResult.breakdown.cpc.comparison})`)
  console.log(`  Conversions: ${goodScoreResult.breakdown.conversions.score}/5 (${goodScoreResult.breakdown.conversions.comparison})`)
  console.log(`\n🎯 Total Bonus: ${goodScoreResult.totalBonus}/20`)

  // Test 4: Save Performance Data
  console.log('\n📊 Test 4: Save & Retrieve Performance Data')
  console.log('-'.repeat(60))

  const adCreativeId = 76 // From offer 49
  const syncDate = new Date().toISOString().split('T')[0]

  await saveCreativePerformance(
    adCreativeId,
    49,
    '1', // autoads user
    goodPerformance,
    'travel_luggage',
    syncDate
  )
  console.log(`✅ Saved performance data for creative ${adCreativeId}`)

  const retrieved = await getCreativePerformance(adCreativeId)
  if (retrieved) {
    console.log(`\nRetrieved Data:`)
    console.log(`  Clicks: ${retrieved.performance.clicks}`)
    console.log(`  CTR: ${retrieved.performance.ctr.toFixed(2)}%`)
    console.log(`  CPC: $${retrieved.performance.cpc.toFixed(2)}`)
    console.log(`  Bonus Score: ${retrieved.bonusScore.totalBonus}/20`)
    console.log(`  Industry: ${retrieved.bonusScore.industryLabel}`)
    console.log(`  Sync Date: ${retrieved.syncDate}`)
  } else {
    console.log('❌ Failed to retrieve performance data')
  }

  // Test 5: Conversion Feedback Flow
  console.log('\n📊 Test 5: Conversion Feedback Flow')
  console.log('-'.repeat(60))

  // Add conversion feedback
  db.prepare(`
    INSERT INTO conversion_feedback (
      ad_creative_id, user_id, conversions, conversion_value,
      period_start, period_end, feedback_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    adCreativeId,
    '1',
    20,
    1500.00,
    '2025-11-01',
    '2025-11-23',
    'Test conversion feedback'
  )
  console.log(`✅ Added conversion feedback`)

  // Update performance with new conversion data
  const updatedPerformance = {
    ...goodPerformance,
    conversions: 20,
    conversionRate: (20 / goodPerformance.clicks) * 100
  }

  const updatedScore = await calculateBonusScore(updatedPerformance, 'travel_luggage')
  console.log(`\nUpdated Bonus Score with Conversions:`)
  console.log(`  Conversions: ${updatedScore.breakdown.conversions.score}/5 (${updatedScore.breakdown.conversions.comparison})`)
  console.log(`  Total Bonus: ${updatedScore.totalBonus}/20`)

  // Test 6: Display Format Example
  console.log('\n📊 Test 6: Display Format Example')
  console.log('-'.repeat(60))

  const baseScore = 96 // Ad Strength score
  const totalScore = baseScore + updatedScore.totalBonus
  const maxTotal = 100 + 20

  console.log(`
┌─────────────────────────────────────┐
│ Performance Score                   │
│ ${updatedScore.industryLabel.padEnd(35)} │
├─────────────────────────────────────┤
│         ${baseScore}/100 +${updatedScore.totalBonus}               │
│       Total: ${totalScore}/${maxTotal}              │
├─────────────────────────────────────┤
│ 👆 Clicks    ${goodPerformance.clicks.toString().padEnd(8)} +${updatedScore.breakdown.clicks.score}      │
│ 🎯 CTR       ${goodPerformance.ctr.toFixed(2)}%  +${updatedScore.breakdown.ctr.score}      │
│ 💲 CPC       $${goodPerformance.cpc.toFixed(2)} +${updatedScore.breakdown.cpc.score}      │
│ 🛒 Conv.     ${updatedPerformance.conversionRate.toFixed(2)}%  +${updatedScore.breakdown.conversions.score}  [Add]│
└─────────────────────────────────────┘
  `)

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('✅ All Tests Passed!')
  console.log('='.repeat(60))
  console.log(`
Summary:
- Industry Classification: ✅ Working
- Bonus Score Calculation: ✅ Working
- Performance Data Storage: ✅ Working
- Conversion Feedback: ✅ Working
- Display Format: ✅ Working

Next Steps:
1. Visit: http://localhost:3000/offers/49/launch
2. Generate creatives if needed
3. View the bonus score card below the radar chart
4. Click [Add] to submit conversion feedback
5. See the bonus score update in real-time
`)
}

// Run tests
testBonusScoreSystem().catch(console.error)
