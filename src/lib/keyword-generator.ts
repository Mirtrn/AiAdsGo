/**
 * 关键词生成器 v2.0 (精简版)
 *
 * ⚠️ 重要变更 (2025-12-14):
 * - 正向关键词生成已迁移到 unified-keyword-service.ts
 * - 本文件只保留否定关键词生成功能
 * - generateKeywords() 已废弃，请使用 getUnifiedKeywordData()
 *
 * @see unified-keyword-service.ts 获取正向关键词
 */

import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import type { Offer } from './offers'

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
 * @deprecated 正向关键词请使用 unified-keyword-service.ts 的 UnifiedKeywordData
 */
export interface GeneratedKeyword {
  keyword: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  category: string
  estimatedCpc?: number
  searchIntent?: string
  reasoning?: string
  searchVolume?: number
}

/**
 * 关键词生成结果
 * @deprecated 正向关键词请使用 unified-keyword-service.ts
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
  filteredCount?: number
  brandKeywordsCount?: number
}

/**
 * 使用AI生成关键词
 *
 * @deprecated 已废弃 (2025-12-14)
 * 正向关键词生成已迁移到 unified-keyword-service.ts
 * 请使用 getUnifiedKeywordData() 代替
 *
 * @see unified-keyword-service.ts
 */
export async function generateKeywords(
  _offer: Offer,
  _userId: number,
  _options?: { minSearchVolume?: number }
): Promise<KeywordGenerationResult> {
  console.warn('⚠️ generateKeywords() 已废弃，请使用 getUnifiedKeywordData() 代替')
  throw new Error('generateKeywords() 已废弃。请使用 unified-keyword-service.ts 的 getUnifiedKeywordData()')
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
    // 🔧 修复(2025-12-11): operationType应为negative_keyword_generation（使用Flash模型）
    // 原来错误使用keyword_expansion（Pro模型），导致使用gemini-3-pro-preview
    // gemini-3-pro-preview是思考型模型，不完全支持responseSchema，返回空content
    const aiResponse = await generateContent({
      operationType: 'negative_keyword_generation',  // ← 修复：使用正确的operationType
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
 *
 * @deprecated 已废弃 (2025-12-14)
 * 关键词扩展已迁移到 unified-keyword-service.ts
 * 请使用 getUnifiedKeywordData() 代替
 *
 * @see unified-keyword-service.ts
 */
export async function expandKeywords(
  _baseKeywords: string[],
  _offer: Offer,
  _userId: number
): Promise<GeneratedKeyword[]> {
  console.warn('⚠️ expandKeywords() 已废弃，请使用 getUnifiedKeywordData() 代替')
  throw new Error('expandKeywords() 已废弃。请使用 unified-keyword-service.ts 的 getUnifiedKeywordData()')
}

// ============================================
// 以下函数已迁移到 unified-keyword-service.ts
// 保留空实现以避免编译错误（向后兼容）
// ============================================

/**
 * @deprecated 已迁移到 unified-keyword-service.ts
 * @see unified-keyword-service.ts buildSmartSeedPool
 */
function expandBrandKeywordsWithPlanner(): Promise<GeneratedKeyword[]> {
  throw new Error('已迁移到 unified-keyword-service.ts')
}

/**
 * @deprecated 已迁移到 unified-keyword-service.ts
 * @see unified-keyword-service.ts extractKeywordsFromProductTitle
 */
function extractKeywordsFromProductTitle(_productTitle: string, _brandName: string): string[] {
  return []
}

/**
 * @deprecated 已迁移到 unified-keyword-service.ts
 * @see unified-keyword-service.ts aggregateStoreProductSeeds
 */
function aggregateStoreProductKeywords(
  _productNames: string[],
  _brandName: string,
  _category?: string | null
): GeneratedKeyword[] {
  return []
}

/**
 * @deprecated 已迁移到 unified-keyword-service.ts
 * @see unified-keyword-service.ts extractFeatureSeeds
 */
function generateKeywordsFromFeatures(
  _features: string,
  _brandName: string,
  _category?: string | null
): GeneratedKeyword[] {
  return []
}

// 防止 unused variable 警告
void expandBrandKeywordsWithPlanner
void extractKeywordsFromProductTitle
void aggregateStoreProductKeywords
void generateKeywordsFromFeatures
