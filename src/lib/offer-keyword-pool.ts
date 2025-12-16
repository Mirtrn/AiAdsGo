/**
 * Offer 级关键词池服务 v1.0
 *
 * 核心功能：
 * 1. 生成 Offer 级关键词池（一次生成多次复用）
 * 2. 纯品牌词共享 + 语义分桶独占
 * 3. AI 语义聚类（品牌导向/场景导向/功能导向）
 * 4. 支持 3 个差异化创意生成
 *
 * 关键词分层策略：
 * - 共享层：纯品牌词（仅品牌名本身，如 "eufy"）
 * - 独占层：语义分桶（品牌导向/场景导向/功能导向）
 *
 * @see docs/Offer 级广告创意优化方案.md
 */

import { getDatabase } from './db'
import { generateContent } from './gemini'
import { loadPrompt } from './prompt-loader'
import { findOfferById, type Offer } from './offers'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import type { UnifiedKeywordData } from './unified-keyword-service'

// ============================================
// 类型定义
// ============================================

/**
 * Offer 级关键词池
 */
export interface OfferKeywordPool {
  id: number
  offerId: number
  userId: number

  // 共享层：纯品牌词
  brandKeywords: string[]

  // 独占层：语义分桶
  bucketAKeywords: string[]  // 品牌导向
  bucketBKeywords: string[]  // 场景导向
  bucketCKeywords: string[]  // 功能导向

  // 桶意图描述
  bucketAIntent: string
  bucketBIntent: string
  bucketCIntent: string

  // 元数据
  totalKeywords: number
  clusteringModel: string | null
  clusteringPromptVersion: string | null
  balanceScore: number | null

  createdAt: string
  updatedAt: string
}

/**
 * 关键词桶（AI 聚类结果）
 */
export interface KeywordBuckets {
  bucketA: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketB: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketC: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  statistics: {
    totalKeywords: number
    bucketACount: number
    bucketBCount: number
    bucketCCount: number
    balanceScore: number
  }
}

/**
 * 桶类型
 * A = 品牌导向 (Brand-Oriented)
 * B = 场景导向 (Scenario-Oriented)
 * C = 功能导向 (Feature-Oriented)
 * S = 综合 (Synthetic) - 第4个创意，包含所有品牌词+高搜索量非品牌词
 */
export type BucketType = 'A' | 'B' | 'C' | 'S'

/**
 * 综合创意关键词配置
 */
export interface SyntheticKeywordConfig {
  /** 最大非品牌关键词数量 */
  maxNonBrandKeywords: number
  /** 是否按搜索量排序 */
  sortByVolume: boolean
  /** 最小搜索量阈值 */
  minSearchVolume: number
}

/**
 * 默认综合创意配置
 */
export const DEFAULT_SYNTHETIC_CONFIG: SyntheticKeywordConfig = {
  maxNonBrandKeywords: 15,  // 从各桶中选择Top15高搜索量关键词
  sortByVolume: true,
  minSearchVolume: 100,
}

/**
 * 创意生成选项（带桶信息）
 */
export interface BucketCreativeOptions {
  bucket: BucketType
  theme: string
  keywords: string[]
  bucketIntent: string
}

// ============================================
// 纯品牌词识别
// ============================================

/**
 * 判断是否为纯品牌词
 *
 * 纯品牌词定义：仅品牌名本身，不包含任何修饰词或品类词
 *
 * @param keyword - 关键词
 * @param brandName - 品牌名称
 * @returns 是否为纯品牌词
 *
 * @example
 * isPureBrandKeyword('eufy', 'Eufy')              // true
 * isPureBrandKeyword('eufy security', 'Eufy')    // false
 * isPureBrandKeyword('eufy camera', 'Eufy')      // false
 */
export function isPureBrandKeyword(keyword: string, brandName: string): boolean {
  if (!keyword || !brandName) return false

  const normalized = keyword.toLowerCase().trim()
  const brand = brandName.toLowerCase().trim()

  // 纯品牌词：仅品牌名本身（可能有常见变体）
  const pureBrandPatterns = [
    brand,                          // eufy
    brand.replace(/\s+/g, ''),      // 去空格版本
    brand.replace(/-/g, ''),        // 去连字符版本
  ]

  return pureBrandPatterns.includes(normalized)
}

/**
 * 分离纯品牌词和非品牌词
 *
 * @param keywords - 所有关键词列表
 * @param brandName - 品牌名称
 * @returns 分离结果：纯品牌词 + 非品牌词
 */
export function separateBrandKeywords(
  keywords: string[],
  brandName: string
): { brandKeywords: string[]; nonBrandKeywords: string[] } {
  const brandKeywords: string[] = []
  const nonBrandKeywords: string[] = []

  for (const keyword of keywords) {
    if (isPureBrandKeyword(keyword, brandName)) {
      brandKeywords.push(keyword)
    } else {
      nonBrandKeywords.push(keyword)
    }
  }

  console.log(`🏷️ 纯品牌词分离: ${brandKeywords.length} 个纯品牌词, ${nonBrandKeywords.length} 个非品牌词`)
  console.log(`   纯品牌词: ${brandKeywords.join(', ') || '(无)'}`)

  return { brandKeywords, nonBrandKeywords }
}

// ============================================
// AI 语义聚类
// ============================================

/**
 * AI 语义聚类：将非品牌关键词分成 3 个语义桶
 *
 * 桶A：品牌导向（知道要买什么品牌）
 * 桶B：场景导向（知道要解决什么问题）
 * 桶C：功能导向（关注技术规格/功能特性）
 *
 * @param keywords - 非品牌关键词列表
 * @param brandName - 品牌名称
 * @param category - 产品类别
 * @param userId - 用户 ID（用于 AI 调用）
 * @returns 关键词桶
 */
export async function clusterKeywordsByIntent(
  keywords: string[],
  brandName: string,
  category: string | null,
  userId: number
): Promise<KeywordBuckets> {
  if (keywords.length === 0) {
    console.log('⚠️ 无关键词需要聚类，返回空桶')
    return createEmptyBuckets()
  }

  console.log(`\n🎯 开始 AI 语义聚类: ${keywords.length} 个关键词`)

  try {
    // 1. 加载聚类 prompt
    const promptTemplate = await loadPrompt('keyword_intent_clustering')

    // 2. 构建 prompt
    const prompt = promptTemplate
      .replace('{{brandName}}', brandName)
      .replace('{{productCategory}}', category || '未分类')
      .replace('{{keywords}}', keywords.join('\n'))

    // 3. 定义结构化输出 schema
    const responseSchema = {
      type: 'OBJECT' as const,
      properties: {
        bucketA: {
          type: 'OBJECT' as const,
          properties: {
            intent: { type: 'STRING' as const },
            intentEn: { type: 'STRING' as const },
            description: { type: 'STRING' as const },
            keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
          },
          required: ['intent', 'intentEn', 'description', 'keywords']
        },
        bucketB: {
          type: 'OBJECT' as const,
          properties: {
            intent: { type: 'STRING' as const },
            intentEn: { type: 'STRING' as const },
            description: { type: 'STRING' as const },
            keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
          },
          required: ['intent', 'intentEn', 'description', 'keywords']
        },
        bucketC: {
          type: 'OBJECT' as const,
          properties: {
            intent: { type: 'STRING' as const },
            intentEn: { type: 'STRING' as const },
            description: { type: 'STRING' as const },
            keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
          },
          required: ['intent', 'intentEn', 'description', 'keywords']
        },
        statistics: {
          type: 'OBJECT' as const,
          properties: {
            totalKeywords: { type: 'INTEGER' as const },
            bucketACount: { type: 'INTEGER' as const },
            bucketBCount: { type: 'INTEGER' as const },
            bucketCCount: { type: 'INTEGER' as const },
            balanceScore: { type: 'NUMBER' as const }
          },
          required: ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'balanceScore']
        }
      },
      required: ['bucketA', 'bucketB', 'bucketC', 'statistics']
    }

    // 4. 调用 AI
    const aiResponse = await generateContent({
      operationType: 'keyword_clustering',
      prompt,
      temperature: 0.3,  // 低温度，保持一致性
      maxOutputTokens: 16384,
      responseSchema,
      responseMimeType: 'application/json'
    }, userId)

    // 5. 记录 token 使用
    if (aiResponse.usage) {
      const cost = estimateTokenCost(
        aiResponse.model,
        aiResponse.usage.inputTokens,
        aiResponse.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: aiResponse.model,
        operationType: 'keyword_clustering',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    // 6. 解析响应
    const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI 返回的数据格式无效')
    }

    const buckets = JSON.parse(jsonMatch[0]) as KeywordBuckets

    // 7. 验证结果
    validateBuckets(buckets, keywords)

    console.log(`✅ AI 聚类完成:`)
    console.log(`   桶A [品牌导向]: ${buckets.bucketA.keywords.length} 个`)
    console.log(`   桶B [场景导向]: ${buckets.bucketB.keywords.length} 个`)
    console.log(`   桶C [功能导向]: ${buckets.bucketC.keywords.length} 个`)
    console.log(`   均衡度得分: ${buckets.statistics.balanceScore.toFixed(2)}`)

    return buckets
  } catch (error: any) {
    console.error('❌ AI 语义聚类失败:', error.message)

    // 降级：使用简单规则分桶
    console.log('⚠️ 降级到规则分桶')
    return fallbackClustering(keywords)
  }
}

/**
 * 创建空桶
 */
function createEmptyBuckets(): KeywordBuckets {
  return {
    bucketA: { intent: '品牌导向', intentEn: 'Brand-Oriented', description: '用户知道要买什么品牌', keywords: [] },
    bucketB: { intent: '场景导向', intentEn: 'Scenario-Oriented', description: '用户知道要解决什么问题', keywords: [] },
    bucketC: { intent: '功能导向', intentEn: 'Feature-Oriented', description: '用户关注技术规格/功能特性', keywords: [] },
    statistics: { totalKeywords: 0, bucketACount: 0, bucketBCount: 0, bucketCCount: 0, balanceScore: 1.0 }
  }
}

/**
 * 验证桶结果
 */
function validateBuckets(buckets: KeywordBuckets, originalKeywords: string[]): void {
  const allBucketKeywords = [
    ...buckets.bucketA.keywords,
    ...buckets.bucketB.keywords,
    ...buckets.bucketC.keywords
  ]

  // 检查是否有遗漏
  const missing = originalKeywords.filter(kw =>
    !allBucketKeywords.some(bkw => bkw.toLowerCase() === kw.toLowerCase())
  )

  if (missing.length > 0) {
    console.warn(`⚠️ 有 ${missing.length} 个关键词未分配到桶中:`, missing.slice(0, 5))
  }

  // 检查是否有重复
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const kw of allBucketKeywords) {
    const lower = kw.toLowerCase()
    if (seen.has(lower)) {
      duplicates.push(kw)
    }
    seen.add(lower)
  }

  if (duplicates.length > 0) {
    console.warn(`⚠️ 有 ${duplicates.length} 个关键词重复分配:`, duplicates.slice(0, 5))
  }
}

/**
 * 降级分桶策略（基于简单规则）
 */
function fallbackClustering(keywords: string[]): KeywordBuckets {
  const bucketA: string[] = []
  const bucketB: string[] = []
  const bucketC: string[] = []

  // 简单规则分桶
  const productKeywords = ['camera', 'cam', 'doorbell', 'indoor', 'outdoor', 'floodlight', 'model', 'pro', 'plus']
  const scenarioKeywords = ['home', 'security', 'baby', 'pet', 'monitor', 'garage', 'driveway', 'backyard', 'watching']
  const demandKeywords = ['best', 'top', 'cheap', 'affordable', 'wireless', 'night', 'vision', '4k', '2k', 'hd', 'solar', 'battery']

  for (const keyword of keywords) {
    const lower = keyword.toLowerCase()

    // 检查需求导向词（优先级最高）
    if (demandKeywords.some(d => lower.includes(d))) {
      bucketC.push(keyword)
    }
    // 检查场景导向词
    else if (scenarioKeywords.some(s => lower.includes(s))) {
      bucketB.push(keyword)
    }
    // 默认为品牌导向
    else {
      bucketA.push(keyword)
    }
  }

  const total = keywords.length
  const balanceScore = 1 - Math.max(
    Math.abs(bucketA.length / total - 0.33),
    Math.abs(bucketB.length / total - 0.33),
    Math.abs(bucketC.length / total - 0.33)
  )

  return {
    bucketA: { intent: '品牌导向', intentEn: 'Brand-Oriented', description: '用户知道要买什么品牌', keywords: bucketA },
    bucketB: { intent: '场景导向', intentEn: 'Scenario-Oriented', description: '用户知道要解决什么问题', keywords: bucketB },
    bucketC: { intent: '功能导向', intentEn: 'Feature-Oriented', description: '用户关注技术规格/功能特性', keywords: bucketC },
    statistics: {
      totalKeywords: total,
      bucketACount: bucketA.length,
      bucketBCount: bucketB.length,
      bucketCCount: bucketC.length,
      balanceScore
    }
  }
}

// ============================================
// 关键词池数据库操作
// ============================================

/**
 * 🔥 2025-12-16修复：根据数据库类型序列化JSON数据
 *
 * PostgreSQL JSONB列：不需要JSON.stringify，驱动自动处理
 * SQLite TEXT列：需要JSON.stringify，因为是文本存储
 *
 * 之前的BUG：统一使用JSON.stringify导致PostgreSQL双重序列化
 * 例如：存储 "[\"dreame\"]" 而不是 ["dreame"]
 */
function serializeJsonForDb(data: any, dbType: string): any {
  if (dbType === 'postgres') {
    // PostgreSQL JSONB：直接传递JavaScript对象/数组
    return JSON.stringify(data)  // pg驱动需要字符串，但不会双重序列化
  }
  // SQLite TEXT：需要序列化为字符串
  return JSON.stringify(data)
}

/**
 * 🔥 2025-12-16修复：根据数据库类型解析JSON数据
 *
 * 处理多种情况：
 * 1. 正常数组: ["dreame"] → ["dreame"]
 * 2. 字符串化数组: '["dreame"]' → ["dreame"]
 * 3. 双重序列化: '"[\\"dreame\\"]"' → ["dreame"]
 * 4. null/undefined → []
 */
function parseJsonFromDb(data: any): any {
  if (data === null || data === undefined) {
    return []
  }
  // 如果已经是数组，直接返回（PostgreSQL JSONB可能直接返回对象）
  if (Array.isArray(data)) {
    return data
  }
  // 如果是字符串，尝试解析
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      // 🔥 处理双重序列化：如果解析结果还是字符串，再解析一次
      if (typeof parsed === 'string') {
        try {
          const doubleParsed = JSON.parse(parsed)
          if (Array.isArray(doubleParsed)) {
            console.log(`⚠️ 检测到双重序列化数据，已自动修复`)
            return doubleParsed
          }
        } catch {
          // 不是双重序列化，返回原始解析结果
        }
      }
      if (Array.isArray(parsed)) {
        return parsed
      }
      return []
    } catch {
      return []
    }
  }
  return []
}

/**
 * 保存关键词池到数据库
 */
export async function saveKeywordPool(
  offerId: number,
  userId: number,
  brandKeywords: string[],
  buckets: KeywordBuckets,
  model?: string,
  promptVersion?: string
): Promise<OfferKeywordPool> {
  const db = await getDatabase()

  const totalKeywords = brandKeywords.length +
    buckets.bucketA.keywords.length +
    buckets.bucketB.keywords.length +
    buckets.bucketC.keywords.length

  // 检查是否已存在
  const existing = await db.queryOne<{ id: number }>(
    'SELECT id FROM offer_keyword_pools WHERE offer_id = ?',
    [offerId]
  )

  // 🔥 2025-12-16修复：使用统一的JSON序列化函数
  const brandKwJson = serializeJsonForDb(brandKeywords, db.type)
  const bucketAJson = serializeJsonForDb(buckets.bucketA.keywords, db.type)
  const bucketBJson = serializeJsonForDb(buckets.bucketB.keywords, db.type)
  const bucketCJson = serializeJsonForDb(buckets.bucketC.keywords, db.type)

  console.log(`📊 保存关键词池 (dbType=${db.type}):`)
  console.log(`   brand_keywords: ${brandKeywords.length}个 → ${typeof brandKwJson}`)
  console.log(`   bucket_a: ${buckets.bucketA.keywords.length}个`)
  console.log(`   bucket_b: ${buckets.bucketB.keywords.length}个`)
  console.log(`   bucket_c: ${buckets.bucketC.keywords.length}个`)

  if (existing) {
    // 更新现有记录
    await db.exec(
      `UPDATE offer_keyword_pools SET
        brand_keywords = ?,
        bucket_a_keywords = ?,
        bucket_b_keywords = ?,
        bucket_c_keywords = ?,
        bucket_a_intent = ?,
        bucket_b_intent = ?,
        bucket_c_intent = ?,
        total_keywords = ?,
        clustering_model = ?,
        clustering_prompt_version = ?,
        balance_score = ?,
        updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
      WHERE offer_id = ?`,
      [
        brandKwJson,
        bucketAJson,
        bucketBJson,
        bucketCJson,
        buckets.bucketA.intent,
        buckets.bucketB.intent,
        buckets.bucketC.intent,
        totalKeywords,
        model || null,
        promptVersion || null,
        buckets.statistics.balanceScore,
        offerId
      ]
    )

    console.log(`✅ 关键词池已更新: Offer #${offerId}`)
    return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
  }

  // 创建新记录
  const result = await db.exec(
    `INSERT INTO offer_keyword_pools (
      offer_id, user_id,
      brand_keywords,
      bucket_a_keywords, bucket_b_keywords, bucket_c_keywords,
      bucket_a_intent, bucket_b_intent, bucket_c_intent,
      total_keywords, clustering_model, clustering_prompt_version, balance_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      offerId,
      userId,
      brandKwJson,
      bucketAJson,
      bucketBJson,
      bucketCJson,
      buckets.bucketA.intent,
      buckets.bucketB.intent,
      buckets.bucketC.intent,
      totalKeywords,
      model || null,
      promptVersion || null,
      buckets.statistics.balanceScore
    ]
  )

  console.log(`✅ 关键词池已创建: Offer #${offerId}, ID #${result.lastInsertRowid}`)
  return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
}

/**
 * 根据 Offer ID 获取关键词池
 */
export async function getKeywordPoolByOfferId(offerId: number): Promise<OfferKeywordPool | null> {
  const db = await getDatabase()

  const row = await db.queryOne<any>(
    'SELECT * FROM offer_keyword_pools WHERE offer_id = ?',
    [offerId]
  )

  if (!row) return null

  // 🔥 2025-12-16修复：使用parseJsonFromDb处理双重序列化问题
  return {
    id: row.id,
    offerId: row.offer_id,
    userId: row.user_id,
    brandKeywords: parseJsonFromDb(row.brand_keywords),
    bucketAKeywords: parseJsonFromDb(row.bucket_a_keywords),
    bucketBKeywords: parseJsonFromDb(row.bucket_b_keywords),
    bucketCKeywords: parseJsonFromDb(row.bucket_c_keywords),
    bucketAIntent: row.bucket_a_intent,
    bucketBIntent: row.bucket_b_intent,
    bucketCIntent: row.bucket_c_intent,
    totalKeywords: row.total_keywords,
    clusteringModel: row.clustering_model,
    clusteringPromptVersion: row.clustering_prompt_version,
    balanceScore: row.balance_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * 删除关键词池
 */
export async function deleteKeywordPool(offerId: number): Promise<void> {
  const db = await getDatabase()
  await db.exec('DELETE FROM offer_keyword_pools WHERE offer_id = ?', [offerId])
  console.log(`🗑️ 关键词池已删除: Offer #${offerId}`)
}

// ============================================
// 主要流程
// ============================================

/**
 * 生成 Offer 级关键词池（主入口）
 *
 * @param offerId - Offer ID
 * @param userId - 用户 ID
 * @param allKeywords - 所有关键词列表（可选，如不提供则从现有创意提取）
 * @returns 关键词池
 */
export async function generateOfferKeywordPool(
  offerId: number,
  userId: number,
  allKeywords?: string[]
): Promise<OfferKeywordPool> {
  console.log(`\n📦 开始生成 Offer #${offerId} 的关键词池`)

  // 1. 获取 Offer 信息
  const offer = await findOfferById(offerId, userId)
  if (!offer) {
    throw new Error(`Offer #${offerId} 不存在`)
  }

  // 2. 获取关键词列表
  const keywords = allKeywords || await extractKeywordsFromOffer(offerId, userId)
  if (keywords.length === 0) {
    throw new Error('无可用关键词，请先生成关键词')
  }

  console.log(`📝 总关键词数: ${keywords.length}`)

  // 3. 分离纯品牌词和非品牌词
  const { brandKeywords, nonBrandKeywords } = separateBrandKeywords(keywords, offer.brand)

  // 4. AI 语义聚类
  const buckets = await clusterKeywordsByIntent(
    nonBrandKeywords,
    offer.brand,
    offer.category,
    userId
  )

  // 5. 保存到数据库
  const pool = await saveKeywordPool(
    offerId,
    userId,
    brandKeywords,
    buckets,
    'gemini',
    'v1.0'
  )

  return pool
}

/**
 * 获取或创建关键词池
 *
 * @param offerId - Offer ID
 * @param userId - 用户 ID
 * @param forceRegenerate - 是否强制重新生成
 * @returns 关键词池
 */
export async function getOrCreateKeywordPool(
  offerId: number,
  userId: number,
  forceRegenerate: boolean = false
): Promise<OfferKeywordPool> {
  // 检查现有池
  if (!forceRegenerate) {
    const existing = await getKeywordPoolByOfferId(offerId)
    if (existing) {
      console.log(`✅ 使用现有关键词池: Offer #${offerId}`)
      return existing
    }
  }

  // 生成新池
  return generateOfferKeywordPool(offerId, userId)
}

/**
 * 从 Offer 现有数据提取关键词
 */
async function extractKeywordsFromOffer(offerId: number, userId: number): Promise<string[]> {
  const db = await getDatabase()

  // 从现有创意中提取关键词
  const creatives = await db.query<{ keywords: string }>(
    `SELECT keywords FROM ad_creatives
     WHERE offer_id = ? AND user_id = ?
     ORDER BY created_at DESC
     LIMIT 3`,
    [offerId, userId]
  )

  const allKeywords = new Set<string>()

  for (const creative of creatives) {
    if (creative.keywords) {
      try {
        const keywords = JSON.parse(creative.keywords) as string[]
        keywords.forEach(kw => allKeywords.add(kw))
      } catch {}
    }
  }

  // 如果没有创意关键词，从 AI 分析结果提取
  if (allKeywords.size === 0) {
    const offer = await db.queryOne<{ ai_keywords: string; extracted_keywords: string }>(
      'SELECT ai_keywords, extracted_keywords FROM offers WHERE id = ?',
      [offerId]
    )

    // 🔥 2025-12-16修复：优先使用ai_keywords，如果没有则使用extracted_keywords
    const keywordsJson = offer?.ai_keywords || offer?.extracted_keywords

    if (keywordsJson) {
      try {
        const parsedKeywords = JSON.parse(keywordsJson)
        if (Array.isArray(parsedKeywords)) {
          parsedKeywords.forEach((kw: any) => {
            if (typeof kw === 'string') {
              allKeywords.add(kw)
            } else if (kw.keyword) {
              allKeywords.add(kw.keyword)
            }
          })
        }
      } catch {}
    }
  }

  return Array.from(allKeywords)
}

// ============================================
// 创意生成辅助
// ============================================

/**
 * 获取桶的关键词和意图信息
 *
 * @param pool - 关键词池
 * @param bucket - 桶类型
 * @returns 桶信息
 */
export function getBucketInfo(
  pool: OfferKeywordPool,
  bucket: BucketType
): { keywords: string[]; intent: string; intentEn: string } {
  switch (bucket) {
    case 'A':
      return {
        keywords: [...pool.brandKeywords, ...pool.bucketAKeywords],
        intent: pool.bucketAIntent,
        intentEn: 'Brand-Oriented'
      }
    case 'B':
      return {
        keywords: [...pool.brandKeywords, ...pool.bucketBKeywords],
        intent: pool.bucketBIntent,
        intentEn: 'Scenario-Oriented'
      }
    case 'C':
      return {
        keywords: [...pool.brandKeywords, ...pool.bucketCKeywords],
        intent: pool.bucketCIntent,
        intentEn: 'Feature-Oriented'
      }
    case 'S':
      // 综合桶：所有品牌词 + 所有桶的关键词（不排序，排序在getSyntheticBucketKeywords中处理）
      return {
        keywords: [
          ...pool.brandKeywords,
          ...pool.bucketAKeywords,
          ...pool.bucketBKeywords,
          ...pool.bucketCKeywords
        ],
        intent: '综合推广',
        intentEn: 'Synthetic'
      }
    default:
      throw new Error(`Invalid bucket type: ${bucket}`)
  }
}

/**
 * 🆕 2025-12-16: 获取综合桶关键词（第4个创意专用）
 *
 * 策略：
 * 1. 包含所有品牌关键词（100%）
 * 2. 从各桶中选择搜索量最高的非品牌关键词
 * 3. 按搜索量降序排序
 *
 * @param pool - 关键词池
 * @param userId - 用户ID（用于获取搜索量）
 * @param country - 目标国家
 * @param config - 综合关键词配置
 * @returns 综合关键词列表（带搜索量）
 */
export async function getSyntheticBucketKeywords(
  pool: OfferKeywordPool,
  userId: number,
  country: string = 'US',
  config: SyntheticKeywordConfig = DEFAULT_SYNTHETIC_CONFIG
): Promise<Array<{ keyword: string; searchVolume: number; isBrand: boolean }>> {
  console.log(`\n🔮 开始构建综合创意关键词池...`)

  // 1. 收集所有品牌词
  const brandKeywords = pool.brandKeywords.map(kw => ({
    keyword: kw,
    searchVolume: 0,  // 品牌词不需要搜索量排序
    isBrand: true
  }))
  console.log(`   品牌词: ${brandKeywords.length}个`)

  // 2. 收集所有非品牌词（去重）
  const allNonBrandKeywords = new Set<string>([
    ...pool.bucketAKeywords,
    ...pool.bucketBKeywords,
    ...pool.bucketCKeywords
  ])
  console.log(`   非品牌词（去重后）: ${allNonBrandKeywords.size}个`)

  // 3. 如果需要按搜索量排序，获取搜索量数据
  let nonBrandWithVolume: Array<{ keyword: string; searchVolume: number; isBrand: boolean }> = []

  if (config.sortByVolume && allNonBrandKeywords.size > 0) {
    try {
      const { getKeywordVolumesForExisting } = await import('@/lib/unified-keyword-service')
      const volumeData = await getKeywordVolumesForExisting({
        baseKeywords: Array.from(allNonBrandKeywords),
        country,
        language: 'en',  // TODO: 从offer获取语言
        userId,
        brandName: pool.brandKeywords[0] || ''
      })

      // 构建搜索量映射
      const volumeMap = new Map(volumeData.map(v => [v.keyword.toLowerCase(), v.searchVolume]))

      // 转换为带搜索量的格式
      nonBrandWithVolume = Array.from(allNonBrandKeywords).map(kw => ({
        keyword: kw,
        searchVolume: volumeMap.get(kw.toLowerCase()) || 0,
        isBrand: false
      }))

      // 按搜索量降序排序
      nonBrandWithVolume.sort((a, b) => b.searchVolume - a.searchVolume)

      // 过滤低于阈值的关键词
      nonBrandWithVolume = nonBrandWithVolume.filter(
        kw => kw.searchVolume >= config.minSearchVolume
      )

      console.log(`   获取搜索量成功，过滤后剩余: ${nonBrandWithVolume.length}个`)
    } catch (error: any) {
      console.warn(`   ⚠️ 获取搜索量失败，使用原始顺序:`, error.message)
      nonBrandWithVolume = Array.from(allNonBrandKeywords).map(kw => ({
        keyword: kw,
        searchVolume: 0,
        isBrand: false
      }))
    }
  } else {
    // 不需要排序，直接使用
    nonBrandWithVolume = Array.from(allNonBrandKeywords).map(kw => ({
      keyword: kw,
      searchVolume: 0,
      isBrand: false
    }))
  }

  // 4. 取Top N非品牌词
  const topNonBrandKeywords = nonBrandWithVolume.slice(0, config.maxNonBrandKeywords)
  console.log(`   选取Top${config.maxNonBrandKeywords}高搜索量词: ${topNonBrandKeywords.length}个`)

  // 5. 合并：品牌词 + 高搜索量非品牌词
  const result = [...brandKeywords, ...topNonBrandKeywords]

  console.log(`✅ 综合关键词池构建完成: 共${result.length}个关键词`)
  console.log(`   - 品牌词: ${brandKeywords.length}个`)
  console.log(`   - 高搜索量非品牌词: ${topNonBrandKeywords.length}个`)
  if (topNonBrandKeywords.length > 0) {
    console.log(`   - 最高搜索量: ${topNonBrandKeywords[0]?.keyword} (${topNonBrandKeywords[0]?.searchVolume})`)
  }

  return result
}

/**
 * 🆕 2025-12-16: 检查是否可以生成综合创意（第4个）
 *
 * 条件：
 * 1. A/B/C 三个桶的创意都已生成
 * 2. 尚未生成综合创意（S桶）
 *
 * @param offerId - Offer ID
 * @returns 是否可以生成综合创意
 */
export async function canGenerateSyntheticCreative(offerId: number): Promise<boolean> {
  const db = await getDatabase()

  const result = await db.query<{ keyword_bucket: string }>(
    `SELECT DISTINCT keyword_bucket FROM ad_creatives
     WHERE offer_id = ? AND keyword_bucket IS NOT NULL`,
    [offerId]
  )

  const usedBuckets = new Set(result.map(r => r.keyword_bucket))

  // 检查A/B/C是否都已使用，且S未使用
  const hasAllABC = usedBuckets.has('A') && usedBuckets.has('B') && usedBuckets.has('C')
  const notHasS = !usedBuckets.has('S')

  console.log(`🔍 综合创意检查: A=${usedBuckets.has('A')}, B=${usedBuckets.has('B')}, C=${usedBuckets.has('C')}, S=${usedBuckets.has('S')}`)
  console.log(`   可以生成综合创意: ${hasAllABC && notHasS}`)

  return hasAllABC && notHasS
}

/**
 * 获取可用的桶（未被占用的）
 *
 * @param offerId - Offer ID
 * @returns 可用桶列表
 */
export async function getAvailableBuckets(offerId: number): Promise<BucketType[]> {
  const db = await getDatabase()

  const usedBuckets = await db.query<{ keyword_bucket: string }>(
    `SELECT DISTINCT keyword_bucket FROM ad_creatives
     WHERE offer_id = ? AND keyword_bucket IS NOT NULL`,
    [offerId]
  )

  const used = new Set(usedBuckets.map(b => b.keyword_bucket))
  const all: BucketType[] = ['A', 'B', 'C']

  return all.filter(b => !used.has(b))
}

/**
 * 获取已使用的桶
 *
 * @param offerId - Offer ID
 * @returns 已使用桶列表
 */
export async function getUsedBuckets(offerId: number): Promise<BucketType[]> {
  const db = await getDatabase()

  const usedBuckets = await db.query<{ keyword_bucket: string }>(
    `SELECT DISTINCT keyword_bucket FROM ad_creatives
     WHERE offer_id = ? AND keyword_bucket IS NOT NULL`,
    [offerId]
  )

  return usedBuckets.map(b => b.keyword_bucket as BucketType)
}

/**
 * 检查 Offer 创意数量是否已达上限
 *
 * @param offerId - Offer ID
 * @returns 是否已满
 */
export async function isCreativeLimitReached(offerId: number): Promise<boolean> {
  const db = await getDatabase()

  const result = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM ad_creatives
     WHERE offer_id = ?`,
    [offerId]
  )

  // 🆕 2025-12-16: 支持4个创意（A/B/C + 综合S）
  return (result?.count || 0) >= 4
}

/**
 * 计算关键词重叠率
 *
 * @param keywords1 - 关键词列表 1
 * @param keywords2 - 关键词列表 2
 * @returns 重叠率 (0-1)
 */
export function calculateKeywordOverlapRate(
  keywords1: string[],
  keywords2: string[]
): number {
  if (keywords1.length === 0 || keywords2.length === 0) return 0

  const set1 = new Set(keywords1.map(k => k.toLowerCase()))
  const set2 = new Set(keywords2.map(k => k.toLowerCase()))

  let overlap = 0
  for (const kw of set1) {
    if (set2.has(kw)) overlap++
  }

  const total = Math.max(set1.size, set2.size)
  return overlap / total
}

// ============================================
// 关键词数量不足处理
// ============================================

/**
 * 关键词数量不足时的处理策略
 */
export interface ClusteringStrategy {
  bucketCount: 1 | 2 | 3
  strategy: 'single' | 'dual' | 'full'
  message: string
}

/**
 * 根据关键词数量确定聚类策略
 *
 * @param keywordCount - 关键词数量
 * @returns 聚类策略
 */
export function determineClusteringStrategy(keywordCount: number): ClusteringStrategy {
  if (keywordCount < 15) {
    return {
      bucketCount: 1,
      strategy: 'single',
      message: '关键词太少 (<15)，只生成 1 个创意'
    }
  } else if (keywordCount < 30) {
    return {
      bucketCount: 2,
      strategy: 'dual',
      message: '关键词较少 (15-29)，生成 2 个创意'
    }
  } else {
    return {
      bucketCount: 3,
      strategy: 'full',
      message: '关键词充足 (>=30)，生成 3 个创意'
    }
  }
}
