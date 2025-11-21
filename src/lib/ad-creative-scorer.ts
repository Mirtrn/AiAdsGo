/**
 * 广告创意本地评分算法
 *
 * 功能：
 * - 作为AI评分的补充或备选
 * - 基于确定性规则的评分系统
 * - 5个维度：relevance, quality, engagement, diversity, clarity
 *
 * 使用场景：
 * 1. AI API不可用时的备选方案
 * 2. 与AI评分对比验证
 * 3. 快速本地评分
 */

export interface AdCreative {
  headline: string[]
  description: string[]
  keywords: string[]
  callouts?: string[]
  sitelinks?: Array<{
    text: string
    description?: string
    url?: string
  }>
  theme?: string
}

export interface ScoreBreakdown {
  relevance: number      // 相关性 (0-100)
  quality: number        // 质量 (0-100)
  engagement: number     // 吸引力 (0-100)
  diversity: number      // 多样性 (0-100)
  clarity: number        // 清晰度 (0-100)
}

export interface ScoringResult {
  score: number                    // 总分 (0-100)
  score_breakdown: ScoreBreakdown
  score_explanation: string
  scoring_method: 'local' | 'ai' | 'hybrid'
}

/**
 * 本地评分算法
 *
 * @param creative 广告创意数据
 * @param context 上下文信息（Offer数据等）
 * @returns 评分结果
 */
export function scoreAdCreativeLocally(
  creative: AdCreative,
  context?: {
    offerName?: string
    brandName?: string
    targetCountry?: string
    productCategory?: string
    landingPageUrl?: string
  }
): ScoringResult {
  const breakdown: ScoreBreakdown = {
    relevance: scoreRelevance(creative, context),
    quality: scoreQuality(creative),
    engagement: scoreEngagement(creative),
    diversity: scoreDiversity(creative),
    clarity: scoreClarity(creative)
  }

  // 加权计算总分
  const weights = {
    relevance: 0.30,      // 相关性权重30%
    quality: 0.25,        // 质量权重25%
    engagement: 0.20,     // 吸引力权重20%
    diversity: 0.15,      // 多样性权重15%
    clarity: 0.10         // 清晰度权重10%
  }

  const totalScore = Math.round(
    breakdown.relevance * weights.relevance +
    breakdown.quality * weights.quality +
    breakdown.engagement * weights.engagement +
    breakdown.diversity * weights.diversity +
    breakdown.clarity * weights.clarity
  )

  const explanation = generateExplanation(breakdown, totalScore)

  return {
    score: totalScore,
    score_breakdown: breakdown,
    score_explanation: explanation,
    scoring_method: 'local'
  }
}

/**
 * 评分维度1: 相关性 (Relevance)
 * 评估广告内容与Offer、品牌、目标的相关性
 */
function scoreRelevance(
  creative: AdCreative,
  context?: {
    offerName?: string
    brandName?: string
    targetCountry?: string
    productCategory?: string
  }
): number {
  let score = 70 // 基准分

  if (!context) return score

  const allText = [
    ...creative.headline,
    ...creative.description,
    ...creative.keywords
  ].join(' ').toLowerCase()

  // 1. 品牌名称出现 (+15分)
  if (context.brandName && allText.includes(context.brandName.toLowerCase())) {
    score += 15
  }

  // 2. 关键词丰富度 (+10分)
  if (creative.keywords.length >= 10) {
    score += 10
  } else if (creative.keywords.length >= 5) {
    score += 5
  }

  // 3. 主题一致性 (+5分)
  if (creative.theme && creative.theme.length > 0) {
    score += 5
  }

  return Math.min(100, score)
}

/**
 * 评分维度2: 质量 (Quality)
 * 评估广告文案的质量、完整性、符合规范程度
 */
function scoreQuality(creative: AdCreative): number {
  let score = 60 // 基准分

  // 1. Headlines完整性 (+15分)
  if (creative.headline.length >= 3) {
    score += 15
    // 长度适中奖励
    const avgLength = creative.headline.reduce((sum, h) => sum + h.length, 0) / creative.headline.length
    if (avgLength >= 15 && avgLength <= 25) {
      score += 5
    }
  } else {
    score -= 10 // 不足3条扣分
  }

  // 2. Descriptions完整性 (+10分)
  if (creative.description.length >= 2) {
    score += 10
    // 长度适中奖励
    const avgLength = creative.description.reduce((sum, d) => sum + d.length, 0) / creative.description.length
    if (avgLength >= 40 && avgLength <= 80) {
      score += 5
    }
  } else {
    score -= 5
  }

  // 3. Callouts (+5分)
  if (creative.callouts && creative.callouts.length >= 3) {
    score += 5
  }

  // 4. Sitelinks (+5分)
  if (creative.sitelinks && creative.sitelinks.length >= 2) {
    score += 5
  }

  // 5. 字符长度规范检查 (+5分)
  const headlineLengthValid = creative.headline.every(h => h.length <= 30)
  const descriptionLengthValid = creative.description.every(d => d.length <= 90)

  if (headlineLengthValid && descriptionLengthValid) {
    score += 5
  }

  return Math.min(100, Math.max(0, score))
}

/**
 * 评分维度3: 吸引力 (Engagement)
 * 评估广告的吸引用户点击的能力
 */
function scoreEngagement(creative: AdCreative): number {
  let score = 65 // 基准分

  const allText = [
    ...creative.headline,
    ...creative.description
  ].join(' ').toLowerCase()

  // 1. 行动号召词 (Call-to-Action) (+15分)
  const ctaWords = [
    'buy', 'shop', 'get', 'order', 'purchase', 'save', 'deal', 'free', 'discount',
    '购买', '立即', '免费', '优惠', '折扣', '限时', '特价', '抢购', '下单'
  ]

  const ctaCount = ctaWords.filter(word => allText.includes(word)).length
  if (ctaCount >= 3) {
    score += 15
  } else if (ctaCount >= 1) {
    score += 8
  }

  // 2. 数字和统计数据 (+10分)
  const numberRegex = /\d+(\.\d+)?%?/g
  const numbers = allText.match(numberRegex)
  if (numbers && numbers.length >= 2) {
    score += 10
  } else if (numbers && numbers.length >= 1) {
    score += 5
  }

  // 3. 紧迫性词汇 (+5分)
  const urgencyWords = ['today', 'now', 'limited', 'hurry', 'exclusive', '今天', '现在', '限时', '仅限', '独家']
  const hasUrgency = urgencyWords.some(word => allText.includes(word))
  if (hasUrgency) {
    score += 5
  }

  // 4. 问题或疑问词 (+5分)
  const hasQuestion = /[?？]/.test(allText) || ['how', 'what', 'why', 'when', 'where', '如何', '什么', '为什么'].some(word => allText.includes(word))
  if (hasQuestion) {
    score += 5
  }

  return Math.min(100, score)
}

/**
 * 评分维度4: 多样性 (Diversity)
 * 评估广告内容的多样性和变化性
 */
function scoreDiversity(creative: AdCreative): number {
  let score = 70 // 基准分

  // 1. Headlines多样性 (+15分)
  const headlineUniqueness = calculateUniqueness(creative.headline)
  score += headlineUniqueness * 15

  // 2. Descriptions多样性 (+10分)
  const descriptionUniqueness = calculateUniqueness(creative.description)
  score += descriptionUniqueness * 10

  // 3. 关键词多样性 (+5分)
  const keywordUniqueness = calculateUniqueness(creative.keywords)
  score += keywordUniqueness * 5

  return Math.min(100, Math.max(0, score))
}

/**
 * 评分维度5: 清晰度 (Clarity)
 * 评估广告信息的清晰度和易理解性
 */
function scoreClarity(creative: AdCreative): number {
  let score = 75 // 基准分

  // 1. 句子长度适中 (+10分)
  const avgHeadlineLength = creative.headline.reduce((sum, h) => sum + h.split(' ').length, 0) / creative.headline.length
  if (avgHeadlineLength >= 3 && avgHeadlineLength <= 6) {
    score += 10
  }

  // 2. 避免过度复杂 (+10分)
  const complexWords = ['synergy', 'paradigm', 'leverage', 'optimize', 'utilize']
  const allText = [...creative.headline, ...creative.description].join(' ').toLowerCase()
  const hasComplexWords = complexWords.some(word => allText.includes(word))
  if (!hasComplexWords) {
    score += 10
  }

  // 3. 一致的语言风格 (+5分)
  const hasConsistentTone = checkToneConsistency(creative)
  if (hasConsistentTone) {
    score += 5
  }

  return Math.min(100, Math.max(0, score))
}

/**
 * 计算文本数组的唯一性
 * 返回0-1之间的值，1表示完全不重复
 */
function calculateUniqueness(texts: string[]): number {
  if (texts.length === 0) return 0

  const words = texts.map(t => t.toLowerCase().split(/\s+/)).flat()
  const uniqueWords = new Set(words)

  return uniqueWords.size / words.length
}

/**
 * 检查语言风格一致性
 */
function checkToneConsistency(creative: AdCreative): boolean {
  const allText = [...creative.headline, ...creative.description].join(' ')

  // 简单检查：大小写使用是否一致
  const hasAllCaps = /[A-Z]{4,}/.test(allText)
  const hasAllLower = /^[a-z\s]+$/.test(allText)

  // 既不全大写也不全小写，说明有适当的大小写混合，表示一致性较好
  return !hasAllCaps || !hasAllLower
}

/**
 * 生成评分说明
 */
function generateExplanation(breakdown: ScoreBreakdown, totalScore: number): string {
  const parts: string[] = []

  // 总体评价
  if (totalScore >= 85) {
    parts.push('该广告创意整体质量优秀')
  } else if (totalScore >= 70) {
    parts.push('该广告创意整体质量良好')
  } else if (totalScore >= 60) {
    parts.push('该广告创意整体质量一般')
  } else {
    parts.push('该广告创意需要改进')
  }

  // 强项
  const strengths: string[] = []
  if (breakdown.relevance >= 85) strengths.push('相关性')
  if (breakdown.quality >= 85) strengths.push('质量')
  if (breakdown.engagement >= 85) strengths.push('吸引力')
  if (breakdown.diversity >= 85) strengths.push('多样性')
  if (breakdown.clarity >= 85) strengths.push('清晰度')

  if (strengths.length > 0) {
    parts.push(`，在${strengths.join('、')}方面表现突出`)
  }

  // 弱项
  const weaknesses: string[] = []
  if (breakdown.relevance < 60) weaknesses.push('相关性')
  if (breakdown.quality < 60) weaknesses.push('质量')
  if (breakdown.engagement < 60) weaknesses.push('吸引力')
  if (breakdown.diversity < 60) weaknesses.push('多样性')
  if (breakdown.clarity < 60) weaknesses.push('清晰度')

  if (weaknesses.length > 0) {
    parts.push(`。建议改进${weaknesses.join('、')}`)
  } else {
    parts.push('。各维度表现均衡')
  }

  return parts.join('')
}

/**
 * 混合评分：结合AI评分和本地评分
 *
 * @param aiScore AI生成的评分
 * @param creative 广告创意数据
 * @param context 上下文信息
 * @returns 混合评分结果
 */
export function scoreAdCreativeHybrid(
  aiScore: ScoringResult | null,
  creative: AdCreative,
  context?: any
): ScoringResult {
  const localScore = scoreAdCreativeLocally(creative, context)

  // 如果没有AI评分，直接返回本地评分
  if (!aiScore) {
    return localScore
  }

  // 混合策略：AI评分占70%，本地评分占30%
  const hybridScore = Math.round(aiScore.score * 0.7 + localScore.score * 0.3)

  const hybridBreakdown: ScoreBreakdown = {
    relevance: Math.round(aiScore.score_breakdown.relevance * 0.7 + localScore.score_breakdown.relevance * 0.3),
    quality: Math.round(aiScore.score_breakdown.quality * 0.7 + localScore.score_breakdown.quality * 0.3),
    engagement: Math.round(aiScore.score_breakdown.engagement * 0.7 + localScore.score_breakdown.engagement * 0.3),
    diversity: Math.round(aiScore.score_breakdown.diversity * 0.7 + localScore.score_breakdown.diversity * 0.3),
    clarity: Math.round(aiScore.score_breakdown.clarity * 0.7 + localScore.score_breakdown.clarity * 0.3)
  }

  return {
    score: hybridScore,
    score_breakdown: hybridBreakdown,
    score_explanation: `${aiScore.score_explanation}（AI评分：${aiScore.score}，本地评分：${localScore.score}，混合评分：${hybridScore}）`,
    scoring_method: 'hybrid'
  }
}
