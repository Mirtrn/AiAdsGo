/**
 * Ad Strength评估器 - 本地评估算法
 *
 * 基于Google Ads Ad Strength标准的6维度评分系统：
 * 1. Diversity (20%) - 资产多样性
 * 2. Relevance (20%) - 关键词相关性
 * 3. Brand Search Volume (20%) - 品牌搜索量
 * 4. Completeness (15%) - 资产完整性
 * 5. Quality (15%) - 内容质量
 * 6. Compliance (10%) - 政策合规性
 *
 * 输出：0-100分 + POOR/AVERAGE/GOOD/EXCELLENT评级
 */

import type {
  HeadlineAsset,
  DescriptionAsset,
  QualityMetrics
} from './ad-creative'
import { getKeywordSearchVolumes } from './keyword-planner'

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
      score: number // 0-20
      weight: 0.20
      details: {
        typeDistribution: number // 0-8 资产类型分布
        lengthDistribution: number // 0-8 长度梯度
        textUniqueness: number // 0-4 文本独特性
      }
    }
    relevance: {
      score: number // 0-20
      weight: 0.20
      details: {
        keywordCoverage: number // 0-12 关键词覆盖率
        keywordNaturalness: number // 0-8 关键词自然度
      }
    }
    completeness: {
      score: number // 0-15
      weight: 0.15
      details: {
        assetCount: number // 0-9 资产数量
        characterCompliance: number // 0-6 字符合规性
      }
    }
    quality: {
      score: number // 0-15
      weight: 0.15
      details: {
        numberUsage: number // 0-5 数字使用
        ctaPresence: number // 0-5 CTA存在
        urgencyExpression: number // 0-5 紧迫感表达
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
    brandSearchVolume: {
      score: number // 0-20
      weight: 0.20
      details: {
        monthlySearchVolume: number // 月均搜索量
        volumeLevel: 'micro' | 'small' | 'medium' | 'large' | 'xlarge' // 流量级别
        dataSource: 'keyword_planner' | 'cached' | 'database' | 'unavailable' // 数据来源
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
  keywords: string[],
  options?: {
    brandName?: string
    targetCountry?: string
    targetLanguage?: string
    userId?: number
  }
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

  // 6. Brand Search Volume维度 (20%)
  const brandSearchVolume = await calculateBrandSearchVolume(
    options?.brandName,
    options?.targetCountry || 'US',
    options?.targetLanguage || 'en',
    options?.userId
  )

  // 计算总分（100分制）
  const overallScore = diversity.score + relevance.score + completeness.score + quality.score + compliance.score + brandSearchVolume.score

  // 确定评级
  const rating = scoreToRating(overallScore)

  // 生成改进建议
  const suggestions = generateSuggestions(diversity, relevance, completeness, quality, compliance, brandSearchVolume, rating)

  return {
    overallScore: Math.round(overallScore),
    rating,
    dimensions: {
      diversity,
      relevance,
      completeness,
      quality,
      compliance,
      brandSearchVolume
    },
    suggestions
  }
}

/**
 * 1. 计算Diversity（多样性）- 20分
 */
function calculateDiversity(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  // 1.1 资产类型分布 (0-8分)
  const headlineTypes = new Set(headlines.map(h => h.type).filter(Boolean))
  let typeDistribution = Math.min(8, headlineTypes.size * 1.6) // 5种类型 * 1.6分/种

  // 优化：如果所有headlines都没有type属性，使用启发式规则估算多样性
  if (headlineTypes.size === 0 && headlines.length >= 10) {
    console.log('⚠️ Headlines缺少type属性，使用启发式规则评估多样性')

    // 基于文本内容的多样性评估
    const hasNumbers = headlines.filter(h => /\d/.test(h.text)).length
    const hasCTA = headlines.filter(h => /shop|buy|get|order|now/i.test(h.text)).length
    const hasUrgency = headlines.filter(h => /limited|today|only|exclusive/i.test(h.text)).length
    const hasBrand = headlines.filter(h => h.text.length < 25).length // 短标题通常是品牌类

    // 估算类型数量（每满足一个特征算1种类型）
    const estimatedTypes = [hasNumbers > 0, hasCTA > 0, hasUrgency > 0, hasBrand > 3].filter(Boolean).length
    typeDistribution = Math.min(8, estimatedTypes * 1.6 + 1.6) // 基础分1.6分

    console.log(`   估算类型数: ${estimatedTypes}, 多样性得分: ${typeDistribution}`)
  } else if (headlineTypes.size > 0) {
    console.log(`✅ Headlines类型分布: ${Array.from(headlineTypes).join(', ')} (${headlineTypes.size}种)`)
  }

  // 1.2 长度梯度分布 (0-8分)
  const lengthCategories = {
    short: headlines.filter(h => (h.length || h.text.length) <= 20).length,
    medium: headlines.filter(h => {
      const len = h.length || h.text.length
      return len > 20 && len <= 25
    }).length,
    long: headlines.filter(h => (h.length || h.text.length) > 25).length
  }

  console.log(`📏 长度分布: 短=${lengthCategories.short}, 中=${lengthCategories.medium}, 长=${lengthCategories.long}`)

  // 理想：短5 中5 长5，每个分类达标得2.67分
  const lengthScore =
    Math.min(2.67, lengthCategories.short / 5 * 2.67) +
    Math.min(2.67, lengthCategories.medium / 5 * 2.67) +
    Math.min(2.66, lengthCategories.long / 5 * 2.66)

  // 1.3 文本独特性 (0-4分)
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)]
  const uniqueness = calculateTextUniqueness(allTexts)
  const textUniqueness = uniqueness * 4 // 0-1 转为 0-4

  console.log(`🎨 文本独特性: ${(uniqueness * 100).toFixed(1)}% (得分: ${textUniqueness.toFixed(1)})`)

  const totalScore = typeDistribution + lengthScore + textUniqueness

  return {
    score: Math.min(20, Math.round(totalScore)), // 确保不超过最大值20
    weight: 0.20 as const,
    details: {
      typeDistribution: Math.round(typeDistribution),
      lengthDistribution: Math.round(lengthScore),
      textUniqueness: Math.round(textUniqueness * 10) / 10
    }
  }
}

/**
 * 2. 计算Relevance（相关性）- 20分
 */
function calculateRelevance(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[]
) {
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)].join(' ').toLowerCase()

  // 2.1 关键词覆盖率 (0-12分) - 优化：支持词形变化和部分匹配
  const matchedKeywords = keywords.filter(kw => {
    const kwLower = kw.toLowerCase()

    // 精确匹配
    if (allTexts.includes(kwLower)) return true

    // 词形变化匹配（单复数、ing形式等）
    const kwRoot = kwLower.replace(/s$|ing$|ed$/g, '') // 简单词根提取
    if (kwRoot.length >= 3 && allTexts.includes(kwRoot)) return true

    // 部分匹配（关键词是文本中某个词的一部分）
    const words = allTexts.split(/\s+/)
    if (words.some(word => word.includes(kwLower) || kwLower.includes(word))) return true

    return false
  })

  const coverageRatio = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0
  const keywordCoverage = coverageRatio * 12

  // 调试输出
  if (coverageRatio < 0.8) {
    const unmatchedKeywords = keywords.filter(kw => !matchedKeywords.includes(kw))
    console.log(`⚠️ 关键词覆盖率偏低: ${(coverageRatio * 100).toFixed(0)}%`)
    console.log(`   匹配成功: ${matchedKeywords.join(', ')}`)
    console.log(`   匹配失败: ${unmatchedKeywords.join(', ')}`)
  }

  // 2.2 关键词自然度 (0-8分)
  // 检查关键词是否自然融入（非堆砌）
  const keywordDensity = calculateKeywordDensity(allTexts, keywords)
  const naturalness = keywordDensity < 0.3 ? 8 : (keywordDensity < 0.5 ? 5.6 : 3.2) // 密度低于30%最佳

  const totalScore = keywordCoverage + naturalness

  return {
    score: Math.min(20, Math.round(totalScore)), // 确保不超过最大值20
    weight: 0.20 as const,
    details: {
      keywordCoverage: Math.round(keywordCoverage),
      keywordNaturalness: Math.round(naturalness)
    }
  }
}

/**
 * 3. 计算Completeness（完整性）- 15分
 */
function calculateCompleteness(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  // 3.1 资产数量 (0-9分)
  const headlineCount = Math.min(15, headlines.length)
  const descriptionCount = Math.min(4, descriptions.length)
  const assetCount = (headlineCount / 15 * 6.75) + (descriptionCount / 4 * 2.25) // Headlines占6.75分，Descriptions占2.25分

  // 3.2 字符合规性 (0-6分)
  const headlineCompliance = headlines.filter(h => {
    const len = h.length || h.text.length
    return len >= 10 && len <= 30
  }).length / headlines.length

  const descriptionCompliance = descriptions.filter(d => {
    const len = d.length || d.text.length
    return len >= 60 && len <= 90
  }).length / descriptions.length

  const characterCompliance = (headlineCompliance * 3.75) + (descriptionCompliance * 2.25)

  const totalScore = assetCount + characterCompliance

  return {
    score: Math.min(15, Math.round(totalScore)), // 确保不超过最大值15
    weight: 0.15 as const,
    details: {
      assetCount: Math.round(assetCount),
      characterCompliance: Math.round(characterCompliance)
    }
  }
}

/**
 * 4. 计算Quality（质量）- 15分
 */
function calculateQuality(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  // 4.1 数字使用 (0-5分)
  const headlinesWithNumbers = headlines.filter(h => h.hasNumber || /\d/.test(h.text)).length
  const numberUsage = Math.min(5, headlinesWithNumbers / 3 * 5) // 至少3个含数字得满分

  // 4.2 CTA存在 (0-5分)
  const descriptionsWithCTA = descriptions.filter(d =>
    d.hasCTA || /shop now|buy now|get|order|learn more|sign up|try|start/i.test(d.text)
  ).length
  const ctaPresence = Math.min(5, descriptionsWithCTA / 2 * 5) // 至少2个含CTA得满分

  // 4.3 紧迫感表达 (0-5分)
  const headlinesWithUrgency = headlines.filter(h =>
    h.hasUrgency || /limited|today|now|hurry|exclusive|only|sale ends/i.test(h.text)
  ).length
  const urgencyExpression = Math.min(5, headlinesWithUrgency / 2 * 5) // 至少2个含紧迫感得满分

  const totalScore = numberUsage + ctaPresence + urgencyExpression

  return {
    score: Math.min(15, Math.round(totalScore)), // 确保不超过最大值15
    weight: 0.15 as const,
    details: {
      numberUsage: Math.round(numberUsage),
      ctaPresence: Math.round(ctaPresence),
      urgencyExpression: Math.round(urgencyExpression)
    }
  }
}

/**
 * 6. 计算Brand Search Volume（品牌搜索量）- 20分
 */
async function calculateBrandSearchVolume(
  brandName: string | undefined,
  targetCountry: string,
  targetLanguage: string,
  userId?: number
) {
  // 如果没有品牌名称，返回0分
  if (!brandName || brandName.trim() === '') {
    console.log('⚠️ 未提供品牌名称，品牌搜索量得分为0')
    return {
      score: 0,
      weight: 0.20 as const,
      details: {
        monthlySearchVolume: 0,
        volumeLevel: 'micro' as const,
        dataSource: 'unavailable' as const
      }
    }
  }

  try {
    // 使用现有的关键词搜索量查询机制（Redis → Database → Google Ads API）
    const volumeResults = await getKeywordSearchVolumes(
      [brandName],
      targetCountry,
      targetLanguage,
      userId
    )

    const brandVolume = volumeResults[0]
    const monthlySearchVolume = brandVolume?.avgMonthlySearches || 0

    // 确定数据来源
    let dataSource: 'keyword_planner' | 'cached' | 'database' = 'keyword_planner'
    if (brandVolume) {
      // 根据实际实现，可能需要从volumeResults中获取数据源信息
      // 这里简化处理，假设成功获取就是从缓存或API
      dataSource = monthlySearchVolume > 0 ? 'cached' : 'keyword_planner'
    }

    // 根据搜索量确定流量级别和分数
    let volumeLevel: 'micro' | 'small' | 'medium' | 'large' | 'xlarge'
    let score: number

    if (monthlySearchVolume >= 100001) {
      volumeLevel = 'xlarge'
      score = 20
    } else if (monthlySearchVolume >= 10001) {
      volumeLevel = 'large'
      score = 15
    } else if (monthlySearchVolume >= 1001) {
      volumeLevel = 'medium'
      score = 10
    } else if (monthlySearchVolume >= 100) {
      volumeLevel = 'small'
      score = 5
    } else {
      volumeLevel = 'micro'
      score = 0
    }

    console.log(`📊 品牌"${brandName}"搜索量: ${monthlySearchVolume.toLocaleString()}/月 (${volumeLevel}级别, ${score}分)`)

    return {
      score,
      weight: 0.20 as const,
      details: {
        monthlySearchVolume,
        volumeLevel,
        dataSource
      }
    }
  } catch (error) {
    console.error(`❌ 获取品牌搜索量失败:`, error)
    // 出错时返回0分，但不影响其他维度评分
    return {
      score: 0,
      weight: 0.20 as const,
      details: {
        monthlySearchVolume: 0,
        volumeLevel: 'micro' as const,
        dataSource: 'unavailable' as const
      }
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
    score: Math.min(10, Math.round(totalScore)), // 确保不超过最大值10
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
  brandSearchVolume: any,
  rating: AdStrengthRating
): string[] {
  const suggestions: string[] = []

  // 如果已经是EXCELLENT，给予肯定
  if (rating === 'EXCELLENT') {
    suggestions.push('✅ 广告创意质量优秀，符合Google Ads最高标准')
    return suggestions
  }

  // Diversity建议
  if (diversity.details.typeDistribution < 6) {
    suggestions.push('💡 增加资产类型多样性：确保包含品牌、产品、促销、CTA、紧迫感5种类型')
  }
  if (diversity.details.lengthDistribution < 6) {
    suggestions.push('💡 优化长度分布：建议短标题5个、中标题5个、长标题5个')
  }
  if (diversity.details.textUniqueness < 3) {
    suggestions.push('💡 提高文本独特性：避免使用相似或重复的表述')
  }

  // Relevance建议
  if (relevance.details.keywordCoverage < 10) {
    suggestions.push('💡 提高关键词覆盖率：至少90%的关键词应出现在创意中')
  }
  if (relevance.details.keywordNaturalness < 6) {
    suggestions.push('💡 优化关键词自然度：避免关键词堆砌，自然融入文案')
  }

  // Completeness建议
  if (completeness.details.assetCount < 7) {
    suggestions.push('💡 补充资产数量：建议15个Headlines + 4个Descriptions')
  }
  if (completeness.details.characterCompliance < 5) {
    suggestions.push('💡 优化字符长度：Headlines 10-30字符，Descriptions 60-90字符')
  }

  // Quality建议
  if (quality.details.numberUsage < 4) {
    suggestions.push('💡 增加数字使用：至少3个Headlines包含具体数字（折扣、价格、数量）')
  }
  if (quality.details.ctaPresence < 4) {
    suggestions.push('💡 强化行动号召：至少2个Descriptions包含明确CTA（Shop Now、Get、Buy）')
  }
  if (quality.details.urgencyExpression < 3) {
    suggestions.push('💡 增加紧迫感：至少2个Headlines体现限时优惠或稀缺性')
  }

  // Compliance建议
  if (compliance.details.policyAdherence < 5) {
    suggestions.push('⚠️ 减少内容重复：确保每个资产独特且差异化')
  }
  if (compliance.details.noSpamWords < 3) {
    suggestions.push('⚠️ 移除违规词汇：避免使用绝对化、夸大或误导性表述')
  }

  // Brand Search Volume建议
  if (brandSearchVolume.details.volumeLevel === 'micro') {
    suggestions.push('📊 品牌知名度较低：建议加强品牌推广，提升市场认知度')
  } else if (brandSearchVolume.details.volumeLevel === 'small') {
    suggestions.push('📊 品牌处于成长期：建议结合品牌建设和效果营销策略')
  } else if (brandSearchVolume.details.volumeLevel === 'medium') {
    suggestions.push('📊 品牌具备一定影响力：可以适当增加品牌类创意资产比例')
  }
  // large和xlarge级别无需建议，已经有足够品牌影响力

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
