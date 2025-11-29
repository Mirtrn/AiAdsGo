/**
 * 相似度计算算法测试脚本
 *
 * 测试改进的多算法加权相似度计算
 */

import chalk from 'chalk'

// ============================================================================
// 相似度计算函数（从 ad-strength-evaluator.ts 复制）
// ============================================================================

function calculateSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0

  const jaccardSimilarity = calculateJaccardSimilarity(text1, text2)
  const cosineSimilarity = calculateCosineSimilarity(text1, text2)
  const levenshteinSimilarity = calculateLevenshteinSimilarity(text1, text2)
  const ngramSimilarity = calculateNgramSimilarity(text1, text2, 2)

  const weightedSimilarity =
    jaccardSimilarity * 0.3 +
    cosineSimilarity * 0.3 +
    levenshteinSimilarity * 0.2 +
    ngramSimilarity * 0.2

  return Math.min(1, Math.max(0, weightedSimilarity))
}

function calculateJaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 0))
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 0))

  if (words1.size === 0 && words2.size === 0) return 1
  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])

  return union.size > 0 ? intersection.size / union.size : 0
}

function calculateCosineSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  const words2 = text2.toLowerCase().split(/\s+/).filter(w => w.length > 0)

  if (words1.length === 0 || words2.length === 0) return 0

  const allWords = new Set([...words1, ...words2])
  const vector1: Record<string, number> = {}
  const vector2: Record<string, number> = {}

  for (const word of allWords) {
    vector1[word] = words1.filter(w => w === word).length
    vector2[word] = words2.filter(w => w === word).length
  }

  let dotProduct = 0
  for (const word of allWords) {
    dotProduct += (vector1[word] || 0) * (vector2[word] || 0)
  }

  const magnitude1 = Math.sqrt(Object.values(vector1).reduce((sum, val) => sum + val * val, 0))
  const magnitude2 = Math.sqrt(Object.values(vector2).reduce((sum, val) => sum + val * val, 0))

  return magnitude1 > 0 && magnitude2 > 0 ? dotProduct / (magnitude1 * magnitude2) : 0
}

function calculateLevenshteinSimilarity(text1: string, text2: string): number {
  const distance = levenshteinDistance(text1, text2)
  const maxLength = Math.max(text1.length, text2.length)
  return maxLength > 0 ? 1 - distance / maxLength : 0
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[str2.length][str1.length]
}

function calculateNgramSimilarity(text1: string, text2: string, n: number = 2): number {
  const ngrams1 = getNgrams(text1, n)
  const ngrams2 = getNgrams(text2, n)

  if (ngrams1.length === 0 && ngrams2.length === 0) return 1
  if (ngrams1.length === 0 || ngrams2.length === 0) return 0

  const intersection = ngrams1.filter(ng => ngrams2.includes(ng)).length
  const union = new Set([...ngrams1, ...ngrams2]).size

  return union > 0 ? intersection / union : 0
}

function getNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  const ngrams: string[] = []

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '))
  }

  return ngrams
}

// ============================================================================
// 测试工具函数
// ============================================================================

function logSection(title: string) {
  console.log('\n' + chalk.cyan('='.repeat(80)))
  console.log(chalk.cyan(`📋 ${title}`))
  console.log(chalk.cyan('='.repeat(80)))
}

function logTest(description: string, similarity: number, maxAllowed: number, passed: boolean) {
  const icon = passed ? chalk.green('✅') : chalk.red('❌')
  const similarityStr = (similarity * 100).toFixed(1)
  const maxStr = (maxAllowed * 100).toFixed(1)
  console.log(`${icon} ${description}`)
  console.log(`   相似度: ${similarityStr}% (允许: ≤${maxStr}%)`)
}

// ============================================================================
// 测试用例
// ============================================================================

function testIdenticalTexts() {
  logSection('测试 1: 完全相同的文本')

  const text = 'Samsung Galaxy S24 Official Store'
  const similarity = calculateSimilarity(text, text)
  const passed = similarity >= 0.95 // 应该接近 100%

  logTest('完全相同的文本应该有很高的相似度', similarity, 1.0, passed)
  return passed ? 1 : 0
}

function testCompletelyDifferentTexts() {
  logSection('测试 2: 完全不同的文本')

  const text1 = 'Samsung Galaxy S24'
  const text2 = 'Apple iPhone 15'
  const similarity = calculateSimilarity(text1, text2)
  const passed = similarity < 0.2 // 应该很低

  logTest('完全不同的文本应该有很低的相似度', similarity, 0.2, passed)
  return passed ? 1 : 0
}

function testSimilarButDifferentHeadlines() {
  logSection('测试 3: 相似但不同的标题（应该检测出相似度）')

  const headlines = [
    'Samsung Galaxy S24',
    'Samsung Galaxy S24 Official',
    'Samsung Galaxy S24 Store',
  ]

  let passed = 0
  for (let i = 0; i < headlines.length; i++) {
    for (let j = i + 1; j < headlines.length; j++) {
      const similarity = calculateSimilarity(headlines[i], headlines[j])
      const isSimilar = similarity > 0.2 // 应该检测出相似
      logTest(
        `"${headlines[i]}" vs "${headlines[j]}"`,
        similarity,
        0.2,
        isSimilar
      )
      if (isSimilar) passed++
    }
  }

  return passed
}

function testDiverseHeadlines() {
  logSection('测试 4: 多样化的标题（应该检测出低相似度）')

  const headlines = [
    'Official Samsung Store',      // 品牌焦点
    '4K Resolution Display',       // 功能焦点
    'Save 40% Today',              // 促销焦点
    'Shop Now',                    // CTA焦点
    'Only 5 Left in Stock',        // 紧迫焦点
  ]

  let passed = 0
  for (let i = 0; i < headlines.length; i++) {
    for (let j = i + 1; j < headlines.length; j++) {
      const similarity = calculateSimilarity(headlines[i], headlines[j])
      const isDiverse = similarity <= 0.2 // 应该低于 20%
      logTest(
        `"${headlines[i]}" vs "${headlines[j]}"`,
        similarity,
        0.2,
        isDiverse
      )
      if (isDiverse) passed++
    }
  }

  return passed
}

function testSimilarDescriptions() {
  logSection('测试 5: 相似的描述（应该检测出相似度）')

  const descriptions = [
    'Award-Winning Tech. Rated 4.8 stars by 50K+ Happy Customers.',
    'Award-Winning Product. Rated 4.8 stars by 50K+ Customers.',
    'Trusted by 100K+ Buyers. 30-Day Money-Back Promise.',
  ]

  let passed = 0
  for (let i = 0; i < descriptions.length; i++) {
    for (let j = i + 1; j < descriptions.length; j++) {
      const similarity = calculateSimilarity(descriptions[i], descriptions[j])
      const shouldDetect = i === 0 && j === 1 ? similarity > 0.2 : similarity <= 0.2
      logTest(
        `描述 ${i + 1} vs 描述 ${j + 1}`,
        similarity,
        0.2,
        shouldDetect
      )
      if (shouldDetect) passed++
    }
  }

  return passed
}

function testMultilingualTexts() {
  logSection('测试 6: 多语言文本')

  const pairs = [
    { text1: 'Samsung Galaxy', text2: '三星 Galaxy', desc: '英文 vs 中文混合' },
    { text1: 'Free Shipping', text2: '免费送货', desc: '英文 vs 中文' },
    { text1: 'Save 40%', text2: '节省 40%', desc: '英文 vs 中文' },
  ]

  let passed = 0
  for (const pair of pairs) {
    const similarity = calculateSimilarity(pair.text1, pair.text2)
    const isDiverse = similarity <= 0.3 // 多语言应该有较低相似度
    logTest(
      `${pair.desc}: "${pair.text1}" vs "${pair.text2}"`,
      similarity,
      0.3,
      isDiverse
    )
    if (isDiverse) passed++
  }

  return passed
}

function testSynonymReplacement() {
  logSection('测试 7: 同义词替换（应该检测出相似度）')

  const pairs = [
    { text1: 'Shop Now', text2: 'Buy Now', desc: '同义词替换' },
    { text1: 'Free Delivery', text2: 'Free Shipping', desc: '同义词替换' },
    { text1: 'Limited Time', text2: 'Limited Offer', desc: '同义词替换' },
  ]

  let passed = 0
  for (const pair of pairs) {
    const similarity = calculateSimilarity(pair.text1, pair.text2)
    const shouldDetect = similarity > 0.2 // 应该检测出相似
    logTest(
      `${pair.desc}: "${pair.text1}" vs "${pair.text2}"`,
      similarity,
      0.2,
      shouldDetect
    )
    if (shouldDetect) passed++
  }

  return passed
}

function testEdgeCases() {
  logSection('测试 8: 边界情况')

  const cases = [
    { text1: '', text2: '', desc: '两个空字符串', expected: 0 },
    { text1: 'a', text2: 'a', desc: '单个字符相同', expected: 1 },
    { text1: 'a', text2: 'b', desc: '单个字符不同', expected: 0 },
    { text1: 'Samsung', text2: 'samsung', desc: '大小写不同', expected: 1 },
  ]

  let passed = 0
  for (const testCase of cases) {
    const similarity = calculateSimilarity(testCase.text1, testCase.text2)
    const isCorrect = Math.abs(similarity - testCase.expected) < 0.1
    logTest(
      `${testCase.desc}`,
      similarity,
      testCase.expected,
      isCorrect
    )
    if (isCorrect) passed++
  }

  return passed
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  console.log(chalk.bold.cyan('\n🧪 相似度计算算法测试\n'))

  let totalPassed = 0
  let totalTests = 0

  // 运行所有测试
  totalPassed += testIdenticalTexts()
  totalTests += 1

  totalPassed += testCompletelyDifferentTexts()
  totalTests += 1

  totalPassed += testSimilarButDifferentHeadlines()
  totalTests += 3

  totalPassed += testDiverseHeadlines()
  totalTests += 10

  totalPassed += testSimilarDescriptions()
  totalTests += 3

  totalPassed += testMultilingualTexts()
  totalTests += 3

  totalPassed += testSynonymReplacement()
  totalTests += 3

  totalPassed += testEdgeCases()
  totalTests += 4

  // 输出总结
  logSection('📊 测试总结')
  console.log(`✅ 通过: ${chalk.green(totalPassed)}`)
  console.log(`❌ 失败: ${chalk.red(totalTests - totalPassed)}`)
  console.log(`📈 成功率: ${chalk.bold((totalPassed / totalTests * 100).toFixed(1))}%`)

  if (totalPassed === totalTests) {
    console.log(chalk.green.bold('\n🎉 所有测试通过！\n'))
    process.exit(0)
  } else {
    console.log(chalk.red.bold(`\n⚠️  有 ${totalTests - totalPassed} 个测试失败\n`))
    process.exit(1)
  }
}

main().catch(error => {
  console.error(chalk.red('错误:'), error)
  process.exit(1)
})
