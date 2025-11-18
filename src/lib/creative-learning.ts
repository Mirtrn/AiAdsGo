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
 * 获取用户的个性化AI Prompt
 */
export function getUserOptimizedPrompt(
  userId: number,
  basePrompt: string
): string {
  // 查询高表现创意
  const highPerformers = queryHighPerformingCreatives(userId, 0.03, 100, 50)

  if (highPerformers.length < 5) {
    // 数据不足，返回基础Prompt
    return basePrompt
  }

  // 分析成功特征
  const features = analyzeSuccessFeatures(highPerformers)

  // 生成增强Prompt
  return generateEnhancedPrompt(basePrompt, features)
}
