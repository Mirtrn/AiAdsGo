import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Offer } from './offers'

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) {
  throw new Error('缺少GEMINI_API_KEY环境变量')
}

const genAI = new GoogleGenerativeAI(apiKey)

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
}

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
}

/**
 * 使用AI生成关键词
 */
export async function generateKeywords(offer: Offer): Promise<KeywordGenerationResult> {
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

  const prompt = `你是一个专业的Google Ads关键词策略专家。请基于以下产品信息，生成高质量的搜索广告关键词列表。

# 产品信息
品牌名称：${offer.brand}
品牌描述：${offer.brandDescription || '未提供'}
目标国家：${offer.targetCountry}
产品类别：${offer.category || '未分类'}

独特卖点：
${offer.uniqueSellingPoints || '未提供'}

产品亮点：
${offer.productHighlights || '未提供'}

目标受众：
${offer.targetAudience || '未提供'}

# 关键词生成要求

请生成30-50个高质量关键词，涵盖以下类别：
1. **品牌词**（5-8个）：包含品牌名称的关键词
2. **产品词**（10-15个）：核心产品功能和类别相关
3. **解决方案词**（8-12个）：用户痛点和解决方案
4. **竞品词**（5-8个）：主要竞争对手品牌（如果适用）
5. **长尾词**（10-15个）：更具体的用户搜索意图

# 匹配类型分配原则
- **BROAD（广泛匹配）**：用于发现新的搜索机会，适用于产品词和解决方案词
- **PHRASE（词组匹配）**：用于平衡覆盖面和精准度，适用于品牌词和产品词
- **EXACT（完全匹配）**：用于最高转化的核心词，适用于品牌词和高意图长尾词

# 优先级判定
- **HIGH**：品牌词、高转化产品词、明确购买意图的长尾词
- **MEDIUM**：一般产品词、解决方案词、中等搜索量的竞品词
- **LOW**：广泛发现词、低搜索量的长尾词

# 输出格式
请严格按照以下JSON格式输出（不要包含任何其他文本）：

{
  "keywords": [
    {
      "keyword": "关键词文本",
      "matchType": "BROAD|PHRASE|EXACT",
      "priority": "HIGH|MEDIUM|LOW",
      "category": "品牌词|产品词|解决方案词|竞品词|长尾词",
      "searchIntent": "informational|navigational|transactional",
      "reasoning": "选择此关键词的简短理由（可选）"
    }
  ],
  "estimatedBudget": {
    "minDaily": 50,
    "maxDaily": 200,
    "currency": "USD"
  },
  "recommendations": [
    "针对此产品的关键词策略建议1",
    "针对此产品的关键词策略建议2",
    "针对此产品的关键词策略建议3"
  ]
}

注意事项：
1. 关键词必须符合目标国家（${offer.targetCountry}）的语言和搜索习惯
2. 避免违禁词和敏感词
3. 考虑季节性和时效性因素
4. 预算估算应基于行业标准CPC
`

  try {
    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    // 提取JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回的数据格式无效')
    }

    const data = JSON.parse(jsonMatch[0]) as {
      keywords: GeneratedKeyword[]
      estimatedBudget?: {
        minDaily: number
        maxDaily: number
        currency: string
      }
      recommendations: string[]
    }

    // 验证数据
    if (!data.keywords || !Array.isArray(data.keywords)) {
      throw new Error('AI返回的关键词列表格式无效')
    }

    // 提取分类
    const categories = Array.from(new Set(data.keywords.map(kw => kw.category)))

    const result: KeywordGenerationResult = {
      keywords: data.keywords,
      totalCount: data.keywords.length,
      categories,
      estimatedBudget: data.estimatedBudget,
      recommendations: data.recommendations || [],
    }

    return result
  } catch (error: any) {
    console.error('生成关键词失败:', error)
    throw new Error(`AI关键词生成失败: ${error.message}`)
  }
}

/**
 * 生成否定关键词（排除不相关流量）
 */
export async function generateNegativeKeywords(offer: Offer): Promise<string[]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

  const prompt = `你是一个Google Ads优化专家。请为以下产品生成否定关键词列表，以排除不相关的搜索流量。

# 产品信息
品牌名称：${offer.brand}
品牌描述：${offer.brandDescription || '未提供'}
目标国家：${offer.targetCountry}
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
    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

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
 */
export async function expandKeywords(
  baseKeywords: string[],
  offer: Offer
): Promise<GeneratedKeyword[]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

  const prompt = `你是一个关键词扩展专家。请基于以下基础关键词，为${offer.brand}产品生成更多关键词变体。

# 基础关键词
${baseKeywords.join(', ')}

# 产品信息
品牌：${offer.brand}
类别：${offer.category || '未分类'}
目标国家：${offer.targetCountry}

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
    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

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
