/**
 * 增强的标题和描述提取器 (P1优化)
 *
 * 功能：
 * 1. 多源头标题和描述提取（页面、评论、竞品、AI生成）
 * 2. 质量评分和排序
 * 3. 多样性检查
 * 4. 类型分类（品牌、功能、促销、CTA、紧迫感等）
 *
 * 预期效果：
 * - 标题数量：3-5 → 15-20
 * - 标题质量：多源头融合
 * - 参考质量提升：+35%
 */

import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'

export interface EnhancedHeadline {
  text: string
  type: 'brand' | 'feature' | 'promo' | 'cta' | 'urgency' | 'social_proof' | 'benefit'
  source: 'existing' | 'review' | 'competitor' | 'ai'
  relevance: number  // 0-1
  creativity: number // 0-1
  engagement: number // 0-1
  keywords: string[]
  hasNumber: boolean
  hasUrgency: boolean
  length: number
  confidence: number
}

export interface EnhancedDescription {
  text: string
  type: 'value' | 'action' | 'feature' | 'proof' | 'urgency' | 'benefit'
  source: 'existing' | 'review' | 'competitor' | 'ai'
  relevance: number  // 0-1
  clarity: number    // 0-1
  hasCTA: boolean
  keywords: string[]
  length: number
  confidence: number
}

export interface HeadlineDescriptionExtractionInput {
  productName: string
  brandName: string
  category: string
  description: string
  features: string[]
  useCases: string[]
  targetAudience: string
  pricing?: {
    current: number
    original?: number
    discount?: string
  }
  reviews?: Array<{ text: string; rating: number }>
  competitors?: string[]
  targetLanguage: string
}

/**
 * 增强的标题和描述提取
 */
export async function extractHeadlinesAndDescriptionsEnhanced(
  input: HeadlineDescriptionExtractionInput,
  userId: number
): Promise<{
  headlines: EnhancedHeadline[]
  descriptions: EnhancedDescription[]
}> {
  const {
    productName,
    brandName,
    category,
    description,
    features,
    useCases,
    targetAudience,
    pricing,
    reviews,
    competitors,
    targetLanguage,
  } = input

  console.log('🔍 开始增强的标题和描述提取...')

  try {
    // 1. 从页面现有内容提取
    console.log('📌 从页面内容提取标题和描述...')
    const existingHeadlines = extractExistingHeadlines(productName, description)
    const existingDescriptions = extractExistingDescriptions(description)

    // 2. 从评论中提取高频表述
    console.log('📌 从评论中提取标题和描述...')
    const reviewHeadlines = extractHeadlinesFromReviews(reviews || [])
    const reviewDescriptions = extractDescriptionsFromReviews(reviews || [])

    // 3. 从竞品中提取灵感
    console.log('📌 从竞品中提取标题和描述...')
    const competitorHeadlines = extractCompetitorHeadlines(competitors || [])
    const competitorDescriptions = extractCompetitorDescriptions(competitors || [])

    // 4. AI生成新的标题和描述
    console.log('📌 使用AI生成标题和描述...')
    const aiGeneratedHeadlines = await generateHeadlinesWithAI(
      {
        productName,
        brandName,
        category,
        description,
        features,
        useCases,
        targetAudience,
        pricing,
      },
      targetLanguage,
      userId
    )

    const aiGeneratedDescriptions = await generateDescriptionsWithAI(
      {
        productName,
        brandName,
        category,
        description,
        features,
        useCases,
        targetAudience,
        pricing,
      },
      targetLanguage,
      userId
    )

    // 5. 合并所有标题
    const allHeadlines = [
      ...existingHeadlines,
      ...reviewHeadlines,
      ...competitorHeadlines,
      ...aiGeneratedHeadlines,
    ]

    // 6. 合并所有描述
    const allDescriptions = [
      ...existingDescriptions,
      ...reviewDescriptions,
      ...competitorDescriptions,
      ...aiGeneratedDescriptions,
    ]

    // 7. 质量评分和排序
    console.log('⚙️ 评分和排序标题...')
    const rankedHeadlines = rankHeadlines(allHeadlines, {
      relevance: 0.4,
      creativity: 0.3,
      engagement: 0.3,
    })

    console.log('⚙️ 评分和排序描述...')
    const rankedDescriptions = rankDescriptions(allDescriptions, {
      relevance: 0.4,
      clarity: 0.3,
      cta: 0.3,
    })

    // 8. 多样性检查
    console.log('🔄 检查多样性...')
    const diverseHeadlines = ensureHeadlineDiversity(rankedHeadlines, 15)
    const diverseDescriptions = ensureDescriptionDiversity(rankedDescriptions, 4)

    console.log(`✅ 标题和描述提取完成：${diverseHeadlines.length}个标题，${diverseDescriptions.length}个描述`)

    return {
      headlines: diverseHeadlines,
      descriptions: diverseDescriptions,
    }

  } catch (error) {
    console.error('❌ 标题和描述提取失败:', error)
    throw error
  }
}

/**
 * 从页面内容提取现有标题
 */
function extractExistingHeadlines(productName: string, description: string): Partial<EnhancedHeadline>[] {
  const headlines: Partial<EnhancedHeadline>[] = []

  // 产品名称作为标题
  if (productName && productName.length <= 30) {
    headlines.push({
      text: productName,
      type: 'brand',
      source: 'existing',
      confidence: 0.9,
    })
  }

  // 从描述中提取第一句作为标题
  const firstSentence = description.split(/[.!?]/)[0]
  if (firstSentence && firstSentence.length > 10 && firstSentence.length <= 30) {
    headlines.push({
      text: firstSentence.trim(),
      type: 'feature',
      source: 'existing',
      confidence: 0.7,
    })
  }

  return headlines
}

/**
 * 从页面内容提取现有描述
 */
function extractExistingDescriptions(description: string): Partial<EnhancedDescription>[] {
  const descriptions: Partial<EnhancedDescription>[] = []

  // 从描述中提取前90个字符
  if (description && description.length > 0) {
    const excerpt = description.substring(0, 90)
    descriptions.push({
      text: excerpt,
      type: 'feature',
      source: 'existing',
      confidence: 0.8,
    })
  }

  return descriptions
}

/**
 * 从评论中提取标题
 */
function extractHeadlinesFromReviews(reviews: Array<{ text: string; rating: number }>): Partial<EnhancedHeadline>[] {
  const headlines: Partial<EnhancedHeadline>[] = []

  if (!reviews || reviews.length === 0) {
    return headlines
  }

  // 从高评分评论中提取关键词
  const highRatedReviews = reviews.filter(r => r.rating >= 4)
  const positiveKeywords = new Map<string, number>()

  for (const review of highRatedReviews) {
    const words = review.text.toLowerCase().split(/\s+/)
    for (const word of words) {
      if (word.length > 4) {
        positiveKeywords.set(word, (positiveKeywords.get(word) || 0) + 1)
      }
    }
  }

  // 获取高频词作为标题
  const topKeywords = Array.from(positiveKeywords.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([keyword]) => keyword)

  for (const keyword of topKeywords) {
    headlines.push({
      text: `Best ${keyword}`,
      type: 'social_proof',
      source: 'review',
      confidence: 0.6,
    })
  }

  return headlines
}

/**
 * 从评论中提取描述
 */
function extractDescriptionsFromReviews(reviews: Array<{ text: string; rating: number }>): Partial<EnhancedDescription>[] {
  const descriptions: Partial<EnhancedDescription>[] = []

  if (!reviews || reviews.length === 0) {
    return descriptions
  }

  // 从高评分评论中提取第一句
  const highRatedReviews = reviews.filter(r => r.rating >= 4)
  if (highRatedReviews.length > 0) {
    const firstReview = highRatedReviews[0]
    const firstSentence = firstReview.text.split(/[.!?]/)[0]
    if (firstSentence && firstSentence.length > 10 && firstSentence.length <= 90) {
      descriptions.push({
        text: firstSentence.trim(),
        type: 'proof',
        source: 'review',
        confidence: 0.7,
      })
    }
  }

  return descriptions
}

/**
 * 从竞品中提取标题灵感
 */
function extractCompetitorHeadlines(competitors: string[]): Partial<EnhancedHeadline>[] {
  const headlines: Partial<EnhancedHeadline>[] = []

  // 简化处理：生成竞品对比标题
  for (const competitor of competitors.slice(0, 2)) {
    headlines.push({
      text: `Better than ${competitor}`,
      type: 'benefit',
      source: 'competitor',
      confidence: 0.5,
    })
  }

  return headlines
}

/**
 * 从竞品中提取描述灵感
 */
function extractCompetitorDescriptions(competitors: string[]): Partial<EnhancedDescription>[] {
  const descriptions: Partial<EnhancedDescription>[] = []

  // 简化处理：生成竞品对比描述
  if (competitors.length > 0) {
    descriptions.push({
      text: `Superior to ${competitors[0]} with better features and value`,
      type: 'benefit',
      source: 'competitor',
      confidence: 0.5,
    })
  }

  return descriptions
}

/**
 * 使用AI生成标题
 */
async function generateHeadlinesWithAI(
  productInfo: any,
  targetLanguage: string,
  userId: number
): Promise<Partial<EnhancedHeadline>[]> {
  try {
    const prompt = `
      Generate 10 unique, compelling ad headlines for this product:
      - Product: ${productInfo.productName}
      - Brand: ${productInfo.brandName}
      - Category: ${productInfo.category}
      - Features: ${productInfo.features?.join(', ')}
      - Use Cases: ${productInfo.useCases?.join(', ')}
      - Target Audience: ${productInfo.targetAudience}

      Requirements:
      - Each headline must be ≤30 characters
      - Include different types: brand, feature, promo, CTA, urgency
      - Must be compelling and action-oriented
      - Avoid generic phrases

      Return as JSON array with format: [{"text": "...", "type": "..."}]
      IMPORTANT: Return ONLY the raw JSON array, no markdown code blocks.
    `

    // 智能模型选择：标题创意生成使用Pro模型（需要创造力）
    const aiResponse = await generateContent({
      operationType: 'headline_generation',
      prompt
    }, userId)

    // 记录token使用
    if (aiResponse.usage) {
      const cost = estimateTokenCost(
        aiResponse.model,
        aiResponse.usage.inputTokens,
        aiResponse.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: aiResponse.model,
        operationType: 'headline_generation',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    // 清理可能的markdown代码块
    const cleanedResponse = aiResponse.text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()
    const headlines = JSON.parse(cleanedResponse)

    return headlines.map((h: any) => ({
      text: h.text,
      type: h.type || 'feature',
      source: 'ai',
      confidence: 0.8,
    }))
  } catch (error) {
    console.warn('⚠️ AI生成标题失败:', error)
    return []
  }
}

/**
 * 使用AI生成描述
 */
async function generateDescriptionsWithAI(
  productInfo: any,
  targetLanguage: string,
  userId: number
): Promise<Partial<EnhancedDescription>[]> {
  try {
    const prompt = `
      Generate 4 unique, compelling ad descriptions for this product:
      - Product: ${productInfo.productName}
      - Brand: ${productInfo.brandName}
      - Category: ${productInfo.category}
      - Features: ${productInfo.features?.join(', ')}
      - Use Cases: ${productInfo.useCases?.join(', ')}
      - Target Audience: ${productInfo.targetAudience}

      Requirements:
      - Each description must be ≤90 characters
      - Include different types: value, action, feature, proof
      - Must include a clear call-to-action
      - Must be persuasive and benefit-focused

      Return as JSON array with format: [{"text": "...", "type": "..."}]
      IMPORTANT: Return ONLY the raw JSON array, no markdown code blocks.
    `

    // 智能模型选择：描述创意生成使用Pro模型（需要创造力）
    const aiResponse = await generateContent({
      operationType: 'description_generation',
      prompt
    }, userId)

    // 记录token使用
    if (aiResponse.usage) {
      const cost = estimateTokenCost(
        aiResponse.model,
        aiResponse.usage.inputTokens,
        aiResponse.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: aiResponse.model,
        operationType: 'description_generation',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    // 清理可能的markdown代码块
    const cleanedResponse = aiResponse.text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()
    const descriptions = JSON.parse(cleanedResponse)

    return descriptions.map((d: any) => ({
      text: d.text,
      type: d.type || 'feature',
      source: 'ai',
      confidence: 0.8,
    }))
  } catch (error) {
    console.warn('⚠️ AI生成描述失败:', error)
    return []
  }
}

/**
 * 排序标题
 */
function rankHeadlines(
  headlines: Partial<EnhancedHeadline>[],
  weights: { relevance: number; creativity: number; engagement: number }
): EnhancedHeadline[] {
  return headlines
    .map((h) => ({
      text: h.text || '',
      type: h.type || 'feature',
      source: h.source || 'existing',
      relevance: h.relevance || 0.5,
      creativity: h.creativity || 0.5,
      engagement: h.engagement || 0.5,
      keywords: h.keywords || [],
      hasNumber: (h.text || '').match(/\d+/) !== null,
      hasUrgency: /urgent|limited|now|today|today only|hurry/i.test(h.text || ''),
      length: (h.text || '').length,
      confidence: h.confidence || 0.5,
    }))
    .map((h) => ({
      ...h,
      score:
        h.relevance * weights.relevance +
        h.creativity * weights.creativity +
        h.engagement * weights.engagement,
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...h }) => h)
}

/**
 * 排序描述
 */
function rankDescriptions(
  descriptions: Partial<EnhancedDescription>[],
  weights: { relevance: number; clarity: number; cta: number }
): EnhancedDescription[] {
  return descriptions
    .map((d) => ({
      text: d.text || '',
      type: d.type || 'feature',
      source: d.source || 'existing',
      relevance: d.relevance || 0.5,
      clarity: d.clarity || 0.5,
      hasCTA: /click|buy|shop|learn|discover|get|order|visit/i.test(d.text || ''),
      keywords: d.keywords || [],
      length: (d.text || '').length,
      confidence: d.confidence || 0.5,
    }))
    .map((d) => ({
      ...d,
      score:
        d.relevance * weights.relevance +
        d.clarity * weights.clarity +
        (d.hasCTA ? weights.cta : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...d }) => d)
}

/**
 * 确保标题多样性
 */
function ensureHeadlineDiversity(
  headlines: EnhancedHeadline[],
  targetCount: number
): EnhancedHeadline[] {
  const selected: EnhancedHeadline[] = []
  const typeCount = new Map<string, number>()

  for (const headline of headlines) {
    if (selected.length >= targetCount) {
      break
    }

    // 检查类型多样性
    const typeFreq = typeCount.get(headline.type) || 0
    if (typeFreq < 3) {
      // 每种类型最多3个
      selected.push(headline)
      typeCount.set(headline.type, typeFreq + 1)
    }
  }

  // 如果不足目标数量，继续添加
  if (selected.length < targetCount) {
    for (const headline of headlines) {
      if (selected.length >= targetCount) {
        break
      }
      if (!selected.includes(headline)) {
        selected.push(headline)
      }
    }
  }

  return selected.slice(0, targetCount)
}

/**
 * 确保描述多样性
 */
function ensureDescriptionDiversity(
  descriptions: EnhancedDescription[],
  targetCount: number
): EnhancedDescription[] {
  const selected: EnhancedDescription[] = []
  const typeCount = new Map<string, number>()

  for (const description of descriptions) {
    if (selected.length >= targetCount) {
      break
    }

    // 检查类型多样性
    const typeFreq = typeCount.get(description.type) || 0
    if (typeFreq < 2) {
      // 每种类型最多2个
      selected.push(description)
      typeCount.set(description.type, typeFreq + 1)
    }
  }

  // 如果不足目标数量，继续添加
  if (selected.length < targetCount) {
    for (const description of descriptions) {
      if (selected.length >= targetCount) {
        break
      }
      if (!selected.includes(description)) {
        selected.push(description)
      }
    }
  }

  return selected.slice(0, targetCount)
}

export {
  extractExistingHeadlines,
  extractExistingDescriptions,
  extractHeadlinesFromReviews,
  extractDescriptionsFromReviews,
  extractCompetitorHeadlines,
  extractCompetitorDescriptions,
  generateHeadlinesWithAI,
  generateDescriptionsWithAI,
  rankHeadlines,
  rankDescriptions,
  ensureHeadlineDiversity,
  ensureDescriptionDiversity,
}
