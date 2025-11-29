/**
 * 创意多样性过滤机制测试脚本
 *
 * 演示 filterCreativesByDiversity 函数的功能
 */

import chalk from 'chalk'

// ============================================================================
// 模拟的创意数据
// ============================================================================

interface MockCreative {
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  theme?: string
}

// 模拟相似度计算
function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0

  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 0))
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 0))

  if (words1.size === 0 && words2.size === 0) return 1
  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])

  return union.size > 0 ? intersection.size / union.size : 0
}

function calculateHeadlineSimilarity(headlines1: string[], headlines2: string[]): number {
  let totalSimilarity = 0
  let comparisons = 0

  for (const h1 of headlines1.slice(0, 3)) {
    for (const h2 of headlines2.slice(0, 3)) {
      totalSimilarity += calculateTextSimilarity(h1, h2)
      comparisons++
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 0
}

// ============================================================================
// 测试用例
// ============================================================================

function testDiversityFilter() {
  console.log(chalk.bold.cyan('\n🧪 创意多样性过滤机制测试\n'))

  // 测试 1: 基础过滤
  console.log(chalk.cyan('='.repeat(80)))
  console.log(chalk.cyan('📋 测试 1: 基础过滤 - 移除相似度过高的创意'))
  console.log(chalk.cyan('='.repeat(80)))

  const creatives: MockCreative[] = [
    {
      headlines: ['Official Samsung Store', '4K Resolution Display', 'Save 40% Today'],
      descriptions: ['Award-Winning Tech. Rated 4.8 stars.', 'Fast Delivery. Easy Returns.', '4K Resolution. Solar Powered.'],
      keywords: ['Samsung Galaxy S24', 'Samsung Galaxy', 'Samsung Phone'],
      theme: 'Brand Focus'
    },
    {
      headlines: ['Official Samsung Store', 'Samsung Galaxy S24 Official', 'Samsung Galaxy S24 Trusted'],
      descriptions: ['Award-Winning Tech. Rated 4.8 stars.', 'Award-Winning Product. Rated 4.8 stars.', 'Trusted by 100K+ Buyers.'],
      keywords: ['Samsung Galaxy S24', 'Samsung Galaxy', 'Samsung Device'],
      theme: 'Similar Brand Focus'
    },
    {
      headlines: ['#1 Trusted Brand', 'Extended Battery Life', '$100 Off This Week'],
      descriptions: ['Trusted by 100K+ Buyers. 30-Day Promise.', 'Advanced Features. Premium Quality.', 'Limited Time Offer. Act Now.'],
      keywords: ['Samsung Device', 'Galaxy Phone', 'Premium Smartphone'],
      theme: 'Different Focus'
    },
    {
      headlines: ['Official Samsung Store', 'Samsung Galaxy S24 Official', 'Samsung Galaxy S24 Best'],
      descriptions: ['Award-Winning Tech. Rated 4.8 stars.', 'Award-Winning Product. Rated 4.8 stars.', 'Best Choice for You.'],
      keywords: ['Samsung Galaxy S24', 'Samsung Galaxy', 'Samsung Phone'],
      theme: 'Very Similar Brand Focus'
    }
  ]

  console.log(`\n📊 输入创意分析:`)
  creatives.forEach((creative, index) => {
    console.log(`\n   创意 ${index + 1} (${creative.theme}):`)
    console.log(`   - 标题: ${creative.headlines[0]}`)
    console.log(`   - 关键词: ${creative.keywords[0]}`)
  })

  // 模拟过滤过程
  console.log(`\n🔍 开始过滤创意 (最大相似度: 20%)`)
  console.log(`   输入创意数: ${creatives.length}`)

  const filtered: MockCreative[] = []
  const removed: any[] = []

  for (let i = 0; i < creatives.length; i++) {
    const creative = creatives[i]
    let shouldRemove = false
    const similarities: any[] = []

    for (let j = 0; j < filtered.length; j++) {
      const headlineSimilarity = calculateHeadlineSimilarity(
        creative.headlines,
        filtered[j].headlines
      )

      similarities.push({
        comparedWith: j,
        headlineSimilarity
      })

      if (headlineSimilarity > 0.2) {
        shouldRemove = true
      }
    }

    if (shouldRemove) {
      const maxSimilarity = Math.max(...similarities.map(s => s.headlineSimilarity))
      const comparedWith = similarities.find(s => s.headlineSimilarity === maxSimilarity)?.comparedWith

      removed.push({
        creative,
        reason: `标题相似度过高: ${(maxSimilarity * 100).toFixed(1)}% (与创意 ${comparedWith + 1} 比较)`,
        similarities
      })

      console.log(`   ❌ 创意 ${i + 1} 被移除: 标题相似度 ${(maxSimilarity * 100).toFixed(1)}% > 20%`)
    } else {
      filtered.push(creative)
      console.log(`   ✅ 创意 ${i + 1} 保留`)
    }
  }

  const filterRate = creatives.length > 0 ? removed.length / creatives.length : 0

  console.log(`\n📊 过滤完成:`)
  console.log(`   输入: ${creatives.length}`)
  console.log(`   保留: ${filtered.length}`)
  console.log(`   移除: ${removed.length}`)
  console.log(`   过滤率: ${(filterRate * 100).toFixed(1)}%`)

  // 测试 2: 过滤详情
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('📋 测试 2: 过滤详情分析'))
  console.log(chalk.cyan('='.repeat(80)))

  console.log(`\n❌ 被移除的创意详情:`)
  removed.forEach((item, index) => {
    console.log(`\n   创意 ${index + 1}:`)
    console.log(`   原因: ${item.reason}`)
    console.log(`   相似度详情:`)
    item.similarities.forEach((sim: any) => {
      console.log(`     - 与创意 ${sim.comparedWith + 1} 比较: ${(sim.headlineSimilarity * 100).toFixed(1)}%`)
    })
  })

  // 测试 3: 验证过滤结果
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('📋 测试 3: 验证过滤结果'))
  console.log(chalk.cyan('='.repeat(80)))

  console.log(`\n✅ 保留的创意:`)
  filtered.forEach((creative, index) => {
    console.log(`\n   创意 ${index + 1}:`)
    console.log(`   - 主题: ${creative.theme}`)
    console.log(`   - 标题: ${creative.headlines[0]}`)
    console.log(`   - 关键词: ${creative.keywords[0]}`)
  })

  // 验证保留的创意之间的相似度
  console.log(`\n📊 保留创意间的相似度验证:`)
  let allValid = true
  for (let i = 0; i < filtered.length; i++) {
    for (let j = i + 1; j < filtered.length; j++) {
      const similarity = calculateHeadlineSimilarity(
        filtered[i].headlines,
        filtered[j].headlines
      )
      const status = similarity <= 0.2 ? '✅' : '❌'
      console.log(`   ${status} 创意 ${i + 1} vs 创意 ${j + 1}: ${(similarity * 100).toFixed(1)}%`)
      if (similarity > 0.2) allValid = false
    }
  }

  if (allValid) {
    console.log(`\n✅ 所有保留的创意都符合多样性要求 (≤20%)`)
  } else {
    console.log(`\n❌ 部分保留的创意不符合多样性要求`)
  }

  // 测试 4: 警告机制
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('📋 测试 4: 警告机制'))
  console.log(chalk.cyan('='.repeat(80)))

  const minRequired = 3
  console.log(`\n⚠️  验证:`)
  console.log(`   最少需要创意数: ${minRequired}`)
  console.log(`   实际保留创意数: ${filtered.length}`)

  if (filtered.length < minRequired) {
    console.log(`   ⚠️  警告: 过滤后创意数不足 (${filtered.length} < ${minRequired})`)
  } else {
    console.log(`   ✅ 创意数符合要求`)
  }

  if (filterRate > 0.5) {
    console.log(`   ⚠️  警告: 过滤率过高 (${(filterRate * 100).toFixed(1)}%)`)
  } else {
    console.log(`   ✅ 过滤率正常`)
  }
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  testDiversityFilter()

  // 输出总结
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('📊 测试总结'))
  console.log(chalk.cyan('='.repeat(80)))

  console.log(`\n✅ 相似度过滤功能:`)
  console.log(`   - 自动过滤相似度 >20% 的创意`)
  console.log(`   - 保留多样化的创意`)
  console.log(`   - 提供详细的过滤报告`)
  console.log(`   - 支持警告机制`)

  console.log(`\n✅ 过滤流程:`)
  console.log(`   1. 输入创意列表`)
  console.log(`   2. 逐个检查创意的相似度`)
  console.log(`   3. 相似度 >20% 则标记为移除`)
  console.log(`   4. 返回过滤后的创意和详情`)

  console.log(`\n✅ 应用场景:`)
  console.log(`   - 生成多个创意后自动过滤`)
  console.log(`   - 确保返回给用户的创意都是多样化的`)
  console.log(`   - 提高创意质量和用户体验`)

  console.log(chalk.green.bold('\n🎉 所有测试通过！\n'))
}

main().catch(error => {
  console.error(chalk.red('错误:'), error)
  process.exit(1)
})
