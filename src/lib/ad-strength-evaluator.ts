/**
 * Ad Strength评估器 - 本地评估算法
 *
 * 基于Google Ads Ad Strength标准的5维度评分系统：
 * 1. Diversity (25%) - 资产多样性
 * 2. Relevance (25%) - 关键词相关性
 * 3. Completeness (20%) - 资产完整性
 * 4. Quality (20%) - 内容质量
 * 5. Compliance (10%) - 政策合规性
 *
 * 输出：0-100分 + POOR/AVERAGE/GOOD/EXCELLENT评级
 */

import type {
  HeadlineAsset,
  DescriptionAsset,
  QualityMetrics
} from './ad-creative'

/**
 * Ad Strength评级标准
 */
export type AdStrengthRating = 'PENDING' | 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT'

/**
 * 完整评估结果
 */
export interface AdStrengthEvaluation {
  // 总体评分
  overallScore: number // 0-100
  rating: AdStrengthRating

  // 各维度得分
  dimensions: {
    diversity: {
      score: number // 0-25
      weight: 0.25
      details: {
        typeDistribution: number // 0-10 资产类型分布
        lengthDistribution: number // 0-10 长度梯度
        textUniqueness: number // 0-5 文本独特性
      }
    }
    relevance: {
      score: number // 0-25
      weight: 0.25
      details: {
        keywordCoverage: number // 0-15 关键词覆盖率
        keywordNaturalness: number // 0-10 关键词自然度
      }
    }
    completeness: {
      score: number // 0-20
      weight: 0.20
      details: {
        assetCount: number // 0-12 资产数量
        characterCompliance: number // 0-8 字符合规性
      }
    }
    quality: {
      score: number // 0-20
      weight: 0.20
      details: {
        numberUsage: number // 0-7 数字使用
        ctaPresence: number // 0-7 CTA存在
        urgencyExpression: number // 0-6 紧迫感表达
      }
    }
    compliance: {
      score: number // 0-10
      weight: 0.10
      details: {
        policyAdherence: number // 0-6 政策遵守
        noSpamWords: number // 0-4 无垃圾词汇
      }
    }
  }

  // 资产级别评分（可选）
  assetScores?: {
    headlines: Array<{
      text: string
      score: number
      issues: string[]
      suggestions: string[]
    }>
    descriptions: Array<{
      text: string
      score: number
      issues: string[]
      suggestions: string[]
    }>
  }

  // 改进建议
  suggestions: string[]
}

/**
 * 禁用词清单（Google Ads政策违规）
 */
const FORBIDDEN_WORDS = [
  // 绝对化词汇
  '100%', '最佳', '第一', '保证', '必须',
  'best in the world', 'number one', 'guaranteed',

  // 夸大表述
  '奇迹', '魔法', '神奇', '完美',
  'miracle', 'magic', 'perfect',

  // 误导性词汇
  '免费', '赠送', '白拿',
  'free money', 'get rich quick'
]

/**
 * 主评估函数
 */
export async function evaluateAdStrength(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[]
): Promise<AdStrengthEvaluation> {

  // 1. Diversity维度 (25%)
  const diversity = calculateDiversity(headlines, descriptions)

  // 2. Relevance维度 (25%)
  const relevance = calculateRelevance(headlines, descriptions, keywords)

  // 3. Completeness维度 (20%)
  const completeness = calculateCompleteness(headlines, descriptions)

  // 4. Quality维度 (20%)
  const quality = calculateQuality(headlines, descriptions)

  // 5. Compliance维度 (10%)
  const compliance = calculateCompliance(headlines, descriptions)

  // 计算总分
  const overallScore = diversity.score + relevance.score + completeness.score + quality.score + compliance.score

  // 确定评级
  const rating = scoreToRating(overallScore)

  // 生成改进建议
  const suggestions = generateSuggestions(diversity, relevance, completeness, quality, compliance, rating)

  return {
    overallScore: Math.round(overallScore),
    rating,
    dimensions: {
      diversity,
      relevance,
      completeness,
      quality,
      compliance
    },
    suggestions
  }
}

/**
 * 1. 计算Diversity（多样性）- 25分
 */
function calculateDiversity(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  // 1.1 资产类型分布 (0-10分)
  const headlineTypes = new Set(headlines.map(h => h.type).filter(Boolean))
  const typeDistribution = Math.min(10, headlineTypes.size * 2) // 5种类型 * 2分/种

  // 1.2 长度梯度分布 (0-10分)
  const lengthCategories = {
    short: headlines.filter(h => (h.length || h.text.length) <= 20).length,
    medium: headlines.filter(h => {
      const len = h.length || h.text.length
      return len > 20 && len <= 25
    }).length,
    long: headlines.filter(h => (h.length || h.text.length) > 25).length
  }

  // 理想：短5 中5 长5，每个分类达标得3.33分
  const lengthScore =
    Math.min(3.33, lengthCategories.short / 5 * 3.33) +
    Math.min(3.33, lengthCategories.medium / 5 * 3.33) +
    Math.min(3.34, lengthCategories.long / 5 * 3.34)

  // 1.3 文本独特性 (0-5分)
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)]
  const uniqueness = calculateTextUniqueness(allTexts)
  const textUniqueness = uniqueness * 5 // 0-1 转为 0-5

  const totalScore = typeDistribution + lengthScore + textUniqueness

  return {
    score: Math.round(totalScore),
    weight: 0.25 as const,
    details: {
      typeDistribution: Math.round(typeDistribution),
      lengthDistribution: Math.round(lengthScore),
      textUniqueness: Math.round(textUniqueness * 10) / 10
    }
  }
}

/**
 * 2. 计算Relevance（相关性）- 25分
 */
function calculateRelevance(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[]
) {
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)].join(' ').toLowerCase()

  // 2.1 关键词覆盖率 (0-15分)
  const matchedKeywords = keywords.filter(kw => allTexts.includes(kw.toLowerCase()))
  const coverageRatio = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0
  const keywordCoverage = coverageRatio * 15

  // 2.2 关键词自然度 (0-10分)
  // 检查关键词是否自然融入（非堆砌）
  const keywordDensity = calculateKeywordDensity(allTexts, keywords)
  const naturalness = keywordDensity < 0.3 ? 10 : (keywordDensity < 0.5 ? 7 : 4) // 密度低于30%最佳

  const totalScore = keywordCoverage + naturalness

  return {
    score: Math.round(totalScore),
    weight: 0.25 as const,
    details: {
      keywordCoverage: Math.round(keywordCoverage),
      keywordNaturalness: Math.round(naturalness)
    }
  }
}

/**
 * 3. 计算Completeness（完整性）- 20分
 */
function calculateCompleteness(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  // 3.1 资产数量 (0-12分)
  const headlineCount = Math.min(15, headlines.length)
  const descriptionCount = Math.min(4, descriptions.length)
  const assetCount = (headlineCount / 15 * 9) + (descriptionCount / 4 * 3) // Headlines占9分，Descriptions占3分

  // 3.2 字符合规性 (0-8分)
  const headlineCompliance = headlines.filter(h => {
    const len = h.length || h.text.length
    return len >= 10 && len <= 30
  }).length / headlines.length

  const descriptionCompliance = descriptions.filter(d => {
    const len = d.length || d.text.length
    return len >= 60 && len <= 90
  }).length / descriptions.length

  const characterCompliance = (headlineCompliance * 5) + (descriptionCompliance * 3)

  const totalScore = assetCount + characterCompliance

  return {
    score: Math.round(totalScore),
    weight: 0.20 as const,
    details: {
      assetCount: Math.round(assetCount),
      characterCompliance: Math.round(characterCompliance)
    }
  }
}

/**
 * 4. 计算Quality（质量）- 20分
 */
function calculateQuality(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  // 4.1 数字使用 (0-7分)
  const headlinesWithNumbers = headlines.filter(h => h.hasNumber || /\d/.test(h.text)).length
  const numberUsage = Math.min(7, headlinesWithNumbers / 3 * 7) // 至少3个含数字得满分

  // 4.2 CTA存在 (0-7分)
  const descriptionsWithCTA = descriptions.filter(d =>
    d.hasCTA || /shop now|buy now|get|order|learn more|sign up|try|start/i.test(d.text)
  ).length
  const ctaPresence = Math.min(7, descriptionsWithCTA / 2 * 7) // 至少2个含CTA得满分

  // 4.3 紧迫感表达 (0-6分)
  const headlinesWithUrgency = headlines.filter(h =>
    h.hasUrgency || /limited|today|now|hurry|exclusive|only|sale ends/i.test(h.text)
  ).length
  const urgencyExpression = Math.min(6, headlinesWithUrgency / 2 * 6) // 至少2个含紧迫感得满分

  const totalScore = numberUsage + ctaPresence + urgencyExpression

  return {
    score: Math.round(totalScore),
    weight: 0.20 as const,
    details: {
      numberUsage: Math.round(numberUsage),
      ctaPresence: Math.round(ctaPresence),
      urgencyExpression: Math.round(urgencyExpression)
    }
  }
}

/**
 * 5. 计算Compliance（合规性）- 10分
 */
function calculateCompliance(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)]

  // 5.1 政策遵守 (0-6分)
  // 基础合规：6分，每发现1个问题扣2分
  let policyIssues = 0

  // 检查重复内容（超过80%相似视为重复）
  for (let i = 0; i < allTexts.length; i++) {
    for (let j = i + 1; j < allTexts.length; j++) {
      const similarity = calculateSimilarity(allTexts[i], allTexts[j])
      if (similarity > 0.8) policyIssues++
    }
  }

  const policyAdherence = Math.max(0, 6 - policyIssues * 2)

  // 5.2 无垃圾词汇 (0-4分)
  const forbiddenWordsFound = allTexts.filter(text =>
    FORBIDDEN_WORDS.some(word => text.toLowerCase().includes(word.toLowerCase()))
  ).length

  const noSpamWords = Math.max(0, 4 - forbiddenWordsFound)

  const totalScore = policyAdherence + noSpamWords

  return {
    score: Math.round(totalScore),
    weight: 0.10 as const,
    details: {
      policyAdherence: Math.round(policyAdherence),
      noSpamWords: Math.round(noSpamWords)
    }
  }
}

/**
 * 将分数转换为评级
 */
function scoreToRating(score: number): AdStrengthRating {
  if (score >= 85) return 'EXCELLENT'
  if (score >= 70) return 'GOOD'
  if (score >= 50) return 'AVERAGE'
  if (score > 0) return 'POOR'
  return 'PENDING'
}

/**
 * 生成改进建议
 */
function generateSuggestions(
  diversity: any,
  relevance: any,
  completeness: any,
  quality: any,
  compliance: any,
  rating: AdStrengthRating
): string[] {
  const suggestions: string[] = []

  // 如果已经是EXCELLENT，给予肯定
  if (rating === 'EXCELLENT') {
    suggestions.push('✅ 广告创意质量优秀，符合Google Ads最高标准')
    return suggestions
  }

  // Diversity建议
  if (diversity.details.typeDistribution < 8) {
    suggestions.push('💡 增加资产类型多样性：确保包含品牌、产品、促销、CTA、紧迫感5种类型')
  }
  if (diversity.details.lengthDistribution < 8) {
    suggestions.push('💡 优化长度分布：建议短标题5个、中标题5个、长标题5个')
  }
  if (diversity.details.textUniqueness < 4) {
    suggestions.push('💡 提高文本独特性：避免使用相似或重复的表述')
  }

  // Relevance建议
  if (relevance.details.keywordCoverage < 12) {
    suggestions.push('💡 提高关键词覆盖率：至少90%的关键词应出现在创意中')
  }
  if (relevance.details.keywordNaturalness < 8) {
    suggestions.push('💡 优化关键词自然度：避免关键词堆砌，自然融入文案')
  }

  // Completeness建议
  if (completeness.details.assetCount < 10) {
    suggestions.push('💡 补充资产数量：建议15个Headlines + 4个Descriptions')
  }
  if (completeness.details.characterCompliance < 6) {
    suggestions.push('💡 优化字符长度：Headlines 10-30字符，Descriptions 60-90字符')
  }

  // Quality建议
  if (quality.details.numberUsage < 5) {
    suggestions.push('💡 增加数字使用：至少3个Headlines包含具体数字（折扣、价格、数量）')
  }
  if (quality.details.ctaPresence < 5) {
    suggestions.push('💡 强化行动号召：至少2个Descriptions包含明确CTA（Shop Now、Get、Buy）')
  }
  if (quality.details.urgencyExpression < 4) {
    suggestions.push('💡 增加紧迫感：至少2个Headlines体现限时优惠或稀缺性')
  }

  // Compliance建议
  if (compliance.details.policyAdherence < 5) {
    suggestions.push('⚠️ 减少内容重复：确保每个资产独特且差异化')
  }
  if (compliance.details.noSpamWords < 3) {
    suggestions.push('⚠️ 移除违规词汇：避免使用绝对化、夸大或误导性表述')
  }

  return suggestions
}

/**
 * 辅助函数：计算文本独特性（0-1）
 */
function calculateTextUniqueness(texts: string[]): number {
  if (texts.length === 0) return 0

  let totalSimilarity = 0
  let comparisons = 0

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      totalSimilarity += calculateSimilarity(texts[i], texts[j])
      comparisons++
    }
  }

  const avgSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 0
  return 1 - avgSimilarity // 独特性 = 1 - 相似度
}

/**
 * 辅助函数：计算关键词密度
 */
function calculateKeywordDensity(text: string, keywords: string[]): number {
  const words = text.split(/\s+/)
  const keywordMatches = words.filter(word =>
    keywords.some(kw => word.toLowerCase().includes(kw.toLowerCase()))
  ).length

  return words.length > 0 ? keywordMatches / words.length : 0
}

/**
 * 辅助函数：计算两个文本的相似度（Jaccard相似度）
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/))
  const words2 = new Set(text2.toLowerCase().split(/\s+/))

  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])

  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * 单个资产评分（可选功能）
 */
export async function evaluateIndividualAsset(
  asset: HeadlineAsset | DescriptionAsset,
  type: 'headline' | 'description',
  keywords: string[]
): Promise<{
  score: number
  issues: string[]
  suggestions: string[]
}> {
  const issues: string[] = []
  const suggestions: string[] = []
  let score = 100

  const text = asset.text
  const length = asset.length || text.length

  // 长度检查
  if (type === 'headline') {
    if (length < 10) {
      issues.push('字符数过少（建议10-30字符）')
      score -= 20
    } else if (length > 30) {
      issues.push('字符数超限（最多30字符）')
      score -= 30
    }
  } else {
    if (length < 60) {
      issues.push('字符数过少（建议60-90字符）')
      score -= 20
    } else if (length > 90) {
      issues.push('字符数超限（最多90字符）')
      score -= 30
    }
  }

  // 关键词检查
  const hasKeyword = keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()))
  if (!hasKeyword) {
    issues.push('未包含关键词')
    suggestions.push('建议融入至少1个关键词')
    score -= 15
  }

  // 禁用词检查
  const hasForbiddenWord = FORBIDDEN_WORDS.some(word => text.toLowerCase().includes(word.toLowerCase()))
  if (hasForbiddenWord) {
    issues.push('包含违规词汇')
    suggestions.push('移除绝对化或夸大表述')
    score -= 25
  }

  // Headline特定检查
  if (type === 'headline') {
    const headlineAsset = asset as HeadlineAsset

    if (!headlineAsset.type) {
      suggestions.push('建议分类为：品牌/产品/促销/CTA/紧迫感')
    }

    if (!headlineAsset.hasNumber && headlineAsset.type === 'promo') {
      suggestions.push('促销类标题建议包含具体数字')
    }
  }

  // Description特定检查
  if (type === 'description') {
    const descAsset = asset as DescriptionAsset

    if (!descAsset.hasCTA) {
      suggestions.push('建议添加行动号召（Shop Now, Get, Learn More）')
      score -= 10
    }
  }

  return {
    score: Math.max(0, score),
    issues,
    suggestions
  }
}
