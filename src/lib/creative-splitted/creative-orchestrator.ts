/**
 * 🔥 创意生成器协调器模块
 * 从 ad-creative-generator.ts 拆分出来
 *
 * 职责: 协调各子模块，主工作流管理
 * 遵循 KISS 原则: 清晰的工作流程，错误处理和日志记录
 */

import type {
  IntentCategory,
  KeywordWithVolume,
  AIConfig,
  GenerateAdCreativeOptions,
  BatchGenerateOptions,
  AIResponse,
  PromptVariables,
  CreativeGenerationError
} from './creative-types'
import { getAIConfig, callAI, parseAIResponse } from './creative-generator'
import { buildPrompt } from './creative-prompt-builder'
import { saveToDatabase, getFromCache, setCache, generateCacheKey } from './creative-storage'
import { getDatabase } from '../db'
import { getKeywords } from '../offer-keyword-pool'
import type { Offer } from '../offers'
import { creativeCache, generateCreativeCacheKey } from '../cache'
import { getKeywordSearchVolumes } from '../keyword-planner'
import { recordTokenUsage, estimateTokenCost } from '../ai-token-tracker'
import type { GeneratedAdCreativeData, HeadlineAsset, DescriptionAsset, QualityMetrics } from '../ad-creative'

/**
 * 🎯 从关键词池获取并格式化关键词
 * 使用新的统一 getKeywords() API
 */
async function getKeywordsForPrompt(offerId: number, options: GenerateAdCreativeOptions): Promise<string[]> {
  try {
    // 使用新的统一 API 获取关键词
    const result = await getKeywords(offerId, {
      bucket: (options.bucket === 'S' ? 'ALL' : options.bucket) as 'A' | 'B' | 'C' | 'ALL' || 'ALL',
      minSearchVolume: 100,
      maxKeywords: 50
    })

    // 提取关键词字符串
    const keywords = result.keywords.map((kw: any) => typeof kw === 'string' ? kw : kw.keyword)

    console.log(`[getKeywordsForPrompt] 获取到 ${keywords.length} 个关键词`)
    return keywords
  } catch (error) {
    console.error('[getKeywordsForPrompt] 获取关键词失败:', error)
    return []
  }
}

/**
 * 🎯 从提取元素中获取关键词
 * 兼容性处理：支持新旧格式
 */
function getKeywordsFromExtractedElements(extractedElements: any): Array<{ keyword: string; searchVolume: number; source: string; priority: string }> {
  if (!extractedElements?.keywords) {
    return []
  }

  // 新格式: extractedElements.keywords (KeywordWithVolume[])
  if (Array.isArray(extractedElements.keywords) && extractedElements.keywords.length > 0) {
    // 检查是否是对象数组 (新格式)
    if (typeof extractedElements.keywords[0] === 'object' && 'keyword' in extractedElements.keywords[0]) {
      return extractedElements.keywords.map((kw: any) => ({
        keyword: typeof kw === 'string' ? kw : kw.keyword,
        searchVolume: kw.searchVolume || 0,
        source: kw.source || 'EXTRACTED',
        priority: kw.priority || 'MEDIUM'
      }))
    }
    // 字符串数组 (旧格式)
    return extractedElements.keywords.map((kw: string) => ({
      keyword: kw,
      searchVolume: 0,
      source: 'EXTRACTED',
      priority: 'MEDIUM'
    }))
  }

  return []
}

/**
 * 🎯 构建完整的提示变量
 * 整合所有数据源
 */
async function buildPromptVariables(
  offer: any,
  extractedElements: any,
  keywordPool: any,
  options: GenerateAdCreativeOptions
): Promise<PromptVariables> {
  const variables: PromptVariables = {
    offer_title: offer.title || '',
    offer_category: offer.category || '',
    product_features: offer.product_features || '',
    target_audience: offer.target_audience || '',
    brand_name: offer.brand || '',
    extracted_keywords_section: '',
    ai_keywords_section: '',
    market_analysis_section: '',
    competitor_intelligence_section: '',
    landing_page_insights_section: '',
    cpc_recommendations_section: '',
    negative_keywords_section: '',
    creative_guidelines_section: '',
    product_usps: offer.product_usps || '',
    seasonal_trends: offer.seasonal_trends || '',
    market_positioning: offer.market_positioning || '',
    tone_of_voice: offer.tone_of_voice || '',
    call_to_action: offer.call_to_action || ''
  }

  // 🔥 修复(2025-12-17): 优先使用关键词池数据，而非旧的ai_keywords字段
  const keywordsFromPool = await getKeywordsForPrompt(offer.id, options)

  if (keywordsFromPool && keywordsFromPool.length > 0) {
    variables.ai_keywords_section = `\n**高价值关键词池** (已验证搜索量):\n${keywordsFromPool.slice(0, 50).join(', ')}\n`
    console.log(`[Prompt] 🔑 提供给AI的关键词数量: ${keywordsFromPool.length}个 (来源: 关键词池)`)
  } else {
    // fallback: 使用旧的 ai_keywords 字段
    const aiKeywords = extractedElements?.ai_keywords || offer?.ai_keywords || []
    if (Array.isArray(aiKeywords) && aiKeywords.length > 0) {
      variables.ai_keywords_section = `\n**高价值关键词** (AI生成):\n${aiKeywords.slice(0, 15).join(', ')}\n`
      console.log(`[Prompt] 🔑 提供给AI的关键词数量: ${aiKeywords.length}个 (来源: ai_keywords)`)
    } else {
      variables.ai_keywords_section = ''
      console.log('[Prompt] ⚠️ 未找到任何关键词数据')
    }
  }

  // 处理 extracted_keywords
  const extractedKeywords = getKeywordsFromExtractedElements(extractedElements)
  if (extractedKeywords.length > 0) {
    variables.extracted_keywords_section = `\n**从产品页面提取的关键词**:\n${extractedKeywords.map(k => k.keyword).join(', ')}\n`
  }

  // TODO: 其他sections可以逐步添加
  // - market_analysis_section
  // - competitor_intelligence_section
  // - landing_page_insights_section
  // - cpc_recommendations_section
  // - negative_keywords_section
  // - creative_guidelines_section

  return variables
}

/**
 * ✅ 主入口函数：生成单个广告创意
 * 协调所有子模块的工作流程
 */
export async function generateAdCreative(
  offerId: number,
  userId: number,
  options: GenerateAdCreativeOptions = {}
): Promise<GeneratedAdCreativeData & { ai_model: string }> {
  console.log(`[generateAdCreative] 开始生成创意 offerId=${offerId}`)

  // 1. 检查缓存
  const cacheKey = generateCreativeCacheKey(offerId, options)
  if (!options.skipCache) {
    const cached = creativeCache.get(cacheKey)
    if (cached) {
      console.log('✅ 使用缓存的广告创意')
      return cached
    }
  }

  // 2. 获取 Offer 数据
  const db = await getDatabase()
  const offer = await db.queryOne(
    'SELECT * FROM offers WHERE id = ? AND user_id = ?',
    [offerId, userId]
  )

  if (!offer) {
    throw new Error('Offer不存在或无权访问')
  }

  // 3. 读取提取的广告元素
  let extractedElements: any = {}
  try {
    const elements = await db.queryOne(
      'SELECT extracted_elements FROM offers WHERE id = ?',
      [offerId]
    )
    extractedElements = elements?.extracted_elements || {}
  } catch (error) {
    console.warn('[generateAdCreative] 读取提取元素失败:', error)
  }

  // 4. 构建提示变量
  const variables = await buildPromptVariables(offer, extractedElements, options.keywordPool, options)

  // 5. 构建提示
  const prompt = await buildPrompt(variables, options)

  // 6. 调用 AI
  const aiConfig = await getAIConfig(userId)
  const aiResponse = await callAI(prompt, aiConfig, userId)

  if (!aiResponse.success) {
    throw new Error(`AI调用失败: ${aiResponse.error}`)
  }

  // 7. 解析响应
  const creativeData = await parseAIResponse(aiResponse.data, options)

  // 8. 保存到数据库
  const saved = await saveToDatabase(offerId, userId, creativeData, aiConfig.type || 'unknown', aiResponse.model || 'unknown')

  // 9. 缓存结果
  if (!options.skipCache) {
    setCache(cacheKey, saved)
  }

  console.log(`[generateAdCreative] 完成 offerId=${offerId}`)
  return saved
}

/**
 * ✅ 批量生成创意
 * TODO: 实现批量生成逻辑
 */
export async function generateAdCreativesBatch(
  offerId: number,
  userId: number,
  count: number = 3,
  options: BatchGenerateOptions = {}
): Promise<Array<GeneratedAdCreativeData & { ai_model: string }>> {
  console.log(`[generateAdCreativesBatch] 开始批量生成 ${count} 个创意`)

  const results: Array<GeneratedAdCreativeData & { ai_model: string }> = []
  const excludeKeywords: string[] = options.excludeKeywords || []

  for (let i = 0; i < count; i++) {
    try {
      const creative = await generateAdCreative(offerId, userId, {
        ...options,
        excludeKeywords
      })

      results.push(creative)

      // 累积排除的关键词以避免重复
      if (creative.headlines) {
        const headlineTexts = creative.headlines.map((h: any) => {
          // 支持字符串或对象格式
          if (typeof h === 'string') return h
          if (h && typeof h === 'object' && 'text' in h) return h.text
          return ''
        }).filter(text => text)
        excludeKeywords.push(...headlineTexts)
      }

      console.log(`[generateAdCreativesBatch] 完成第 ${i + 1}/${count} 个创意`)
    } catch (error) {
      console.error(`[generateAdCreativesBatch] 第 ${i + 1} 个创意生成失败:`, error)
      // 继续生成下一个
    }
  }

  return results
}

/**
 * ✅ 综合创意生成
 * TODO: 实现综合创意逻辑
 */
export async function generateSyntheticCreative(
  offerId: number,
  userId: number,
  options: GenerateAdCreativeOptions = {}
): Promise<GeneratedAdCreativeData & { ai_model: string }> {
  console.log(`[generateSyntheticCreative] 开始生成综合创意 offerId=${offerId}`)

  // TODO: 实现综合创意生成逻辑
  // 这将使用多个桶的关键词来生成一个综合性的创意

  return generateAdCreative(offerId, userId, {
    ...options,
    isSyntheticCreative: true
  })
}

/**
 * ✅ 带多样性检查的创意生成
 * TODO: 实现多样性检查逻辑
 */
export async function generateMultipleCreativesWithDiversityCheck(
  offerId: number,
  userId: number,
  count: number = 3,
  options: GenerateAdCreativeOptions = {}
): Promise<Array<GeneratedAdCreativeData & { ai_model: string }>> {
  console.log(`[generateMultipleCreativesWithDiversityCheck] 开始生成 ${count} 个多样性创意`)

  // TODO: 实现多样性检查逻辑
  // 确保生成的创意在主题、风格、关键词使用等方面有足够的多样性

  return generateAdCreativesBatch(offerId, userId, count, options)
}
