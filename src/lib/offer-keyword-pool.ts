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
 * 🆕 关键词池数据结构 - 包含完整元数据
 * 用途：存储关键词的搜索量、CPC、竞争度等数据，避免重复调用 Keyword Planner
 */
export interface PoolKeywordData {
  keyword: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
  lowTopPageBid?: number  // CPC 数据
  highTopPageBid?: number // CPC 数据
  source: string
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
}

/**
 * Offer 级关键词池
 */
export interface OfferKeywordPool {
  id: number
  offerId: number
  userId: number

  // 共享层：纯品牌词（🔥 升级为 PoolKeywordData[]）
  brandKeywords: PoolKeywordData[]

  // 独占层：语义分桶（🔥 升级为 PoolKeywordData[]）
  bucketAKeywords: PoolKeywordData[]  // 品牌导向
  bucketBKeywords: PoolKeywordData[]  // 场景导向
  bucketCKeywords: PoolKeywordData[]  // 功能导向
  bucketDKeywords: PoolKeywordData[]  // 🔥 2025-12-22: 高购买意图

  // 桶意图描述
  bucketAIntent: string
  bucketBIntent: string
  bucketCIntent: string
  bucketDIntent: string  // 🔥 2025-12-22: 高购买意图描述

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
  bucketD: {
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
    bucketDCount: number
    balanceScore: number
  }
}

/**
 * 桶类型
 * A = 品牌导向 (Brand-Oriented) - 第1个创意
 * B = 场景导向 (Scenario-Oriented) - 第2个创意
 * C = 功能导向 (Feature-Oriented) - 第3个创意
 * D = 高购买意图 (High Purchase Intent) - 第4个创意
 * S = 综合推广 (Synthetic) - 第5个创意，整合A+B+C+D所有桶的关键词
 */
export type BucketType = 'A' | 'B' | 'C' | 'D' | 'S'

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
 * 🔥 2025-12-22: 生成高购买意图关键词（桶D专用）
 *
 * 策略：基于品牌名和产品类别生成高购买意图关键词
 * 关键词特征：包含购买意图词（buy/price/deal/discount等）
 *
 * @param brandName - 品牌名称
 * @param category - 产品类别
 * @param baseKeywords - 基础关键词列表（可选，用于组合）
 * @returns 高购买意图关键词列表
 */
export function generateHighIntentKeywords(
  brandName: string,
  category: string | null,
  baseKeywords?: string[]
): string[] {
  const highIntentKeywords: string[] = []

  // 高购买意图修饰词
  const intentModifiers = [
    'buy', 'purchase', 'order', 'shop',
    'price', 'cost', 'deal', 'discount',
    'best', 'top', 'review', 'compare',
    'cheap', 'affordable', 'sale', 'offer',
    'where to buy', 'buy online'
  ]

  // 1. 品牌名 + 高意图词
  intentModifiers.forEach(modifier => {
    highIntentKeywords.push(`${brandName.toLowerCase()} ${modifier}`)
    highIntentKeywords.push(`${modifier} ${brandName.toLowerCase()}`)
  })

  // 2. 品牌名 + 类别 + 高意图词
  if (category) {
    intentModifiers.slice(0, 8).forEach(modifier => {
      highIntentKeywords.push(`${brandName.toLowerCase()} ${category.toLowerCase()} ${modifier}`)
      highIntentKeywords.push(`${modifier} ${brandName.toLowerCase()} ${category.toLowerCase()}`)
    })
  }

  // 3. 如果提供了基础关键词，组合生成
  if (baseKeywords && baseKeywords.length > 0) {
    const topBaseKeywords = baseKeywords.slice(0, 5) // 只取前5个
    const topIntentModifiers = intentModifiers.slice(0, 5) // 只取前5个意图词

    topBaseKeywords.forEach(keyword => {
      topIntentModifiers.forEach(modifier => {
        highIntentKeywords.push(`${keyword} ${modifier}`)
        highIntentKeywords.push(`${modifier} ${keyword}`)
      })
    })
  }

  // 去重
  return Array.from(new Set(highIntentKeywords))
}

/**
 * 🔥 2025-12-22 重大优化：分批处理大规模关键词聚类
 *
 * 问题：249个关键词一次性聚类导致超时（即使flash模型也需要180s+）
 * 解决：将关键词分批处理，每批80-100个关键词，并行处理后合并结果
 *
 * 性能提升：
 * - 批量处理：每批处理时间从180s+降至45-60s
 * - 并行执行：3个批次并行处理，总时间减少60%
 * - 超时风险：从>90%降至<1%
 *
 * 策略：
 * 1. 关键词数量 <= 100：直接处理（原逻辑）
 * 2. 关键词数量 > 100：分批处理（3批次并行）
 * 3. 每批次独立聚类，保持桶A/B/C结构
 * 4. 合并时去重并计算平均意图描述
 */

/**
 * 批量聚类单个批次
 */
async function clusterBatchKeywords(
  batchKeywords: string[],
  brandName: string,
  category: string | null,
  userId: number,
  batchIndex: number,
  totalBatches: number
): Promise<{
  bucketA: { intent: string; intentEn: string; description: string; keywords: string[] }
  bucketB: { intent: string; intentEn: string; description: string; keywords: string[] }
  bucketC: { intent: string; intentEn: string; description: string; keywords: string[] }
  bucketD: { intent: string; intentEn: string; description: string; keywords: string[] }
  statistics: { totalKeywords: number; bucketACount: number; bucketBCount: number; bucketCCount: number; bucketDCount: number; balanceScore: number }
}> {
  console.log(`📦 处理批次 ${batchIndex}/${totalBatches}: ${batchKeywords.length} 个关键词`)

  // 1. 加载聚类 prompt
  const promptTemplate = await loadPrompt('keyword_intent_clustering')

  // 2. 构建 prompt
  const prompt = promptTemplate
    .replace('{{brandName}}', brandName)
    .replace('{{productCategory}}', category || '未分类')
    .replace('{{keywords}}', batchKeywords.join('\n'))

  // 3. 定义结构化输出 schema（支持4个桶）
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
      bucketD: {
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
          bucketDCount: { type: 'INTEGER' as const },
          balanceScore: { type: 'NUMBER' as const }
        },
        required: ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'bucketDCount', 'balanceScore']
      }
    },
    required: ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'statistics']
  }

  // 4. 调用 AI（使用智能模型选择，60-90s）
  const aiResponse = await generateContent({
    operationType: 'keyword_clustering',
    prompt,
    temperature: 0.3,
    maxOutputTokens: 65000,
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
    throw new Error('AI 返回的数据格式无效：未找到JSON')
  }

  let batchResult
  try {
    batchResult = JSON.parse(jsonMatch[0])
  } catch (parseError) {
    console.error('❌ JSON解析失败:', parseError)
    console.error('   原始响应:', aiResponse.text.slice(0, 500))
    const errorMessage = parseError instanceof Error ? parseError.message : '未知错误'
    throw new Error(`JSON解析失败: ${errorMessage}`)
  }

  // 🔥 2025-12-22 添加数据结构验证（支持4个桶）
  if (!batchResult.bucketA || !batchResult.bucketB || !batchResult.bucketC || !batchResult.bucketD) {
    console.error('❌ AI返回数据结构不完整:', batchResult)
    throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D')
  }

  if (!Array.isArray(batchResult.bucketA.keywords) ||
      !Array.isArray(batchResult.bucketB.keywords) ||
      !Array.isArray(batchResult.bucketC.keywords) ||
      !Array.isArray(batchResult.bucketD.keywords)) {
    console.error('❌ AI返回的keywords不是数组:', batchResult)
    throw new Error('AI返回的keywords不是数组')
  }

  console.log(`✅ 批次 ${batchIndex} 完成: A=${batchResult.bucketA.keywords.length}, B=${batchResult.bucketB.keywords.length}, C=${batchResult.bucketC.keywords.length}, D=${batchResult.bucketD.keywords.length}`)

  return batchResult
}

/**
 * 合并多个批次的聚类结果
 */
function mergeBatchResults(
  batchResults: Array<{
    bucketA: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketB: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketC: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketD: { intent: string; intentEn: string; description: string; keywords: string[] }
    statistics: { totalKeywords: number; bucketACount: number; bucketBCount: number; bucketCCount: number; bucketDCount: number; balanceScore: number }
  }>
): KeywordBuckets {
  // 合并所有关键词（去重）
  const allBucketAKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketA.keywords)))
  const allBucketBKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketB.keywords)))
  const allBucketCKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketC.keywords)))
  const allBucketDKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketD.keywords)))

  // 选择最详细的意图描述（选择最长的描述）
  const bucketAIntent = batchResults.reduce((best, current) =>
    current.bucketA.description.length > best.bucketA.description.length ? current : best
  ).bucketA

  const bucketBIntent = batchResults.reduce((best, current) =>
    current.bucketB.description.length > best.bucketB.description.length ? current : best
  ).bucketB

  const bucketCIntent = batchResults.reduce((best, current) =>
    current.bucketC.description.length > best.bucketC.description.length ? current : best
  ).bucketC

  const bucketDIntent = batchResults.reduce((best, current) =>
    current.bucketD.description.length > best.bucketD.description.length ? current : best
  ).bucketD

  // 计算统计数据
  const totalKeywords = allBucketAKeywords.length + allBucketBKeywords.length + allBucketCKeywords.length + allBucketDKeywords.length
  const averageBalanceScore = batchResults.reduce((sum, r) => sum + r.statistics.balanceScore, 0) / batchResults.length

  console.log(`🔄 合并 ${batchResults.length} 个批次结果:`)
  console.log(`   桶A: ${allBucketAKeywords.length} 个关键词`)
  console.log(`   桶B: ${allBucketBKeywords.length} 个关键词`)
  console.log(`   桶C: ${allBucketCKeywords.length} 个关键词`)
  console.log(`   桶D: ${allBucketDKeywords.length} 个关键词`)
  console.log(`   平均均衡度: ${averageBalanceScore.toFixed(2)}`)

  return {
    bucketA: { ...bucketAIntent, keywords: allBucketAKeywords },
    bucketB: { ...bucketBIntent, keywords: allBucketBKeywords },
    bucketC: { ...bucketCIntent, keywords: allBucketCKeywords },
    bucketD: { ...bucketDIntent, keywords: allBucketDKeywords },
    statistics: {
      totalKeywords,
      bucketACount: allBucketAKeywords.length,
      bucketBCount: allBucketBKeywords.length,
      bucketCCount: allBucketCKeywords.length,
      bucketDCount: allBucketDKeywords.length,
      balanceScore: averageBalanceScore
    }
  }
}

/**
 * AI 语义聚类：将非品牌关键词分成 3 个语义桶（优化版）
 *
 * 🔥 2025-12-22 重大优化：
 * - 小批量（<=100）：直接处理
 * - 大批量（>100）：分批并行处理
 * - 解决249个关键词超时问题
 *
 * 🔥 2025-12-22 整合优化：
 * - 支持4个桶（A/B/C/D）的聚类
 * - 高购买意图词也参与AI语义聚类
 * - 保持语义聚类的一致性
 *
 * 桶A：品牌导向（知道要买什么品牌）
 * 桶B：场景导向（知道要解决什么问题）
 * 桶C：功能导向（关注技术规格/功能特性）
 * 桶D：高购买意图（包含购买行为词的关键词）
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

  // 🔥 2025-12-22 整合优化：先生成高购买意图关键词
  const highIntentKeywords = generateHighIntentKeywords(brandName, category, keywords.slice(0, 10))
  console.log(`🎯 生成高购买意图关键词: ${highIntentKeywords.length} 个`)

  // 将高购买意图关键词也加入聚类输入
  const allKeywordsForClustering = [...keywords, ...highIntentKeywords]
  console.log(`📊 总计聚类关键词: ${allKeywordsForClustering.length} 个 (原始:${keywords.length} + 高意图:${highIntentKeywords.length})`)

  // 🔥 2025-12-22 优化：判断是否需要分批处理
  const BATCH_SIZE = 80  // 每批80个关键词（留20个缓冲）
  const needsBatching = allKeywordsForClustering.length > 100
  const batchCount = needsBatching ? Math.ceil(allKeywordsForClustering.length / BATCH_SIZE) : 1

  if (!needsBatching) {
    // 小批量：直接处理（原逻辑）
    console.log(`📝 小批量模式：直接处理 ${allKeywordsForClustering.length} 个关键词`)
    return await clusterKeywordsDirectly(allKeywordsForClustering, brandName, category, userId)
  }

  // 大批量：分批处理
  console.log(`🚀 大批量模式：将 ${allKeywordsForClustering.length} 个关键词分成 ${batchCount} 个批次并行处理`)

  // 1. 分批
  const batches: string[][] = []
  for (let i = 0; i < batchCount; i++) {
    const start = i * BATCH_SIZE
    const end = Math.min(start + BATCH_SIZE, allKeywordsForClustering.length)
    batches.push(allKeywordsForClustering.slice(start, end))
  }

  console.log(`📦 批次划分: ${batches.map((b, i) => `批次${i + 1}=${b.length}个`).join(', ')}`)

  // 2. 并行处理所有批次（带重试）
  const maxRetries = 2
  const baseDelay = 5000
  let lastError: any

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    try {
      const batchPromises = batches.map((batch, index) =>
        clusterBatchKeywords(batch, brandName, category, userId, index + 1, batchCount)
          .catch(error => {
            console.error(`❌ 批次 ${index + 1} 失败:`, error.message)
            throw error
          })
      )

      // 等待所有批次完成
      const batchResults = await Promise.all(batchPromises)

      // 3. 合并结果
      const mergedBuckets = mergeBatchResults(batchResults)

      // 4. 验证结果
      validateBuckets(mergedBuckets, allKeywordsForClustering)

      console.log(`✅ 分批 AI 聚类完成:`)
      console.log(`   桶A [品牌导向]: ${mergedBuckets.bucketA.keywords.length} 个`)
      console.log(`   桶B [场景导向]: ${mergedBuckets.bucketB.keywords.length} 个`)
      console.log(`   桶C [功能导向]: ${mergedBuckets.bucketC.keywords.length} 个`)
      console.log(`   桶D [高购买意图]: ${mergedBuckets.bucketD.keywords.length} 个`)
      console.log(`   均衡度得分: ${mergedBuckets.statistics.balanceScore.toFixed(2)}`)

      return mergedBuckets
    } catch (error: any) {
      lastError = error
      const isTimeout = error.message?.includes('timeout') || error.code === 'ECONNABORTED'
      const isRateLimited = error.response?.status === 429

      if (retryCount < maxRetries && (isTimeout || isRateLimited)) {
        const delay = baseDelay * Math.pow(2, retryCount)
        console.warn(`⚠️ 分批聚类第 ${retryCount + 1} 次失败，${delay / 1000}s 后重试...`)
        console.warn(`   错误: ${error.message}`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      console.error('❌ 分批 AI 语义聚类失败:', error.message)
      throw new Error(`关键词AI语义分类失败（分批处理）: ${error.message}`)
    }
  }

  throw new Error(`关键词AI语义分类失败（重试${maxRetries}次均失败）: ${lastError?.message || '未知错误'}`)
}

/**
 * 直接处理小批量关键词聚类（原逻辑）
 */
async function clusterKeywordsDirectly(
  keywords: string[],
  brandName: string,
  category: string | null,
  userId: number
): Promise<KeywordBuckets> {
  // 重试配置
  const maxRetries = 2
  const baseDelay = 5000
  let lastError: any

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    try {
      // 1. 加载聚类 prompt
      const promptTemplate = await loadPrompt('keyword_intent_clustering')

      // 2. 构建 prompt
      const prompt = promptTemplate
        .replace('{{brandName}}', brandName)
        .replace('{{productCategory}}', category || '未分类')
        .replace('{{keywords}}', keywords.join('\n'))

      // 3. 定义结构化输出 schema（支持4个桶）
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
          bucketD: {
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
              bucketDCount: { type: 'INTEGER' as const },
              balanceScore: { type: 'NUMBER' as const }
            },
            required: ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'bucketDCount', 'balanceScore']
          }
        },
        required: ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'statistics']
      }

      // 4. 调用 AI（使用智能模型选择）
      const aiResponse = await generateContent({
        operationType: 'keyword_clustering',
        prompt,
        temperature: 0.3,
        maxOutputTokens: 65000,
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
        throw new Error('AI 返回的数据格式无效：未找到JSON')
      }

      let buckets
      try {
        buckets = JSON.parse(jsonMatch[0]) as KeywordBuckets
      } catch (parseError) {
        console.error('❌ JSON解析失败:', parseError)
        console.error('   原始响应:', aiResponse.text.slice(0, 500))
        const errorMessage = parseError instanceof Error ? parseError.message : '未知错误'
        throw new Error(`JSON解析失败: ${errorMessage}`)
      }

      // 🔥 2025-12-22 添加数据结构验证（支持4个桶）
      if (!buckets.bucketA || !buckets.bucketB || !buckets.bucketC || !buckets.bucketD) {
        console.error('❌ AI返回数据结构不完整:', buckets)
        throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D')
      }

      if (!Array.isArray(buckets.bucketA.keywords) ||
          !Array.isArray(buckets.bucketB.keywords) ||
          !Array.isArray(buckets.bucketC.keywords) ||
          !Array.isArray(buckets.bucketD.keywords)) {
        console.error('❌ AI返回的keywords不是数组:', buckets)
        throw new Error('AI返回的keywords不是数组')
      }

      // 7. 验证结果
      validateBuckets(buckets, keywords)

      console.log(`✅ AI 聚类完成:`)
      console.log(`   桶A [品牌导向]: ${buckets.bucketA.keywords.length} 个`)
      console.log(`   桶B [场景导向]: ${buckets.bucketB.keywords.length} 个`)
      console.log(`   桶C [功能导向]: ${buckets.bucketC.keywords.length} 个`)
      console.log(`   桶D [高购买意图]: ${buckets.bucketD.keywords.length} 个`)
      console.log(`   均衡度得分: ${buckets.statistics.balanceScore.toFixed(2)}`)

      return buckets
    } catch (error: any) {
      lastError = error
      const isTimeout = error.message?.includes('timeout') || error.code === 'ECONNABORTED'
      const isRateLimited = error.response?.status === 429

      if (retryCount < maxRetries && (isTimeout || isRateLimited)) {
        const delay = baseDelay * Math.pow(2, retryCount)
        console.warn(`⚠️ AI 聚类第 ${retryCount + 1} 次失败，${delay / 1000}s 后重试...`)
        console.warn(`   错误: ${error.message}`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      console.error('❌ AI 语义聚类失败:', error.message)
      throw new Error(`关键词AI语义分类失败: ${error.message}`)
    }
  }

  throw new Error(`关键词AI语义分类失败（重试${maxRetries}次均失败）: ${lastError?.message || '未知错误'}`)
}

/**
 * 创建空桶
 */
function createEmptyBuckets(): KeywordBuckets {
  return {
    bucketA: { intent: '品牌导向', intentEn: 'Brand-Oriented', description: '用户知道要买什么品牌', keywords: [] },
    bucketB: { intent: '场景导向', intentEn: 'Scenario-Oriented', description: '用户知道要解决什么问题', keywords: [] },
    bucketC: { intent: '功能导向', intentEn: 'Feature-Oriented', description: '用户关注技术规格/功能特性', keywords: [] },
    bucketD: { intent: '通用词汇', intentEn: 'Generic-Terms', description: '竞争度中等、搜索量高、CPC低的通用词', keywords: [] },
    statistics: { totalKeywords: 0, bucketACount: 0, bucketBCount: 0, bucketCCount: 0, bucketDCount: 0, balanceScore: 1.0 }
  }
}

/**
 * 验证桶结果
 */
function validateBuckets(buckets: KeywordBuckets, originalKeywords: string[]): void {
  // 🔥 2025-12-22 添加安全检查，防止undefined错误
  if (!buckets) {
    throw new Error('聚类结果为空')
  }

  const allBucketKeywords = [
    ...(buckets.bucketA?.keywords || []),
    ...(buckets.bucketB?.keywords || []),
    ...(buckets.bucketC?.keywords || []),
    ...(buckets.bucketD?.keywords || [])
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

// 🔥 统一架构(2025-12-16): 已移除 fallbackClustering 降级函数
// 关键词必须经过AI语义分类，不再支持规则降级

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
    buckets.bucketC.keywords.length +
    buckets.bucketD.keywords.length

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
  const bucketDJson = serializeJsonForDb(buckets.bucketD.keywords, db.type)

  console.log(`📊 保存关键词池 (dbType=${db.type}):`)
  console.log(`   brand_keywords: ${brandKeywords.length}个 → ${typeof brandKwJson}`)
  console.log(`   bucket_a: ${buckets.bucketA.keywords.length}个`)
  console.log(`   bucket_b: ${buckets.bucketB.keywords.length}个`)
  console.log(`   bucket_c: ${buckets.bucketC.keywords.length}个`)
  console.log(`   bucket_d: ${buckets.bucketD.keywords.length}个`)

  if (existing) {
    // 更新现有记录
    await db.exec(
      `UPDATE offer_keyword_pools SET
        brand_keywords = ?,
        bucket_a_keywords = ?,
        bucket_b_keywords = ?,
        bucket_c_keywords = ?,
        bucket_d_keywords = ?,
        bucket_a_intent = ?,
        bucket_b_intent = ?,
        bucket_c_intent = ?,
        bucket_d_intent = ?,
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
        bucketDJson,
        buckets.bucketA.intent,
        buckets.bucketB.intent,
        buckets.bucketC.intent,
        buckets.bucketD.intent,
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
      bucket_a_keywords, bucket_b_keywords, bucket_c_keywords, bucket_d_keywords,
      bucket_a_intent, bucket_b_intent, bucket_c_intent, bucket_d_intent,
      total_keywords, clustering_model, clustering_prompt_version, balance_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      offerId,
      userId,
      brandKwJson,
      bucketAJson,
      bucketBJson,
      bucketCJson,
      bucketDJson,
      buckets.bucketA.intent,
      buckets.bucketB.intent,
      buckets.bucketC.intent,
      buckets.bucketD.intent,
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
 * 🆕 保存关键词池（PoolKeywordData[] 版本）
 * 🔥 2025-12-22: 添加bucketD支持
 */
async function saveKeywordPoolWithData(
  offerId: number,
  userId: number,
  brandKeywords: PoolKeywordData[],
  buckets: {
    bucketA: { intent: string; keywords: PoolKeywordData[] }
    bucketB: { intent: string; keywords: PoolKeywordData[] }
    bucketC: { intent: string; keywords: PoolKeywordData[] }
    bucketD: { intent: string; keywords: PoolKeywordData[] }
    statistics: { totalKeywords: number; balanceScore: number }
  },
  model?: string,
  promptVersion?: string
): Promise<OfferKeywordPool> {
  const db = await getDatabase()

  const brandKwJson = JSON.stringify(brandKeywords)
  const bucketAJson = JSON.stringify(buckets.bucketA.keywords)
  const bucketBJson = JSON.stringify(buckets.bucketB.keywords)
  const bucketCJson = JSON.stringify(buckets.bucketC.keywords)
  const bucketDJson = JSON.stringify(buckets.bucketD.keywords)
  const totalKeywords = brandKeywords.length + buckets.bucketA.keywords.length + buckets.bucketB.keywords.length + buckets.bucketC.keywords.length + buckets.bucketD.keywords.length

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
        bucket_d_keywords = ?,
        bucket_a_intent = ?,
        bucket_b_intent = ?,
        bucket_c_intent = ?,
        bucket_d_intent = ?,
        total_keywords = ?,
        clustering_model = ?,
        clustering_prompt_version = ?,
        balance_score = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE offer_id = ?`,
      [
        brandKwJson,
        bucketAJson,
        bucketBJson,
        bucketCJson,
        bucketDJson,
        buckets.bucketA.intent,
        buckets.bucketB.intent,
        buckets.bucketC.intent,
        buckets.bucketD.intent,
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
      bucket_a_keywords, bucket_b_keywords, bucket_c_keywords, bucket_d_keywords,
      bucket_a_intent, bucket_b_intent, bucket_c_intent, bucket_d_intent,
      total_keywords, clustering_model, clustering_prompt_version, balance_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      offerId,
      userId,
      brandKwJson,
      bucketAJson,
      bucketBJson,
      bucketCJson,
      bucketDJson,
      buckets.bucketA.intent,
      buckets.bucketB.intent,
      buckets.bucketC.intent,
      buckets.bucketD.intent,
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
 * 🆕 解析关键词数组（向后兼容）
 * 处理新格式 PoolKeywordData[] 和旧格式 string[]
 */
function parseKeywordArray(data: string): PoolKeywordData[] {
  const parsed = parseJsonFromDb(data)

  if (!Array.isArray(parsed) || parsed.length === 0) return []

  // 新格式：PoolKeywordData[]
  if (typeof parsed[0] === 'object' && parsed[0].keyword) {
    return parsed as PoolKeywordData[]
  }

  // 旧格式：string[] - 转换为 PoolKeywordData[]
  return parsed.map((kw: string) => ({
    keyword: kw,
    searchVolume: 0,
    source: 'LEGACY',
    matchType: 'BROAD'
  }))
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

  // 🔥 2025-12-16升级：使用parseKeywordArray处理新旧格式
  // 🔥 2025-12-22：添加bucketDKeywords和bucketDIntent
  return {
    id: row.id,
    offerId: row.offer_id,
    userId: row.user_id,
    brandKeywords: parseKeywordArray(row.brand_keywords),
    bucketAKeywords: parseKeywordArray(row.bucket_a_keywords),
    bucketBKeywords: parseKeywordArray(row.bucket_b_keywords),
    bucketCKeywords: parseKeywordArray(row.bucket_c_keywords),
    bucketDKeywords: parseKeywordArray(row.bucket_d_keywords || '[]'),
    bucketAIntent: row.bucket_a_intent,
    bucketBIntent: row.bucket_b_intent,
    bucketCIntent: row.bucket_c_intent,
    bucketDIntent: row.bucket_d_intent || '高购买意图',
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

  // 2. 提取初始关键词（保留 searchVolume）
  let initialKeywords: PoolKeywordData[]
  if (allKeywords) {
    // 如果提供了关键词列表，转换为 PoolKeywordData[]
    initialKeywords = allKeywords.map(kw => ({
      keyword: kw,
      searchVolume: 0,
      source: 'PROVIDED',
      matchType: 'BROAD'
    }))
  } else {
    initialKeywords = await extractKeywordsFromOffer(offerId, userId)
  }

  if (initialKeywords.length === 0) {
    throw new Error('无可用关键词，请先生成关键词')
  }

  console.log(`📝 初始关键词数: ${initialKeywords.length}`)

  // 2.5 🔧 修复(2025-12-22): 过滤种子词质量问题
  // 避免超长描述和无效组合词作为种子词
  const beforeFilterCount = initialKeywords.length
  initialKeywords = initialKeywords.filter(kw => {
    const keyword = kw.keyword.trim()

    // 过滤条件1：长度限制（≤5个单词）
    const wordCount = keyword.split(/\s+/).length
    if (wordCount > 5) {
      console.log(`   ⊗ 种子词长度过滤: "${keyword}" (${wordCount}个单词, 限制≤5)`)
      return false
    }

    // 过滤条件2：排除购买渠道词和过度组合
    const invalidPatterns = [
      // 购买渠道
      'store', 'shop', 'near me', 'official',
      // 电商平台
      'amazon', 'ebay', 'aliexpress', 'shopee', 'etsy',
      // 购买行为
      'buy', 'purchase', 'order',
      // 优惠相关
      'discount', 'sale', 'deal', 'code', 'coupon', 'voucher',
      // 价格相关
      'price', 'cost', 'cheap', 'affordable', 'budget',
      // 查询类
      'history', 'tracker', 'locator', 'review', 'compare',
      // 特殊年份/时间
      '2025', '2024', '2023', 'black friday', 'prime day'
    ]
    const keywordLower = keyword.toLowerCase()
    const hasInvalidPattern = invalidPatterns.some(pattern =>
      keywordLower.includes(pattern)
    )
    if (hasInvalidPattern) {
      const matchedPattern = invalidPatterns.find(p => keywordLower.includes(p))
      console.log(`   ⊗ 种子词无效模式过滤: "${keyword}" (包含: ${matchedPattern})`)
      return false
    }

    return true
  })

  if (beforeFilterCount !== initialKeywords.length) {
    console.log(`📊 种子词质量过滤: ${beforeFilterCount} → ${initialKeywords.length}`)
  }

  // 3. 🆕 全量扩展（替换3轮品牌种子词策略）
  const { expandAllKeywords, filterKeywords } = await import('./keyword-pool-helpers')

  // 获取Google Ads凭证（用于扩展）
  let customerId: string | undefined
  let refreshToken: string | undefined
  let accountId: number | undefined
  let clientId: string | undefined
  let clientSecret: string | undefined
  let developerToken: string | undefined

  try {
    const { getGoogleAdsCredentials } = await import('./google-ads-oauth')
    const { getDatabase } = await import('./db')
    const db = await getDatabase()

    // 🔧 PostgreSQL兼容性修复: is_active/is_manager_account在PostgreSQL中是BOOLEAN类型
    const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
    const isManagerCondition = db.type === 'postgres' ? 'is_manager_account = false' : 'is_manager_account = 0'

    const adsAccount = await db.queryOne(`
      SELECT id, customer_id FROM google_ads_accounts
      WHERE user_id = ? AND ${isActiveCondition} AND status = 'ENABLED' AND ${isManagerCondition}
      ORDER BY created_at DESC LIMIT 1
    `, [userId]) as { id: number; customer_id: string } | undefined

    if (adsAccount) {
      const credentials = await getGoogleAdsCredentials(userId)
      if (credentials) {
        customerId = adsAccount.customer_id
        refreshToken = credentials.refresh_token
        accountId = adsAccount.id
        // 从 credentials 获取 API 配置
        clientId = credentials.client_id
        clientSecret = credentials.client_secret
        developerToken = credentials.developer_token
      }
    }
  } catch (error) {
    console.warn('⚠️ 无法获取Google Ads凭证，跳过关键词扩展')
  }

  const expandedKeywords = await expandAllKeywords(
    initialKeywords,
    offer.brand,
    offer.category || '',
    offer.target_country,
    offer.target_language || 'en',
    userId,
    customerId,
    refreshToken,
    accountId,
    clientId,
    clientSecret,
    developerToken
  )

  // 4. 🆕 智能过滤（竞品+品类+搜索量+地理位置）
  const filteredKeywords = filterKeywords(
    expandedKeywords,
    offer.brand,
    offer.category || '',
    offer.target_country  // 🔧 修复(2025-12-17): 传递目标国家进行地理过滤
  )

  console.log(`📝 过滤后关键词数: ${filteredKeywords.length}`)

  // 5. 分离纯品牌词和非品牌词
  const keywordStrings = filteredKeywords.map(kw => kw.keyword)
  const { brandKeywords: brandKwStrings, nonBrandKeywords: nonBrandKwStrings } = separateBrandKeywords(keywordStrings, offer.brand)

  // 转换回 PoolKeywordData[]
  const brandKeywordsData = filteredKeywords.filter(kw => brandKwStrings.includes(kw.keyword))
  const nonBrandKeywordsData = filteredKeywords.filter(kw => nonBrandKwStrings.includes(kw.keyword))

  // 6. AI 语义聚类（保持不变）
  const buckets = await clusterKeywordsByIntent(
    nonBrandKwStrings,
    offer.brand,
    offer.category,
    userId
  )

  // 7. 将 PoolKeywordData 映射到桶中
  const bucketAData = buckets.bucketA.keywords.map(kw =>
    nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
  )
  const bucketBData = buckets.bucketB.keywords.map(kw =>
    nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
  )
  const bucketCData = buckets.bucketC.keywords.map(kw =>
    nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
  )
  const bucketDData = buckets.bucketD.keywords.map(kw =>
    nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
  )

  // 8. 保存到数据库
  const pool = await saveKeywordPoolWithData(
    offerId,
    userId,
    brandKeywordsData,
    {
      bucketA: { intent: buckets.bucketA.intent, keywords: bucketAData },
      bucketB: { intent: buckets.bucketB.intent, keywords: bucketBData },
      bucketC: { intent: buckets.bucketC.intent, keywords: bucketCData },
      bucketD: { intent: buckets.bucketD.intent, keywords: bucketDData },
      statistics: buckets.statistics
    },
    'gemini',
    'v1.1'
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
 * 🔥 2025-12-16升级：返回 PoolKeywordData[]，保留完整元数据
 */
async function extractKeywordsFromOffer(offerId: number, userId: number): Promise<PoolKeywordData[]> {
  const db = await getDatabase()
  const keywordMap = new Map<string, PoolKeywordData>()

  // 从现有创意中提取关键词
  const creatives = await db.query<{ keywords: string }>(
    `SELECT keywords FROM ad_creatives
     WHERE offer_id = ? AND user_id = ?
     ORDER BY created_at DESC
     LIMIT 3`,
    [offerId, userId]
  )

  for (const creative of creatives) {
    if (creative.keywords) {
      try {
        const keywords = JSON.parse(creative.keywords)
        if (Array.isArray(keywords)) {
          keywords.forEach((kw: any) => {
            const kwStr = typeof kw === 'string' ? kw : kw.keyword
            if (kwStr && !keywordMap.has(kwStr)) {
              keywordMap.set(kwStr, {
                keyword: kwStr,
                searchVolume: typeof kw === 'object' ? (kw.searchVolume || 0) : 0,
                competition: typeof kw === 'object' ? kw.competition : undefined,
                competitionIndex: typeof kw === 'object' ? kw.competitionIndex : undefined,
                lowTopPageBid: typeof kw === 'object' ? kw.lowTopPageBid : undefined,
                highTopPageBid: typeof kw === 'object' ? kw.highTopPageBid : undefined,
                source: 'CREATIVE',
                matchType: typeof kw === 'object' ? kw.matchType : 'BROAD'
              })
            }
          })
        }
      } catch {}
    }
  }

  // 如果没有创意关键词，从 AI 分析结果提取
  if (keywordMap.size === 0) {
    const offer = await db.queryOne<{ ai_keywords: string; extracted_keywords: string }>(
      'SELECT ai_keywords, extracted_keywords FROM offers WHERE id = ?',
      [offerId]
    )

    const keywordsJson = offer?.ai_keywords || offer?.extracted_keywords

    if (keywordsJson) {
      try {
        const parsedKeywords = JSON.parse(keywordsJson)
        if (Array.isArray(parsedKeywords)) {
          parsedKeywords.forEach((kw: any) => {
            const kwStr = typeof kw === 'string' ? kw : kw.keyword
            if (kwStr && !keywordMap.has(kwStr)) {
              keywordMap.set(kwStr, {
                keyword: kwStr,
                searchVolume: typeof kw === 'object' ? (kw.searchVolume || 0) : 0,
                competition: typeof kw === 'object' ? kw.competition : undefined,
                competitionIndex: typeof kw === 'object' ? kw.competitionIndex : undefined,
                lowTopPageBid: typeof kw === 'object' ? kw.lowTopPageBid : undefined,
                highTopPageBid: typeof kw === 'object' ? kw.highTopPageBid : undefined,
                source: 'OFFER_DATA',
                matchType: typeof kw === 'object' ? kw.matchType : 'BROAD'
              })
            }
          })
        }
      } catch {}
    }
  }

  return Array.from(keywordMap.values())
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
): { keywords: PoolKeywordData[]; intent: string; intentEn: string } {
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
      // 🔥 2025-12-22: 综合桶（第5个创意）
      // 整合A+B+C+D所有桶的关键词，覆盖最广泛的用户群
      return {
        keywords: [
          ...pool.brandKeywords,
          ...pool.bucketAKeywords,
          ...pool.bucketBKeywords,
          ...pool.bucketCKeywords,
          ...pool.bucketDKeywords
        ],
        intent: '综合推广',
        intentEn: 'Synthetic'
      }
    case 'D':
      // 🔥 2025-12-22: 高购买意图桶（第4个创意）
      // 使用专门生成的高购买意图关键词
      return {
        keywords: [...pool.brandKeywords, ...pool.bucketDKeywords],
        intent: pool.bucketDIntent,
        intentEn: 'High Purchase Intent'
      }
    default:
      throw new Error(`Invalid bucket type: ${bucket}`)
  }
}

/**
 * 🆕 2025-12-22: 获取综合桶关键词（第5个创意专用）
 *
 * 策略：
 * 1. 包含所有品牌关键词（100%）
 * 2. 从A+B+C+D各桶中选择搜索量最高的非品牌关键词
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

  // 1. 收集所有品牌词（从 PoolKeywordData[] 提取）
  const brandKeywords = pool.brandKeywords.map(kw => ({
    keyword: typeof kw === 'string' ? kw : kw.keyword,
    searchVolume: typeof kw === 'string' ? 0 : (kw.searchVolume || 0),
    isBrand: true
  }))
  console.log(`   品牌词: ${brandKeywords.length}个`)

  // 2. 收集所有非品牌词（去重）- 从 PoolKeywordData[] 提取 keyword 字符串
  const allNonBrandKeywords = new Set<string>([
    ...pool.bucketAKeywords.map(kw => typeof kw === 'string' ? kw : kw.keyword),
    ...pool.bucketBKeywords.map(kw => typeof kw === 'string' ? kw : kw.keyword),
    ...pool.bucketCKeywords.map(kw => typeof kw === 'string' ? kw : kw.keyword)
  ])
  console.log(`   非品牌词（去重后）: ${allNonBrandKeywords.size}个`)

  // 3. 如果需要按搜索量排序，获取搜索量数据
  let nonBrandWithVolume: Array<{ keyword: string; searchVolume: number; isBrand: boolean }> = []

  if (config.sortByVolume && allNonBrandKeywords.size > 0) {
    try {
      const { getKeywordVolumesForExisting } = await import('./unified-keyword-service')
      const volumeData = await getKeywordVolumesForExisting({
        baseKeywords: Array.from(allNonBrandKeywords),
        country,
        language: 'en',  // TODO: 从offer获取语言
        userId,
        brandName: pool.brandKeywords[0] ? (typeof pool.brandKeywords[0] === 'string' ? pool.brandKeywords[0] : pool.brandKeywords[0].keyword) : ''
      })

      // 构建搜索量映射
      const volumeMap = new Map(volumeData.map(v => [v.keyword.toLowerCase(), v.searchVolume]))

      // 转换为带搜索量的格式
      nonBrandWithVolume = Array.from(allNonBrandKeywords).map(kw => ({
        keyword: kw,
        searchVolume: (volumeMap.get(kw.toLowerCase()) as number) || 0,
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
  // 🔥 2025-12-22: 添加桶D和桶S支持
  const all: BucketType[] = ['A', 'B', 'C', 'D', 'S']

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

  // 🆕 2025-12-22: 支持5个创意（A/B/C/D + 综合S）
  return (result?.count || 0) >= 5
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

// ============================================
// 🔥 KISS 优化：统一关键词检索 API
// 替代 5 个重叠函数，简化开发者体验
// ============================================

/**
 * 统一的关键词检索 API
 *
 * 简化了以下 5 个重叠函数：
 * 1. getKeywordPoolByOfferId()
 * 2. getOrCreateKeywordPool()
 * 3. getMultiRoundIntentAwareKeywords()
 * 4. getUnifiedKeywordData()
 * 5. getUnifiedKeywordDataWithMultiRounds()
 *
 * 使用参数化选项替代多个函数，遵循 KISS 原则
 *
 * 注意：此函数仅负责检索。如需创建关键词池，请使用 getOrCreateKeywordPool()
 */
export interface GetKeywordsOptions {
  /** 要检索的桶：A(品牌), B(场景), C(功能), ALL(全部) */
  bucket?: 'A' | 'B' | 'C' | 'ALL'

  /** 意图过滤：品牌、场景、功能 */
  intent?: 'brand' | 'scenario' | 'feature'

  /** 最小搜索量阈值 */
  minSearchVolume?: number

  /** 最大关键词数量 */
  maxKeywords?: number
}

/**
 * 统一关键词检索结果
 */
export interface GetKeywordsResult {
  /** 关键词列表 */
  keywords: PoolKeywordData[]

  /** 桶信息（如果适用） */
  buckets?: {
    A?: { intent: string; keywords: PoolKeywordData[] }
    B?: { intent: string; keywords: PoolKeywordData[] }
    C?: { intent: string; keywords: PoolKeywordData[] }
  }

  /** 统计信息 */
  stats: {
    totalCount: number
    bucketACount?: number
    bucketBCount?: number
    bucketCCount?: number
    searchVolumeRange?: { min: number; max: number }
  }

  /** 元数据 */
  meta: {
    offerId: number
    createdAt?: string
    updatedAt?: string
    hasMultipleRounds?: boolean
  }
}

/**
 * 🔥 核心 API：统一关键词检索
 *
 * 示例用法：
 * ```typescript
 * // 获取所有关键词
 * const all = await getKeywords(123)
 *
 * // 只获取品牌桶
 * const brand = await getKeywords(123, { bucket: 'A' })
 *
 * // 获取过滤后的关键词
 * const filtered = await getKeywords(123, { minSearchVolume: 100, maxKeywords: 500 })
 * ```
 *
 * 注意：此函数仅负责检索。如需创建关键词池，请使用 getOrCreateKeywordPool()
 */
export async function getKeywords(
  offerId: number,
  options: GetKeywordsOptions = {}
): Promise<GetKeywordsResult> {
  const {
    bucket = 'ALL',
    intent,
    minSearchVolume = 100,
    maxKeywords = 5000
  } = options

  // 1. 获取关键词池
  const keywordPool = await getKeywordPoolByOfferId(offerId)

  // 2. 如果没有，返回空结果
  if (!keywordPool) {
    return {
      keywords: [],
      stats: { totalCount: 0 },
      meta: { offerId }
    }
  }

  // 3. 根据选项过滤和返回关键词
  let keywords: PoolKeywordData[] = []

  // 选择要返回的桶
  if (bucket === 'ALL') {
    // 合并所有桶的关键词
    keywords = [
      ...keywordPool.brandKeywords,
      ...keywordPool.bucketAKeywords,
      ...keywordPool.bucketBKeywords,
      ...keywordPool.bucketCKeywords
    ]
  } else if (bucket === 'A') {
    keywords = keywordPool.bucketAKeywords
  } else if (bucket === 'B') {
    keywords = keywordPool.bucketBKeywords
  } else if (bucket === 'C') {
    keywords = keywordPool.bucketCKeywords
  }

  // 4. 应用意图过滤（如果指定）
  if (intent) {
    if (intent === 'brand' && bucket === 'A') {
      keywords = keywordPool.bucketAKeywords
    } else if (intent === 'scenario' && bucket === 'B') {
      keywords = keywordPool.bucketBKeywords
    } else if (intent === 'feature' && bucket === 'C') {
      keywords = keywordPool.bucketCKeywords
    }
  }

  // 5. 按搜索量过滤
  keywords = keywords.filter(kw => kw.searchVolume >= minSearchVolume)

  // 6. 限制数量
  keywords = keywords.slice(0, maxKeywords)

  // 7. 构建返回结果
  const result: GetKeywordsResult = {
    keywords,
    stats: {
      totalCount: keywords.length,
      bucketACount: keywordPool.bucketAKeywords.length,
      bucketBCount: keywordPool.bucketBKeywords.length,
      bucketCCount: keywordPool.bucketCKeywords.length,
      searchVolumeRange: keywords.length > 0
        ? {
            min: Math.min(...keywords.map(k => k.searchVolume)),
            max: Math.max(...keywords.map(k => k.searchVolume))
          }
        : undefined
    },
    meta: {
      offerId,
      createdAt: keywordPool.createdAt,
      updatedAt: keywordPool.updatedAt
    }
  }

  // 8. 如果需要，返回桶信息
  if (bucket === 'ALL') {
    result.buckets = {
      A: { intent: keywordPool.bucketAIntent, keywords: keywordPool.bucketAKeywords },
      B: { intent: keywordPool.bucketBIntent, keywords: keywordPool.bucketBKeywords },
      C: { intent: keywordPool.bucketCIntent, keywords: keywordPool.bucketCKeywords }
    }
  }

  console.log(`[getKeywords] 完成: offerId=${offerId}, bucket=${bucket}, 返回${keywords.length}个关键词`)
  return result
}
