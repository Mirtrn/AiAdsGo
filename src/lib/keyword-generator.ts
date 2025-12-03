import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { getKeywordSearchVolumes, getKeywordSuggestions } from './keyword-planner'
import type { Offer } from './offers'
import { loadPrompt } from './prompt-loader'

/**
 * 获取否定关键词的语言指令
 */
function getLanguageInstructionForNegativeKeywords(targetLanguage: string): string {
  const lang = targetLanguage.toLowerCase()

  if (lang.includes('italian') || lang === 'it') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in ITALIAN ONLY.
- Examples: "gratuito", "economico", "tutorial", "come usare", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Italian.`
  } else if (lang.includes('spanish') || lang === 'es') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in SPANISH ONLY.
- Examples: "gratis", "barato", "tutorial", "cómo usar", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Spanish.`
  } else if (lang.includes('french') || lang === 'fr') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in FRENCH ONLY.
- Examples: "gratuit", "bon marché", "tutoriel", "comment utiliser", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in French.`
  } else if (lang.includes('german') || lang === 'de') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in GERMAN ONLY.
- Examples: "kostenlos", "billig", "anleitung", "wie man benutzt", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in German.`
  } else if (lang.includes('portuguese') || lang === 'pt') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in PORTUGUESE ONLY.
- Examples: "grátis", "barato", "tutorial", "como usar", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Portuguese.`
  } else if (lang.includes('japanese') || lang === 'ja') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in JAPANESE ONLY.
- Examples: "無料", "安い", "チュートリアル", "使い方", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Japanese.`
  } else if (lang.includes('korean') || lang === 'ko') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in KOREAN ONLY.
- Examples: "무료", "싼", "튜토리얼", "사용 방법", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Korean.`
  } else if (lang.includes('russian') || lang === 'ru') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in RUSSIAN ONLY.
- Examples: "бесплатно", "дешево", "учебник", "как использовать", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Russian.`
  } else if (lang.includes('arabic') || lang === 'ar') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in ARABIC ONLY.
- Examples: "مجاني", "رخيص", "درس تعليمي", "كيفية الاستخدام", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Arabic.`
  } else if (lang.includes('chinese') || lang === 'zh') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in CHINESE ONLY.
- Examples: "免费", "便宜", "教程", "如何使用", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Chinese.`
  }

  // Default to English
  return `Generate negative keywords in English.`
}

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
  maxCompetitionIndex?: number // 🎯 最大竞争度指数（0-100），可选，用于手动过滤（不建议使用）
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
  const maxCompetitionIndex = options?.maxCompetitionIndex  // 🎯 移除默认值，只在用户明确指定时才过滤
  const filterByIntent = options?.filterByIntent ?? true
  const smartMatchType = options?.smartMatchType ?? true

  // 📦 从数据库加载prompt模板 (版本管理)
  const promptTemplate = await loadPrompt('keywords_generation')

  // 🎨 插值替换模板变量
  const prompt = promptTemplate
    .replace('{{offer.brand}}', offer.brand)
    .replace('{{offer.brand_description}}', offer.brand_description || '未提供')
    .replace('{{offer.target_country}}', offer.target_country)
    .replace(/\{\{offer\.target_country\}\}/g, offer.target_country) // 替换所有出现的地方
    .replace('{{offer.category}}', offer.category || '未分类')

  // 🆕 Token优化：定义结构化JSON schema
  const responseSchema = {
    type: 'OBJECT' as const,
    properties: {
      keywords: {
        type: 'ARRAY' as const,
        description: '30个高质量关键词数组',
        items: {
          type: 'OBJECT' as const,
          properties: {
            keyword: { type: 'STRING' as const, description: '关键词文本' },
            matchType: { type: 'STRING' as const, enum: ['BROAD', 'PHRASE', 'EXACT'], description: '匹配类型' },
            priority: { type: 'STRING' as const, enum: ['HIGH', 'MEDIUM', 'LOW'], description: '优先级' },
            category: { type: 'STRING' as const, description: '关键词类别' },
            searchIntent: { type: 'STRING' as const, description: '搜索意图' }
          },
          required: ['keyword', 'matchType', 'priority', 'category', 'searchIntent']
        }
      },
      estimatedBudget: {
        type: 'OBJECT' as const,
        properties: {
          minDaily: { type: 'NUMBER' as const, description: '最小日预算' },
          maxDaily: { type: 'NUMBER' as const, description: '最大日预算' },
          currency: { type: 'STRING' as const, description: '货币单位' }
        }
      },
      recommendations: {
        type: 'ARRAY' as const,
        description: '策略建议',
        items: { type: 'STRING' as const }
      }
    },
    required: ['keywords']
  }

  try {
    // 智能模型选择：关键词生成使用Pro模型
    const aiResponse = await generateContent({
      operationType: 'keyword_generation',
      prompt,
      temperature: 0.7,
      maxOutputTokens: 8192,  // 增加到8192以避免关键词生成输出被截断
      responseSchema,  // 🆕 传递JSON schema约束
      responseMimeType: 'application/json'  // 🆕 强制JSON输出
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
        operationType: 'keyword_generation',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    const text = aiResponse.text

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
    const competitionIndexMap = new Map<string, number>()  // 🎯 新增：竞争度指数映射
    volumeData.forEach(v => {
      const key = v.keyword.toLowerCase()
      volumeMap.set(key, v.avgMonthlySearches)
      // 使用平均CPC
      const avgCpc = (v.lowTopPageBid + v.highTopPageBid) / 2
      cpcMap.set(key, avgCpc || 1) // 避免除以0
      competitionIndexMap.set(key, v.competitionIndex || 0)  // 🎯 新增：存储竞争度指数
    })

    // 3. 过滤关键词
    let filteredKeywords = allKeywords.filter(kw => {
      const kwLower = kw.keyword.toLowerCase()
      const volume = volumeMap.get(kwLower) || 0
      const avgCpc = cpcMap.get(kwLower) || 1
      const competitionIndex = competitionIndexMap.get(kwLower) || 0

      // 过滤搜索量
      if (volume < minSearchVolume) {
        filteredCount++
        return false
      }

      // 🎯 竞争度过滤（仅在用户明确指定时）
      if (maxCompetitionIndex !== undefined && competitionIndex > maxCompetitionIndex) {
        console.log(`⚠️ 过滤高竞争度关键词: "${kw.keyword}" (竞争度指数: ${competitionIndex})`)
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
      const competitionIndex = competitionIndexMap.get(kwLower) || 0  // 保留竞争度信息用于排序

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

    // 4. 按效率分和优先级排序（考虑竞争度）
    // 品牌词 > HIGH > MEDIUM > LOW，同优先级按综合得分降序
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

      // 🎯 同优先级按综合得分降序（效率分70% + 竞争度加分30%）
      const aEfficiency = (a.searchVolume || 0) / (a.estimatedCpc || 1)
      const bEfficiency = (b.searchVolume || 0) / (b.estimatedCpc || 1)

      // 获取竞争度指数
      const aCompetitionIndex = competitionIndexMap.get(a.keyword.toLowerCase()) || 50
      const bCompetitionIndex = competitionIndexMap.get(b.keyword.toLowerCase()) || 50

      // 竞争度加分：竞争度越低加分越多（0-100转换为0-1的加成）
      const aCompetitionBonus = (100 - aCompetitionIndex) / 100
      const bCompetitionBonus = (100 - bCompetitionIndex) / 100

      // 综合得分：效率分 × (1 + 竞争度加成 × 0.3)
      const aScore = aEfficiency * (1 + aCompetitionBonus * 0.3)
      const bScore = bEfficiency * (1 + bCompetitionBonus * 0.3)

      return bScore - aScore
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
  const targetLanguage = offer.target_language || 'English'
  const languageInstruction = getLanguageInstructionForNegativeKeywords(targetLanguage)

  const prompt = `${languageInstruction}

你是一个Google Ads优化专家。请为以下电商产品生成否定关键词列表，以排除不相关的搜索流量，提升广告投放ROI。

# 产品信息
品牌名称：${offer.brand}
品牌描述：${offer.brand_description || '未提供'}
目标国家：${offer.target_country}
目标语言：${targetLanguage}
产品类别：${offer.category || '未分类'}

# 否定关键词生成原则（针对电商产品）
1. **低价值搜索**：排除免费、破解、盗版、试用、样品
2. **信息查询**：排除教程、指南、评测、对比、如何使用
3. **招聘/工作**：排除招聘、职位、工作、兼职、薪资
4. **二手/维修**：排除二手、翻新、维修、修理、配件
5. **竞品品牌**：排除主要竞品的品牌名和型号
6. **不相关产品**：排除与${offer.category || '产品'}无关的相似产品
7. **低价搜索**：排除便宜、最低价、批发、清仓
8. **DIY/自制**：排除DIY、手工、自制、教程
9. **下载/虚拟**：排除下载、软件、APP、PDF
10. **地域/渠道限制**：排除与目标市场不符的地域词或渠道词

# 数量要求
**必须生成40-50个否定关键词**，确保覆盖所有低价值流量类型。

# 输出格式
{
  "negativeKeywords": [
    "free",
    "cheap",
    "tutorial",
    "...（继续添加至40-50个）"
  ]
}

重要：
1. 所有关键词必须使用目标语言 ${targetLanguage}
2. 关键词必须覆盖上述10个类别
3. 总数必须达到40-50个
4. 返回纯JSON，不要markdown代码块
`

  // 🆕 Token优化：定义结构化JSON schema
  const responseSchema = {
    type: 'OBJECT' as const,
    properties: {
      negativeKeywords: {
        type: 'ARRAY' as const,
        description: '40-50个否定关键词数组',
        items: {
          type: 'STRING' as const
        }
      }
    },
    required: ['negativeKeywords']
  }

  try {
    // 智能模型选择：关键词扩展使用Pro模型
    const aiResponse = await generateContent({
      operationType: 'keyword_expansion',
      prompt,
      temperature: 0.7,
      maxOutputTokens: 8192,
      responseSchema,  // 🆕 传递JSON schema约束
      responseMimeType: 'application/json'  // 🆕 强制JSON输出
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
        operationType: 'negative_keyword_generation',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/)
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
    // 智能模型选择：否定关键词生成使用Flash模型（简单列表任务）
    const aiResponse = await generateContent({
      operationType: 'negative_keyword_generation',
      prompt,
      temperature: 0.7,
      maxOutputTokens: 2048,  // ✅ 优化：输出20-50个否定关键词约500-1000 tokens,2048足够(原8192浪费75%)
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
        operationType: 'keyword_expansion',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/)
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
