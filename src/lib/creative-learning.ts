/**
 * AI创意学习系统
 *
 * 功能：
 * - 分析历史高表现创意
 * - 提取成功特征模式
 * - 优化AI生成Prompt
 * - 提供个性化创意建议
 */

import { getDatabase } from '@/lib/db'

export interface HistoricalCreative {
  creativeId: number
  headline1: string
  headline2: string | null
  headline3: string | null
  description1: string
  description2: string | null
  ctr: number
  clicks: number
  impressions: number
  conversions: number
  conversionRate: number
}

export interface CreativePattern {
  pattern: string
  frequency: number
  avgCtr: number
  avgConversionRate: number
  examples: string[]
}

export interface SuccessFeatures {
  // 标题特征
  headlinePatterns: {
    avgLength: number
    commonWords: string[]
    commonPhrases: string[]
    usesNumbers: number // 使用数字的比例
    usesQuestions: number // 使用疑问的比例
    usesAction: number // 使用动作词的比例
  }

  // 描述特征
  descriptionPatterns: {
    avgLength: number
    commonWords: string[]
    commonPhrases: string[]
    mentionsBenefit: number // 提及好处的比例
    mentionsUrgency: number // 紧迫性的比例
  }

  // CTA（Call-to-Action）特征
  ctaPatterns: {
    commonCtas: string[]
    avgPosition: string // early/middle/late
  }

  // 整体风格
  stylePatterns: {
    toneOfVoice: string[] // professional, casual, urgent, friendly
    emotionalAppeal: string[] // fear, desire, curiosity, trust
  }

  // 高表现阈值
  benchmarks: {
    minCtr: number
    avgCtr: number
    minConversionRate: number
    avgConversionRate: number
  }
}

/**
 * 查询高表现历史创意
 */
export function queryHighPerformingCreatives(
  userId: number,
  minCtr: number = 0.03, // 3%
  minClicks: number = 100,
  limit: number = 50
): HistoricalCreative[] {
  const db = getDatabase()

  // 查询高CTR的创意及其性能数据
  const stmt = db.prepare(`
    SELECT
      c.id as creativeId,
      c.headline1,
      c.headline2,
      c.headline3,
      c.description1,
      c.description2,
      COALESCE(SUM(cp.clicks), 0) as clicks,
      COALESCE(SUM(cp.impressions), 0) as impressions,
      COALESCE(SUM(cp.conversions), 0) as conversions,
      CASE
        WHEN SUM(cp.impressions) > 0
        THEN CAST(SUM(cp.clicks) AS REAL) / SUM(cp.impressions)
        ELSE 0
      END as ctr,
      CASE
        WHEN SUM(cp.clicks) > 0
        THEN CAST(SUM(cp.conversions) AS REAL) / SUM(cp.clicks)
        ELSE 0
      END as conversionRate
    FROM creative_versions c
    LEFT JOIN campaigns camp ON c.id = camp.current_creative_id
    LEFT JOIN campaign_performance cp ON camp.id = cp.campaign_id
    WHERE c.user_id = ?
      AND c.version_number > 0
    GROUP BY c.id
    HAVING SUM(cp.clicks) >= ?
      AND ctr >= ?
    ORDER BY ctr DESC, conversionRate DESC
    LIMIT ?
  `)

  return stmt.all(userId, minClicks, minCtr, limit) as HistoricalCreative[]
}

/**
 * 提取常见词汇
 */
function extractCommonWords(texts: string[], minFrequency: number = 3): string[] {
  const wordCounts = new Map<string, number>()

  // 停用词（中英文）
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    '的', '了', '和', '是', '在', '我', '你', '他', '她', '它', '我们', '你们', '他们'
  ])

  texts.forEach(text => {
    if (!text) return

    // 提取单词（支持中英文分词）
    const words = text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1 && !stopWords.has(word))

    words.forEach(word => {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1)
    })
  })

  // 过滤高频词
  return Array.from(wordCounts.entries())
    .filter(([_, count]) => count >= minFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word)
}

/**
 * 提取常见短语（2-3个词）
 */
function extractCommonPhrases(texts: string[], minFrequency: number = 2): string[] {
  const phraseCounts = new Map<string, number>()

  texts.forEach(text => {
    if (!text) return

    const words = text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)

    // 提取2-gram和3-gram
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = words.slice(i, i + 2).join(' ')
      phraseCounts.set(bigram, (phraseCounts.get(bigram) || 0) + 1)

      if (i < words.length - 2) {
        const trigram = words.slice(i, i + 3).join(' ')
        phraseCounts.set(trigram, (phraseCounts.get(trigram) || 0) + 1)
      }
    }
  })

  return Array.from(phraseCounts.entries())
    .filter(([_, count]) => count >= minFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase]) => phrase)
}

/**
 * 检测文本特征
 */
function analyzeTextFeatures(texts: string[]): {
  avgLength: number
  usesNumbers: number
  usesQuestions: number
  usesAction: number
  mentionsBenefit: number
  mentionsUrgency: number
} {
  let totalLength = 0
  let usesNumbers = 0
  let usesQuestions = 0
  let usesAction = 0
  let mentionsBenefit = 0
  let mentionsUrgency = 0

  const actionWords = [
    'get', 'buy', 'order', 'shop', 'discover', 'learn', 'save', 'start', 'try', 'join',
    '获取', '购买', '订购', '了解', '发现', '节省', '开始', '加入', '体验'
  ]

  const benefitWords = [
    'free', 'save', 'discount', 'best', 'quality', 'guarantee', 'bonus',
    '免费', '优惠', '折扣', '最好', '品质', '保证', '赠送', '省钱'
  ]

  const urgencyWords = [
    'now', 'today', 'limited', 'hurry', 'last chance', 'expires', 'soon',
    '现在', '今天', '限时', '赶快', '最后机会', '即将', '马上'
  ]

  const validTexts = texts.filter(t => t && t.length > 0)
  if (validTexts.length === 0) {
    return {
      avgLength: 0,
      usesNumbers: 0,
      usesQuestions: 0,
      usesAction: 0,
      mentionsBenefit: 0,
      mentionsUrgency: 0
    }
  }

  validTexts.forEach(text => {
    totalLength += text.length
    if (/\d/.test(text)) usesNumbers++
    if (/[?？]/.test(text)) usesQuestions++
    if (actionWords.some(w => text.toLowerCase().includes(w))) usesAction++
    if (benefitWords.some(w => text.toLowerCase().includes(w))) mentionsBenefit++
    if (urgencyWords.some(w => text.toLowerCase().includes(w))) mentionsUrgency++
  })

  return {
    avgLength: Math.round(totalLength / validTexts.length),
    usesNumbers: usesNumbers / validTexts.length,
    usesQuestions: usesQuestions / validTexts.length,
    usesAction: usesAction / validTexts.length,
    mentionsBenefit: mentionsBenefit / validTexts.length,
    mentionsUrgency: mentionsUrgency / validTexts.length
  }
}

/**
 * 提取CTA模式
 */
function extractCtaPatterns(descriptions: string[]): {
  commonCtas: string[]
  avgPosition: string
} {
  const ctaKeywords = [
    '立即', '马上', '现在', '点击', '购买', '订购', '了解', '咨询',
    'buy now', 'shop now', 'learn more', 'get started', 'order now', 'click here'
  ]

  const ctas: string[] = []
  let positionSum = 0
  let positionCount = 0

  descriptions.forEach(desc => {
    if (!desc) return

    const lower = desc.toLowerCase()
    ctaKeywords.forEach(keyword => {
      if (lower.includes(keyword)) {
        ctas.push(keyword)

        // 计算CTA位置（前1/3、中1/3、后1/3）
        const position = lower.indexOf(keyword) / desc.length
        positionSum += position
        positionCount++
      }
    })
  })

  // 统计最常见的CTA
  const ctaCounts = new Map<string, number>()
  ctas.forEach(cta => {
    ctaCounts.set(cta, (ctaCounts.get(cta) || 0) + 1)
  })

  const commonCtas = Array.from(ctaCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cta]) => cta)

  // 平均位置
  const avgPos = positionCount > 0 ? positionSum / positionCount : 0.5
  const avgPosition = avgPos < 0.33 ? 'early' : avgPos < 0.67 ? 'middle' : 'late'

  return { commonCtas, avgPosition }
}

/**
 * 分析成功创意特征
 */
export function analyzeSuccessFeatures(creatives: HistoricalCreative[]): SuccessFeatures {
  if (creatives.length === 0) {
    // 返回默认特征
    return {
      headlinePatterns: {
        avgLength: 30,
        commonWords: [],
        commonPhrases: [],
        usesNumbers: 0,
        usesQuestions: 0,
        usesAction: 0
      },
      descriptionPatterns: {
        avgLength: 60,
        commonWords: [],
        commonPhrases: [],
        mentionsBenefit: 0,
        mentionsUrgency: 0
      },
      ctaPatterns: {
        commonCtas: [],
        avgPosition: 'middle'
      },
      stylePatterns: {
        toneOfVoice: ['professional'],
        emotionalAppeal: ['trust']
      },
      benchmarks: {
        minCtr: 0.03,
        avgCtr: 0.03,
        minConversionRate: 0.01,
        avgConversionRate: 0.01
      }
    }
  }

  // 收集所有标题和描述
  const headlines = creatives.flatMap(c => [c.headline1, c.headline2, c.headline3].filter(Boolean) as string[])
  const descriptions = creatives.flatMap(c => [c.description1, c.description2].filter(Boolean) as string[])

  // 分析标题特征
  const headlineFeatures = analyzeTextFeatures(headlines)
  const headlineWords = extractCommonWords(headlines)
  const headlinePhrases = extractCommonPhrases(headlines)

  // 分析描述特征
  const descriptionFeatures = analyzeTextFeatures(descriptions)
  const descriptionWords = extractCommonWords(descriptions)
  const descriptionPhrases = extractCommonPhrases(descriptions)

  // 提取CTA模式
  const ctaPatterns = extractCtaPatterns(descriptions)

  // 计算基准
  const ctrs = creatives.map(c => c.ctr)
  const conversionRates = creatives.map(c => c.conversionRate)

  const avgCtr = ctrs.reduce((sum, ctr) => sum + ctr, 0) / ctrs.length
  const avgConversionRate = conversionRates.reduce((sum, rate) => sum + rate, 0) / conversionRates.length

  // 推断风格（简单的启发式规则）
  const toneOfVoice: string[] = []
  const emotionalAppeal: string[] = []

  if (headlineFeatures.usesAction > 0.5) toneOfVoice.push('action-oriented')
  if (headlineFeatures.usesQuestions > 0.3) toneOfVoice.push('inquisitive')
  if (descriptionFeatures.mentionsBenefit > 0.5) emotionalAppeal.push('benefit-focused')
  if (descriptionFeatures.mentionsUrgency > 0.3) emotionalAppeal.push('urgency-driven')

  if (toneOfVoice.length === 0) toneOfVoice.push('professional')
  if (emotionalAppeal.length === 0) emotionalAppeal.push('trust-based')

  return {
    headlinePatterns: {
      avgLength: headlineFeatures.avgLength,
      commonWords: headlineWords,
      commonPhrases: headlinePhrases,
      usesNumbers: headlineFeatures.usesNumbers,
      usesQuestions: headlineFeatures.usesQuestions,
      usesAction: headlineFeatures.usesAction
    },
    descriptionPatterns: {
      avgLength: descriptionFeatures.avgLength,
      commonWords: descriptionWords,
      commonPhrases: descriptionPhrases,
      mentionsBenefit: descriptionFeatures.mentionsBenefit,
      mentionsUrgency: descriptionFeatures.mentionsUrgency
    },
    ctaPatterns,
    stylePatterns: {
      toneOfVoice,
      emotionalAppeal
    },
    benchmarks: {
      minCtr: Math.min(...ctrs),
      avgCtr,
      minConversionRate: Math.min(...conversionRates),
      avgConversionRate
    }
  }
}

/**
 * 生成增强的AI Prompt
 */
export function generateEnhancedPrompt(
  basePrompt: string,
  features: SuccessFeatures
): string {
  const enhancements: string[] = []

  // 标题建议
  if (features.headlinePatterns.commonWords.length > 0) {
    enhancements.push(
      `高效标题常用词汇：${features.headlinePatterns.commonWords.slice(0, 10).join(', ')}`
    )
  }

  if (features.headlinePatterns.usesNumbers > 0.3) {
    enhancements.push('建议在标题中使用具体数字（如折扣、数量、时间）')
  }

  if (features.headlinePatterns.usesQuestions > 0.2) {
    enhancements.push('可以考虑使用疑问句式吸引注意力')
  }

  if (features.headlinePatterns.usesAction > 0.4) {
    enhancements.push('使用动作词汇（如：获取、了解、发现）增强行动感')
  }

  // 描述建议
  if (features.descriptionPatterns.commonWords.length > 0) {
    enhancements.push(
      `高转化描述关键词：${features.descriptionPatterns.commonWords.slice(0, 10).join(', ')}`
    )
  }

  if (features.descriptionPatterns.mentionsBenefit > 0.4) {
    enhancements.push('突出产品好处和用户价值（如：免费、优惠、保证）')
  }

  if (features.descriptionPatterns.mentionsUrgency > 0.2) {
    enhancements.push('适度使用紧迫性词汇（如：限时、今天、马上）')
  }

  // CTA建议
  if (features.ctaPatterns.commonCtas.length > 0) {
    enhancements.push(
      `推荐CTA：${features.ctaPatterns.commonCtas.join(', ')}`
    )
  }

  enhancements.push(
    `CTA最佳位置：描述的${features.ctaPatterns.avgPosition === 'early' ? '开头' : features.ctaPatterns.avgPosition === 'middle' ? '中间' : '结尾'}`
  )

  // 风格建议
  enhancements.push(`语气风格：${features.stylePatterns.toneOfVoice.join(', ')}`)
  enhancements.push(`情感诉求：${features.stylePatterns.emotionalAppeal.join(', ')}`)

  // 性能基准
  enhancements.push(
    `参考基准：CTR ${(features.benchmarks.avgCtr * 100).toFixed(1)}%，转化率 ${(features.benchmarks.avgConversionRate * 100).toFixed(1)}%`
  )

  const enhancedPrompt = `${basePrompt}

## 基于历史高表现创意的优化建议

${enhancements.map((e, i) => `${i + 1}. ${e}`).join('\n')}

请根据以上建议生成创意，同时保持创意的独特性和吸引力。`

  return enhancedPrompt
}

/**
 * 创意效果评分结果
 */
export interface CreativePerformanceScore {
  creativeId: number
  score: number // 0-100
  rating: 'excellent' | 'good' | 'average' | 'poor'
  isGood: boolean // 是否为高表现创意
  metrics: {
    ctr: number
    cpc: number
    clicks: number
    conversions: number
    budget: number
  }
  reasons: string[] // 评分理由
}

/**
 * 多维度创意效果评分系统（基于可获取数据）
 *
 * 评分维度（仅使用可靠的Google Ads指标）：
 * 1. CTR（点击率）- 40分
 *    - 直接反映广告质量和用户兴趣
 *    - 行业基准：搜索广告平均CTR为2-3%
 *
 * 2. CPC效率（成本控制）- 30分
 *    - CPC相对于预算的比例
 *    - 成本越低效率越高
 *
 * 3. 点击量规模 - 20分
 *    - 绝对点击量，反映广告影响力
 *    - 兼顾质量（CTR）和规模（Clicks）
 *
 * 4. 预算利用率 - 10分
 *    - 实际花费/预算
 *    - 资源利用效率
 *
 * 总分：100分
 * - Excellent: 85-100分（优秀创意）
 * - Good: 70-84分（良好创意）
 * - Average: 50-69分（普通创意）
 * - Poor: 0-49分（待优化创意）
 */
export function scoreCreativePerformance(
  creativeId: number,
  userId: number
): CreativePerformanceScore | null {
  const db = getDatabase()

  // 查询创意的性能数据
  const stmt = db.prepare(`
    SELECT
      c.id as creativeId,
      c.headline1,
      camp.budget_amount as budget,
      COALESCE(SUM(cp.clicks), 0) as clicks,
      COALESCE(SUM(cp.impressions), 0) as impressions,
      COALESCE(SUM(cp.conversions), 0) as conversions,
      COALESCE(SUM(cp.cost), 0) as cost,
      CASE
        WHEN SUM(cp.impressions) > 0
        THEN CAST(SUM(cp.clicks) AS REAL) / SUM(cp.impressions)
        ELSE 0
      END as ctr,
      CASE
        WHEN SUM(cp.clicks) > 0
        THEN CAST(SUM(cp.cost) AS REAL) / SUM(cp.clicks)
        ELSE 0
      END as cpc
    FROM creative_versions c
    LEFT JOIN campaigns camp ON c.id = camp.current_creative_id
    LEFT JOIN campaign_performance cp ON camp.id = cp.campaign_id
    WHERE c.id = ? AND c.user_id = ?
    GROUP BY c.id
  `)

  const data = stmt.get(creativeId, userId) as any

  if (!data || data.impressions === 0) {
    return null // 没有数据或曝光不足
  }

  const { ctr, cpc, clicks, conversions, budget, cost, impressions } = data
  const reasons: string[] = []

  // 初始化评分
  let totalScore = 0

  // ========== 1. CTR评分（40分）- 最重要指标 ==========
  let ctrScore = 0
  const ctrPercent = ctr * 100

  if (ctr >= 0.05) {        // ≥5% - 优秀
    ctrScore = 40
    reasons.push(`优秀CTR (${ctrPercent.toFixed(2)}%)`)
  } else if (ctr >= 0.03) { // ≥3% - 良好（接近行业高水平）
    ctrScore = 32 + ((ctr - 0.03) / 0.02) * 8 // 32-40分
    reasons.push(`良好CTR (${ctrPercent.toFixed(2)}%)`)
  } else if (ctr >= 0.02) { // ≥2% - 行业平均水平
    ctrScore = 24 + ((ctr - 0.02) / 0.01) * 8 // 24-32分
    reasons.push(`中等CTR (${ctrPercent.toFixed(2)}%)`)
  } else if (ctr >= 0.01) { // ≥1% - 及格线
    ctrScore = 16 + ((ctr - 0.01) / 0.01) * 8 // 16-24分
    reasons.push(`一般CTR (${ctrPercent.toFixed(2)}%)`)
  } else if (ctr >= 0.005) { // ≥0.5% - 偏低但可接受
    ctrScore = 8 + ((ctr - 0.005) / 0.005) * 8 // 8-16分
    reasons.push(`偏低CTR (${ctrPercent.toFixed(2)}%)`)
  } else {                   // <0.5% - 需要优化
    ctrScore = Math.max(2, ctr * 1600) // 2-8分
    reasons.push(`低CTR (${ctrPercent.toFixed(2)}%)`)
  }
  totalScore += ctrScore

  // ========== 2. CPC效率评分（30分）- 成本控制 ==========
  let cpcScore = 0
  const cpcRatio = cpc / (budget * 0.01) // CPC相对于预算1%的比例

  if (cpcRatio <= 0.5) {        // CPC ≤ 预算*0.5% - 极低成本
    cpcScore = 30
    reasons.push(`极低CPC (${cpc.toFixed(2)}，预算${(cpcRatio).toFixed(2)}%）`)
  } else if (cpcRatio <= 1.0) { // CPC ≤ 预算*1% - 低成本
    cpcScore = 24 + (1.0 - cpcRatio) / 0.5 * 6 // 24-30分
    reasons.push(`低CPC (${cpc.toFixed(2)}，预算${(cpcRatio).toFixed(2)}%）`)
  } else if (cpcRatio <= 2.0) { // CPC ≤ 预算*2% - 可接受
    cpcScore = 18 + (2.0 - cpcRatio) / 1.0 * 6 // 18-24分
    reasons.push(`中等CPC (${cpc.toFixed(2)}，预算${(cpcRatio).toFixed(2)}%）`)
  } else if (cpcRatio <= 3.0) { // CPC ≤ 预算*3% - 偏高
    cpcScore = 12 + (3.0 - cpcRatio) / 1.0 * 6 // 12-18分
    reasons.push(`偏高CPC (${cpc.toFixed(2)}，预算${(cpcRatio).toFixed(2)}%）`)
  } else if (cpcRatio <= 5.0) { // CPC ≤ 预算*5% - 高成本
    cpcScore = 6 + (5.0 - cpcRatio) / 2.0 * 6 // 6-12分
    reasons.push(`高CPC (${cpc.toFixed(2)}，预算${(cpcRatio).toFixed(2)}%）`)
  } else {                       // CPC > 预算*5% - 成本过高
    cpcScore = Math.max(2, 30 - cpcRatio * 2) // 2-6分
    reasons.push(`过高CPC (${cpc.toFixed(2)}，预算${(cpcRatio).toFixed(2)}%）`)
  }
  totalScore += cpcScore

  // ========== 3. 点击量规模评分（20分）- 效果规模 ==========
  let clicksScore = 0

  if (clicks >= 1000) {
    clicksScore = 20
    reasons.push(`高点击量 (${clicks}次)`)
  } else if (clicks >= 500) {
    clicksScore = 16 + ((clicks - 500) / 500) * 4 // 16-20分
    reasons.push(`良好点击量 (${clicks}次)`)
  } else if (clicks >= 200) {
    clicksScore = 12 + ((clicks - 200) / 300) * 4 // 12-16分
    reasons.push(`中等点击量 (${clicks}次)`)
  } else if (clicks >= 100) {
    clicksScore = 8 + ((clicks - 100) / 100) * 4 // 8-12分
    reasons.push(`一般点击量 (${clicks}次)`)
  } else if (clicks >= 50) {
    clicksScore = 4 + ((clicks - 50) / 50) * 4 // 4-8分
    reasons.push(`点击量较少 (${clicks}次)`)
  } else {
    clicksScore = Math.max(2, (clicks / 50) * 4) // 2-4分
    reasons.push(`点击量很少 (${clicks}次)`)
  }
  totalScore += clicksScore

  // ========== 4. 预算利用率评分（10分）- 资源利用 ==========
  let budgetScore = 0
  const budgetUsage = cost / budget

  if (budgetUsage >= 0.80 && budgetUsage <= 1.0) {
    // 80-100%利用率 - 最佳
    budgetScore = 10
    reasons.push(`高预算利用率 (${(budgetUsage * 100).toFixed(0)}%)`)
  } else if (budgetUsage >= 0.60) {
    // 60-80%利用率 - 良好
    budgetScore = 7 + ((budgetUsage - 0.60) / 0.20) * 3 // 7-10分
    reasons.push(`良好预算利用 (${(budgetUsage * 100).toFixed(0)}%)`)
  } else if (budgetUsage >= 0.40) {
    // 40-60%利用率 - 中等
    budgetScore = 5 + ((budgetUsage - 0.40) / 0.20) * 2 // 5-7分
    reasons.push(`中等预算利用 (${(budgetUsage * 100).toFixed(0)}%)`)
  } else if (budgetUsage >= 0.20) {
    // 20-40%利用率 - 偏低
    budgetScore = 3 + ((budgetUsage - 0.20) / 0.20) * 2 // 3-5分
    reasons.push(`预算利用偏低 (${(budgetUsage * 100).toFixed(0)}%)`)
  } else if (budgetUsage > 0) {
    // <20%利用率 - 需要关注
    budgetScore = Math.max(1, (budgetUsage / 0.20) * 3) // 1-3分
    reasons.push(`预算利用很低 (${(budgetUsage * 100).toFixed(0)}%)`)
  } else {
    budgetScore = 0
    reasons.push('无预算花费')
  }

  // 预算超支惩罚
  if (budgetUsage > 1.0) {
    budgetScore = Math.max(0, 10 - (budgetUsage - 1.0) * 10) // 超支扣分
    reasons.push(`预算超支 (${(budgetUsage * 100).toFixed(0)}%)`)
  }

  totalScore += budgetScore

  // ========== 最终评分和评级 ==========
  const score = Math.min(100, Math.max(0, Math.round(totalScore)))
  let rating: 'excellent' | 'good' | 'average' | 'poor'

  if (score >= 85) {
    rating = 'excellent'
  } else if (score >= 70) {
    rating = 'good'
  } else if (score >= 50) {
    rating = 'average'
  } else {
    rating = 'poor'
  }

  // 添加总体评价
  reasons.unshift(`总分: ${score}/100 (${rating})`)

  return {
    creativeId,
    score,
    rating,
    isGood: rating === 'excellent' || rating === 'good',
    metrics: {
      ctr,
      cpc,
      clicks,
      conversions,
      budget
    },
    reasons
  }
}

/**
 * 批量评分所有创意（供定时任务使用）
 */
export function scoreAllCreatives(userId: number): CreativePerformanceScore[] {
  const db = getDatabase()

  // 获取所有有性能数据的创意
  const creativeIds = db.prepare(`
    SELECT DISTINCT c.id
    FROM creative_versions c
    JOIN campaigns camp ON c.id = camp.current_creative_id
    JOIN campaign_performance cp ON camp.id = cp.campaign_id
    WHERE c.user_id = ?
      AND cp.impressions > 100
  `).all(userId) as { id: number }[]

  const scores: CreativePerformanceScore[] = []

  creativeIds.forEach(({ id }) => {
    const score = scoreCreativePerformance(id, userId)
    if (score) {
      scores.push(score)
    }
  })

  // 按评分降序排序
  return scores.sort((a, b) => b.score - a.score)
}

/**
 * 将成功特征持久化到数据库
 */
export function saveSuccessFeatures(
  userId: number,
  features: SuccessFeatures,
  totalCreatives: number
): void {
  const db = getDatabase()

  // 将SuccessFeatures对象序列化为JSON
  const featuresJson = JSON.stringify(features)

  // 检查是否已存在该用户的学习模式
  const existingStmt = db.prepare(`
    SELECT id FROM creative_learning_patterns
    WHERE user_id = ?
  `)
  const existing = existingStmt.get(userId) as { id: number } | undefined

  if (existing) {
    // 更新现有记录
    const updateStmt = db.prepare(`
      UPDATE creative_learning_patterns
      SET success_features = ?,
          total_creatives_analyzed = ?,
          avg_ctr = ?,
          avg_conversion_rate = ?,
          min_ctr_threshold = ?,
          updated_at = datetime('now')
      WHERE user_id = ?
    `)
    updateStmt.run(
      featuresJson,
      totalCreatives,
      features.benchmarks.avgCtr,
      features.benchmarks.avgConversionRate,
      features.benchmarks.minCtr,
      userId
    )
  } else {
    // 插入新记录
    const insertStmt = db.prepare(`
      INSERT INTO creative_learning_patterns (
        user_id,
        success_features,
        total_creatives_analyzed,
        avg_ctr,
        avg_conversion_rate,
        min_ctr_threshold
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    insertStmt.run(
      userId,
      featuresJson,
      totalCreatives,
      features.benchmarks.avgCtr,
      features.benchmarks.avgConversionRate,
      features.benchmarks.minCtr
    )
  }
}

/**
 * 从数据库加载成功特征
 */
export function loadSuccessFeatures(userId: number): SuccessFeatures | null {
  const db = getDatabase()

  const stmt = db.prepare(`
    SELECT success_features
    FROM creative_learning_patterns
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `)

  const result = stmt.get(userId) as { success_features: string } | undefined

  if (!result) {
    return null
  }

  try {
    return JSON.parse(result.success_features) as SuccessFeatures
  } catch (error) {
    console.error('解析成功特征失败:', error)
    return null
  }
}

/**
 * 保存创意评分到数据库
 */
export function saveCreativeScore(
  userId: number,
  score: CreativePerformanceScore
): void {
  const db = getDatabase()

  const insertStmt = db.prepare(`
    INSERT INTO creative_performance_scores (
      user_id,
      creative_id,
      score,
      rating,
      is_good,
      metrics_snapshot,
      reasons
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  insertStmt.run(
    userId,
    score.creativeId,
    score.score,
    score.rating,
    score.isGood ? 1 : 0,
    JSON.stringify(score.metrics),
    JSON.stringify(score.reasons)
  )
}

/**
 * 运行完整的创意优化闭环（供定时任务调用）
 *
 * 流程：
 * 1. 评分所有创意
 * 2. 筛选高表现创意
 * 3. 分析成功特征
 * 4. 持久化学习模式
 *
 * @returns 分析报告
 */
export function runCreativeOptimizationLoop(userId: number): {
  totalCreatives: number
  highPerformers: number
  featuresUpdated: boolean
  avgScore: number
} {
  // Step 1: 评分所有创意
  const scores = scoreAllCreatives(userId)

  if (scores.length === 0) {
    return {
      totalCreatives: 0,
      highPerformers: 0,
      featuresUpdated: false,
      avgScore: 0
    }
  }

  // 保存评分结果到数据库
  scores.forEach(score => {
    saveCreativeScore(userId, score)
  })

  // Step 2: 筛选高表现创意（excellent 或 good）
  const highPerformers = scores.filter(s => s.isGood)

  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length

  // Step 3 & 4: 如果有足够的高表现创意，分析并保存特征
  let featuresUpdated = false
  if (highPerformers.length >= 5) {
    // 将评分转换为HistoricalCreative格式
    const db = getDatabase()
    const stmt = db.prepare(`
      SELECT
        c.id as creativeId,
        c.headline1,
        c.headline2,
        c.headline3,
        c.description1,
        c.description2,
        ? as ctr,
        ? as clicks,
        0 as impressions,
        ? as conversions,
        0 as conversionRate
      FROM creative_versions c
      WHERE c.id = ?
    `)

    const historicalCreatives: HistoricalCreative[] = highPerformers.map(s => {
      const creative = stmt.get(
        s.metrics.ctr,
        s.metrics.clicks,
        s.metrics.conversions,
        s.creativeId
      ) as any

      return {
        ...creative,
        impressions: s.metrics.clicks / (s.metrics.ctr || 0.01),
        conversionRate: s.metrics.conversions / (s.metrics.clicks || 1)
      }
    })

    // 分析成功特征
    const features = analyzeSuccessFeatures(historicalCreatives)

    // 持久化到数据库
    saveSuccessFeatures(userId, features, highPerformers.length)
    featuresUpdated = true
  }

  return {
    totalCreatives: scores.length,
    highPerformers: highPerformers.length,
    featuresUpdated,
    avgScore
  }
}

/**
 * 获取用户的个性化AI Prompt（增强版）
 * 优先从数据库加载持久化的成功特征
 */
export function getUserOptimizedPrompt(
  userId: number,
  basePrompt: string
): string {
  // 优先从数据库加载持久化的特征
  let features = loadSuccessFeatures(userId)

  if (!features) {
    // 数据库中没有，尝试实时分析
    const highPerformers = queryHighPerformingCreatives(userId, 0.02, 50, 50)

    if (highPerformers.length < 5) {
      // 数据不足，返回基础Prompt
      return basePrompt
    }

    // 分析成功特征
    features = analyzeSuccessFeatures(highPerformers)

    // 保存到数据库以供后续使用
    saveSuccessFeatures(userId, features, highPerformers.length)
  }

  // 生成增强Prompt
  return generateEnhancedPrompt(basePrompt, features)
}
