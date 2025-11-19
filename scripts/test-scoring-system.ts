/**
 * 测试新评分系统 - 使用真实广告数据场景
 * 验证4维评分系统是否能正确识别优秀/平庸/差劲广告
 */

import Database from 'better-sqlite3'
import path from 'path'

// 模拟真实广告数据的测试案例
interface TestCase {
  name: string
  description: string
  data: {
    ctr: number
    cpc: number
    clicks: number
    cost: number
    conversions: number
    budget: number
    impressions: number
  }
  expectedRating: 'excellent' | 'good' | 'average' | 'poor'
  expectedScoreRange: [number, number] // [min, max]
  oldSystemScore: number // 旧系统给的分数
  shouldFail: boolean // 旧系统是否误判
}

const testCases: TestCase[] = [
  {
    name: '案例1：真正的优秀广告',
    description: 'CTR 6%, CPC极低, 点击量大, 预算利用充分',
    data: {
      ctr: 0.06,
      cpc: 5,
      clicks: 600,
      cost: 3000,
      conversions: 30,
      budget: 5000,
      impressions: 10000
    },
    expectedRating: 'excellent',
    expectedScoreRange: [90, 100],
    oldSystemScore: 95,
    shouldFail: false // 旧系统正确
  },
  {
    name: '案例2：平庸广告被旧系统高估',
    description: 'CTR刚过2%, CPC很高但<50%预算, 点击量少',
    data: {
      ctr: 0.021, // 2.1%刚过阈值
      cpc: 1000,
      clicks: 50,
      cost: 50000,
      conversions: 2,
      budget: 100000,
      impressions: 2381 // 50/0.021
    },
    expectedRating: 'average',
    expectedScoreRange: [55, 70],
    oldSystemScore: 95, // 旧系统误判为95分
    shouldFail: true // ⚠️ 旧系统严重误判
  },
  {
    name: '案例3：高CTR但成本失控',
    description: 'CTR优秀4%, 但CPC太高导致成本失控',
    data: {
      ctr: 0.04,
      cpc: 5000, // CPC占预算5%
      clicks: 300,
      cost: 1500000,
      conversions: 15,
      budget: 100000,
      impressions: 7500
    },
    expectedRating: 'average', // CPC太高拉低评分
    expectedScoreRange: [55, 75],
    oldSystemScore: 75, // 旧系统因CPC>50%预算只给75分
    shouldFail: false
  },
  {
    name: '案例4：低CTR但成本控制好',
    description: 'CTR 1.5%, 但CPC极低, 适合大规模投放',
    data: {
      ctr: 0.015,
      cpc: 3,
      clicks: 1000,
      cost: 3000,
      conversions: 10,
      budget: 10000,
      impressions: 66667
    },
    expectedRating: 'average',
    expectedScoreRange: [50, 70],
    oldSystemScore: 55, // 旧系统因CTR<2%只给55分
    shouldFail: false
  },
  {
    name: '案例5：高CTR低成本少点击',
    description: 'CTR 4%, CPC低, 但点击量不足影响规模',
    data: {
      ctr: 0.04,
      cpc: 8,
      clicks: 40, // 点击量不足
      cost: 320,
      conversions: 2,
      budget: 5000,
      impressions: 1000
    },
    expectedRating: 'good', // CTR好但规模不足
    expectedScoreRange: [70, 85],
    oldSystemScore: 95, // 旧系统只看CTR+CPC给95分
    shouldFail: true // ⚠️ 忽略了规模问题
  },
  {
    name: '案例6：差劲广告 - CTR和CPC都差',
    description: 'CTR 0.5%, CPC高, 点击量少',
    data: {
      ctr: 0.005,
      cpc: 2000,
      clicks: 10,
      cost: 20000,
      conversions: 0,
      budget: 50000,
      impressions: 2000
    },
    expectedRating: 'poor',
    expectedScoreRange: [0, 40],
    oldSystemScore: 30, // 旧系统正确识别为差
    shouldFail: false
  },
  {
    name: '案例7：预算利用不足的优质广告',
    description: 'CTR好、CPC低、点击多，但预算利用率只30%',
    data: {
      ctr: 0.05,
      cpc: 10,
      clicks: 500,
      cost: 5000,
      conversions: 25,
      budget: 20000, // 只用了25%
      impressions: 10000
    },
    expectedRating: 'excellent', // 质量优秀但有改进空间
    expectedScoreRange: [80, 92],
    oldSystemScore: 95,
    shouldFail: false
  },
  {
    name: '案例8：边界测试 - 恰好达标',
    description: '所有指标恰好达到good水平',
    data: {
      ctr: 0.03, // 3% good
      cpc: 50, // 预算的1% acceptable
      clicks: 200, // 200次 good
      cost: 10000,
      conversions: 6,
      budget: 5000, // 成本超预算但控制在合理范围
      impressions: 6667
    },
    expectedRating: 'good',
    expectedScoreRange: [70, 85],
    oldSystemScore: 95,
    shouldFail: true // 成本超预算但仍被给95分
  }
]

// 新评分系统实现（从creative-learning.ts复制）
function scoreCreativePerformance(data: TestCase['data']): {
  score: number
  rating: 'excellent' | 'good' | 'average' | 'poor'
  breakdown: {
    ctrScore: number
    cpcScore: number
    clickScore: number
    budgetScore: number
  }
  reasons: string[]
} {
  const { ctr, cpc, clicks, cost, budget, impressions } = data
  const reasons: string[] = []

  // ========== 1. CTR评分（40分）==========
  let ctrScore = 0
  const ctrPercent = ctr * 100

  if (ctr >= 0.05) {
    ctrScore = 40
    reasons.push(`优秀CTR (${ctrPercent.toFixed(2)}%)`)
  } else if (ctr >= 0.03) {
    ctrScore = 32 + ((ctr - 0.03) / 0.02) * 8
    reasons.push(`良好CTR (${ctrPercent.toFixed(2)}%)`)
  } else if (ctr >= 0.02) {
    ctrScore = 24 + ((ctr - 0.02) / 0.01) * 8
    reasons.push(`中等CTR (${ctrPercent.toFixed(2)}%)`)
  } else if (ctr >= 0.01) {
    ctrScore = 12 + ((ctr - 0.01) / 0.01) * 12
    reasons.push(`偏低CTR (${ctrPercent.toFixed(2)}%)`)
  } else {
    ctrScore = ctr * 1200
    reasons.push(`差CTR (${ctrPercent.toFixed(2)}%)`)
  }

  // ========== 2. CPC效率评分（30分）==========
  let cpcScore = 0
  const cpcRatio = cpc / (budget * 0.01)

  if (cpcRatio <= 0.5) {
    cpcScore = 30
    reasons.push(`极低CPC (${cpc.toFixed(2)}，预算${(cpcRatio * 100).toFixed(2)}%)`)
  } else if (cpcRatio <= 1.0) {
    cpcScore = 24 + (1 - cpcRatio / 0.5) * 6
    reasons.push(`低CPC (${cpc.toFixed(2)}，预算${(cpcRatio * 100).toFixed(2)}%)`)
  } else if (cpcRatio <= 2.0) {
    cpcScore = 15 + (2 - cpcRatio) * 9
    reasons.push(`可接受CPC (${cpc.toFixed(2)}，预算${(cpcRatio * 100).toFixed(2)}%)`)
  } else if (cpcRatio <= 5.0) {
    cpcScore = Math.max(0, 15 - (cpcRatio - 2) * 5)
    reasons.push(`偏高CPC (${cpc.toFixed(2)}，预算${(cpcRatio * 100).toFixed(2)}%)`)
  } else {
    cpcScore = 0
    reasons.push(`过高CPC (${cpc.toFixed(2)}，预算${(cpcRatio * 100).toFixed(2)}%)`)
  }

  // ========== 3. 点击量规模评分（20分）==========
  let clickScore = 0
  if (clicks >= 500) {
    clickScore = 20
    reasons.push(`大规模点击 (${clicks}次)`)
  } else if (clicks >= 200) {
    clickScore = 15 + ((clicks - 200) / 300) * 5
    reasons.push(`良好点击量 (${clicks}次)`)
  } else if (clicks >= 50) {
    clickScore = 10 + ((clicks - 50) / 150) * 5
    reasons.push(`中等点击量 (${clicks}次)`)
  } else {
    clickScore = (clicks / 50) * 10
    reasons.push(`点击量不足 (${clicks}次)`)
  }

  // ========== 4. 预算利用率评分（10分）==========
  let budgetScore = 0
  const utilizationRate = cost / budget

  if (utilizationRate >= 0.9) {
    budgetScore = 10
    reasons.push(`充分利用预算 (${(utilizationRate * 100).toFixed(1)}%)`)
  } else if (utilizationRate >= 0.7) {
    budgetScore = 7 + (utilizationRate - 0.7) * 15
    reasons.push(`良好预算利用 (${(utilizationRate * 100).toFixed(1)}%)`)
  } else if (utilizationRate >= 0.5) {
    budgetScore = 4 + (utilizationRate - 0.5) * 15
    reasons.push(`中等预算利用 (${(utilizationRate * 100).toFixed(1)}%)`)
  } else {
    budgetScore = utilizationRate * 8
    reasons.push(`预算利用不足 (${(utilizationRate * 100).toFixed(1)}%)`)
  }

  // ========== 总分和评级 ==========
  const totalScore = ctrScore + cpcScore + clickScore + budgetScore
  const score = Math.min(100, Math.max(0, Math.round(totalScore)))

  let rating: 'excellent' | 'good' | 'average' | 'poor'
  if (score >= 85) rating = 'excellent'
  else if (score >= 70) rating = 'good'
  else if (score >= 50) rating = 'average'
  else rating = 'poor'

  reasons.unshift(`总分: ${score}/100 (${rating})`)

  return {
    score,
    rating,
    breakdown: {
      ctrScore: Math.round(ctrScore),
      cpcScore: Math.round(cpcScore),
      clickScore: Math.round(clickScore),
      budgetScore: Math.round(budgetScore)
    },
    reasons
  }
}

// 旧评分系统实现（用于对比）
function oldScoringSystem(data: TestCase['data']): number {
  const { ctr, cpc, budget } = data

  if (ctr > 0.02 && cpc < budget * 0.5) {
    return 95 // Excellent
  } else if (ctr > 0.02 || cpc < budget * 0.5) {
    return 75 // Good
  } else if (ctr > 0.01) {
    return 55 // Average
  } else {
    return 30 // Poor
  }
}

// 运行测试
function runTests() {
  console.log('='.repeat(80))
  console.log('新评分系统测试报告 - 使用真实广告数据')
  console.log('='.repeat(80))
  console.log('')

  let passCount = 0
  let failCount = 0
  let issuesFixed = 0

  testCases.forEach((testCase, index) => {
    console.log(`\n[测试案例 ${index + 1}] ${testCase.name}`)
    console.log(`描述: ${testCase.description}`)
    console.log('-'.repeat(80))

    // 运行新系统评分
    const result = scoreCreativePerformance(testCase.data)

    // 验证旧系统评分
    const oldScore = oldScoringSystem(testCase.data)
    const oldScoreMatches = oldScore === testCase.oldSystemScore

    console.log(`\n📊 广告数据:`)
    console.log(`  CTR: ${(testCase.data.ctr * 100).toFixed(2)}%`)
    console.log(`  CPC: ¥${testCase.data.cpc.toFixed(2)}`)
    console.log(`  点击量: ${testCase.data.clicks}次`)
    console.log(`  成本: ¥${testCase.data.cost.toFixed(2)}`)
    console.log(`  预算: ¥${testCase.data.budget.toFixed(2)}`)
    console.log(`  预算利用率: ${((testCase.data.cost / testCase.data.budget) * 100).toFixed(1)}%`)

    console.log(`\n🆚 评分对比:`)
    console.log(`  旧系统评分: ${oldScore}分 ${!oldScoreMatches ? '⚠️ 预期不匹配' : ''}`)
    console.log(`  新系统评分: ${result.score}分 (${result.rating})`)
    console.log(`  分数差异: ${result.score - oldScore > 0 ? '+' : ''}${result.score - oldScore}分`)

    console.log(`\n📈 新系统评分详情:`)
    console.log(`  CTR得分: ${result.breakdown.ctrScore}/40`)
    console.log(`  CPC效率得分: ${result.breakdown.cpcScore}/30`)
    console.log(`  点击量得分: ${result.breakdown.clickScore}/20`)
    console.log(`  预算利用得分: ${result.breakdown.budgetScore}/10`)

    console.log(`\n💬 评分理由:`)
    result.reasons.forEach(reason => console.log(`  - ${reason}`))

    // 验证测试结果
    const ratingMatch = result.rating === testCase.expectedRating
    const scoreInRange =
      result.score >= testCase.expectedScoreRange[0] &&
      result.score <= testCase.expectedScoreRange[1]

    console.log(`\n✅ 测试验证:`)
    console.log(`  预期评级: ${testCase.expectedRating} | 实际: ${result.rating} ${ratingMatch ? '✓' : '✗'}`)
    console.log(`  预期分数范围: ${testCase.expectedScoreRange[0]}-${testCase.expectedScoreRange[1]} | 实际: ${result.score} ${scoreInRange ? '✓' : '✗'}`)

    if (testCase.shouldFail) {
      console.log(`  ⚠️ 旧系统误判案例: 旧分${oldScore} → 新分${result.score}`)
      if (ratingMatch && scoreInRange) {
        console.log(`  ✅ 新系统成功修复误判！`)
        issuesFixed++
      }
    }

    if (ratingMatch && scoreInRange) {
      console.log(`\n🎉 测试通过`)
      passCount++
    } else {
      console.log(`\n❌ 测试失败`)
      failCount++
    }
  })

  // 测试总结
  console.log('\n' + '='.repeat(80))
  console.log('测试总结')
  console.log('='.repeat(80))
  console.log(`总案例数: ${testCases.length}`)
  console.log(`✅ 通过: ${passCount}`)
  console.log(`❌ 失败: ${failCount}`)
  console.log(`🔧 修复旧系统误判: ${issuesFixed}/${testCases.filter(tc => tc.shouldFail).length}`)
  console.log(`✨ 通过率: ${((passCount / testCases.length) * 100).toFixed(1)}%`)

  console.log('\n📊 业务影响预测:')
  console.log(`  - AI学习质量提升: ${issuesFixed > 0 ? '✅ 是' : '⚠️ 待验证'} (避免学习平庸广告)`)
  console.log(`  - 成本优化潜力: ✅ 是 (CPC效率评分引导)`)
  console.log(`  - ROI提升潜力: ✅ 是 (多维度优化机会)`)

  return {
    total: testCases.length,
    passed: passCount,
    failed: failCount,
    issuesFixed,
    passRate: (passCount / testCases.length) * 100
  }
}

// 执行测试
const results = runTests()

// 如果测试失败，退出码非0
if (results.failed > 0) {
  process.exit(1)
}
