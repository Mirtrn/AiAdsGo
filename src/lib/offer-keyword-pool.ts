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
import { getUserAuthType } from './google-ads-oauth'
import type { UnifiedKeywordData } from './unified-keyword-service'
import { filterKeywordQuality, generateFilterReport } from './keyword-quality-filter'
import { getMinContextTokenMatchesForKeywordQualityFilter } from './keyword-context-filter'

// ============================================
// 类型定义
// ============================================

/**
 * 🆕 关键词池数据结构 - 包含完整元数据
 * 用途：存储关键词的搜索量、CPC、竞争度等数据，避免重复调用 Keyword Planner
 *
 * 🔥 2025-12-29: 新增 isPureBrand 属性用于标记纯品牌词
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
  isPureBrand?: boolean   // 🔥 2025-12-29 新增：标记是否为纯品牌词（豁免搜索量过滤）
}

/**
 * Offer 级关键词池
 * 🆕 v4.16: 支持单品链接和店铺链接的不同分桶策略
 */
export interface OfferKeywordPool {
  id: number
  offerId: number
  userId: number

  // 共享层：纯品牌词（🔥 升级为 PoolKeywordData[]）
  brandKeywords: PoolKeywordData[]

  // 独占层：语义分桶（单品链接）- 4个桶
  bucketAKeywords: PoolKeywordData[]  // 产品型号导向 (Product-Specific)
  bucketBKeywords: PoolKeywordData[]  // 购买意图导向 (Purchase-Intent)
  bucketCKeywords: PoolKeywordData[]  // 功能特性导向 (Feature-Focused)
  bucketDKeywords: PoolKeywordData[]  // 紧迫促销导向 (Urgency-Promo)

  // 桶意图描述（单品链接）
  bucketAIntent: string
  bucketBIntent: string
  bucketCIntent: string
  bucketDIntent: string

  // 🆕 v4.16: 店铺链接分桶 - 5个桶
  storeBucketAKeywords: PoolKeywordData[]  // 品牌信任导向 (Brand-Trust)
  storeBucketBKeywords: PoolKeywordData[]  // 场景解决方案 (Scene-Solution)
  storeBucketCKeywords: PoolKeywordData[]  // 精选推荐导向 (Collection-Highlight)
  storeBucketDKeywords: PoolKeywordData[]  // 信任信号导向 (Trust-Signals)
  storeBucketSKeywords: PoolKeywordData[]  // 店铺全景 (Store-Overview)

  // 店铺分桶意图描述
  storeBucketAIntent: string
  storeBucketBIntent: string
  storeBucketCIntent: string
  storeBucketDIntent: string
  storeBucketSIntent: string

  // 🆕 v4.16: 链接类型标识
  linkType: 'product' | 'store' | 'both'

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
 * 🔧 2025-12-24: 添加可选的 bucketS 支持店铺链接
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
  bucketS?: {  // 🔧 可选：店铺链接专用
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
    bucketSCount?: number  // 🔧 可选：店铺链接专用
    balanceScore: number
  }
}

/**
 * 🆕 v4.16: 店铺链接关键词桶（5个桶）
 * 用于店铺链接的5种不同创意类型
 */
export interface StoreKeywordBuckets {
  bucketA: {
    intent: string  // 品牌信任导向 (Brand-Trust)
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketB: {
    intent: string  // 场景解决方案 (Scene-Solution)
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketC: {
    intent: string  // 精选推荐导向 (Collection-Highlight)
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketD: {
    intent: string  // 信任信号导向 (Trust-Signals)
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketS: {
    intent: string  // 店铺全景 (Store-Overview)
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
    bucketSCount: number
    balanceScore: number
  }
}

/**
 * 桶类型
 * A = 品牌导向 (Brand-Oriented) - 第1个创意
 * B = 场景导向 (Scenario-Oriented) - 第2个创意
 * C = 功能导向 (Feature-Oriented) - 第3个创意
 * D = 高购买意图 (High Purchase Intent) - 第4个创意
 * S = 综合推广 (Synthetic) - 历史遗留：旧版第5个创意（已在KISS-3类型方案中弃用）
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
 * 🆕 v4.16: 支持店铺链接的5桶模式
 */
async function clusterBatchKeywords(
  batchKeywords: string[],
  brandName: string,
  category: string | null,
  userId: number,
  batchIndex: number,
  totalBatches: number,
  pageType: 'product' | 'store' = 'product'
): Promise<{
  bucketA: { intent: string; intentEn: string; description: string; keywords: string[] }
  bucketB: { intent: string; intentEn: string; description: string; keywords: string[] }
  bucketC: { intent: string; intentEn: string; description: string; keywords: string[] }
  bucketD: { intent: string; intentEn: string; description: string; keywords: string[] }
  statistics: { totalKeywords: number; bucketACount: number; bucketBCount: number; bucketCCount: number; bucketDCount: number; balanceScore: number }
}> {
  console.log(`📦 处理批次 ${batchIndex}/${totalBatches}: ${batchKeywords.length} 个关键词 (${pageType}链接)`)

  // 1. 加载聚类 prompt
  const promptTemplate = await loadPrompt('keyword_intent_clustering')

  // 2. 构建 prompt（v4.16 支持 store 链接）
  let prompt = promptTemplate
    .replace('{{brandName}}', brandName)
    .replace('{{productCategory}}', category || '未分类')
    .replace('{{keywords}}', batchKeywords.join('\n'))
    // 🆕 v4.16: 添加链接类型参数到 prompt
    .replace(/\{\{linkType\}\}/g, pageType)

  // 3. 定义结构化输出 schema（支持4桶产品 或 5桶店铺）
  const isStore = pageType === 'store'
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
      // 🆕 v4.16: 店铺链接添加 bucketS
      ...(isStore ? {
        bucketS: {
          type: 'OBJECT' as const,
          properties: {
            intent: { type: 'STRING' as const },
            intentEn: { type: 'STRING' as const },
            description: { type: 'STRING' as const },
            keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
          },
          required: ['intent', 'intentEn', 'description', 'keywords']
        }
      } : {}),
      statistics: {
        type: 'OBJECT' as const,
        properties: {
          totalKeywords: { type: 'INTEGER' as const },
          bucketACount: { type: 'INTEGER' as const },
          bucketBCount: { type: 'INTEGER' as const },
          bucketCCount: { type: 'INTEGER' as const },
          bucketDCount: { type: 'INTEGER' as const },
          // 🆕 v4.16: 店铺链接添加 bucketSCount
          ...(isStore ? { bucketSCount: { type: 'INTEGER' as const } } : {}),
          balanceScore: { type: 'NUMBER' as const }
        },
        required: isStore
          ? ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'bucketDCount', 'bucketSCount', 'balanceScore']
          : ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'bucketDCount', 'balanceScore']
      }
    },
    required: isStore
      ? ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'bucketS', 'statistics']
      : ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'statistics']
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
  // 🆕 v4.16: 店铺链接支持5个桶
  if (isStore) {
    // 店铺链接：验证5个桶
    if (!batchResult.bucketA || !batchResult.bucketB || !batchResult.bucketC || !batchResult.bucketD || !batchResult.bucketS) {
      console.error('❌ AI返回数据结构不完整(店铺):', batchResult)
      throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D/S')
    }

    if (!Array.isArray(batchResult.bucketA.keywords) ||
        !Array.isArray(batchResult.bucketB.keywords) ||
        !Array.isArray(batchResult.bucketC.keywords) ||
        !Array.isArray(batchResult.bucketD.keywords) ||
        !Array.isArray(batchResult.bucketS.keywords)) {
      console.error('❌ AI返回的keywords不是数组(店铺):', batchResult)
      throw new Error('AI返回的keywords不是数组')
    }

    console.log(`✅ 批次 ${batchIndex} 完成 (店铺5桶): A=${batchResult.bucketA.keywords.length}, B=${batchResult.bucketB.keywords.length}, C=${batchResult.bucketC.keywords.length}, D=${batchResult.bucketD.keywords.length}, S=${batchResult.bucketS.keywords.length}`)
  } else {
    // 产品链接：验证4个桶
    if (!batchResult.bucketA || !batchResult.bucketB || !batchResult.bucketC || !batchResult.bucketD) {
      console.error('❌ AI返回数据结构不完整(产品):', batchResult)
      throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D')
    }

    if (!Array.isArray(batchResult.bucketA.keywords) ||
        !Array.isArray(batchResult.bucketB.keywords) ||
        !Array.isArray(batchResult.bucketC.keywords) ||
        !Array.isArray(batchResult.bucketD.keywords)) {
      console.error('❌ AI返回的keywords不是数组(产品):', batchResult)
      throw new Error('AI返回的keywords不是数组')
    }

    console.log(`✅ 批次 ${batchIndex} 完成 (产品4桶): A=${batchResult.bucketA.keywords.length}, B=${batchResult.bucketB.keywords.length}, C=${batchResult.bucketC.keywords.length}, D=${batchResult.bucketD.keywords.length}`)
  }

  return batchResult
}

/**
 * 合并多个批次的聚类结果（支持4桶和5桶模式）
 * 🔧 修复(2025-12-24): 支持店铺链接的bucketS
 */
function mergeBatchResults(
  batchResults: Array<{
    bucketA: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketB: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketC: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketD: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketS?: { intent: string; intentEn: string; description: string; keywords: string[] }  // 🔧 可选：店铺链接专用
    statistics: { totalKeywords: number; bucketACount: number; bucketBCount: number; bucketCCount: number; bucketDCount: number; bucketSCount?: number; balanceScore: number }
  }>
): KeywordBuckets {
  // 合并所有关键词（去重）
  const allBucketAKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketA.keywords)))
  const allBucketBKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketB.keywords)))
  const allBucketCKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketC.keywords)))
  const allBucketDKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketD.keywords)))
  const allBucketSKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketS?.keywords || [])))  // 🔧 处理可选的bucketS

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

  // 🔧 处理bucketS（店铺链接专用）
  const bucketSIntent = batchResults.find(r => r.bucketS)?.bucketS

  // 计算统计数据
  const totalKeywords = allBucketAKeywords.length + allBucketBKeywords.length + allBucketCKeywords.length + allBucketDKeywords.length + allBucketSKeywords.length
  const averageBalanceScore = batchResults.reduce((sum, r) => sum + r.statistics.balanceScore, 0) / batchResults.length

  console.log(`🔄 合并 ${batchResults.length} 个批次结果:`)
  console.log(`   桶A: ${allBucketAKeywords.length} 个关键词`)
  console.log(`   桶B: ${allBucketBKeywords.length} 个关键词`)
  console.log(`   桶C: ${allBucketCKeywords.length} 个关键词`)
  console.log(`   桶D: ${allBucketDKeywords.length} 个关键词`)
  if (allBucketSKeywords.length > 0) {
    console.log(`   桶S: ${allBucketSKeywords.length} 个关键词`)  // 🔧 店铺链接显示bucketS
  }
  console.log(`   平均均衡度: ${averageBalanceScore.toFixed(2)}`)

  const result: KeywordBuckets = {
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

  // 🔧 添加bucketS（如果存在）
  if (bucketSIntent && allBucketSKeywords.length > 0) {
    result.bucketS = { ...bucketSIntent, keywords: allBucketSKeywords }
    result.statistics.bucketSCount = allBucketSKeywords.length
  }

  return result
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
 * 桶A：产品型号导向（知道要买什么产品）
 * 桶B：购买意图导向（搜索价格/优惠）
 * 桶C：功能特性导向（关注技术规格/功能特性）
 * 桶D：紧迫促销导向（追求即时购买）
 *
 * 🆕 v4.16: 店铺链接支持5个桶
 * 桶A：品牌信任导向
 * 桶B：场景解决方案导向
 * 桶C：精选推荐导向
 * 桶D：信任信号导向
 * 桶S：店铺全景导向
 *
 * @param keywords - 非品牌关键词列表
 * @param brandName - 品牌名称
 * @param category - 产品类别
 * @param userId - 用户 ID（用于 AI 调用）
 * @param targetCountry - 目标国家
 * @param targetLanguage - 目标语言
 * @param pageType - 链接类型 ('product' | 'store')
 * @returns 关键词桶
 */
export async function clusterKeywordsByIntent(
  keywords: string[],
  brandName: string,
  category: string | null,
  userId: number,
  targetCountry?: string,
  targetLanguage?: string,
  pageType: 'product' | 'store' = 'product'
): Promise<KeywordBuckets> {
  if (keywords.length === 0) {
    console.log('⚠️ 无关键词需要聚类，返回空桶')
    return pageType === 'store' ? createEmptyStoreBuckets() : createEmptyBuckets()
  }

  console.log(`🎯 开始 AI 语义聚类: ${keywords.length} 个关键词 (${pageType}链接)`)

  // 🔥 2025-12-22 整合优化：先生成高购买意图关键词
  // 🆕 v4.16: 店铺链接不生成高购买意图关键词
  const highIntentKeywords = pageType === 'product'
    ? generateHighIntentKeywords(brandName, category, keywords.slice(0, 10))
    : []

  if (pageType === 'product') {
    console.log(`🎯 生成高购买意图关键词: ${highIntentKeywords.length} 个`)
  }

  // 🔥 2025-12-23 修复：查询高购买意图词的真实搜索量
  let highIntentKeywordsWithVolume: string[] = highIntentKeywords
  if (targetCountry && targetLanguage) {
    try {
      console.log(`📊 查询高购买意图词搜索量: ${highIntentKeywords.length} 个关键词`)
      const { getKeywordSearchVolumes } = await import('./keyword-planner')
      // 🔧 修复(2025-12-26): 支持服务账号模式
      const auth = await getUserAuthType(userId)
      const metricsResults = await getKeywordSearchVolumes(
        highIntentKeywords,
        targetCountry,
        targetLanguage,
        userId,
        auth.authType,
        auth.serviceAccountId
      )

      // 过滤掉搜索量为0的关键词（API未返回数据）
      // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，保留所有关键词
      const disableSearchVolumeFilter = metricsResults.some((kw: any) =>
        kw?.volumeUnavailableReason === 'DEV_TOKEN_TEST_ONLY' ||
        kw?.volumeUnavailableReason === 'SERVICE_ACCOUNT_UNSUPPORTED'
      )
      const hasAnyVolume = metricsResults.some((kw: any) => kw.avgMonthlySearches > 0)
      let validKeywords: string[]

      if (disableSearchVolumeFilter) {
        validKeywords = highIntentKeywords
        console.log('⚠️ 搜索量数据不可用（可能是服务账号或 developer token 无 Basic/Standard access），保留所有关键词')
      } else if (hasAnyVolume) {
        validKeywords = metricsResults
          .filter((kw: any) => kw.avgMonthlySearches > 0)
          .map((kw: any) => kw.keyword)
        console.log(`✅ 高购买意图词搜索量查询完成: ${validKeywords.length}/${highIntentKeywords.length} 个有搜索量`)
      } else {
        validKeywords = highIntentKeywords
        console.log(`⚠️ 所有高购买意图词搜索量为0（可能是服务账号模式），保留所有关键词`)
      }

      // 只保留有搜索量的关键词
      if (validKeywords.length > 0) {
        highIntentKeywordsWithVolume = validKeywords
      } else {
        console.warn(`⚠️ 所有高购买意图词搜索量为0，保留原始关键词`)
      }
    } catch (error: any) {
      console.warn(`⚠️ 高购买意图词搜索量查询失败: ${error.message}，使用原始关键词`)
    }
  } else {
    console.log(`ℹ️ 未提供目标国家/语言，跳过高购买意图词搜索量查询`)
  }

  // 将高购买意图关键词也加入聚类输入
  const allKeywordsForClustering = [...keywords, ...highIntentKeywordsWithVolume]
  console.log(`📊 总计聚类关键词: ${allKeywordsForClustering.length} 个 (原始:${keywords.length} + 高意图:${highIntentKeywordsWithVolume.length})`)

  // 🔥 2025-12-27 优化：减小批次大小，降低超时风险
  // 原因：减小单次请求处理量，提高稳定性
  const BATCH_SIZE = 50  // 每批50个关键词（降低超时风险）
  const needsBatching = allKeywordsForClustering.length > 60  // 从100改为60
  const batchCount = needsBatching ? Math.ceil(allKeywordsForClustering.length / BATCH_SIZE) : 1

  if (!needsBatching) {
    // 小批量：直接处理（原逻辑）
    console.log(`📝 小批量模式：直接处理 ${allKeywordsForClustering.length} 个关键词`)
    return await clusterKeywordsDirectly(allKeywordsForClustering, brandName, category, userId, pageType)
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

  // 2. 🔥 2025-12-27 优化：保持并行处理以支持多用户并发
  // 原因：多用户场景下串行处理会严重影响系统吞吐量
  // 优化措施：增大重试次数 + 随机抖动 + 增加超时时间
  const maxRetries = 3  // 从2改为3（4次尝试）
  const baseDelay = 5000
  let lastError: any

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    try {
      // 并行处理所有批次
      const batchPromises = batches.map((batch, index) =>
        clusterBatchKeywords(batch, brandName, category, userId, index + 1, batchCount, pageType)
          .catch(error => {
            console.error(`❌ 批次 ${index + 1} 失败:`, error.message)
            throw error
          })
      )

      // 等待所有批次完成
      const batchResults = await Promise.all(batchPromises)

      // 3. 合并结果
      const mergedBuckets = mergeBatchResults(batchResults)

      // 4. 验证结果（店铺/单品分别处理）
      if (pageType === 'store') {
        const storeBuckets = mergedBuckets as unknown as StoreKeywordBuckets
        redistributeStoreBucketsFromS(storeBuckets, allKeywordsForClustering)
        applyStoreBucketPostProcessing(storeBuckets)
        recalculateStoreBucketStatistics(storeBuckets)
        validateStoreBuckets(storeBuckets, allKeywordsForClustering)

        console.log(`✅ 分批 AI 聚类完成 (店铺):`)
        console.log(`   桶A [品牌信任]: ${storeBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [场景解决]: ${storeBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [精选推荐]: ${storeBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [信任信号]: ${storeBuckets.bucketD.keywords.length} 个`)
        console.log(`   桶S [店铺全景]: ${storeBuckets.bucketS.keywords.length} 个`)
        console.log(`   均衡度得分: ${storeBuckets.statistics.balanceScore.toFixed(2)}`)
      } else {
        validateBuckets(mergedBuckets, allKeywordsForClustering)

        console.log(`✅ 分批 AI 聚类完成:`)
        console.log(`   桶A [品牌导向]: ${mergedBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [场景导向]: ${mergedBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [功能导向]: ${mergedBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [高购买意图]: ${mergedBuckets.bucketD.keywords.length} 个`)
        console.log(`   均衡度得分: ${mergedBuckets.statistics.balanceScore.toFixed(2)}`)
      }

      return mergedBuckets
    } catch (error: any) {
      lastError = error
      const isTimeout = error.message?.includes('timeout') || error.code === 'ECONNABORTED'
      const isRateLimited = error.response?.status === 429
      const isGatewayError = error.response?.status >= 500  // 504, 502, 500 等服务器错误

      // 🔧 修复(2025-12-31): 添加 5xx 网关错误识别，支持 504 等错误重试
      if (retryCount < maxRetries && (isTimeout || isRateLimited || isGatewayError)) {
        // 🔥 2025-12-27 优化：添加随机抖动，避免重试风暴
        const baseDelayMs = baseDelay * Math.pow(2, retryCount)
        const jitter = Math.random() * 2000  // 0-2秒随机抖动
        const delay = Math.min(baseDelayMs + jitter, 60000)  // 最多60秒
        const errorInfo = error.response?.status
          ? `HTTP ${error.response.status}`
          : error.message?.substring(0, 50)
        console.warn(`⚠️ 分批聚类第 ${retryCount + 1} 次失败 (${errorInfo})，${(delay / 1000).toFixed(1)}s 后重试...`)
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
 * 🆕 v4.16: 支持店铺链接的5桶模式
 * 🔥 2025-12-27: 增加重试次数，与分批处理保持一致
 */
async function clusterKeywordsDirectly(
  keywords: string[],
  brandName: string,
  category: string | null,
  userId: number,
  pageType: 'product' | 'store' = 'product'
): Promise<KeywordBuckets | StoreKeywordBuckets> {
  // 🔥 2025-12-27: 增加重试次数，与分批处理保持一致
  const maxRetries = 3  // 🔥 从2改为3（4次尝试）
  const baseDelay = 5000
  let lastError: any

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    try {
      // 1. 加载聚类 prompt（v4.16 支持 pageType 参数）
      const promptTemplate = await loadPrompt('keyword_intent_clustering')

      // 2. 构建 prompt（v4.16 支持 store 链接）
      let prompt = promptTemplate
        .replace('{{brandName}}', brandName)
        .replace('{{productCategory}}', category || '未分类')
        .replace('{{keywords}}', keywords.join('\n'))
        // 🆕 v4.16: 添加链接类型参数到 prompt
        .replace(/\{\{linkType\}\}/g, pageType)

      // 3. 定义结构化输出 schema（支持4桶产品 或 5桶店铺）
      const isStore = pageType === 'store'
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
          // 🆕 v4.16: 店铺链接添加 bucketS
          ...(isStore ? {
            bucketS: {
              type: 'OBJECT' as const,
              properties: {
                intent: { type: 'STRING' as const },
                intentEn: { type: 'STRING' as const },
                description: { type: 'STRING' as const },
                keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
              },
              required: ['intent', 'intentEn', 'description', 'keywords']
            }
          } : {}),
          statistics: {
            type: 'OBJECT' as const,
            properties: {
              totalKeywords: { type: 'INTEGER' as const },
              bucketACount: { type: 'INTEGER' as const },
              bucketBCount: { type: 'INTEGER' as const },
              bucketCCount: { type: 'INTEGER' as const },
              bucketDCount: { type: 'INTEGER' as const },
              // 🆕 v4.16: 店铺链接添加 bucketSCount
              ...(isStore ? { bucketSCount: { type: 'INTEGER' as const } } : {}),
              balanceScore: { type: 'NUMBER' as const }
            },
            required: isStore
              ? ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'bucketDCount', 'bucketSCount', 'balanceScore']
              : ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'bucketDCount', 'balanceScore']
          }
        },
        required: isStore
          ? ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'bucketS', 'statistics']
          : ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'statistics']
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

      let buckets: KeywordBuckets | StoreKeywordBuckets
      try {
        buckets = JSON.parse(jsonMatch[0])
      } catch (parseError) {
        console.error('❌ JSON解析失败:', parseError)
        console.error('   原始响应:', aiResponse.text.slice(0, 500))
        const errorMessage = parseError instanceof Error ? parseError.message : '未知错误'
        throw new Error(`JSON解析失败: ${errorMessage}`)
      }

      // 🔥 2025-12-22 添加数据结构验证（支持4个桶）
      // 🆕 v4.16: 店铺链接支持5个桶
      if (isStore) {
        // 店铺链接：验证5个桶
        const storeBuckets = buckets as StoreKeywordBuckets
        if (!storeBuckets.bucketA || !storeBuckets.bucketB || !storeBuckets.bucketC || !storeBuckets.bucketD || !storeBuckets.bucketS) {
          console.error('❌ AI返回数据结构不完整(店铺):', buckets)
          throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D/S')
        }

        if (!Array.isArray(storeBuckets.bucketA.keywords) ||
            !Array.isArray(storeBuckets.bucketB.keywords) ||
            !Array.isArray(storeBuckets.bucketC.keywords) ||
            !Array.isArray(storeBuckets.bucketD.keywords) ||
            !Array.isArray(storeBuckets.bucketS.keywords)) {
          console.error('❌ AI返回的keywords不是数组(店铺):', buckets)
          throw new Error('AI返回的keywords不是数组')
        }

        // 🔧 2026-01-11: 兜底修复 - 避免关键词全部落入桶S导致后续桶A-D无词
        // 先尝试从桶S/原始关键词中恢复 A/B/C/D 的基础分布，再应用后处理规则。
        redistributeStoreBucketsFromS(storeBuckets, keywords)

        // 🔥 v4.18 新增：后处理规则修正错误分配（促销/型号/评价/地理）
        applyStoreBucketPostProcessing(storeBuckets)
        recalculateStoreBucketStatistics(storeBuckets)

        // 验证店铺结果（只告警，不阻断创意生成）
        validateStoreBuckets(storeBuckets, keywords)

        console.log(`✅ AI 聚类完成 (店铺 5桶):`)
        console.log(`   桶A [品牌信任]: ${storeBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [场景解决]: ${storeBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [精选推荐]: ${storeBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [信任信号]: ${storeBuckets.bucketD.keywords.length} 个`)
        console.log(`   桶S [店铺全景]: ${storeBuckets.bucketS.keywords.length} 个`)
        console.log(`   均衡度得分: ${storeBuckets.statistics.balanceScore.toFixed(2)}`)
      } else {
        // 产品链接：验证4个桶
        const productBuckets = buckets as KeywordBuckets
        if (!productBuckets.bucketA || !productBuckets.bucketB || !productBuckets.bucketC || !productBuckets.bucketD) {
          console.error('❌ AI返回数据结构不完整(产品):', buckets)
          throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D')
        }

        if (!Array.isArray(productBuckets.bucketA.keywords) ||
            !Array.isArray(productBuckets.bucketB.keywords) ||
            !Array.isArray(productBuckets.bucketC.keywords) ||
            !Array.isArray(productBuckets.bucketD.keywords)) {
          console.error('❌ AI返回的keywords不是数组(产品):', buckets)
          throw new Error('AI返回的keywords不是数组')
        }

        // 验证产品结果
        validateBuckets(productBuckets, keywords)

        console.log(`✅ AI 聚类完成 (产品 4桶):`)
        console.log(`   桶A [产品型号]: ${productBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [购买意图]: ${productBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [功能特性]: ${productBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [紧迫促销]: ${productBuckets.bucketD.keywords.length} 个`)
        console.log(`   均衡度得分: ${productBuckets.statistics.balanceScore.toFixed(2)}`)
      }

      return buckets
    } catch (error: any) {
      lastError = error
      const isTimeout = error.message?.includes('timeout') || error.code === 'ECONNABORTED'
      const isRateLimited = error.response?.status === 429
      const isGatewayError = error.response?.status >= 500  // 🔧 2025-12-31: 5xx 网关错误（502, 504 等）

      if (retryCount < maxRetries && (isTimeout || isRateLimited || isGatewayError)) {
        // 🔥 2025-12-27 优化：添加随机抖动，避免重试风暴
        const baseDelayMs = baseDelay * Math.pow(2, retryCount)
        const jitter = Math.random() * 2000  // 0-2秒随机抖动
        const delay = Math.min(baseDelayMs + jitter, 60000)  // 最多60秒
        const errorInfo = error.response?.status
          ? `HTTP ${error.response.status} ${error.response.status === 504 ? '(Gateway Timeout)' : ''}`
          : error.message?.substring(0, 50)
        console.warn(`⚠️ AI 聚类第 ${retryCount + 1} 次失败 (${errorInfo})，${(delay / 1000).toFixed(1)}s 后重试...`)
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
 * 🆕 v4.16: 创建店铺链接空桶（5个桶）
 */
function createEmptyStoreBuckets(): StoreKeywordBuckets {
  return {
    bucketA: { intent: '品牌信任导向', intentEn: 'Brand-Trust', description: '用户认可品牌，寻求官方购买渠道', keywords: [] },
    bucketB: { intent: '场景解决导向', intentEn: 'Scene-Solution', description: '用户有具体使用场景需求', keywords: [] },
    bucketC: { intent: '精选推荐导向', intentEn: 'Collection-Highlight', description: '用户想了解店铺热销/推荐产品', keywords: [] },
    bucketD: { intent: '信任信号导向', intentEn: 'Trust-Signals', description: '用户关注店铺信誉、售后保障', keywords: [] },
    bucketS: { intent: '店铺全景导向', intentEn: 'Store-Overview', description: '用户想全面了解店铺', keywords: [] },
    statistics: { totalKeywords: 0, bucketACount: 0, bucketBCount: 0, bucketCCount: 0, bucketDCount: 0, bucketSCount: 0, balanceScore: 1.0 }
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

/**
 * 🆕 v4.16: 验证店铺桶结果（5个桶）
 * 🔥 2025-12-24: 添加均衡性检查，不均衡时抛出错误让上层重试
 */
function validateStoreBuckets(buckets: StoreKeywordBuckets, originalKeywords: string[]): void {
  if (!buckets) {
    throw new Error('店铺聚类结果为空')
  }

  const allBucketKeywords = [
    ...(buckets.bucketA?.keywords || []),
    ...(buckets.bucketB?.keywords || []),
    ...(buckets.bucketC?.keywords || []),
    ...(buckets.bucketD?.keywords || []),
    ...(buckets.bucketS?.keywords || [])
  ]

  // 检查是否有遗漏
  const missing = originalKeywords.filter(kw =>
    !allBucketKeywords.some(bkw => bkw.toLowerCase() === kw.toLowerCase())
  )

  if (missing.length > 0) {
    console.warn(`⚠️ 有 ${missing.length} 个店铺关键词未分配到桶中:`, missing.slice(0, 5))
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
    console.warn(`⚠️ 有 ${duplicates.length} 个店铺关键词重复分配:`, duplicates.slice(0, 5))
  }

  // 🔥 2025-12-24 新增：均衡性检查
  const counts = [
    buckets.bucketA?.keywords?.length || 0,
    buckets.bucketB?.keywords?.length || 0,
    buckets.bucketC?.keywords?.length || 0,
    buckets.bucketD?.keywords?.length || 0,
    buckets.bucketS?.keywords?.length || 0
  ]
  const nonZeroCounts = counts.filter(c => c > 0).length
  const maxCount = Math.max(...counts)
  const minCount = Math.min(...counts.filter(c => c > 0))

  // 计算均衡度：使用 AI 报告的 balanceScore 或手动计算
  const reportedBalanceScore = buckets.statistics?.balanceScore ?? calculateBalanceScore(counts)

  // 打印各桶分布情况，便于调试
  console.log(`   📊 店铺桶分布: A=${counts[0]}, B=${counts[1]}, C=${counts[2]}, D=${counts[3]}, S=${counts[4]}`)
  console.log(`   📊 有效桶数: ${nonZeroCounts}/5, 最大桶=${maxCount}, 最小非空桶=${minCount}`)
  console.log(`   📊 均衡度: ${reportedBalanceScore.toFixed(2)}`)

  // ⚠️ 2026-01-11: 店铺链接在小样本/概念型站点（如SaaS落地页）上，AI 可能倾向把词都放到桶S。
  // 这里不再直接抛错阻断创意生成，而是记录告警；上层会做兜底分桶/默认关键词降级。
  if (originalKeywords.length >= 8 && nonZeroCounts <= 1) {
    const warnMsg = `聚类结果不均衡: 只有 ${nonZeroCounts}/5 个桶有数据 (A=${counts[0]}, B=${counts[1]}, C=${counts[2]}, D=${counts[3]}, S=${counts[4]})`
    console.warn(`⚠️ ${warnMsg}`)
  }

  if (reportedBalanceScore < 0.2 && originalKeywords.length >= 20) {
    const warnMsg = `聚类均衡度偏低: ${reportedBalanceScore.toFixed(2)} < 0.2 (A=${counts[0]}, B=${counts[1]}, C=${counts[2]}, D=${counts[3]}, S=${counts[4]})`
    console.warn(`⚠️ ${warnMsg}`)
  }
}

/**
 * 🔥 2025-12-24: 计算均衡度
 */
function calculateBalanceScore(counts: number[]): number {
  if (counts.length === 0) return 1.0
  const total = counts.reduce((a, b) => a + b, 0)
  if (total === 0) return 1.0
  const avg = total / counts.length
  const maxDiff = Math.max(...counts.map(c => Math.abs(c - avg)))
  return Math.max(0, 1 - (maxDiff / total))
}

function normalizeKeywordsForBuckets(keywords: string[]): string[] {
  const unique = new Map<string, string>()
  for (const kw of keywords) {
    const trimmed = String(kw || '').trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (!unique.has(key)) unique.set(key, trimmed)
  }
  return Array.from(unique.values())
}

function recalculateStoreBucketStatistics(buckets: StoreKeywordBuckets): void {
  const counts = [
    buckets.bucketA?.keywords?.length || 0,
    buckets.bucketB?.keywords?.length || 0,
    buckets.bucketC?.keywords?.length || 0,
    buckets.bucketD?.keywords?.length || 0,
    buckets.bucketS?.keywords?.length || 0,
  ]

  const totalKeywords = counts.reduce((a, b) => a + b, 0)
  buckets.statistics.totalKeywords = totalKeywords
  buckets.statistics.bucketACount = counts[0]
  buckets.statistics.bucketBCount = counts[1]
  buckets.statistics.bucketCCount = counts[2]
  buckets.statistics.bucketDCount = counts[3]
  buckets.statistics.bucketSCount = counts[4]
  buckets.statistics.balanceScore = calculateBalanceScore(counts)
}

function redistributeStoreBucketsFromS(buckets: StoreKeywordBuckets, originalKeywords: string[]): void {
  const all = normalizeKeywordsForBuckets([
    ...originalKeywords,
    ...(buckets.bucketA?.keywords || []),
    ...(buckets.bucketB?.keywords || []),
    ...(buckets.bucketC?.keywords || []),
    ...(buckets.bucketD?.keywords || []),
    ...(buckets.bucketS?.keywords || []),
  ])

  if (all.length === 0) return

  const trustSignalsPattern =
    /\b(review|reviews|rating|ratings|testimonial|testimonials|feedback|support|customer\s*service|warranty|guarantee|refund|return|secure|security|privacy|trusted|trust)\b/i
  const sceneSolutionPattern =
    /\b(lonely|loneliness|wellness|mental|anxiety|stress|depression|therapy|support|growth|self[- ]?reflection|mindfulness|sleep|relationship|friendship)\b/i
  const collectionPattern =
    /\b(best|top|popular|recommended|recommendation|features?|feature|compare|comparison|vs|alternatives?|examples?|templates?|list)\b/i
  const brandTrustPattern =
    /\b(official|authorized|authentic|download|app|signup|sign[- ]?up|login|subscribe|subscription|plan|pricing)\b/i
  const productTypePattern =
    /\b(ai|chatbot|assistant|companion|virtual|friend|conversation)\b/i

  const assigned: Record<'A' | 'B' | 'C' | 'D', string[]> = { A: [], B: [], C: [], D: [] }

  for (const kw of all) {
    const lower = kw.toLowerCase()
    if (trustSignalsPattern.test(lower)) {
      assigned.D.push(kw)
    } else if (sceneSolutionPattern.test(lower)) {
      assigned.B.push(kw)
    } else if (collectionPattern.test(lower)) {
      assigned.C.push(kw)
    } else if (brandTrustPattern.test(lower)) {
      assigned.A.push(kw)
    } else if (productTypePattern.test(lower)) {
      assigned.C.push(kw)
    } else {
      assigned.B.push(kw)
    }
  }

  // 确保 A/B/C/D 至少各有 1 个（当关键词数足够时）
  const bucketOrder: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D']
  if (all.length >= 4) {
    for (const target of bucketOrder) {
      if (assigned[target].length > 0) continue

      let donor: 'A' | 'B' | 'C' | 'D' | null = null
      let donorSize = 0
      for (const candidate of bucketOrder) {
        if (candidate === target) continue
        if (assigned[candidate].length > donorSize) {
          donor = candidate
          donorSize = assigned[candidate].length
        }
      }
      if (!donor || donorSize === 0) continue

      const moved = assigned[donor].pop()
      if (moved) assigned[target].push(moved)
    }
  }

  buckets.bucketA.keywords = normalizeKeywordsForBuckets(assigned.A)
  buckets.bucketB.keywords = normalizeKeywordsForBuckets(assigned.B)
  buckets.bucketC.keywords = normalizeKeywordsForBuckets(assigned.C)
  buckets.bucketD.keywords = normalizeKeywordsForBuckets(assigned.D)
  buckets.bucketS.keywords = all
  recalculateStoreBucketStatistics(buckets)
}

/**
 * 🔥 v4.18 新增：店铺桶后处理规则
 *
 * 目的：修正 AI 聚类可能的错误分配，作为双重保障
 *
 * 规则：
 * 1. 促销/价格词 → 从其他桶移到桶S
 * 2. 具体型号词 → 从桶A/B/D移到桶C
 * 3. 评价词 → 从桶A/B/C移到桶D
 * 4. 地理位置词 → 从桶A/B移到桶S
 */
function applyStoreBucketPostProcessing(buckets: StoreKeywordBuckets): void {
  console.log(`\n🔧 应用后处理规则修正关键词分配...`)

  let totalMoved = 0
  const moves: Array<{keyword: string; from: string; to: string; reason: string}> = []

  // 定义匹配规则
  const PROMO_PRICE_PATTERNS = /\b(discount|sale|deal|coupon|promo|code|offer|clearance|price|cost|cheap|affordable|budget)\b/i
  const MODEL_PATTERNS = /\b(s\d+|q\d+|s7|s8|q5|q7|max|ultra|pro(?!\s*store))\b/i  // 排除 "pro store"
  const REVIEW_PATTERNS = /\b(review|rating|testimonial|feedback|comment|opinion)\b/i
  const GEO_PATTERNS = /\b(locations?|near\s+me|delivery|shipping|local|store\s+finder)\b/i

  // 辅助函数：移动关键词
  const moveKeyword = (
    keyword: string,
    fromBucket: { intent: string; keywords: string[] },
    toBucket: { intent: string; keywords: string[] },
    fromName: string,
    toName: string,
    reason: string
  ) => {
    const index = fromBucket.keywords.indexOf(keyword)
    if (index > -1) {
      fromBucket.keywords.splice(index, 1)
      toBucket.keywords.push(keyword)
      totalMoved++
      moves.push({ keyword, from: fromName, to: toName, reason })
    }
  }

  // 规则1：促销/价格词 → 桶S
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketS, '桶A', '桶S', '含促销/价格词')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketS, '桶B', '桶S', '含促销/价格词')
    }
  }
  for (const keyword of [...buckets.bucketC.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword) && !MODEL_PATTERNS.test(keyword)) {
      // 如果同时包含型号词，优先保留在桶C（如 "s8 price" 可以在桶C）
      moveKeyword(keyword, buckets.bucketC, buckets.bucketS, '桶C', '桶S', '含促销/价格词')
    }
  }
  for (const keyword of [...buckets.bucketD.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketD, buckets.bucketS, '桶D', '桶S', '含促销/价格词')
    }
  }

  // 规则2：具体型号词 → 桶C
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (MODEL_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketC, '桶A', '桶C', '含具体型号')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (MODEL_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketC, '桶B', '桶C', '含具体型号')
    }
  }
  for (const keyword of [...buckets.bucketD.keywords]) {
    if (MODEL_PATTERNS.test(keyword) && !REVIEW_PATTERNS.test(keyword)) {
      // 如果同时包含评价词，优先保留在桶D（如 "s8 review" 可以在桶D）
      moveKeyword(keyword, buckets.bucketD, buckets.bucketC, '桶D', '桶C', '含具体型号')
    }
  }
  for (const keyword of [...buckets.bucketS.keywords]) {
    if (MODEL_PATTERNS.test(keyword) && !PROMO_PRICE_PATTERNS.test(keyword)) {
      // 如果同时包含促销词，保留在桶S（如 "s8 discount" 保留在桶S）
      moveKeyword(keyword, buckets.bucketS, buckets.bucketC, '桶S', '桶C', '含具体型号')
    }
  }

  // 规则3：评价词 → 桶D
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (REVIEW_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketD, '桶A', '桶D', '含评价词')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (REVIEW_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketD, '桶B', '桶D', '含评价词')
    }
  }
  for (const keyword of [...buckets.bucketC.keywords]) {
    if (REVIEW_PATTERNS.test(keyword) && !MODEL_PATTERNS.test(keyword)) {
      // 如果同时包含型号词，保留在桶C（如 "s8 review" 可能在桶C，让它保留）
      moveKeyword(keyword, buckets.bucketC, buckets.bucketD, '桶C', '桶D', '含评价词')
    }
  }

  // 规则4：地理位置词 → 桶S
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (GEO_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketS, '桶A', '桶S', '含地理位置')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (GEO_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketS, '桶B', '桶S', '含地理位置')
    }
  }

  // 更新统计数据
  buckets.statistics.bucketACount = buckets.bucketA.keywords.length
  buckets.statistics.bucketBCount = buckets.bucketB.keywords.length
  buckets.statistics.bucketCCount = buckets.bucketC.keywords.length
  buckets.statistics.bucketDCount = buckets.bucketD.keywords.length
  buckets.statistics.bucketSCount = buckets.bucketS.keywords.length

  // 重新计算均衡度
  const counts = [
    buckets.statistics.bucketACount,
    buckets.statistics.bucketBCount,
    buckets.statistics.bucketCCount,
    buckets.statistics.bucketDCount,
    buckets.statistics.bucketSCount
  ]
  buckets.statistics.balanceScore = calculateBalanceScore(counts)

  // 输出日志
  if (totalMoved > 0) {
    console.log(`   ✅ 后处理完成：移动 ${totalMoved} 个关键词`)
    moves.slice(0, 10).forEach(m => {
      console.log(`      "${m.keyword}" (${m.from} → ${m.to}: ${m.reason})`)
    })
    if (moves.length > 10) {
      console.log(`      ... 共 ${moves.length} 个移动`)
    }
  } else {
    console.log(`   ✅ 后处理完成：无需调整（AI聚类已正确）`)
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
 * 🆕 v4.16: 支持店铺链接的5桶存储
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
  pageType: 'product' | 'store' = 'product',
  storeBuckets?: StoreKeywordBuckets  // 🆕 v4.16: 店铺桶数据（可选）
): Promise<OfferKeywordPool> {
  const db = await getDatabase()

  const brandKwJson = serializeJsonForDb(brandKeywords, db.type)
  const bucketAJson = serializeJsonForDb(buckets.bucketA.keywords, db.type)
  const bucketBJson = serializeJsonForDb(buckets.bucketB.keywords, db.type)
  const bucketCJson = serializeJsonForDb(buckets.bucketC.keywords, db.type)
  const bucketDJson = serializeJsonForDb(buckets.bucketD.keywords, db.type)

  // 🆕 v4.16: 店铺分桶JSON
  const storeBucketAJson = storeBuckets ? serializeJsonForDb(storeBuckets.bucketA.keywords, db.type) : '[]'
  const storeBucketBJson = storeBuckets ? serializeJsonForDb(storeBuckets.bucketB.keywords, db.type) : '[]'
  const storeBucketCJson = storeBuckets ? serializeJsonForDb(storeBuckets.bucketC.keywords, db.type) : '[]'
  const storeBucketDJson = storeBuckets ? serializeJsonForDb(storeBuckets.bucketD.keywords, db.type) : '[]'
  const storeBucketSJson = storeBuckets ? serializeJsonForDb(storeBuckets.bucketS.keywords, db.type) : '[]'

  const totalKeywords = brandKeywords.length + buckets.bucketA.keywords.length + buckets.bucketB.keywords.length + buckets.bucketC.keywords.length + buckets.bucketD.keywords.length

  // 检查是否已存在
  const existing = await db.queryOne<{ id: number }>(
    'SELECT id FROM offer_keyword_pools WHERE offer_id = ?',
    [offerId]
  )

  // 🆕 v4.16: 店铺分桶意图
  const storeBucketAIntent = storeBuckets?.bucketA.intent || '品牌信任导向'
  const storeBucketBIntent = storeBuckets?.bucketB.intent || '场景解决导向'
  const storeBucketCIntent = storeBuckets?.bucketC.intent || '精选推荐导向'
  const storeBucketDIntent = storeBuckets?.bucketD.intent || '信任信号导向'
  const storeBucketSIntent = storeBuckets?.bucketS.intent || '店铺全景导向'

  if (existing) {
    // 🆕 v4.16: 更新现有记录（包含店铺分桶）
    const updateFields = [
      'brand_keywords = ?',
      'bucket_a_keywords = ?',
      'bucket_b_keywords = ?',
      'bucket_c_keywords = ?',
      'bucket_d_keywords = ?',
      'bucket_a_intent = ?',
      'bucket_b_intent = ?',
      'bucket_c_intent = ?',
      'bucket_d_intent = ?',
      'total_keywords = ?',
      'clustering_model = ?',
      'clustering_prompt_version = ?',
      'balance_score = ?',
      'link_type = ?',
      'store_bucket_a_keywords = ?',
      'store_bucket_b_keywords = ?',
      'store_bucket_c_keywords = ?',
      'store_bucket_d_keywords = ?',
      'store_bucket_s_keywords = ?',
      'store_bucket_a_intent = ?',
      'store_bucket_b_intent = ?',
      'store_bucket_c_intent = ?',
      'store_bucket_d_intent = ?',
      'store_bucket_s_intent = ?',
      `updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}`
    ]

    const updateValues = [
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
      'gemini',  // model
      'v4.16',   // prompt version
      buckets.statistics.balanceScore,
      pageType,
      storeBucketAJson,
      storeBucketBJson,
      storeBucketCJson,
      storeBucketDJson,
      storeBucketSJson,
      storeBucketAIntent,
      storeBucketBIntent,
      storeBucketCIntent,
      storeBucketDIntent,
      storeBucketSIntent,
      offerId
    ]

    await db.exec(
      `UPDATE offer_keyword_pools SET ${updateFields.join(', ')} WHERE offer_id = ?`,
      updateValues
    )

    console.log(`✅ 关键词池已更新: Offer #${offerId} (${pageType}链接)`)
    return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
  }

  // 🆕 v4.16: 创建新记录（包含店铺分桶）
  const insertFields = [
    'offer_id', 'user_id',
    'brand_keywords',
    'bucket_a_keywords', 'bucket_b_keywords', 'bucket_c_keywords', 'bucket_d_keywords',
    'bucket_a_intent', 'bucket_b_intent', 'bucket_c_intent', 'bucket_d_intent',
    'total_keywords', 'clustering_model', 'clustering_prompt_version', 'balance_score',
    'link_type',
    'store_bucket_a_keywords', 'store_bucket_b_keywords', 'store_bucket_c_keywords', 'store_bucket_d_keywords', 'store_bucket_s_keywords',
    'store_bucket_a_intent', 'store_bucket_b_intent', 'store_bucket_c_intent', 'store_bucket_d_intent', 'store_bucket_s_intent'
  ]

  const insertValues = [
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
    'gemini',
    'v4.16',
    buckets.statistics.balanceScore,
    pageType,
    storeBucketAJson,
    storeBucketBJson,
    storeBucketCJson,
    storeBucketDJson,
    storeBucketSJson,
    storeBucketAIntent,
    storeBucketBIntent,
    storeBucketCIntent,
    storeBucketDIntent,
    storeBucketSIntent
  ]

  const placeholders = insertFields.map(() => '?').join(', ')

  const result = await db.exec(
    `INSERT INTO offer_keyword_pools (${insertFields.join(', ')}) VALUES (${placeholders})`,
    insertValues
  )

  console.log(`✅ 关键词池已创建: Offer #${offerId}, ID #${result.lastInsertRowid} (${pageType}链接, 店铺5桶: ${storeBuckets ? '是' : '否'})`)
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
 * 🆕 v4.16: 添加店铺分桶字段解析
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
  // 🔥 2025-12-24：添加店铺分桶字段
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
    // 🆕 v4.16: 店铺分桶字段
    storeBucketAKeywords: parseKeywordArray(row.store_bucket_a_keywords || '[]'),
    storeBucketBKeywords: parseKeywordArray(row.store_bucket_b_keywords || '[]'),
    storeBucketCKeywords: parseKeywordArray(row.store_bucket_c_keywords || '[]'),
    storeBucketDKeywords: parseKeywordArray(row.store_bucket_d_keywords || '[]'),
    storeBucketSKeywords: parseKeywordArray(row.store_bucket_s_keywords || '[]'),
    storeBucketAIntent: row.store_bucket_a_intent || '品牌信任导向',
    storeBucketBIntent: row.store_bucket_b_intent || '场景解决导向',
    storeBucketCIntent: row.store_bucket_c_intent || '精选推荐导向',
    storeBucketDIntent: row.store_bucket_d_intent || '信任信号导向',
    storeBucketSIntent: row.store_bucket_s_intent || '店铺全景导向',
    linkType: row.link_type || 'product',
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

  // 1.5 Marketplace场景：尽量补全“品牌官网”，用于Keyword Planner的站点过滤（best-effort）
  try {
    const { ensureOfferBrandOfficialSite } = await import('./offer-official-site')
    const official = await ensureOfferBrandOfficialSite({
      offerId: offer.id,
      userId,
      brand: offer.brand,
      targetCountry: offer.target_country,
      finalUrl: offer.final_url,
      url: offer.url,
      category: offer.category,
      productName: offer.product_name,
      extractionMetadata: offer.extraction_metadata,
    })

    if (official?.origin) {
      const existing = (() => {
        try {
          return offer.extraction_metadata ? JSON.parse(offer.extraction_metadata) : {}
        } catch {
          return {}
        }
      })()
      offer.extraction_metadata = JSON.stringify({ ...existing, brandOfficialSite: official })
      console.log(`🌐 已补全品牌官网(origin): ${official.origin}`)
    }
  } catch (e: any) {
    console.warn(`⚠️ 品牌官网补全失败（不影响关键词池生成）: ${e?.message || String(e)}`)
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

  // 2.5 🔧 修复(2025-12-24): 优化种子词过滤策略
  // 核心问题: 52→12个种子词过滤率太高，导致关键词扩展不足
  const beforeFilterCount = initialKeywords.length

  // 🆕 先提取长尾种子词中的有价值短语
  const extractedSeeds: PoolKeywordData[] = []
  for (const kw of initialKeywords) {
    const wordCount = kw.keyword.trim().split(/\s+/).length
    if (wordCount > 10) {
      // 从长尾词中提取2-4个单词的短语
      const words = kw.keyword.trim().split(/\s+/)
      const brand = offer.brand.toLowerCase()

      for (let i = 0; i < words.length - 1; i++) {
        for (let len = 2; len <= Math.min(4, words.length - i); len++) {
          const phrase = words.slice(i, i + len).join(' ')
          const phraseLower = phrase.toLowerCase()

          // 只提取包含品牌名的短语
          if (phraseLower.includes(brand)) {
            extractedSeeds.push({
              ...kw,
              keyword: phrase
            })
          }
        }
      }
    }
  }

  // 应用过滤条件
  initialKeywords = initialKeywords.filter(kw => {
    const keyword = kw.keyword.trim()
    const wordCount = keyword.split(/\s+/).length

    // 过滤条件1：长度限制（≤10个单词）
    if (wordCount > 10) {
      console.log(`   ⊗ 种子词长度过滤: "${keyword}" (${wordCount}个单词, 限制≤10)`)
      return false
    }

    // 过滤条件2：排除低质量词
    // 🔥 2025-12-24优化: 只过滤明确的低质量词，保留高转化词
    const invalidPatterns = [
      // 购买渠道（保留store/shop/amazon/ebay，因为这些是正常购买渠道）
      'near me', 'official',
      // 低转化查询类
      'history', 'tracker', 'locator', 'review', 'compare',
      // 过时年份
      '2023', '2022', '2021', 'black friday', 'prime day'
      // ✅ 保留: 'store', 'shop', 'amazon', 'ebay' - 店铺/销售渠道词
      // ✅ 保留: 'discount', 'sale', 'deal', 'code', 'coupon' - 高购买意图词
      // ✅ 保留: 'price', 'cost', 'cheap', 'affordable', 'budget' - 高转化词
      // ✅ 保留: '2024', '2025' - 当前年份
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

  // 合并提取的短语种子词（去重）
  const seenPhrases = new Set(initialKeywords.map(k => k.keyword.toLowerCase()))
  let addedCount = 0
  extractedSeeds.forEach(seed => {
    if (!seenPhrases.has(seed.keyword.toLowerCase())) {
      initialKeywords.push(seed)
      seenPhrases.add(seed.keyword.toLowerCase())
      addedCount++
    }
  })

  if (addedCount > 0) {
    console.log(`   ✅ 从长尾种子词中提取: ${addedCount} 个短语种子词`)
  }

  if (beforeFilterCount !== initialKeywords.length) {
    console.log(`📊 种子词质量过滤: ${beforeFilterCount} → ${initialKeywords.length}`)
  }

  // 3. 🆕 全量扩展（v2.0：根据认证类型分发）
  const { expandAllKeywords, filterKeywords } = await import('./keyword-pool-helpers')

  // 获取Google Ads凭证和认证类型（用于扩展）
  let customerId: string | undefined
  let refreshToken: string | undefined
  let accountId: number | undefined
  let clientId: string | undefined
  let clientSecret: string | undefined
  let developerToken: string | undefined
  let authType: 'oauth' | 'service_account' = 'oauth'

  try {
    const { getGoogleAdsConfig } = await import('./keyword-planner')
    const { getDatabase } = await import('./db')
    const db = await getDatabase()

    // 获取认证类型
    const auth = await getUserAuthType(userId)
    authType = auth.authType

    // 🔧 PostgreSQL兼容性修复: is_active/is_manager_account在PostgreSQL中是BOOLEAN类型
    const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
    const isManagerCondition = db.type === 'postgres' ? 'is_manager_account = false' : 'is_manager_account = 0'

    const adsAccount = await db.queryOne(`
      SELECT id, customer_id FROM google_ads_accounts
      WHERE user_id = ? AND ${isActiveCondition} AND status = 'ENABLED' AND ${isManagerCondition}
      ORDER BY created_at DESC LIMIT 1
    `, [userId]) as { id: number; customer_id: string } | undefined

    if (adsAccount) {
      const config = await getGoogleAdsConfig(userId)
      if (config) {
        customerId = adsAccount.customer_id
        refreshToken = config.refreshToken
        accountId = adsAccount.id
        clientId = config.clientId
        clientSecret = config.clientSecret
        developerToken = config.developerToken
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
    authType,           // 🔥 2025-12-29 新增：认证类型
    offer,              // 🔥 2025-12-29 新增：Offer信息（服务账号模式需要）
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
    offer.target_country,  // 🔧 修复(2025-12-17): 传递目标国家进行地理过滤
    offer.product_name
  )

  console.log(`📝 第一次过滤后关键词数: ${filteredKeywords.length}`)

  // 🆕 2025-12-27: 关键词质量过滤
  // 过滤品牌变体词（如 eurekaddl）和语义查询词（如 significato）
  const pageTypeForContextFilter = (offer.page_type as 'product' | 'store') || 'product'
  const qualityFiltered = filterKeywordQuality(filteredKeywords, {
    brandName: offer.brand,
    category: offer.category || undefined,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    // 过滤歧义品牌的无关主题（例如 rove beetle / rove concept）
    minContextTokenMatches: getMinContextTokenMatchesForKeywordQualityFilter({
      pageType: pageTypeForContextFilter
    }),
  })

  // 生成过滤报告
  const filterReport = generateFilterReport(filteredKeywords.length, qualityFiltered.removed)
  console.log(filterReport)

  // 使用过滤后的关键词
  const finalFilteredKeywords = qualityFiltered.filtered

  console.log(`📝 最终过滤后关键词数: ${finalFilteredKeywords.length}`)

  // 5. 分离纯品牌词和非品牌词
  const keywordStrings = finalFilteredKeywords.map(kw => kw.keyword)
  const { brandKeywords: brandKwStrings, nonBrandKeywords: nonBrandKwStrings } = separateBrandKeywords(keywordStrings, offer.brand)

  // 转换回 PoolKeywordData[]
  const brandKeywordsData = finalFilteredKeywords.filter(kw => brandKwStrings.includes(kw.keyword))
  const nonBrandKeywordsData = finalFilteredKeywords.filter(kw => nonBrandKwStrings.includes(kw.keyword))

  // 🆕 v4.16: 确定页面类型
  const pageType = (offer.page_type as 'product' | 'store') || 'product'
  console.log(`📊 页面类型: ${pageType}`)

  // 6. AI 语义聚类（传递国家和语言参数用于查询高购买意图词搜索量）
  // 🆕 v4.16: 传递 pageType 参数
  const buckets = await clusterKeywordsByIntent(
    nonBrandKwStrings,
    offer.brand,
    offer.category,
    userId,
    offer.target_country,  // 🔥 2025-12-23 新增：传递目标国家
    offer.target_language || 'en',  // 🔥 2025-12-23 新增：传递目标语言
    pageType  // 🆕 v4.16: 传递页面类型
  )

  // 🆕 v4.16: 根据页面类型处理不同的桶结构
  if (pageType === 'store') {
    // 店铺链接：处理5个桶
    const storeBuckets = buckets as StoreKeywordBuckets

    // 7. 将 PoolKeywordData 映射到桶中
    const storeBucketAData = storeBuckets.bucketA.keywords.map(kw =>
      nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
    )
    const storeBucketBData = storeBuckets.bucketB.keywords.map(kw =>
      nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
    )
    const storeBucketCData = storeBuckets.bucketC.keywords.map(kw =>
      nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
    )
    const storeBucketDData = storeBuckets.bucketD.keywords.map(kw =>
      nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
    )
    const storeBucketSData = storeBuckets.bucketS.keywords.map(kw =>
      nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
    )

    // 8. 保存到数据库（包含店铺分桶）
    const pool = await saveKeywordPoolWithData(
      offerId,
      userId,
      brandKeywordsData,
      {
        bucketA: { intent: storeBuckets.bucketA.intent, keywords: storeBucketAData },
        bucketB: { intent: storeBuckets.bucketB.intent, keywords: storeBucketBData },
        bucketC: { intent: storeBuckets.bucketC.intent, keywords: storeBucketCData },
        bucketD: { intent: storeBuckets.bucketD.intent, keywords: storeBucketDData },
        statistics: storeBuckets.statistics
      },
      pageType,  // 🆕 v4.16: 传递页面类型
      storeBuckets  // 🆕 v4.16: 传递店铺桶数据
    )

    return pool
  } else {
    // 产品链接：处理4个桶（原逻辑）
    const productBuckets = buckets as KeywordBuckets

    // 7. 将 PoolKeywordData 映射到桶中
    const bucketAData = productBuckets.bucketA.keywords.map(kw =>
      nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
    )
    const bucketBData = productBuckets.bucketB.keywords.map(kw =>
      nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
    )
    const bucketCData = productBuckets.bucketC.keywords.map(kw =>
      nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
    )
    const bucketDData = productBuckets.bucketD.keywords.map(kw =>
      nonBrandKeywordsData.find(k => k.keyword === kw) || { keyword: kw, searchVolume: 0, source: 'CLUSTERED', matchType: 'BROAD' as const }
    )

    // 8. 保存到数据库
    const pool = await saveKeywordPoolWithData(
      offerId,
      userId,
      brandKeywordsData,
      {
        bucketA: { intent: productBuckets.bucketA.intent, keywords: bucketAData },
        bucketB: { intent: productBuckets.bucketB.intent, keywords: bucketBData },
        bucketC: { intent: productBuckets.bucketC.intent, keywords: bucketCData },
        bucketD: { intent: productBuckets.bucketD.intent, keywords: bucketDData },
        statistics: productBuckets.statistics
      },
      pageType  // 🆕 v4.16: 传递页面类型
    )

    return pool
  }
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

  const addKeywordData = (kw: PoolKeywordData) => {
    const keyword = kw?.keyword?.trim()
    if (!keyword) return
    if (keywordMap.has(keyword)) return
    keywordMap.set(keyword, kw)
  }

  const addKeywordString = (keyword: string, source: string) => {
    const normalized = keyword?.trim()
    if (!normalized) return
    addKeywordData({
      keyword: normalized,
      searchVolume: 0,
      source,
      matchType: 'BROAD'
    })
  }

  const addKeywordsFromJson = (raw: unknown, source: string) => {
    if (raw == null) return

    let parsed: unknown = raw
    if (typeof raw === 'string') {
      if (raw.trim() === '') return
      try {
        parsed = JSON.parse(raw)
      } catch {
        return
      }
    }

    if (!Array.isArray(parsed)) return

    for (const item of parsed) {
      if (typeof item === 'string') {
        addKeywordString(item, source)
        continue
      }
      if (item && typeof item === 'object') {
        const keyword = (item as any).keyword || (item as any).text
        if (typeof keyword === 'string') {
          addKeywordData({
            keyword,
            searchVolume: Number((item as any).searchVolume || (item as any).volume || 0) || 0,
            competition: typeof (item as any).competition === 'string' ? (item as any).competition : undefined,
            competitionIndex: typeof (item as any).competitionIndex === 'number' ? (item as any).competitionIndex : undefined,
            lowTopPageBid: typeof (item as any).lowTopPageBid === 'number' ? (item as any).lowTopPageBid : undefined,
            highTopPageBid: typeof (item as any).highTopPageBid === 'number' ? (item as any).highTopPageBid : undefined,
            source,
            matchType: (item as any).matchType || 'BROAD'
          })
        }
      }
    }
  }

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
    const offer = await db.queryOne<{
      ai_keywords: string | null
      extracted_keywords: string | null
      brand: string | null
      category: string | null
      product_name: string | null
      product_highlights: string | null
      unique_selling_points: string | null
      scraped_data: string | null
      page_type: string | null
    }>(
      `SELECT
        ai_keywords,
        extracted_keywords,
        brand,
        category,
        product_name,
        product_highlights,
        unique_selling_points,
        scraped_data,
        page_type
      FROM offers
      WHERE id = ? AND user_id = ?`,
      [offerId, userId]
    )

    // 先解析 ai_keywords；如果为空数组，再尝试 extracted_keywords
    addKeywordsFromJson(offer?.ai_keywords, 'OFFER_AI_KEYWORDS')
    addKeywordsFromJson(offer?.extracted_keywords, 'OFFER_EXTRACTED_KEYWORDS')

    // 兜底：某些页面类型（尤其店铺页/抓取降级）可能出现 ai_keywords='[]' 且 extracted_keywords=NULL
    // 这种情况下用“真实已抓取”的结构化字段构建最小种子词，避免整个创意生成流程被阻断。
    if (keywordMap.size === 0 && offer?.brand) {
      console.warn(`[extractKeywordsFromOffer] Offer #${offerId} 无AI/提取关键词，使用兜底种子词生成 (pageType=${offer.page_type || 'unknown'})`)

      // 1) 品牌词（保证至少有一个关键词）
      addKeywordString(offer.brand, 'FALLBACK_BRAND')

      // 2) 产品名 / 品类（来自抓取结果）
      if (offer.product_name && offer.product_name !== offer.brand) {
        addKeywordString(`${offer.brand} ${offer.product_name}`.slice(0, 80), 'FALLBACK_PRODUCT_NAME')
      }
      if (offer.category) {
        addKeywordString(`${offer.brand} ${offer.category}`.slice(0, 80), 'FALLBACK_CATEGORY')
      }

      // 3) 尝试复用统一关键词服务的“意图感知种子词”构建逻辑（仅在兜底路径加载）
      try {
        const { buildIntentAwareSeedPool } = await import('./unified-keyword-service')
        const seedPool = buildIntentAwareSeedPool({
          brand: offer.brand,
          category: offer.category,
          productTitle: offer.product_name || undefined,
          productFeatures: offer.product_highlights || offer.unique_selling_points || undefined,
          scrapedData: offer.scraped_data || undefined
        })

        seedPool.allSeeds
          .slice(0, 50)
          .forEach(seed => addKeywordString(seed, 'FALLBACK_INTENT_SEEDS'))
      } catch (seedError: any) {
        console.warn(`[extractKeywordsFromOffer] 兜底种子词构建失败: ${seedError?.message || seedError}`)
      }
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
        // ✅ KISS优化：B桶 = 场景 + 功能（合并B+C为一个创意类型，减少用户可见创意数量）
        keywords: [...pool.brandKeywords, ...pool.bucketBKeywords, ...pool.bucketCKeywords],
        intent: '场景+功能',
        intentEn: 'Scenario + Feature'
      }
    case 'C':
      return {
        // 🔧 向后兼容：旧版C桶在KISS-3类型方案中等价于B桶（场景+功能合并）
        keywords: [...pool.brandKeywords, ...pool.bucketBKeywords, ...pool.bucketCKeywords],
        intent: '场景+功能',
        intentEn: 'Scenario + Feature'
      }
    case 'S':
      // 🔧 向后兼容：旧版S桶在KISS-3类型方案中等价于D桶（转化/价值导向）
      return {
        keywords: [...pool.brandKeywords, ...pool.bucketDKeywords],
        intent: pool.bucketDIntent || '转化/价值',
        intentEn: 'Value / Deal'
      }
    case 'D':
      // ✅ KISS优化：D桶 = 转化/价值导向
      // 若D桶关键词不足，少量补充B/C高意图词，避免“D桶为空导致创意贫瘠”
      {
        const base = [...pool.brandKeywords, ...pool.bucketDKeywords]
        const needsSupplement = pool.bucketDKeywords.length < 8
        const supplement = needsSupplement
          ? [...pool.bucketBKeywords, ...pool.bucketCKeywords].slice(0, 20)
          : []
        return {
          keywords: [...base, ...supplement],
          intent: pool.bucketDIntent || '转化/价值',
          intentEn: 'Value / Deal'
        }
      }
    default:
      throw new Error(`Invalid bucket type: ${bucket}`)
  }
}

/**
 * KISS-3类型：将历史bucket映射到仅3个“用户可见创意类型”
 * - A -> A
 * - B/C -> B（场景+功能）
 * - D/S -> D（转化/价值）
 */
function mapBucketToKissType(bucket: BucketType): 'A' | 'B' | 'D' {
  if (bucket === 'A') return 'A'
  if (bucket === 'B' || bucket === 'C') return 'B'
  return 'D' // D 或 S
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
      // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，跳过过滤
      const hasAnyVolume = nonBrandWithVolume.some(kw => kw.searchVolume > 0)
      if (hasAnyVolume) {
        nonBrandWithVolume = nonBrandWithVolume.filter(
          kw => kw.searchVolume >= config.minSearchVolume
        )
        console.log(`   获取搜索量成功，过滤后剩余: ${nonBrandWithVolume.length}个`)
      } else {
        console.log(`   ⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤`)
      }
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
  // ✅ KISS-3类型方案中不再生成综合创意（S桶）
  // 旧逻辑保留签名，避免历史引用导致运行时崩溃
  void offerId
  return false
}

/**
 * 获取可用的桶（未被占用的）
 *
 * @param offerId - Offer ID
 * @returns 可用桶列表
 */
export async function getAvailableBuckets(offerId: number): Promise<BucketType[]> {
  const db = await getDatabase()

  // 🔧 修复(2025-01-02): 只查询未删除的创意，排除软删除的创意
  const usedBuckets = await db.query<{ keyword_bucket: string }>(
    `SELECT DISTINCT keyword_bucket FROM ad_creatives
     WHERE offer_id = ? AND keyword_bucket IS NOT NULL AND deleted_at IS NULL`,
    [offerId]
  )

  // ✅ KISS优化：仅暴露3个创意类型（A / B(含C) / D(含S)）
  const usedTypes = new Set(
    usedBuckets
      .map(b => b.keyword_bucket as BucketType)
      .filter(Boolean)
      .map(mapBucketToKissType)
  )

  const allTypes: BucketType[] = ['A', 'B', 'D']
  return allTypes.filter(t => !usedTypes.has(t as 'A' | 'B' | 'D'))
}

/**
 * 获取已使用的桶
 *
 * @param offerId - Offer ID
 * @returns 已使用桶列表
 */
export async function getUsedBuckets(offerId: number): Promise<BucketType[]> {
  const db = await getDatabase()

  // 🔧 修复(2025-01-02): 只查询未删除的创意，排除软删除的创意
  const usedBuckets = await db.query<{ keyword_bucket: string }>(
    `SELECT DISTINCT keyword_bucket FROM ad_creatives
     WHERE offer_id = ? AND keyword_bucket IS NOT NULL AND deleted_at IS NULL`,
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
  // ✅ KISS优化：最多3个创意类型（A / B(含C) / D(含S)）
  // 兼容历史数据：即使数据库中存在>3条旧创意，也不应阻塞新流程的类型判断
  const usedBuckets = await db.query<{ keyword_bucket: string }>(
    `SELECT DISTINCT keyword_bucket FROM ad_creatives
     WHERE offer_id = ? AND keyword_bucket IS NOT NULL AND deleted_at IS NULL`,
    [offerId]
  )

  const usedTypes = new Set(
    usedBuckets
      .map(b => b.keyword_bucket as BucketType)
      .filter(Boolean)
      .map(mapBucketToKissType)
  )

  return usedTypes.size >= 3
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
  // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，跳过过滤
  const hasAnyVolume = keywords.some(kw => kw.searchVolume > 0)
  if (hasAnyVolume) {
    keywords = keywords.filter(kw => kw.searchVolume >= minSearchVolume)
  } else {
    console.log('⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤')
  }

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

/**
 * 🆕 v4.16: 根据链接类型和创意桶获取关键词
 *
 * @param offerId - Offer ID
 * @param linkType - 链接类型 ('product' | 'store')
 * @param bucket - 创意桶类型 ('A' | 'B' | 'C' | 'D' | 'S')
 * @returns 关键词数组和意图描述
 */
export async function getKeywordsByLinkTypeAndBucket(
  offerId: number,
  linkType: 'product' | 'store',
  bucket: BucketType
): Promise<{ keywords: PoolKeywordData[]; intent: string; intentEn: string }> {
  const keywordPool = await getKeywordPoolByOfferId(offerId)

  if (!keywordPool) {
    console.warn(`[getKeywordsByLinkTypeAndBucket] 关键词池不存在: offerId=${offerId}`)
    return { keywords: [], intent: '', intentEn: '' }
  }

    // 根据链接类型选择对应的桶
  if (linkType === 'store') {
    // 店铺链接使用店铺分桶
    switch (bucket) {
      case 'A':
        return {
          keywords: keywordPool.storeBucketAKeywords,
          intent: keywordPool.storeBucketAIntent,
          intentEn: 'Brand-Trust'
        }
      case 'B':
        return {
          keywords: keywordPool.storeBucketBKeywords,
          intent: keywordPool.storeBucketBIntent,
          intentEn: 'Scene-Solution'
        }
      case 'C':
        return {
          keywords: keywordPool.storeBucketCKeywords,
          intent: keywordPool.storeBucketCIntent,
          intentEn: 'Collection-Highlight'
        }
      case 'D':
        return {
          keywords: keywordPool.storeBucketDKeywords,
          intent: keywordPool.storeBucketDIntent,
          intentEn: 'Trust-Signals'
        }
      case 'S':
        // S桶优先使用店铺全景桶（bucketS）的关键词；为空时回退为 A-D 的组合
        return {
          keywords: (keywordPool.storeBucketSKeywords && keywordPool.storeBucketSKeywords.length > 0)
            ? keywordPool.storeBucketSKeywords
            : [
              ...keywordPool.storeBucketAKeywords,
              ...keywordPool.storeBucketBKeywords,
              ...keywordPool.storeBucketCKeywords,
              ...keywordPool.storeBucketDKeywords
            ],
          intent: keywordPool.storeBucketSIntent,
          intentEn: 'Store-Overview'
        }
    }
  } else {
    // 单品链接使用产品分桶
    switch (bucket) {
      case 'A':
        return {
          keywords: keywordPool.bucketAKeywords,
          intent: keywordPool.bucketAIntent,
          intentEn: 'Product-Specific'
        }
      case 'B':
        return {
          keywords: keywordPool.bucketBKeywords,
          intent: keywordPool.bucketBIntent,
          intentEn: 'Purchase-Intent'
        }
      case 'C':
        return {
          keywords: keywordPool.bucketCKeywords,
          intent: keywordPool.bucketCIntent,
          intentEn: 'Feature-Focused'
        }
      case 'D':
        return {
          keywords: keywordPool.bucketDKeywords,
          intent: keywordPool.bucketDIntent,
          intentEn: 'Urgency-Promo'
        }
      case 'S':
        // S桶使用所有产品桶的关键词组合
        return {
          keywords: [
            ...keywordPool.bucketAKeywords,
            ...keywordPool.bucketBKeywords,
            ...keywordPool.bucketCKeywords,
            ...keywordPool.bucketDKeywords
          ],
          intent: '综合推广',
          intentEn: 'Comprehensive'
        }
    }
  }

  return { keywords: [], intent: '', intentEn: '' }
}
