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
import { filterKeywordQuality } from '../keyword-quality-filter'

/**
 * 🎯 从关键词池获取并格式化关键词
 * 使用新的统一 getKeywords() API
 * 🔥 2025-12-27: 添加关键词质量过滤作为安全保护层
 */
async function getKeywordsForPrompt(offerId: number, options: GenerateAdCreativeOptions): Promise<string[]> {
  try {
    // 使用新的统一 API 获取关键词
    // 🔧 修复：getKeywords 只接受 'A' | 'B' | 'C' | 'ALL'，
    //   'D' 和 'S' 都需要映射到 'ALL'（获取全部桶的关键词）
    const rawBucket = options.bucket
    const mappedBucket: 'A' | 'B' | 'C' | 'ALL' =
      rawBucket === 'A' ? 'A'
      : rawBucket === 'B' ? 'B'
      : rawBucket === 'C' ? 'C'
      : 'ALL'  // D / S / undefined 统一映射到 ALL

    const result = await getKeywords(offerId, {
      bucket: mappedBucket,
      minSearchVolume: 100,
      maxKeywords: 50
    })

    // 提取关键词字符串
    let keywords = result.keywords.map((kw: any) => typeof kw === 'string' ? kw : kw.keyword)

    // 🔥 2025-12-27: 额外安全过滤 - 移除品牌变体词和语义查询词
    // 即使关键词池已过滤，这层保护可以处理旧数据或边界情况
    const keywordPoolData = keywords.map(kw => ({
      keyword: kw,
      searchVolume: 0,
      source: 'POOL' as const
    }))

    const brandName = options.brandName || ''
    const filtered = filterKeywordQuality(keywordPoolData, {
      brandName,
      minWordCount: 1,
      maxWordCount: 8
    })

    // 如果有过滤掉的关键词，记录日志
    if (filtered.removed.length > 0) {
      console.log(`[getKeywordsForPrompt] 🔒 安全过滤移除 ${filtered.removed.length} 个低质量关键词`)
      filtered.removed.slice(0, 5).forEach(item => {
        console.log(`   - "${item.keyword.keyword}": ${item.reason}`)
      })
    }

    keywords = filtered.filtered.map(kw => kw.keyword)

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
 * 🎯 根据bucket类型构建intent策略指导
 */
function buildIntentStrategySection(
  bucket: 'A' | 'B' | 'C' | 'D' | 'S' | undefined,
  scenarioCount: number,
  questionCount: number,
  quantitativeCount: number
): string {
  if (!bucket) return ''

  const bucketStrategies = {
    A: {
      name: '品牌/信任导向',
      keywordRatio: 40,
      intentRatio: 60,
      focus: '信任证据、数据驱动、官方认证',
      distribution: '40% 关键词密集型 + 30% 数据驱动 + 20% 问答式（解决信任顾虑） + 10% 品牌信任'
    },
    B: {
      name: '场景+功能导向',
      keywordRatio: 30,
      intentRatio: 70,
      focus: '场景痛点引入、功能解法、真实使用场景',
      distribution: '30% 关键词密集型 + 40% 场景化 + 20% 问答式（痛点→解法） + 10% 数据驱动'
    },
    D: {
      name: '转化/价值导向',
      keywordRatio: 40,
      intentRatio: 60,
      focus: '可验证价值点、促销优惠、强CTA',
      distribution: '40% 关键词密集型 + 30% 数据驱动（价值证明） + 20% 问答式（价值对比） + 10% 促销/CTA'
    }
  }

  const strategy = bucketStrategies[bucket as 'A' | 'B' | 'D']
  if (!strategy) return ''

  return `
## 🎯 Intent-Driven Strategy for Bucket ${bucket} (${strategy.name})

**核心原则**: 关键词相关性 + 意图理解 = 最佳效果

**Headline生成策略 (15个headlines分配)**:
${strategy.distribution}

**策略重点**: ${strategy.focus}

**数据可用性**:
- 用户场景: ${scenarioCount}个
- 用户问题: ${questionCount}个
- 量化数据: ${quantitativeCount}个

**生成要求**:
1. **关键词密集型 (${strategy.keywordRatio}%)**: 用于broad match和高流量搜索
   - 必须包含核心关键词，用于宽泛搜索
   - 例如: "Smart Watch Fitness Tracker GPS Heart Rate Monitor"

2. **场景化/数据驱动/价值点 (${strategy.intentRatio}%)**: 基于真实评论数据
   - 使用上述"用户真实场景"、"用户常问问题"、"量化数据亮点"
   - 例如: "Perfect for Hiking: 3-Day Battery + GPS Tracking"
   - 例如: "18-Hour Battery Life - Verified by 5000+ Reviews"

3. **问答式headlines**: 回答用户具体问题或顾虑
   - 基于"用户常问问题"和"用户痛点"
   - 例如: "Worried About Battery? 72-Hour Runtime Guaranteed"
   - ⚠️ 避免过多问号（Google Ads SYMBOLS政策），优先使用陈述句

**Google Ads合规**:
- 仍需遵守字符限制 (30/90)
- 仍需evidence-only claims（只使用评论中验证的数据）
- 避免SYMBOLS政策违规（问号不超过3个）

**RSA优势**:
- Google会根据搜索词自动选择最相关的headline组合
- 宽泛搜索 → 展示关键词密集型headlines
- 长尾/高意图搜索 → 展示场景化/问答式headlines
`
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

  // 🎯 Intent-driven optimization: 注入场景数据
  try {
    // 解析场景数据
    const scenarios = offer.user_scenarios ? JSON.parse(offer.user_scenarios) : []
    const painPoints = offer.pain_points ? JSON.parse(offer.pain_points) : []
    const userQuestions = offer.user_questions ? JSON.parse(offer.user_questions) : []

    // 解析review_analysis中的量化数据
    let quantitativeHighlights: any[] = []
    if (offer.review_analysis) {
      try {
        const reviewAnalysis = JSON.parse(offer.review_analysis)
        quantitativeHighlights = reviewAnalysis.quantitativeHighlights || []
      } catch (e) {
        console.warn('[Prompt] 解析review_analysis失败:', e)
      }
    }

    // 构建场景section
    if (scenarios.length > 0) {
      variables.user_scenarios_section = `\n## 📊 用户真实场景 (从评论中提取)\n\n${scenarios.map((s: any, i: number) =>
        `${i+1}. **${s.scenario}** (提及频率: ${s.frequency}, 来源: ${s.source})`
      ).join('\n')}\n\n**这些是真实用户在评论中提到的使用场景，优先级高于假设的关键词。**\n`
      console.log(`[Prompt] 🎯 注入场景数据: ${scenarios.length}个场景`)
    }

    // 构建用户问题section
    if (userQuestions.length > 0) {
      const topQuestions = userQuestions.slice(0, 10)
      variables.user_questions_section = `\n## ❓ 用户常问问题 (从评论和痛点提取)\n\n${topQuestions.map((q: any, i: number) =>
        `${i+1}. ${q.question} (优先级: ${q.priority}, 类型: ${q.category})`
      ).join('\n')}\n\n**这些问题来自真实用户评论，是高意图搜索的来源。**\n`
      console.log(`[Prompt] 🎯 注入用户问题: ${topQuestions.length}个问题`)
    }

    // 构建痛点section
    if (painPoints.length > 0) {
      variables.pain_points_section = `\n## ⚠️ 用户痛点 (从评论中提取)\n\n${painPoints.map((p: string, i: number) => `${i+1}. ${p}`).join('\n')}\n`
      console.log(`[Prompt] 🎯 注入痛点数据: ${painPoints.length}个痛点`)
    }

    // 构建量化数据section
    if (quantitativeHighlights.length > 0) {
      variables.quantitative_highlights_section = `\n## 📈 量化数据亮点 (评论中的具体数字)\n\n${quantitativeHighlights.map((h: any, i: number) =>
        `${i+1}. ${h.metric}: ${h.value}${h.adCopy ? ` (广告文案: "${h.adCopy}")` : ''}`
      ).join('\n')}\n\n**这些是用户在评论中提到的具体数字，可以直接用于headlines。**\n`
      console.log(`[Prompt] 🎯 注入量化数据: ${quantitativeHighlights.length}个数据点`)
    }

    // 根据bucket类型构建intent策略section
    const bucket = options.bucket
    if (bucket && (scenarios.length > 0 || userQuestions.length > 0 || quantitativeHighlights.length > 0)) {
      variables.intent_strategy_section = buildIntentStrategySection(bucket, scenarios.length, userQuestions.length, quantitativeHighlights.length)
      console.log(`[Prompt] 🎯 应用Bucket ${bucket}的intent策略`)
    }

  } catch (error) {
    console.warn('[Prompt] 解析场景数据失败（非致命）:', error)
    // 降级：继续使用纯关键词模式
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

  // 3. 解析提取的广告元素（复用已查询的 offer 数据，避免重复查询）
  // 🔧 修复：extracted_elements 在 SQLite 中是 JSON 字符串，需要解析；PostgreSQL jsonb 已自动解析为对象
  let extractedElements: any = {}
  try {
    const raw = offer.extracted_elements
    if (raw) {
      extractedElements = typeof raw === 'string' ? JSON.parse(raw) : raw
    }
  } catch (error) {
    console.warn('[generateAdCreative] 解析 extracted_elements 失败:', error)
  }

  // 4. 构建提示变量
  // 🔥 2025-12-27: 确保 brandName 传递给 getKeywordsForPrompt
  options.brandName = offer.brand
  const variables = await buildPromptVariables(offer, extractedElements, options.keywordPool, options)

  // 5. 构建提示
  const prompt = await buildPrompt(variables, options)

  // 6. 调用 AI（options.aiProvider 临时覆盖全局设置）
  const aiConfig = await getAIConfig(userId)
  const aiResponse = await callAI(prompt, aiConfig, userId, options.aiProvider)

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
 * 增强多样性机制：主题轮换 + headlines排除
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
  const excludeHeadlines: string[] = [] // 累积已生成的headlines

  // 🆕 主题轮换策略（确保多样性）
  const diversityThemes = [
    '价格优惠和促销活动（强调折扣、限时优惠、性价比）',
    '产品功能和技术特性（强调性能参数、创新技术、核心功能）',
    '用户评价和社会证明（强调好评、销量、用户推荐）',
    '品牌权威和���任背书（强调官方渠道、品牌历史、质量保证）'
  ]

  for (let i = 0; i < count; i++) {
    try {
      const creative = await generateAdCreative(offerId, userId, {
        ...options,
        excludeKeywords,
        excludeHeadlines: excludeHeadlines.length > 0 ? excludeHeadlines : undefined,
        diversityTheme: diversityThemes[i % diversityThemes.length] // 轮换主题
      })

      results.push(creative)

      // 累积已生成的headlines（用于下一轮避免重复）
      if (creative.headlines) {
        const headlineTexts = creative.headlines.map((h: any) => {
          if (typeof h === 'string') return h
          if (h && typeof h === 'object' && 'text' in h) return h.text
          return ''
        }).filter(text => text)

        excludeHeadlines.push(...headlineTexts)
        excludeKeywords.push(...headlineTexts)
      }

      console.log(`[generateAdCreativesBatch] 完成第 ${i + 1}/${count} 个创意（主题: ${diversityThemes[i % diversityThemes.length]}）`)
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
