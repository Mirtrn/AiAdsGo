/**
 * 广告创意生成任务执行器
 *
 * 功能：
 * 1. 调用核心generateAdCreative函数
 * 2. 将进度更新到creative_tasks表
 * 3. 支持SSE实时推送（通过数据库轮询）
 */

import type { Task } from '../types'
import { applyKeywordSupplementationOnce, generateAdCreative } from '@/lib/ad-creative-gen'
import { createAdCreative } from '@/lib/ad-creative'
import {
  CREATIVE_BRAND_KEYWORD_RESERVE,
  CREATIVE_KEYWORD_MAX_COUNT,
  selectCreativeKeywords,
} from '@/lib/creative-keyword-selection'
import { findOfferById } from '@/lib/offers'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/json-field'
import { filterKeywordQuality } from '@/lib/keyword-quality-filter'
import { getMinContextTokenMatchesForKeywordQualityFilter } from '@/lib/keyword-context-filter'
import {
  AD_CREATIVE_MAX_AUTO_RETRIES,
  AD_CREATIVE_REQUIRED_MIN_SCORE,
  evaluateCreativeForQuality,
  runCreativeGenerationQualityLoop
} from '@/lib/ad-creative-quality-loop'
// 🆕 v4.10: 关键词池集成
import {
  getOrCreateKeywordPool,
  getAvailableBuckets,
  getBucketInfo,
  type BucketType,
  type OfferKeywordPool,
  type PoolKeywordData
} from '@/lib/offer-keyword-pool'

/**
 * 验证URL是否为有效的URL
 * 排除 null, undefined, "null", "null/" 等无效值
 */
function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return false
  if (url === 'null' || url === 'null/' || url === 'undefined') return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

function normalizeRequestedBucket(value: unknown): BucketType | null {
  const upper = String(value || '').trim().toUpperCase()
  if (!upper) return null
  if (upper === 'A') return 'A'
  if (upper === 'B' || upper === 'C') return 'B'
  if (upper === 'D' || upper === 'S') return 'D'
  return null
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function resolveOfferPageTypeForKeywordContext(offer: {
  page_type?: string | null
  scraped_data?: string | null
}): 'store' | 'product' {
  const explicit = String(offer.page_type || '').trim().toLowerCase()
  if (explicit === 'store') return 'store'
  if (explicit === 'product') return 'product'

  if (offer.scraped_data) {
    try {
      const parsed = JSON.parse(offer.scraped_data)
      const pageType = String((parsed as any)?.pageType || '').trim().toLowerCase()
      if (pageType === 'store' || pageType === 'product') return pageType

      const productsLen = Array.isArray((parsed as any)?.products) ? (parsed as any).products.length : 0
      const hasStoreName = typeof (parsed as any)?.storeName === 'string' && (parsed as any).storeName.trim().length > 0
      const hasDeep = Boolean((parsed as any)?.deepScrapeResults)
      if (hasStoreName || hasDeep || productsLen >= 2) return 'store'
    } catch {
      // Ignore invalid scraped_data JSON
    }
  }

  return 'product'
}

function extractCategorySignalsForKeywordContext(scrapedData: string | null | undefined): string[] {
  if (!scrapedData) return []

  try {
    const parsed = JSON.parse(scrapedData)
    if (!parsed || typeof parsed !== 'object') return []

    const candidates: string[] = []
    const push = (value: unknown) => {
      if (typeof value !== 'string') return
      const trimmed = value.trim()
      if (trimmed) candidates.push(trimmed)
    }

    push((parsed as any).productCategory)
    push((parsed as any).category)

    const primaryCategories = (parsed as any)?.productCategories?.primaryCategories
    if (Array.isArray(primaryCategories)) {
      for (const item of primaryCategories) {
        push(item?.name)
      }
    }

    const breadcrumbs = (parsed as any)?.breadcrumbs
    if (Array.isArray(breadcrumbs)) {
      for (const item of breadcrumbs) {
        push(item)
      }
    }

    return Array.from(new Set(candidates))
  } catch {
    return []
  }
}

function normalizeCreativeKeywordsWithVolume(
  keywordsWithVolume: any[],
  fallbackSource: string
): PoolKeywordData[] {
  return keywordsWithVolume
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const keyword = String((item as any).keyword || '').trim()
      if (!keyword) return null

      return {
        ...item,
        keyword,
        searchVolume: typeof (item as any).searchVolume === 'number'
          ? (item as any).searchVolume
          : Number((item as any).searchVolume) || 0,
        source: String((item as any).source || fallbackSource || 'KEYWORD_POOL').trim() || 'KEYWORD_POOL',
        matchType: ((item as any).matchType || 'PHRASE') as 'EXACT' | 'PHRASE' | 'BROAD',
      } as PoolKeywordData
    })
    .filter((item): item is PoolKeywordData => item !== null)
}

function filterCreativeKeywordsByOfferContext(params: {
  offer: {
    brand?: string | null
    category?: string | null
    product_name?: string | null
    target_country?: string | null
    target_language?: string | null
    final_url?: string | null
    url?: string | null
    page_type?: string | null
    scraped_data?: string | null
  }
  keywordsWithVolume: PoolKeywordData[]
  scopeLabel: string
}): PoolKeywordData[] {
  const { offer, keywordsWithVolume, scopeLabel } = params
  if (keywordsWithVolume.length === 0) return keywordsWithVolume

  const pageType = resolveOfferPageTypeForKeywordContext(offer)
  const minContextTokenMatches = getMinContextTokenMatchesForKeywordQualityFilter({ pageType })
  const categorySignals = extractCategorySignalsForKeywordContext(offer.scraped_data || null)
  const categoryContext = [offer.category, ...categorySignals]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ')

  const qualityFiltered = filterKeywordQuality(keywordsWithVolume, {
    brandName: offer.brand || '',
    category: categoryContext || undefined,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 5,
    mustContainBrand: false,
    minContextTokenMatches,
  })

  if (qualityFiltered.removed.length > 0) {
    const contextRemoved = qualityFiltered.removed.filter(item => item.reason.includes('与商品无关')).length
    console.log(
      `🧹 创意关键词过滤(${scopeLabel}): ${keywordsWithVolume.length} → ${qualityFiltered.filtered.length} ` +
      `(移除 ${qualityFiltered.removed.length}，其中上下文不相关 ${contextRemoved})`
    )
  }

  return qualityFiltered.filtered
}

/**
 * 广告创意生成任务数据接口
 */
export interface AdCreativeTaskData {
  offerId: number
  maxRetries?: number
  targetRating?: 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'POOR'
  synthetic?: boolean  // 🔧 向后兼容：旧版"综合创意"标记（KISS-3类型方案中不再生成S桶）
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S'
  // 🆕 多 AI Provider 支持：前端临时覆盖，优先级高于全局设置
  aiProvider?: 'gemini' | 'openai' | 'anthropic' | 'litellm' | 'aicodecat'
}

/**
 * 广告创意生成任务执行器
 */
export async function executeAdCreativeGeneration(
  task: Task<AdCreativeTaskData>
): Promise<any> {
  const {
    offerId,
    maxRetries = AD_CREATIVE_MAX_AUTO_RETRIES,
    targetRating = 'GOOD',
    synthetic = false,
    bucket,
    aiProvider,
  } = task.data
  const db = getDatabase()
  const effectiveMaxRetries = Math.max(
    0,
    Math.min(
      AD_CREATIVE_MAX_AUTO_RETRIES,
      Number.isFinite(Number(maxRetries)) ? Math.floor(Number(maxRetries)) : AD_CREATIVE_MAX_AUTO_RETRIES
    )
  )
  const enforcedTargetRating: AdCreativeTaskData['targetRating'] = 'GOOD'
  const requestedBucket = normalizeRequestedBucket(bucket)
  const creativeTaskHeartbeatMs = parsePositiveIntEnv(
    process.env.CREATIVE_TASK_HEARTBEAT_MS,
    15000
  )
  const creativeKeywordBrandOnly = parseBooleanEnv(
    process.env.CREATIVE_KEYWORD_BRAND_ONLY,
    false
  )

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const toDbJson = (value: any): any => toDbJsonObjectField(value, db.type, null)

  try {
    // 更新任务状态为运行中
    await db.exec(`
      UPDATE creative_tasks
      SET status = 'running',
          started_at = ${nowFunc},
          message = '开始生成广告创意',
          max_retries = ?
      WHERE id = ?
    `, [effectiveMaxRetries, task.id])

    console.log(`🚀 开始执行创意生成任务: ${task.id}`)

    // 验证Offer存在
    const offer = await findOfferById(offerId, task.userId)
    if (!offer) {
      throw new Error('Offer不存在或无权访问')
    }

    if (offer.scrape_status === 'failed') {
      throw new Error('Offer信息抓取失败，请重新抓取')
    }

    // 🆕 v4.10: 获取或创建关键词池（复用已有数据，避免重复AI调用）
    let keywordPool: OfferKeywordPool | null = null
    let selectedBucket: BucketType | null = null
    let bucketInfo: { keywords: PoolKeywordData[]; intent: string; intentEn: string } | null = null

    try {
      // 更新进度：准备关键词池
      await db.exec(`
        UPDATE creative_tasks
        SET stage = 'preparing', progress = 5, message = '正在准备关键词池...', updated_at = ${nowFunc}
        WHERE id = ?
      `, [task.id])

      type KeywordPoolProgressInfo = {
        phase?: 'seed-volume' | 'expand-round' | 'volume-batch' | 'service-step' | 'filter' | 'cluster' | 'save'
        message: string
        current?: number
        total?: number
      }

      const reportKeywordPoolProgress = (() => {
        let lastProgress = 5
        let lastMessage = ''
        let lastUpdateAt = 0
        const minIntervalMs = 800

        const computeProgress = (info: KeywordPoolProgressInfo): number => {
          const ratio = info.current && info.total ? info.current / info.total : undefined
          switch (info.phase) {
            case 'seed-volume':
              return 6
            case 'expand-round':
              return 6 + (ratio ? Math.floor(ratio * 2) : 0) // 6-8
            case 'volume-batch':
              return 7 + (ratio ? Math.floor(ratio * 2) : 0) // 7-9
            case 'service-step':
              return 6 + (ratio ? Math.floor(ratio * 2) : 0) // 6-8
            case 'filter':
            case 'cluster':
            case 'save':
              return 9
            default:
              return 6
          }
        }

        return async (info: KeywordPoolProgressInfo) => {
          const now = Date.now()
          if (now - lastUpdateAt < minIntervalMs && info.message === lastMessage) return

          const nextProgress = Math.min(
            9,
            Math.max(lastProgress, computeProgress(info))
          )
          lastProgress = nextProgress
          lastMessage = info.message
          lastUpdateAt = now

          const message = info.message.startsWith('关键词池')
            ? info.message
            : `关键词池：${info.message}`

          try {
            await db.exec(`
              UPDATE creative_tasks
              SET stage = 'preparing', progress = ?, message = ?, updated_at = ${nowFunc}
              WHERE id = ?
            `, [nextProgress, message, task.id])
          } catch (error: any) {
            console.warn(`⚠️ 关键词池进度更新失败: ${error?.message || String(error)}`)
          }
        }
      })()

      keywordPool = await getOrCreateKeywordPool(offerId, task.userId, false, reportKeywordPoolProgress)

      // 获取可用桶（未被占用的，已按KISS-3类型收敛）
      const availableBuckets = await getAvailableBuckets(offerId)

      if (availableBuckets.length > 0) {
        let preferred: BucketType | null = null

        if (requestedBucket) {
          if (!availableBuckets.includes(requestedBucket)) {
            throw new Error(
              `桶${requestedBucket}创意已存在或暂不可用。当前可用桶：${availableBuckets.join(', ') || '无'}`
            )
          }
          preferred = requestedBucket
        } else if (synthetic && availableBuckets.includes('D')) {
          // 旧 synthetic 请求优先生成 D（转化/价值导向）
          console.warn(`⚠️ 检测到旧版 synthetic=true，已映射为桶D（不再生成S桶）`)
          preferred = 'D'
        } else {
          preferred = availableBuckets[0]
        }

        if (!preferred) {
          throw new Error('未能确定可用的关键词桶')
        }

        selectedBucket = preferred
        bucketInfo = getBucketInfo(keywordPool, selectedBucket)
        console.log(`📦 使用关键词池桶 ${selectedBucket} (${bucketInfo.intent}): ${bucketInfo.keywords.length} 个关键词`)
      } else {
        // ✅ KISS-3类型：三类创意都已生成，拒绝继续生成（避免用户看到>3套创意）
        throw new Error('该Offer已生成全部3种创意类型（A/B/D），无需继续生成。请删除某个类型后再生成。')
      }
    } catch (poolError: any) {
      // 🔥 统一架构(2025-12-16): 关键词池是必需的，失败直接抛错
      console.error(`❌ 关键词池创建失败: ${poolError.message}`)
      throw new Error(`关键词池创建失败，无法生成创意: ${poolError.message}`)
    }

    if (String(targetRating || '').toUpperCase() !== String(enforcedTargetRating)) {
      console.warn(`⚠️ queue targetRating=${targetRating} 已忽略，统一使用 GOOD 阈值`)
    }
    if (effectiveMaxRetries < Number(maxRetries)) {
      console.log(`ℹ️ 已限制自动重试次数: ${maxRetries} → ${effectiveMaxRetries}`)
    }

    let usedKeywords: string[] = []
    const brandKeywords = offer.brand ? [offer.brand.toLowerCase()] : []
    const offerAny = offer as any

    const generationResult = await runCreativeGenerationQualityLoop<Awaited<ReturnType<typeof generateAdCreative>>>({
      maxRetries: effectiveMaxRetries,
      delayMs: 1000,
      generate: async ({ attempt, retryFailureType }) => {
        const attemptBaseProgress = 10 + (attempt - 1) * 25
        const bucketLabel = selectedBucket ? ` [桶${selectedBucket}]` : ''
        const generationMessageBase = `第${attempt}次生成${bucketLabel}: AI正在创作广告文案...`
        const generationStartedAt = Date.now()
        let generationHeartbeatTimer: NodeJS.Timeout | null = null
        const updateGenerationHeartbeat = async () => {
          const elapsedSeconds = Math.floor((Date.now() - generationStartedAt) / 1000)
          await db.exec(`
            UPDATE creative_tasks
            SET stage = 'generating', progress = ?, message = ?, current_attempt = ?, updated_at = ${nowFunc}
            WHERE id = ?
          `, [attemptBaseProgress, `${generationMessageBase} (${elapsedSeconds}s)`, attempt, task.id])
        }
        await updateGenerationHeartbeat()
        generationHeartbeatTimer = setInterval(() => {
          void updateGenerationHeartbeat().catch((heartbeatError: any) => {
            console.warn(`⚠️ 创意生成心跳更新失败: ${task.id}: ${heartbeatError?.message || heartbeatError}`)
          })
        }, creativeTaskHeartbeatMs)

        let creative: Awaited<ReturnType<typeof generateAdCreative>>
        try {
          creative = await generateAdCreative(
            offerId,
            task.userId,
            {
              skipCache: true,
              excludeKeywords: attempt > 1 ? usedKeywords : undefined,
              retryFailureType,
              keywordPool: keywordPool || undefined,
              bucket: selectedBucket || undefined,
              bucketKeywords: bucketInfo?.keywords.map(kw => typeof kw === 'string' ? kw : kw.keyword),
              bucketIntent: bucketInfo?.intent,
              bucketIntentEn: bucketInfo?.intentEn,
              deferKeywordSupplementation: Boolean(bucketInfo?.keywords && bucketInfo.keywords.length > 0),
              // 🆕 临时 AI Provider 覆盖（来自前端选择）
              aiProvider: aiProvider || undefined,
            }
          )
        } finally {
          if (generationHeartbeatTimer) {
            clearInterval(generationHeartbeatTimer)
            generationHeartbeatTimer = null
          }
        }

        const generatedKeywordsForExclusion: string[] = Array.isArray(creative.keywords)
          ? creative.keywords.slice()
          : []

        if (bucketInfo?.keywords && bucketInfo.keywords.length > 0) {
          const bucketKeywordsWithVolume = bucketInfo.keywords
            .map((kw: any) => {
              const keywordRaw = typeof kw === 'string' ? kw : kw?.keyword
              const keyword = typeof keywordRaw === 'string' ? keywordRaw.trim() : ''
              if (!keyword) return null

              if (typeof kw === 'string') {
                return {
                  keyword,
                  searchVolume: 0,
                  matchType: 'PHRASE' as const,
                  source: 'KEYWORD_POOL' as const
                }
              }

              return {
                keyword,
                searchVolume: typeof kw.searchVolume === 'number' ? kw.searchVolume : Number(kw.searchVolume) || 0,
                competition: kw.competition,
                competitionIndex: kw.competitionIndex,
                lowTopPageBid: kw.lowTopPageBid,
                highTopPageBid: kw.highTopPageBid,
                matchType: (kw.matchType as 'EXACT' | 'PHRASE' | 'BROAD' | undefined) || ('PHRASE' as const),
                source: 'KEYWORD_POOL' as const
              }
            })
            .filter((v): v is NonNullable<typeof v> => v !== null)
          creative.keywords = bucketKeywordsWithVolume.map((kw: any) => kw.keyword)
          creative.keywordsWithVolume = bucketKeywordsWithVolume
        }

        if (selectedBucket) {
          try {
            const poolCandidates = Array.isArray(bucketInfo?.keywords)
              ? bucketInfo.keywords
                .map((kw: any) => typeof kw === 'string' ? kw : kw?.keyword)
                .map((keyword: string) => String(keyword || '').trim())
                .filter(Boolean)
              : []
            const baseKeywordsWithVolume = Array.isArray(creative.keywordsWithVolume)
              ? creative.keywordsWithVolume
              : (creative.keywords || []).map((keyword: string) => ({
                keyword,
                searchVolume: 0,
                matchType: 'PHRASE' as const,
                source: 'AI_GENERATED' as const
              }))
            const supplemented = await applyKeywordSupplementationOnce({
              offer,
              userId: task.userId,
              brandName: offer.brand || 'Unknown',
              targetLanguage: offer.target_language || 'English',
              keywordsWithVolume: baseKeywordsWithVolume,
              poolCandidates,
            })
            creative.keywords = supplemented.keywords
            creative.keywordsWithVolume = supplemented.keywordsWithVolume
            creative.keywordSupplementation = supplemented.keywordSupplementation
          } catch (supplementError: any) {
            console.warn(`⚠️ 关键词补充失败（继续执行）: ${supplementError?.message || supplementError}`)
          }
        }

        const creativeKeywordCandidates = normalizeCreativeKeywordsWithVolume(
          Array.isArray(creative.keywordsWithVolume)
            ? creative.keywordsWithVolume
            : (creative.keywords || []).map((keyword: string) => ({
              keyword,
              searchVolume: 0,
              matchType: 'PHRASE' as const,
              source: 'AI_GENERATED' as const
            })),
          selectedBucket ? 'KEYWORD_POOL' : 'AI_GENERATED'
        )

        const contextFilteredCandidates = filterCreativeKeywordsByOfferContext({
          offer,
          keywordsWithVolume: creativeKeywordCandidates,
          scopeLabel: selectedBucket ? `桶${selectedBucket}` : '默认'
        })
        const keywordsForSelection = contextFilteredCandidates.length > 0
          ? contextFilteredCandidates
          : creativeKeywordCandidates
        if (creativeKeywordCandidates.length > 0 && contextFilteredCandidates.length === 0) {
          console.warn('⚠️ 创意关键词上下文过滤后为空，回退原候选关键词')
        }

        creative.keywordsWithVolume = keywordsForSelection as any
        creative.keywords = keywordsForSelection.map(item => item.keyword)

        const prioritizedKeywords = selectCreativeKeywords({
          keywords: creative.keywords,
          keywordsWithVolume: creative.keywordsWithVolume as any,
          brandName: offer.brand || '',
          bucket: (selectedBucket || null) as any,
          maxKeywords: CREATIVE_KEYWORD_MAX_COUNT,
          brandReserve: CREATIVE_BRAND_KEYWORD_RESERVE,
          minBrandKeywords: CREATIVE_BRAND_KEYWORD_RESERVE,
          brandOnly: creativeKeywordBrandOnly,
        })
        creative.keywords = prioritizedKeywords.keywords
        creative.keywordsWithVolume = prioritizedKeywords.keywordsWithVolume as any

        if (generatedKeywordsForExclusion.length > 0) {
          const nonBrandKeywords = generatedKeywordsForExclusion.filter(kw => {
            if (!kw || typeof kw !== 'string') return false
            const kwLower = kw.toLowerCase()
            return !brandKeywords.some(brand => kwLower.includes(brand) || brand.includes(kwLower))
          })
          usedKeywords = Array.from(new Set([...usedKeywords, ...nonBrandKeywords]))
        }

        return creative
      },
      evaluate: async (creative, { attempt }) => {
        const attemptBaseProgress = 10 + (attempt - 1) * 25
        const evaluationMessageBase = `第${attempt}次生成: 评估创意质量...`
        const evaluationStartedAt = Date.now()
        let evaluationHeartbeatTimer: NodeJS.Timeout | null = null
        const updateEvaluationHeartbeat = async () => {
          const elapsedSeconds = Math.floor((Date.now() - evaluationStartedAt) / 1000)
          await db.exec(`
            UPDATE creative_tasks
            SET stage = 'evaluating', progress = ?, message = ?, updated_at = ${nowFunc}
            WHERE id = ?
          `, [attemptBaseProgress + 10, `${evaluationMessageBase} (${elapsedSeconds}s)`, task.id])
        }
        await updateEvaluationHeartbeat()
        evaluationHeartbeatTimer = setInterval(() => {
          void updateEvaluationHeartbeat().catch((heartbeatError: any) => {
            console.warn(`⚠️ 创意评估心跳更新失败: ${task.id}: ${heartbeatError?.message || heartbeatError}`)
          })
        }, creativeTaskHeartbeatMs)

        try {
          const evaluation = await evaluateCreativeForQuality({
            creative,
            minimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
            adStrengthContext: {
              brandName: offer.brand,
              targetCountry: offer.target_country || 'US',
              targetLanguage: offer.target_language || 'en',
              userId: task.userId
            },
            ruleContext: {
              brandName: offer.brand,
              category: offer.category,
              productName: offer.product_name || offerAny.product_title || offerAny.name,
              productTitle: offerAny.product_title || offerAny.title,
              productDescription: offer.brand_description,
              uniqueSellingPoints: offer.unique_selling_points || offer.product_highlights,
              keywords: creative.keywords || [],
              targetLanguage: offer.target_language || 'en',
              bucket: selectedBucket || null
            }
          })

          await db.exec(`
            UPDATE creative_tasks
            SET progress = ?, message = ?, updated_at = ${nowFunc}
            WHERE id = ?
          `, [attemptBaseProgress + 18, `第${attempt}次生成: ${evaluation.adStrength.finalRating} (${evaluation.adStrength.finalScore}分)`, task.id])
          return evaluation
        } finally {
          if (evaluationHeartbeatTimer) {
            clearInterval(evaluationHeartbeatTimer)
            evaluationHeartbeatTimer = null
          }
        }
      }
    })

    const attempts = generationResult.attempts
    const bestCreative = generationResult.selectedCreative
    const selectedEvaluation = generationResult.selectedEvaluation
    const bestEvaluation = selectedEvaluation.adStrength
    const retryHistory = generationResult.history.map(item => ({
      attempt: item.attempt,
      rating: item.rating,
      score: item.score,
      suggestions: item.suggestions,
      failureType: item.failureType,
      reasons: item.reasons,
      passed: item.passed
    }))
    const qualityWarning = !selectedEvaluation.passed

    if (qualityWarning) {
      console.warn(`⚠️ 创意未达 GOOD 阈值，已保存最佳结果: ${bestEvaluation.finalRating} (${bestEvaluation.finalScore})`)
    }

    // 更新进度：保存中
    await db.exec(`
      UPDATE creative_tasks
      SET stage = 'saving', progress = 85, message = '正在保存创意到数据库...', updated_at = ${nowFunc}
      WHERE id = ?
    `, [task.id])

    // 保存到数据库（包含完整的7维度Ad Strength数据）
    const savedCreative = await createAdCreative(task.userId, offerId, {
      headlines: bestCreative.headlines,
      descriptions: bestCreative.descriptions,
      keywords: bestCreative.keywords,
      keywordsWithVolume: bestCreative.keywordsWithVolume,
      negativeKeywords: bestCreative.negativeKeywords,
      callouts: bestCreative.callouts,
      sitelinks: bestCreative.sitelinks,
      theme: bestCreative.theme,
      explanation: bestCreative.explanation,
      // 🔧 修复：使用isValidUrl验证final_url，避免"null/"字符串被当作有效URL
      // 确保 final_url 始终为 string 类型
      final_url: (() => {
        if (isValidUrl(offer.final_url)) return offer.final_url!
        if (isValidUrl(offer.url)) return offer.url!
        throw new Error('Offer缺少有效的URL（final_url和url均为无效值）')
      })(),
      final_url_suffix: offer.final_url_suffix || undefined,
      score: bestEvaluation.finalScore,
      score_breakdown: {
        relevance: bestEvaluation.localEvaluation.dimensions.relevance.score,
        quality: bestEvaluation.localEvaluation.dimensions.quality.score,
        engagement: bestEvaluation.localEvaluation.dimensions.completeness.score,
        diversity: bestEvaluation.localEvaluation.dimensions.diversity.score,
        clarity: bestEvaluation.localEvaluation.dimensions.compliance.score,
        // 🔧 修复：添加品牌搜索量和竞争定位维度
        brandSearchVolume: bestEvaluation.localEvaluation.dimensions.brandSearchVolume?.score || 0,
        competitivePositioning: bestEvaluation.localEvaluation.dimensions.competitivePositioning?.score || 0
      },
      generation_round: attempts,
      ai_model: bestCreative.ai_model,
      // 🔧 修复：传递完整的 adStrength 数据，确保刷新后雷达图显示正确
      adStrength: {
        rating: bestEvaluation.finalRating,
        score: bestEvaluation.finalScore,
        isExcellent: bestEvaluation.finalRating === 'EXCELLENT',
        dimensions: bestEvaluation.localEvaluation.dimensions,
        suggestions: bestEvaluation.combinedSuggestions
      },
      // 🆕 v4.10: 关键词桶信息
      keyword_bucket: selectedBucket || undefined,
      keyword_pool_id: keywordPool?.id || undefined,
      bucket_intent: bucketInfo?.intent || undefined
    })

    // 构建完整结果
    const finalResult = {
      success: true,
      creative: {
        id: savedCreative.id,
        headlines: bestCreative.headlines,
        descriptions: bestCreative.descriptions,
        keywords: bestCreative.keywords,
        keywordsWithVolume: bestCreative.keywordsWithVolume,
        negativeKeywords: bestCreative.negativeKeywords,
        callouts: bestCreative.callouts,
        sitelinks: bestCreative.sitelinks,
        theme: bestCreative.theme,
        explanation: bestCreative.explanation,
        headlinesWithMetadata: bestCreative.headlinesWithMetadata,
        descriptionsWithMetadata: bestCreative.descriptionsWithMetadata,
        qualityMetrics: bestCreative.qualityMetrics,
        keywordSupplementation: bestCreative.keywordSupplementation || null
      },
      adStrength: {
        rating: bestEvaluation.finalRating,
        score: bestEvaluation.finalScore,
        isExcellent: bestEvaluation.finalRating === 'EXCELLENT',
        dimensions: bestEvaluation.localEvaluation.dimensions,
        suggestions: bestEvaluation.combinedSuggestions
      },
      optimization: {
        attempts,
        targetRating: enforcedTargetRating,
        achieved: selectedEvaluation.passed,
        qualityGatePassed: selectedEvaluation.passed,
        history: retryHistory
      },
      offer: {
        id: offer.id,
        brand: offer.brand,
        url: offer.url,
        affiliateLink: offer.affiliate_link
      }
    }

    // 更新任务为完成状态（带质量警告标记）
    await db.exec(`
      UPDATE creative_tasks
      SET
        status = 'completed',
        stage = 'complete',
        progress = 100,
        message = ?,
        creative_id = ?,
        result = ?,
        optimization_history = ?,
        completed_at = ${nowFunc},
        updated_at = ${nowFunc}
      WHERE id = ?
    `, [
      qualityWarning
        ? `⚠️ 生成完成（质量${bestEvaluation.finalScore}分，建议优化）`
        : '✅ 生成完成',
      savedCreative.id,
      toDbJson(finalResult),
      toDbJson(retryHistory),
      task.id
    ])

    if (qualityWarning) {
      console.log(`⚠️ 创意生成任务完成（质量警告）: ${task.id} - ${bestEvaluation.finalScore}分`)
    } else {
      console.log(`✅ 创意生成任务完成: ${task.id}`)
    }

    return finalResult
  } catch (error: any) {
    console.error(`❌ 创意生成任务失败: ${task.id}:`, error.message)

    // 🔧 PostgreSQL兼容性：在catch块中也需要使用正确的NOW函数
    const nowFuncErr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    // 更新任务为失败状态
    await db.exec(`
      UPDATE creative_tasks
      SET
        status = 'failed',
        message = ?,
        error = ?,
        completed_at = ${nowFuncErr},
        updated_at = ${nowFuncErr}
      WHERE id = ?
    `, [
      error.message,
      toDbJson({ message: error.message, stack: error.stack }),
      task.id
    ])

    throw error
  }
}
