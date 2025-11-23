import { generateContent } from './gemini'
import { getKeywordSearchVolumes, getKeywordSuggestions } from './keyword-planner'
import type { Offer } from './offers'

/**
 * AI生成的关键词数据结构
 */
export interface GeneratedKeyword {
  keyword: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  category: string
  estimatedCpc?: number
  searchIntent?: string
  reasoning?: string
  searchVolume?: number // 搜索量（可选）
}

/**
 * 关键词生成选项
 */
export interface KeywordGenerationOptions {
  minSearchVolume?: number // 最小搜索量阈值，默认500
  expandBrandKeywords?: boolean // 是否扩展品牌关键词，默认true
  maxBrandKeywords?: number // 最大品牌关键词数量，默认10
  minEfficiencyScore?: number // 最小CPC效率分（搜索量/CPC），默认100
  filterByIntent?: boolean // 是否过滤研究意图关键词，默认true
  smartMatchType?: boolean // 是否智能分配匹配类型，默认true
}

// 研究意图关键词标识（需要过滤）
const RESEARCH_INTENT_PATTERNS = [
  'review', 'reviews', 'vs', 'versus', 'comparison', 'compare',
  'alternative', 'alternatives', 'how to', 'what is', 'guide',
  'tutorial', 'reddit', 'forum', 'blog', 'article', 'best'
]

// 购买意图关键词标识（优先保留）
const PURCHASE_INTENT_PATTERNS = [
  'buy', 'shop', 'store', 'amazon', 'price', 'sale', 'discount',
  'coupon', 'deal', 'order', 'purchase', 'official', 'online'
]

/**
 * 关键词生成结果
 */
export interface KeywordGenerationResult {
  keywords: GeneratedKeyword[]
  totalCount: number
  categories: string[]
  estimatedBudget?: {
    minDaily: number
    maxDaily: number
    currency: string
  }
  recommendations: string[]
  filteredCount?: number // 被过滤的关键词数量
  brandKeywordsCount?: number // 品牌关键词数量
}

/**
 * 使用AI生成关键词
 * @param offer - Offer信息
 * @param userId - 用户ID（必需，用于获取用户的AI配置）
 * @param options - 关键词生成选项
 */
export async function generateKeywords(
  offer: Offer,
  userId: number,
  options?: KeywordGenerationOptions
): Promise<KeywordGenerationResult> {
  const minSearchVolume = options?.minSearchVolume ?? 500
  const expandBrandKeywords = options?.expandBrandKeywords ?? true
  const maxBrandKeywords = options?.maxBrandKeywords ?? 10
  const minEfficiencyScore = options?.minEfficiencyScore ?? 100
  const filterByIntent = options?.filterByIntent ?? true
  const smartMatchType = options?.smartMatchType ?? true

  const prompt = `你是一个专业的Google Ads关键词策略专家。请基于以下产品信息，生成高质量的搜索广告关键词列表。

# 产品信息
品牌名称：${offer.brand}
品牌描述：${offer.brand_description || '未提供'}
目标国家：${offer.target_country}
产品类别：${offer.category || '未分类'}

# 输出要求
请生成30个高质量关键词，返回标准JSON格式。每个关键词包含：keyword（关键词）、matchType（BROAD/PHRASE/EXACT）、priority（HIGH/MEDIUM/LOW）、category（品牌词/产品词/解决方案词/长尾词）。

**重要：只生成购买意图关键词**
- ✅ 包含：buy, shop, store, price, sale, discount, amazon, online, official
- ❌ 排除：review, vs, comparison, alternative, how to, guide, tutorial, reddit, forum

示例JSON格式（请严格遵循）：
{
  "keywords": [
    {"keyword": "buy bagsmart backpack", "matchType": "PHRASE", "priority": "HIGH", "category": "品牌词", "searchIntent": "transactional"}
  ],
  "estimatedBudget": {"minDaily": 50, "maxDaily": 200, "currency": "USD"},
  "recommendations": ["建议1", "建议2"]
}

重要：
1. 只返回JSON，不要有其他文字
2. 关键词需符合${offer.target_country}语言习惯
3. 确保JSON语法正确（注意逗号、引号）
4. 所有关键词必须是购买意图，searchIntent必须是transactional
`

  try {
    // 需求12：使用Gemini 2.0 Flash实验版模型（使用用户级AI配置）
    const text = await generateContent({
      model: 'gemini-2.0-flash-exp',
      prompt,
      temperature: 0.7,
      maxOutputTokens: 4096,
    }, userId)

    // 提取JSON（尝试移除markdown代码块标记）
    let jsonText = text
    if (text.includes('```json')) {
      const match = text.match(/```json\s*([\s\S]*?)```/)
      if (match) {
        jsonText = match[1].trim()
      }
    } else if (text.includes('```')) {
      const match = text.match(/```\s*([\s\S]*?)```/)
      if (match) {
        jsonText = match[1].trim()
      }
    }

    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('AI返回内容:', text.substring(0, 500))
      throw new Error('AI返回的数据格式无效')
    }

    let data: {
      keywords: GeneratedKeyword[]
      estimatedBudget?: {
        minDaily: number
        maxDaily: number
        currency: string
      }
      recommendations: string[]
    }

    try {
      data = JSON.parse(jsonMatch[0])
    } catch (parseError: any) {
      console.error('JSON解析失败:', parseError.message)
      console.error('JSON内容（前1000字符）:', jsonMatch[0].substring(0, 1000))
      throw new Error(`AI返回的JSON格式错误: ${parseError.message}`)
    }

    // 验证数据
    if (!data.keywords || !Array.isArray(data.keywords)) {
      throw new Error('AI返回的关键词列表格式无效')
    }

    let allKeywords = data.keywords
    let filteredCount = 0
    let brandKeywordsCount = 0

    // 获取目标国家和语言
    const targetCountry = offer.target_country || 'US'
    const targetLanguage = offer.target_language || 'en'

    // 1. 扩展品牌关键词（如果启用）
    if (expandBrandKeywords && offer.brand) {
      const brandKeywords = await expandBrandKeywordsWithPlanner(
        offer.brand,
        targetCountry,
        targetLanguage,
        maxBrandKeywords,
        userId,
        minSearchVolume
      )

      // 将品牌关键词添加到列表开头（高优先级）
      if (brandKeywords.length > 0) {
        allKeywords = [...brandKeywords, ...allKeywords]
        brandKeywordsCount = brandKeywords.length
      }
    }

    // 2. 获取所有关键词的搜索量和CPC数据
    const keywordTexts = allKeywords.map(kw => kw.keyword)
    const volumeData = await getKeywordSearchVolumes(
      keywordTexts,
      targetCountry,
      targetLanguage,
      userId
    )

    // 创建搜索量和CPC映射
    const volumeMap = new Map<string, number>()
    const cpcMap = new Map<string, number>()
    volumeData.forEach(v => {
      const key = v.keyword.toLowerCase()
      volumeMap.set(key, v.avgMonthlySearches)
      // 使用平均CPC
      const avgCpc = (v.lowTopPageBid + v.highTopPageBid) / 2
      cpcMap.set(key, avgCpc || 1) // 避免除以0
    })

    // 3. 过滤关键词
    let filteredKeywords = allKeywords.filter(kw => {
      const kwLower = kw.keyword.toLowerCase()
      const volume = volumeMap.get(kwLower) || 0
      const avgCpc = cpcMap.get(kwLower) || 1

      // 过滤搜索量
      if (volume < minSearchVolume) {
        filteredCount++
        return false
      }

      // 过滤研究意图关键词
      if (filterByIntent) {
        const hasResearchIntent = RESEARCH_INTENT_PATTERNS.some(pattern =>
          kwLower.includes(pattern)
        )
        // 如果包含研究意图词且不包含购买意图词，则过滤
        const hasPurchaseIntent = PURCHASE_INTENT_PATTERNS.some(pattern =>
          kwLower.includes(pattern)
        )
        if (hasResearchIntent && !hasPurchaseIntent) {
          filteredCount++
          return false
        }
      }

      // 过滤CPC效率（搜索量/CPC）
      const efficiencyScore = volume / avgCpc
      if (efficiencyScore < minEfficiencyScore) {
        filteredCount++
        return false
      }

      return true
    }).map(kw => {
      const kwLower = kw.keyword.toLowerCase()
      const volume = volumeMap.get(kwLower) || 0
      const avgCpc = cpcMap.get(kwLower) || 1

      // 智能分配匹配类型
      let matchType = kw.matchType
      if (smartMatchType) {
        if (kw.category === '品牌词') {
          matchType = 'EXACT' // 品牌词用精准匹配
        } else if (kw.category === '产品词' || kw.category === '解决方案词') {
          matchType = 'PHRASE' // 产品词用词组匹配
        } else {
          matchType = 'BROAD' // 长尾词用广泛匹配
        }
      }

      return {
        ...kw,
        matchType,
        searchVolume: volume,
        estimatedCpc: avgCpc
      }
    })

    // 4. 按效率分和优先级排序
    // 品牌词 > HIGH > MEDIUM > LOW，同优先级按效率分降序
    filteredKeywords.sort((a, b) => {
      // 品牌词优先
      const aIsBrand = a.category === '品牌词'
      const bIsBrand = b.category === '品牌词'
      if (aIsBrand && !bIsBrand) return -1
      if (!aIsBrand && bIsBrand) return 1

      // 按优先级排序
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff

      // 同优先级按效率分降序（搜索量/CPC）
      const aEfficiency = (a.searchVolume || 0) / (a.estimatedCpc || 1)
      const bEfficiency = (b.searchVolume || 0) / (b.estimatedCpc || 1)
      return bEfficiency - aEfficiency
    })

    // 提取分类
    const categories = Array.from(new Set(filteredKeywords.map(kw => kw.category)))

    const result: KeywordGenerationResult = {
      keywords: filteredKeywords,
      totalCount: filteredKeywords.length,
      categories,
      estimatedBudget: data.estimatedBudget,
      recommendations: data.recommendations || [],
      filteredCount,
      brandKeywordsCount,
    }

    return result
  } catch (error: any) {
    console.error('生成关键词失败:', error)
    throw new Error(`AI关键词生成失败: ${error.message}`)
  }
}

/**
 * 生成否定关键词（排除不相关流量）
 * @param offer - Offer信息
 * @param userId - 用户ID（必需，用于获取用户的AI配置）
 */
export async function generateNegativeKeywords(offer: Offer, userId: number): Promise<string[]> {
  const prompt = `你是一个Google Ads优化专家。请为以下产品生成否定关键词列表，以排除不相关的搜索流量。

# 产品信息
品牌名称：${offer.brand}
品牌描述：${offer.brand_description || '未提供'}
目标国家：${offer.target_country}
产品类别：${offer.category || '未分类'}

# 否定关键词生成原则
1. 排除免费、破解、盗版等低质量搜索
2. 排除招聘、职位、工作等非产品搜索
3. 排除竞品的特定型号或版本
4. 排除与产品无关的相似词
5. 排除价格过低的搜索（如"便宜"、"最低价"）

# 输出格式
请输出一个JSON数组，包含15-25个否定关键词：

{
  "negativeKeywords": [
    "关键词1",
    "关键词2",
    "关键词3"
  ]
}
`

  try {
    // 需求12：使用Gemini 2.0 Flash实验版模型（使用用户级AI配置）
    const text = await generateContent({
      model: 'gemini-2.0-flash-exp',
      prompt,
      temperature: 0.7,
      maxOutputTokens: 2048,
    }, userId)

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回的数据格式无效')
    }

    const data = JSON.parse(jsonMatch[0]) as { negativeKeywords: string[] }

    return data.negativeKeywords || []
  } catch (error: any) {
    console.error('生成否定关键词失败:', error)
    throw new Error(`AI否定关键词生成失败: ${error.message}`)
  }
}

/**
 * 关键词扩展（基于已有关键词生成更多变体）
 * @param baseKeywords - 基础关键词列表
 * @param offer - Offer信息
 * @param userId - 用户ID（必需，用于获取用户的AI配置）
 */
export async function expandKeywords(
  baseKeywords: string[],
  offer: Offer,
  userId: number
): Promise<GeneratedKeyword[]> {
  const prompt = `你是一个关键词扩展专家。请基于以下基础关键词，为${offer.brand}产品生成更多关键词变体。

# 基础关键词
${baseKeywords.join(', ')}

# 产品信息
品牌：${offer.brand}
类别：${offer.category || '未分类'}
目标国家：${offer.target_country}

# 扩展策略
1. 同义词和近义词
2. 不同表述方式
3. 添加修饰词（最新、专业、高效等）
4. 添加用户意图词（购买、对比、评测等）
5. 添加地域词（如适用）

# 输出格式
{
  "expandedKeywords": [
    {
      "keyword": "扩展后的关键词",
      "matchType": "BROAD|PHRASE|EXACT",
      "priority": "HIGH|MEDIUM|LOW",
      "category": "扩展类型",
      "searchIntent": "informational|navigational|transactional"
    }
  ]
}

请生成10-20个高质量扩展关键词。
`

  try {
    // 需求12：使用Gemini 2.0 Flash实验版模型（使用用户级AI配置）
    const text = await generateContent({
      model: 'gemini-2.0-flash-exp',
      prompt,
      temperature: 0.7,
      maxOutputTokens: 2048,
    }, userId)

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回的数据格式无效')
    }

    const data = JSON.parse(jsonMatch[0]) as { expandedKeywords: GeneratedKeyword[] }

    return data.expandedKeywords || []
  } catch (error: any) {
    console.error('扩展关键词失败:', error)
    throw new Error(`AI关键词扩展失败: ${error.message}`)
  }
}

/**
 * 使用Keyword Planner扩展品牌关键词
 * 通过Keyword Planner API获取真实的品牌相关关键词建议
 * @param brandName - 品牌名称
 * @param targetCountry - 目标国家
 * @param targetLanguage - 目标语言
 * @param maxKeywords - 最大关键词数量
 * @param userId - 用户ID
 * @param minSearchVolume - 最小搜索量阈值
 */
async function expandBrandKeywordsWithPlanner(
  brandName: string,
  targetCountry: string,
  targetLanguage: string,
  maxKeywords: number,
  userId: number,
  minSearchVolume: number = 500
): Promise<GeneratedKeyword[]> {
  try {
    // 使用品牌名作为种子关键词，通过Keyword Planner获取相关关键词建议
    const suggestions = await getKeywordSuggestions(
      [brandName],
      targetCountry,
      targetLanguage,
      maxKeywords * 3 // 请求更多以便过滤后有足够数量
    )

    // 过滤：只保留包含品牌名且搜索量>=阈值的关键词
    const brandLower = brandName.toLowerCase()
    const validKeywords = suggestions
      .filter(v =>
        v.avgMonthlySearches >= minSearchVolume &&
        v.keyword.toLowerCase().includes(brandLower)
      )
      .sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches)
      .slice(0, maxKeywords)

    // 转换为GeneratedKeyword格式
    return validKeywords.map(v => ({
      keyword: v.keyword,
      matchType: 'EXACT' as const, // 品牌词使用精准匹配，提高CTR
      priority: 'HIGH' as const, // 品牌词优先级最高
      category: '品牌词',
      searchIntent: 'navigational',
      searchVolume: v.avgMonthlySearches,
      estimatedCpc: v.highTopPageBid || undefined
    }))
  } catch (error) {
    console.error('扩展品牌关键词失败:', error)
    return [] // 失败时返回空数组，不影响主流程
  }
}
