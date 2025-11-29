/**
 * 字符限制验证测试脚本
 *
 * 测试 Callouts、Sitelinks 和关键词的字符限制验证
 */

import chalk from 'chalk'

// ============================================================================
// 测试工具函数
// ============================================================================

function logSection(title: string) {
  console.log('\n' + chalk.cyan('='.repeat(70)))
  console.log(chalk.cyan(`📋 ${title}`))
  console.log(chalk.cyan('='.repeat(70)))
}

function logTest(category: string, description: string, passed: boolean) {
  const icon = passed ? chalk.green('✅') : chalk.red('❌')
  console.log(`${icon} [${category}] ${description}`)
}

function logSuccess(message: string) {
  console.log(chalk.green(`✓ ${message}`))
}

function logWarning(message: string) {
  console.log(chalk.yellow(`⚠️  ${message}`))
}

function logError(message: string) {
  console.log(chalk.red(`✗ ${message}`))
}

// ============================================================================
// Callouts 验证测试
// ============================================================================

function testCalloutsValidation() {
  logSection('Callouts 长度验证 (≤25 字符)')

  let passed = 0
  let failed = 0

  // 测试 1: 接受有效的 callouts
  const validCallouts = [
    'Free Shipping',           // 13 字符
    '免费送货',                 // 4 字符
    'Money Back Guarantee',    // 21 字符
    '24/7 Support',            // 12 字符
  ]

  const allValid = validCallouts.every(c => c.length <= 25)
  logTest('Callouts', '接受 ≤25 字符的 callouts', allValid)
  allValid ? passed++ : failed++

  // 测试 2: 检测超长 callouts
  const testCallouts = [
    'Free Shipping Worldwide',           // 24 字符 ✓
    'Free Shipping Worldwide Today',     // 31 字符 ✗
    'Envío gratis a toda España',        // 26 字符 ✗
  ]

  const invalidCallouts = testCallouts.filter(c => c.length > 25)
  const correctDetection = invalidCallouts.length === 2
  logTest('Callouts', '检测 >25 字符的 callouts', correctDetection)
  correctDetection ? passed++ : failed++

  if (invalidCallouts.length > 0) {
    invalidCallouts.forEach(c => {
      console.log(`  - "${c}" (${c.length} 字符)`)
    })
  }

  // 测试 3: 截断超长 callouts
  const truncated = testCallouts.map(c => c.substring(0, 25))
  const correctTruncation = truncated.every(c => c.length <= 25)
  logTest('Callouts', '正确截断超长 callouts', correctTruncation)
  correctTruncation ? passed++ : failed++

  // 测试 4: 多语言 callouts
  const multilingualCallouts = [
    'Free Shipping',                     // 英文 13 字符
    '免费送货',                          // 中文 4 字符
    'Envío gratis',                      // 西班牙文 12 字符
    'Livraison gratuite',                // 法文 18 字符
    'Envío gratis a toda España',        // 西班牙文 26 字符 ✗
  ]

  const multilingualInvalid = multilingualCallouts.filter(c => c.length > 25)
  const correctMultilingual = multilingualInvalid.length === 1
  logTest('Callouts', '处理多语言 callouts', correctMultilingual)
  correctMultilingual ? passed++ : failed++

  return { passed, failed }
}

// ============================================================================
// Sitelinks 验证测试
// ============================================================================

function testSitelinksValidation() {
  logSection('Sitelinks 长度验证 (text ≤25, desc ≤35)')

  let passed = 0
  let failed = 0

  // 测试 1: 接受有效的 sitelinks
  const validSitelinks = [
    { text: 'Shop Now', description: 'Free 2-Day Prime Delivery' },           // 8, 25
    { text: '立即购买', description: '免费两天送达' },                         // 4, 6
    { text: 'Support', description: 'Expert Tech Support 24/7' },             // 7, 25
  ]

  const allValid = validSitelinks.every(s => s.text.length <= 25 && s.description.length <= 35)
  logTest('Sitelinks', '接受符合要求的 sitelinks', allValid)
  allValid ? passed++ : failed++

  // 测试 2: 检测文本超长的 sitelinks
  const testSitelinks = [
    { text: 'Shop Now', description: 'Free Delivery' },                       // 8, 13 ✓
    { text: 'Compra Ahora en Oferta Especial', description: 'Free' },        // 31, 4 ✗
  ]

  const invalidText = testSitelinks.filter(s => s.text.length > 25)
  const correctTextDetection = invalidText.length === 1
  logTest('Sitelinks', '检测文本超过 25 字符的 sitelinks', correctTextDetection)
  correctTextDetection ? passed++ : failed++

  // 测试 3: 检测描述超长的 sitelinks
  const testSitelinks2 = [
    { text: 'Support', description: 'Expert Tech Support 24/7' },             // 7, 25 ✓
    { text: 'Delivery', description: 'Entrega gratuita en 2 días para miembros Prime' }, // 8, 46 ✗
  ]

  const invalidDesc = testSitelinks2.filter(s => s.description.length > 35)
  const correctDescDetection = invalidDesc.length === 1
  logTest('Sitelinks', '检测描述超过 35 字符的 sitelinks', correctDescDetection)
  correctDescDetection ? passed++ : failed++

  // 测试 4: 正确截断超长 sitelinks
  const toTruncate = [
    { text: 'Compra Ahora en Oferta Especial', description: 'Entrega gratuita en 2 días para miembros Prime' },
  ]

  const truncatedSitelinks = toTruncate.map(s => ({
    text: s.text.substring(0, 25),
    description: s.description.substring(0, 35),
  }))

  const correctTruncation = truncatedSitelinks.every(s => s.text.length <= 25 && s.description.length <= 35)
  logTest('Sitelinks', '正确截断超长 sitelinks', correctTruncation)
  correctTruncation ? passed++ : failed++

  // 测试 5: 多语言 sitelinks
  const multilingualSitelinks = [
    { text: 'Shop Now', description: 'Free 2-Day Prime Delivery' },           // 英文
    { text: '立即购买', description: '免费两天送达' },                         // 中文
    { text: 'Comprar Ahora', description: 'Envío gratis en 2 días' },        // 西班牙文
    { text: 'Acheter Maintenant', description: 'Livraison gratuite 2 jours' }, // 法文
  ]

  const validMultilingual = multilingualSitelinks.filter(s =>
    s.text.length <= 25 && s.description.length <= 35
  )
  const correctMultilingual = validMultilingual.length === 4
  logTest('Sitelinks', '处理多语言 sitelinks', correctMultilingual)
  correctMultilingual ? passed++ : failed++

  return { passed, failed }
}

// ============================================================================
// 关键词验证测试
// ============================================================================

function testKeywordsValidation() {
  logSection('关键词长度验证 (1-4 个单词)')

  let passed = 0
  let failed = 0

  // 测试 1: 接受 1-4 个单词的关键词
  const validKeywords = [
    'Samsung',                           // 1 个单词
    'Samsung Galaxy',                    // 2 个单词
    'Samsung Galaxy S24',                // 3 个单词
    'Samsung Galaxy S24 Pro',            // 4 个单词
  ]

  const allValid = validKeywords.every(k => {
    const wordCount = k.trim().split(/\s+/).length
    return wordCount >= 1 && wordCount <= 4
  })
  logTest('Keywords', '接受 1-4 个单词的关键词', allValid)
  allValid ? passed++ : failed++

  // 测试 2: 检测超过 4 个单词的关键词
  const testKeywords = [
    'Samsung Galaxy S24 Pro Max',        // 5 个单词 ✗
    'best robot vacuum for pet hair',    // 6 个单词 ✗
    'robot vacuum with mop',             // 4 个单词 ✓
  ]

  const invalidKeywords = testKeywords.filter(k => {
    const wordCount = k.trim().split(/\s+/).length
    return wordCount > 4
  })
  const correctDetection = invalidKeywords.length === 2
  logTest('Keywords', '检测超过 4 个单词的关键词', correctDetection)
  correctDetection ? passed++ : failed++

  if (invalidKeywords.length > 0) {
    invalidKeywords.forEach(k => {
      const wordCount = k.trim().split(/\s+/).length
      console.log(`  - "${k}" (${wordCount} 个单词)`)
    })
  }

  // 测试 3: 过滤不符合要求的关键词
  const toFilter = [
    'Samsung',                           // ✓
    'Samsung Galaxy',                    // ✓
    'Samsung Galaxy S24',                // ✓
    'Samsung Galaxy S24 Pro',            // ✓
    'Samsung Galaxy S24 Pro Max',        // ✗
    'best robot vacuum for pet hair',    // ✗
  ]

  const filtered = toFilter.filter(k => {
    const wordCount = k.trim().split(/\s+/).length
    return wordCount >= 1 && wordCount <= 4
  })
  const correctFiltering = filtered.length === 4
  logTest('Keywords', '正确过滤不符合要求的关键词', correctFiltering)
  correctFiltering ? passed++ : failed++

  // 测试 4: 多语言关键词
  const multilingualKeywords = [
    'Samsung',                           // 英文 1 个单词
    '三星',                              // 中文 1 个单词
    'Samsung Galaxy',                    // 英文 2 个单词
    '三星 Galaxy',                       // 混合 2 个单词
    'robot vacuum for pet hair',         // 英文 5 个单词 ✗
    '宠物毛发机器人吸尘器',              // 中文 1 个单词
  ]

  const validMultilingual = multilingualKeywords.filter(k => {
    if (!k) return false
    const wordCount = k.trim().split(/\s+/).length
    return wordCount >= 1 && wordCount <= 4
  })
  const correctMultilingual = validMultilingual.length === 5
  logTest('Keywords', '处理多语言关键词', correctMultilingual)
  correctMultilingual ? passed++ : failed++

  // 测试 5: 处理特殊字符
  const specialCharKeywords = [
    'Samsung-Galaxy',                    // 1 个单词 (连字符)
    'Samsung & Galaxy',                  // 2 个单词
    'Samsung (Galaxy)',                  // 2 个单词
    'Samsung/Galaxy',                    // 1 个单词 (斜杠)
  ]

  const validSpecial = specialCharKeywords.filter(k => {
    const wordCount = k.trim().split(/\s+/).length
    return wordCount >= 1 && wordCount <= 4
  })
  const correctSpecial = validSpecial.length === 4
  logTest('Keywords', '处理带有特殊字符的关键词', correctSpecial)
  correctSpecial ? passed++ : failed++

  return { passed, failed }
}

// ============================================================================
// 综合验证测试
// ============================================================================

function testIntegratedValidation() {
  logSection('综合验证')

  let passed = 0
  let failed = 0

  // 测试 1: 同时验证所有元素
  const creative = {
    callouts: [
      'Free Shipping',                   // ✓
      'Free Shipping Worldwide Today',   // ✗ (31 字符)
    ],
    sitelinks: [
      { text: 'Shop Now', description: 'Free Delivery' },                    // ✓
      { text: 'Compra Ahora en Oferta Especial', description: 'Free' },     // ✗ (31 字符)
    ],
    keywords: [
      'Samsung',                         // ✓
      'Samsung Galaxy S24 Pro Max',      // ✗ (5 个单词)
    ],
  }

  const invalidCallouts = creative.callouts.filter(c => c.length > 25)
  const invalidSitelinks = creative.sitelinks.filter(s =>
    s.text.length > 25 || s.description.length > 35
  )
  const invalidKeywords = creative.keywords.filter(k => {
    const wordCount = k.trim().split(/\s+/).length
    return wordCount < 1 || wordCount > 4
  })

  const totalInvalid = invalidCallouts.length + invalidSitelinks.length + invalidKeywords.length
  const correctDetection = totalInvalid === 3
  logTest('Integrated', '同时验证 callouts、sitelinks 和关键词', correctDetection)
  correctDetection ? passed++ : failed++

  // 测试 2: 完全有效的创意
  const validCreative = {
    callouts: [
      'Free Shipping',
      '免费送货',
      'Money Back Guarantee',
    ],
    sitelinks: [
      { text: 'Shop Now', description: 'Free 2-Day Prime Delivery' },
      { text: '立即购买', description: '免费两天送达' },
    ],
    keywords: [
      'Samsung',
      'Samsung Galaxy',
      'Samsung Galaxy S24',
    ],
  }

  const validCallouts = validCreative.callouts.filter(c => c.length > 25)
  const validSitelinks = validCreative.sitelinks.filter(s =>
    s.text.length > 25 || s.description.length > 35
  )
  const validKeywords = validCreative.keywords.filter(k => {
    const wordCount = k.trim().split(/\s+/).length
    return wordCount < 1 || wordCount > 4
  })

  const totalValid = validCallouts.length + validSitelinks.length + validKeywords.length
  const allValid = totalValid === 0
  logTest('Integrated', '完全有效的创意通过验证', allValid)
  allValid ? passed++ : failed++

  return { passed, failed }
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  console.log(chalk.bold.cyan('\n🧪 字符限制验证测试\n'))

  let totalPassed = 0
  let totalFailed = 0

  // 运行所有测试
  const calloutsResult = testCalloutsValidation()
  totalPassed += calloutsResult.passed
  totalFailed += calloutsResult.failed

  const sitelinksResult = testSitelinksValidation()
  totalPassed += sitelinksResult.passed
  totalFailed += sitelinksResult.failed

  const keywordsResult = testKeywordsValidation()
  totalPassed += keywordsResult.passed
  totalFailed += keywordsResult.failed

  const integratedResult = testIntegratedValidation()
  totalPassed += integratedResult.passed
  totalFailed += integratedResult.failed

  // 输出总结
  logSection('📊 测试总结')
  console.log(`✅ 通过: ${chalk.green(totalPassed)}`)
  console.log(`❌ 失败: ${chalk.red(totalFailed)}`)
  console.log(`📈 成功率: ${chalk.bold((totalPassed / (totalPassed + totalFailed) * 100).toFixed(1))}%`)

  if (totalFailed === 0) {
    console.log(chalk.green.bold('\n🎉 所有测试通过！\n'))
    process.exit(0)
  } else {
    console.log(chalk.red.bold(`\n⚠️  有 ${totalFailed} 个测试失败\n`))
    process.exit(1)
  }
}

main().catch(error => {
  console.error(chalk.red('错误:'), error)
  process.exit(1)
})
