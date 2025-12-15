/**
 * Offer 级关键词池服务 v1.0
 *
 * 核心功能：
 * 1. 生成 Offer 级关键词池（一次生成多次复用）
 * 2. 纯品牌词共享 + 语义分桶独占
 * 3. AI 语义聚类（产品导向/场景导向/需求导向）
 * 4. 支持 3 个差异化创意生成
 *
 * 关键词分层策略：
 * - 共享层：纯品牌词（仅品牌名本身，如 "eufy"）
 * - 独占层：语义分桶（产品导向/场景导向/需求导向）
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
  bucketAKeywords: string[]  // 产品导向
  bucketBKeywords: string[]  // 场景导向
  bucketCKeywords: string[]  // 需求导向

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
 */
export type BucketType = 'A' | 'B' | 'C'

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
 * 桶A：产品导向（知道要买什么产品）
 * 桶B：场景导向（知道要解决什么问题）
 * 桶C：需求导向（关注具体功能需求）
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
    console.log(`   桶A [产品导向]: ${buckets.bucketA.keywords.length} 个`)
    console.log(`   桶B [场景导向]: ${buckets.bucketB.keywords.length} 个`)
    console.log(`   桶C [需求导向]: ${buckets.bucketC.keywords.length} 个`)
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
    bucketA: { intent: '产品导向', intentEn: 'Product-Oriented', description: '用户知道要买什么产品', keywords: [] },
    bucketB: { intent: '场景导向', intentEn: 'Scenario-Oriented', description: '用户知道要解决什么问题', keywords: [] },
    bucketC: { intent: '需求导向', intentEn: 'Demand-Oriented', description: '用户关注具体功能需求', keywords: [] },
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
    // 默认为产品导向
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
    bucketA: { intent: '产品导向', intentEn: 'Product-Oriented', description: '用户知道要买什么产品', keywords: bucketA },
    bucketB: { intent: '场景导向', intentEn: 'Scenario-Oriented', description: '用户知道要解决什么问题', keywords: bucketB },
    bucketC: { intent: '需求导向', intentEn: 'Demand-Oriented', description: '用户关注具体功能需求', keywords: bucketC },
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
        JSON.stringify(brandKeywords),
        JSON.stringify(buckets.bucketA.keywords),
        JSON.stringify(buckets.bucketB.keywords),
        JSON.stringify(buckets.bucketC.keywords),
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
      JSON.stringify(brandKeywords),
      JSON.stringify(buckets.bucketA.keywords),
      JSON.stringify(buckets.bucketB.keywords),
      JSON.stringify(buckets.bucketC.keywords),
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

  return {
    id: row.id,
    offerId: row.offer_id,
    userId: row.user_id,
    brandKeywords: JSON.parse(row.brand_keywords || '[]'),
    bucketAKeywords: JSON.parse(row.bucket_a_keywords || '[]'),
    bucketBKeywords: JSON.parse(row.bucket_b_keywords || '[]'),
    bucketCKeywords: JSON.parse(row.bucket_c_keywords || '[]'),
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
    const offer = await db.queryOne<{ ai_keywords: string }>(
      'SELECT ai_keywords FROM offers WHERE id = ?',
      [offerId]
    )

    if (offer?.ai_keywords) {
      try {
        const aiKeywords = JSON.parse(offer.ai_keywords)
        if (Array.isArray(aiKeywords)) {
          aiKeywords.forEach((kw: any) => {
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
        intentEn: 'Product-Oriented'
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
        intentEn: 'Demand-Oriented'
      }
    default:
      throw new Error(`Invalid bucket type: ${bucket}`)
  }
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

  return (result?.count || 0) >= 3
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
