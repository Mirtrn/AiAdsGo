/**
 * 多语言评分系统测试 - 验证意大利语创意engagement分数修复效果
 *
 * 测试目标：
 * 1. 验证意大利语CTA词汇是否被正确识别（acquista, scopri, iscriviti等）
 * 2. 验证意大利语紧迫感词汇是否被正确识别（limitato, oggi, ora, scade等）
 * 3. 对比意大利语创意 vs 英语创意的engagement分数
 * 4. 确保多语言支持不会降低评分准确性
 * 5. 验证修复后意大利语创意能获得更高的engagement分数
 */

import { scoreAdCreativeLocally, AdCreative } from '../src/lib/ad-creative-scorer'

interface TestResult {
  language: string
  name: string
  totalScore: number
  engagement: number
  breakdown: any
  ctaWordsFound: string[]
  urgencyWordsFound: string[]
}

// 意大利语CTA词汇表（用于验证）
const ITALIAN_CTA_WORDS = ['acquista', 'compra', 'ordina', 'scopri', 'iscriviti', 'prova', 'inizia', 'scarica', 'unisciti', 'risparmia', 'ottieni', 'richiedi']
const ITALIAN_URGENCY_WORDS = ['limitato', 'oggi', 'ora', 'subito', 'esclusivo', 'solo', 'scade', 'occasione', 'tempo limitato', 'scorte limitate', 'urgente', 'ultimi', 'pochi pezzi', 'breve']

// 测试用例1：意大利语创意（高engagement - 含CTA+紧迫感）
const italianCreativeHigh: AdCreative = {
  headline: [
    'Acquista Ora Eufy Security',
    'Risparmia Oggi su Telecamere',
    'Scopri la Sicurezza Eufy',
    'Offerta Limitata - Iscriviti',
    'Ultimi Pezzi Disponibili'
  ],
  description: [
    'Telecamere di sicurezza premium con risoluzione 12MP. Offerta limitata - Acquista subito e risparmia fino al 50%.',
    'Eufy offre la migliore sicurezza per la tua casa. Scopri di più oggi e ottieni uno sconto esclusivo.'
  ],
  keywords: ['eufy', 'telecamera', 'sicurezza', 'smart home', 'acquista', 'sconto'],
  callouts: ['Spedizione Gratuita', 'Garanzia 30 Giorni', 'Supporto 24/7'],
  theme: 'Security'
}

// 测试用例2：意大利语创意（中等engagement - 仅含CTA）
const italianCreativeMedium: AdCreative = {
  headline: [
    'Compra Online Eufy',
    'Prodotti di Qualità',
    'Consegna Veloce',
    'Prezzi Competitivi',
    'Servizio Affidabile'
  ],
  description: [
    'Ordina i tuoi prodotti preferiti online con facilità. Consegna rapida in tutta Italia.',
    'Eufy offre prodotti di alta qualità con prezzi competitivi. Scopri la nostra collezione.'
  ],
  keywords: ['eufy', 'telecamera', 'sicurezza', 'smart home'],
  callouts: ['Pagamento Sicuro', 'Reso Facile'],
  theme: 'Security'
}

// 测试用例3：意大利语创意（低engagement - 无CTA无紧迫感）
const italianCreativeLow: AdCreative = {
  headline: [
    'I Nostri Prodotti Eufy',
    'Qualità Superiore',
    'Affidabile e Sicuro',
    'Esperienza Positiva',
    'Soddisfazione Garantita'
  ],
  description: [
    'Scopri la vasta gamma di prodotti Eufy di alta qualità. Siamo impegnati a fornire il miglior servizio.',
    'Eufy è un marchio affidabile con anni di esperienza nel settore della sicurezza domestica.'
  ],
  keywords: ['eufy', 'telecamera', 'sicurezza', 'smart home'],
  callouts: ['Certificato', 'Verificato'],
  theme: 'Security'
}

// 对比：英语创意（高engagement）
const englishCreativeHigh: AdCreative = {
  headline: [
    'Buy Now Eufy Security',
    'Save Today on Cameras',
    'Discover Eufy Security',
    'Limited Offer - Sign Up',
    'Last Stock Available'
  ],
  description: [
    'Premium security cameras with 12MP resolution. Limited offer - Buy now and save up to 50%.',
    'Eufy offers the best security for your home. Learn more today and get an exclusive discount.'
  ],
  keywords: ['eufy', 'camera', 'security', 'smart home', 'buy', 'discount'],
  callouts: ['Free Shipping', '30-Day Guarantee', '24/7 Support'],
  theme: 'Security'
}

// 对比：中文创意（高engagement）
const chineseCreativeHigh: AdCreative = {
  headline: [
    '立即购买Eufy安防',
    '今天特价摄像头',
    '探索Eufy安全系统',
    '限时优惠 - 立即注册',
    '仅剩库存'
  ],
  description: [
    '高端安防摄像头，12MP分辨率。限时优惠 - 立即下单享折扣高达50%。',
    'Eufy为您的家提供最佳安全保障。了解更多优惠并获得独家折扣。'
  ],
  keywords: ['eufy', '摄像头', '安防', '智能家居', '购买', '折扣'],
  callouts: ['免费送货', '30天保证', '24/7支持'],
  theme: 'Security'
}

// 对比：日语创意（高engagement）
const japaneseCreativeHigh: AdCreative = {
  headline: [
    '今すぐ購入 Eufy Security',
    '今日限定 カメラセール',
    'Eufy セキュリティを発見',
    '限定オファー - 登録',
    '在庫限り'
  ],
  description: [
    '12MP解像度のプレミアムセキュリティカメラ。限定オファー - 今すぐ購入して最大50%節約。',
    'Eufyはあなたの家に最高のセキュリティを提供します。詳しくはこちらで独占割引を取得。'
  ],
  keywords: ['eufy', 'カメラ', 'セキュリティ', 'スマートホーム', '購入', '割引'],
  callouts: ['送料無料', '30日保証', '24/7サポート'],
  theme: 'Security'
}

const context = {
  brandName: 'Eufy',
  targetCountry: 'IT',
  productCategory: 'Security Cameras'
}

/**
 * 检测文本中的CTA和紧迫感词汇
 */
function detectKeywords(text: string, keywords: string[]): string[] {
  const lowerText = text.toLowerCase()
  return keywords.filter(kw => lowerText.includes(kw.toLowerCase()))
}

/**
 * 运行测试
 */
function runTests() {
  console.log('\n' + '='.repeat(100))
  console.log('🌍 多语言评分系统测试 - 意大利语创意engagement分数验证')
  console.log('='.repeat(100) + '\n')

  const results: TestResult[] = []

  // 测试意大利语创意
  console.log('📍 意大利语创意评分测试\n')
  console.log('-'.repeat(100))

  // 高engagement
  console.log('\n【测试1】意大利语创意 - 高engagement（含CTA+紧迫感）')
  const itHighText = [...italianCreativeHigh.headline, ...italianCreativeHigh.description].join(' ')
  const itHighCTA = detectKeywords(itHighText, ITALIAN_CTA_WORDS)
  const itHighUrgency = detectKeywords(itHighText, ITALIAN_URGENCY_WORDS)
  const itHighResult = scoreAdCreativeLocally(italianCreativeHigh, context)

  console.log(`  检测到CTA词汇: ${itHighCTA.join(', ')} (${itHighCTA.length}个)`)
  console.log(`  检测到紧迫感词汇: ${itHighUrgency.join(', ')} (${itHighUrgency.length}个)`)
  console.log(`  总分: ${itHighResult.score}/100`)
  console.log(`  Engagement分数: ${itHighResult.score_breakdown.engagement}/100 ✅ (期望: 80+)`)
  console.log(`  评分详情:`)
  console.log(`    - Relevance: ${itHighResult.score_breakdown.relevance}/100`)
  console.log(`    - Quality: ${itHighResult.score_breakdown.quality}/100`)
  console.log(`    - Engagement: ${itHighResult.score_breakdown.engagement}/100`)
  console.log(`    - Diversity: ${itHighResult.score_breakdown.diversity}/100`)
  console.log(`    - Clarity: ${itHighResult.score_breakdown.clarity}/100`)

  results.push({
    language: 'Italian',
    name: '高engagement（含CTA+紧迫感）',
    totalScore: itHighResult.score,
    engagement: itHighResult.score_breakdown.engagement,
    breakdown: itHighResult.score_breakdown,
    ctaWordsFound: itHighCTA,
    urgencyWordsFound: itHighUrgency
  })

  // 中等engagement
  console.log('\n【测试2】意大利语创意 - 中等engagement（仅含CTA）')
  const itMediumText = [...italianCreativeMedium.headline, ...italianCreativeMedium.description].join(' ')
  const itMediumCTA = detectKeywords(itMediumText, ITALIAN_CTA_WORDS)
  const itMediumUrgency = detectKeywords(itMediumText, ITALIAN_URGENCY_WORDS)
  const itMediumResult = scoreAdCreativeLocally(italianCreativeMedium, context)

  console.log(`  检测到CTA词汇: ${itMediumCTA.join(', ')} (${itMediumCTA.length}个)`)
  console.log(`  检测到紧迫感词汇: ${itMediumUrgency.join(', ')} (${itMediumUrgency.length}个)`)
  console.log(`  总分: ${itMediumResult.score}/100`)
  console.log(`  Engagement分数: ${itMediumResult.score_breakdown.engagement}/100 ⚠️ (期望: 65-75)`)
  console.log(`  评分详情:`)
  console.log(`    - Relevance: ${itMediumResult.score_breakdown.relevance}/100`)
  console.log(`    - Quality: ${itMediumResult.score_breakdown.quality}/100`)
  console.log(`    - Engagement: ${itMediumResult.score_breakdown.engagement}/100`)
  console.log(`    - Diversity: ${itMediumResult.score_breakdown.diversity}/100`)
  console.log(`    - Clarity: ${itMediumResult.score_breakdown.clarity}/100`)

  results.push({
    language: 'Italian',
    name: '中等engagement（仅含CTA）',
    totalScore: itMediumResult.score,
    engagement: itMediumResult.score_breakdown.engagement,
    breakdown: itMediumResult.score_breakdown,
    ctaWordsFound: itMediumCTA,
    urgencyWordsFound: itMediumUrgency
  })

  // 低engagement
  console.log('\n【测试3】意大利语创意 - 低engagement（无CTA无紧迫感）')
  const itLowText = [...italianCreativeLow.headline, ...italianCreativeLow.description].join(' ')
  const itLowCTA = detectKeywords(itLowText, ITALIAN_CTA_WORDS)
  const itLowUrgency = detectKeywords(itLowText, ITALIAN_URGENCY_WORDS)
  const itLowResult = scoreAdCreativeLocally(italianCreativeLow, context)

  console.log(`  检测到CTA词汇: ${itLowCTA.join(', ') || '无'} (${itLowCTA.length}个)`)
  console.log(`  检测到紧迫感词汇: ${itLowUrgency.join(', ') || '无'} (${itLowUrgency.length}个)`)
  console.log(`  总分: ${itLowResult.score}/100`)
  console.log(`  Engagement分数: ${itLowResult.score_breakdown.engagement}/100 ❌ (期望: 60-70)`)
  console.log(`  评分详情:`)
  console.log(`    - Relevance: ${itLowResult.score_breakdown.relevance}/100`)
  console.log(`    - Quality: ${itLowResult.score_breakdown.quality}/100`)
  console.log(`    - Engagement: ${itLowResult.score_breakdown.engagement}/100`)
  console.log(`    - Diversity: ${itLowResult.score_breakdown.diversity}/100`)
  console.log(`    - Clarity: ${itLowResult.score_breakdown.clarity}/100`)

  results.push({
    language: 'Italian',
    name: '低engagement（无CTA无紧迫感）',
    totalScore: itLowResult.score,
    engagement: itLowResult.score_breakdown.engagement,
    breakdown: itLowResult.score_breakdown,
    ctaWordsFound: itLowCTA,
    urgencyWordsFound: itLowUrgency
  })

  // 对比其他语言
  console.log('\n' + '-'.repeat(100))
  console.log('\n📍 多语言对比测试（高engagement创意）\n')

  // 英语
  console.log('【英语创意 - 高engagement】')
  const enHighText = [...englishCreativeHigh.headline, ...englishCreativeHigh.description].join(' ')
  const enHighResult = scoreAdCreativeLocally(englishCreativeHigh, context)
  console.log(`  总分: ${enHighResult.score}/100`)
  console.log(`  Engagement分数: ${enHighResult.score_breakdown.engagement}/100`)

  results.push({
    language: 'English',
    name: '高engagement（含CTA+紧迫感）',
    totalScore: enHighResult.score,
    engagement: enHighResult.score_breakdown.engagement,
    breakdown: enHighResult.score_breakdown,
    ctaWordsFound: [],
    urgencyWordsFound: []
  })

  // 中文
  console.log('\n【中文创意 - 高engagement】')
  const zhHighText = [...chineseCreativeHigh.headline, ...chineseCreativeHigh.description].join(' ')
  const zhHighResult = scoreAdCreativeLocally(chineseCreativeHigh, context)
  console.log(`  总分: ${zhHighResult.score}/100`)
  console.log(`  Engagement分数: ${zhHighResult.score_breakdown.engagement}/100`)

  results.push({
    language: 'Chinese',
    name: '高engagement（含CTA+紧迫感）',
    totalScore: zhHighResult.score,
    engagement: zhHighResult.score_breakdown.engagement,
    breakdown: zhHighResult.score_breakdown,
    ctaWordsFound: [],
    urgencyWordsFound: []
  })

  // 日语
  console.log('\n【日语创意 - 高engagement】')
  const jaHighText = [...japaneseCreativeHigh.headline, ...japaneseCreativeHigh.description].join(' ')
  const jaHighResult = scoreAdCreativeLocally(japaneseCreativeHigh, context)
  console.log(`  总分: ${jaHighResult.score}/100`)
  console.log(`  Engagement分数: ${jaHighResult.score_breakdown.engagement}/100`)

  results.push({
    language: 'Japanese',
    name: '高engagement（含CTA+紧迫感）',
    totalScore: jaHighResult.score,
    engagement: jaHighResult.score_breakdown.engagement,
    breakdown: jaHighResult.score_breakdown,
    ctaWordsFound: [],
    urgencyWordsFound: []
  })

  // 对比分析
  console.log('\n' + '='.repeat(100))
  console.log('\n📊 对比分析\n')

  const italianHighEng = results[0].engagement
  const englishHighEng = results[3].engagement
  const chineseHighEng = results[4].engagement
  const japaneseHighEng = results[5].engagement

  console.log('高engagement创意的Engagement分数对比:')
  console.log(`  意大利语: ${italianHighEng}/100`)
  console.log(`  英语: ${englishHighEng}/100`)
  console.log(`  中文: ${chineseHighEng}/100`)
  console.log(`  日语: ${japaneseHighEng}/100`)

  const avgEngagement = (italianHighEng + englishHighEng + chineseHighEng + japaneseHighEng) / 4
  const italianDiff = italianHighEng - avgEngagement
  const englishDiff = englishHighEng - avgEngagement
  const chineseDiff = chineseHighEng - avgEngagement
  const japaneseDiff = japaneseHighEng - avgEngagement

  console.log(`\n平均Engagement分数: ${avgEngagement.toFixed(1)}/100`)
  console.log(`  意大利语差异: ${italianDiff > 0 ? '+' : ''}${italianDiff.toFixed(1)}`)
  console.log(`  英语差异: ${englishDiff > 0 ? '+' : ''}${englishDiff.toFixed(1)}`)
  console.log(`  中文差异: ${chineseDiff > 0 ? '+' : ''}${chineseDiff.toFixed(1)}`)
  console.log(`  日语差异: ${japaneseDiff > 0 ? '+' : ''}${japaneseDiff.toFixed(1)}`)

  const maxDiff = Math.max(
    Math.abs(italianDiff),
    Math.abs(englishDiff),
    Math.abs(chineseDiff),
    Math.abs(japaneseDiff)
  )

  console.log(`\n多语言一致性: ${maxDiff <= 5 ? '✅ 良好' : '⚠️ 需要改进'} (最大差异: ${maxDiff.toFixed(1)})`)

  // 意大利语分层测试
  console.log('\n' + '='.repeat(100))
  console.log('\n📈 意大利语创意分层测试\n')

  const italianEngagementScores = [
    results[0].engagement,
    results[1].engagement,
    results[2].engagement
  ]

  console.log('Engagement分数分层:')
  console.log(`  高engagement: ${italianEngagementScores[0]}/100`)
  console.log(`  中等engagement: ${italianEngagementScores[1]}/100`)
  console.log(`  低engagement: ${italianEngagementScores[2]}/100`)

  const isProgressive = italianEngagementScores[0] > italianEngagementScores[1] && italianEngagementScores[1] > italianEngagementScores[2]
  console.log(`\n分层合理性: ${isProgressive ? '✅ 合理' : '❌ 不合理'} (应该: 高 > 中 > 低)`)

  // 最终结论
  console.log('\n' + '='.repeat(100))
  console.log('\n🎯 测试结论\n')

  const italianHighPassed = italianHighEng >= 80
  const italianMediumPassed = results[1].engagement >= 65 && results[1].engagement <= 75
  const italianLowPassed = results[2].engagement >= 60 && results[2].engagement <= 70
  const multilingualConsistent = maxDiff <= 5

  console.log('意大利语创意评分:')
  console.log(`  高engagement: ${italianHighPassed ? '✅ 通过' : '❌ 未通过'} (${italianHighEng}/100)`)
  console.log(`  中等engagement: ${italianMediumPassed ? '✅ 通过' : '❌ 未通过'} (${results[1].engagement}/100)`)
  console.log(`  低engagement: ${italianLowPassed ? '✅ 通过' : '❌ 未通过'} (${results[2].engagement}/100)`)

  console.log(`\n多语言支持:`)
  console.log(`  一致性: ${multilingualConsistent ? '✅ 良好' : '⚠️ 需要改进'}`)

  if (italianHighPassed && italianMediumPassed && italianLowPassed && multilingualConsistent) {
    console.log('\n✅ 所有测试通过！意大利语创意评分系统工作正常')
    console.log('✅ 多语言支持一致性良好，意大利语创意能获得合理的engagement分数')
  } else {
    console.log('\n⚠️ 部分测试未通过，需要进一步调整')
  }

  console.log('\n' + '='.repeat(100) + '\n')
}

// 运行测试
runTests()
