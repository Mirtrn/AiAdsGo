import { getDatabase } from './db'
import { getInsertedId, nowFunc } from './db-helpers'
import { GEMINI_ACTIVE_MODEL } from './gemini-models'
import {
  getSearchTermAutoNegativeConfigFromEnv,
  getSearchTermAutoPositiveConfigFromEnv,
  runSearchTermAutoNegatives,
  runSearchTermAutoPositiveKeywords,
} from './search-term-auto-negatives'

/**
 * 关键词搜索量数据
 *
 * 🎯 数据来源说明：
 * - Historical Metrics API：精确匹配搜索量（优先使用）
 * - Keyword Ideas API：关键词发现的估算值（已用精确值校准）
 */
export interface KeywordWithVolume {
  keyword: string
  searchVolume: number // 精确搜索量（来自Historical Metrics API）
  competition?: string
  competitionIndex?: number
  source?: 'AI_GENERATED' | 'KEYWORD_EXPANSION' | 'MERGED' | 'KEYWORD_POOL' // 数据来源标记 (2026-01-19: 添加 KEYWORD_POOL)
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD' // 匹配类型（可选）
  volumeUnavailableReason?: 'SERVICE_ACCOUNT_UNSUPPORTED' | 'DEV_TOKEN_TEST_ONLY'
}

/**
 * 广告创意接口
 */
export interface AdCreative {
  id: number
  offer_id: number
  user_id: number

  // 广告创意内容
  headlines: string[]           // 最多15个headline，每个最多30字符
  descriptions: string[]        // 最多4个description，每个最多90字符
  keywords: string[]            // 关键词列表（向后兼容）
  keywordsWithVolume?: KeywordWithVolume[]  // 带搜索量的关键词数据
  negativeKeywords?: string[]   // 🎯 新增：否定关键词列表
  callouts?: string[]           // 标注（每个最多25字符）
  sitelinks?: Array<{           // 站点链接
    text: string                // 链接文本（最多25字符）
    url: string                 // 链接URL
    description?: string        // 链接描述（最多35字符）
  }>

  // URL配置
  final_url: string
  final_url_suffix?: string
  path_1?: string               // URL路径1
  path_2?: string               // URL路径2

  // 评分信息 (Ad Strength 7维度评分体系)
  score: number                      // 总评分 (0-100)
  score_breakdown: {
    relevance: number                // 相关性 (0-18)
    quality: number                  // 质量 (0-14)
    engagement: number               // 吸引力/完整性 (0-14)
    diversity: number                // 多样性 (0-18)
    clarity: number                  // 清晰度/合规性 (0-8)
    brandSearchVolume: number        // 品牌搜索量 (0-18)
    competitivePositioning: number   // 竞争定位 (0-10)
  }
  score_explanation: string

  // 生成信息
  version: number               // 版本号
  generation_round: number      // 第几轮生成
  generation_prompt?: string    // 生成提示词
  theme: string                 // 广告主题
  ai_model: string             // 使用的AI模型
  is_selected: number          // 是否被用户选中

  // Google Ads同步信息
  ad_group_id?: number         // 关联的Ad Group ID
  ad_id?: string               // Google Ads中的Ad ID
  creation_status: string      // 创建状态: draft/pending/synced/failed
  creation_error?: string      // 创建错误信息
  last_sync_at?: string        // 最后同步时间

  created_at: string
  updated_at: string
}

/**
 * 广告创意生成输入
 */
export interface GenerateAdCreativeInput {
  offer_id: number
  generation_round?: number     // 第几轮生成，默认1
  theme?: string                // 指定主题（可选）
  reference_performance?: {     // 参考历史表现数据（用于优化）
    best_headlines?: string[]
    best_descriptions?: string[]
    top_keywords?: string[]
  }
}

/**
 * 生成的广告创意数据（AI返回格式）
 */
// 资产标注接口（用于Ad Strength评估）
export interface HeadlineAsset {
  text: string
  type?: 'brand' | 'product' | 'promo' | 'cta' | 'urgency' | 'feature' | 'social_proof' | 'question' | 'emotional'  // 资产类型
  length?: number                                           // 字符长度
  keywords?: string[]                                       // 包含的关键词
  hasNumber?: boolean                                       // 是否包含数字
  hasUrgency?: boolean                                      // 是否体现紧迫感
  // 非破坏式扩展：仅用于意图分析与建议，不影响既有评分与发布逻辑
  intentTag?: 'brand' | 'scenario' | 'solution' | 'transactional' | 'other'
}

export interface DescriptionAsset {
  text: string
  type?: 'value' | 'cta' | 'feature-benefit-cta' | 'problem-solution-proof' | 'offer-urgency-trust' | 'usp-differentiation'  // 价值主张 或 行动召唤
  length?: number
  hasCTA?: boolean        // 是否包含CTA
  keywords?: string[]
  // 非破坏式扩展：仅用于意图分析与建议，不影响既有评分与发布逻辑
  intentTag?: 'brand' | 'scenario' | 'solution' | 'transactional' | 'other'
  structureTag?: 'pain_solution_cta' | 'benefit_cta' | 'trust_cta' | 'value_cta' | 'other'
}

export interface QualityMetrics {
  headline_diversity_score?: number  // 0-100
  keyword_relevance_score?: number   // 0-100
}

export interface GeneratedAdCreativeData {
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  keywordsWithVolume?: KeywordWithVolume[]  // 带搜索量的关键词
  negativeKeywords?: string[]               // 🎯 新增：否定关键词列表
  callouts?: string[]
  sitelinks?: Array<{
    text: string
    url: string
    description?: string
  }>
  theme: string
  explanation: string           // 创意说明
  ai_model?: string              // 🎯 新增：实际使用的AI模型

  // 🆕 v4.7: RSA Display Path (展示URL路径)
  path1?: string                // RSA Display URL路径1，最多15字符
  path2?: string                // RSA Display URL路径2，最多15字符

  // 新增：带标注的资产（可选，用于Ad Strength评估）
  headlinesWithMetadata?: HeadlineAsset[]
  descriptionsWithMetadata?: DescriptionAsset[]
  qualityMetrics?: QualityMetrics
  // Runtime-only metadata: returned via API/logs, not persisted in ad_creatives table
  keywordSupplementation?: {
    triggered: boolean
    beforeCount: number
    afterCount: number
    addedKeywords: Array<{ keyword: string; source: 'keyword_pool' | 'title_about' }>
    supplementCapApplied: boolean
  }
}

function parsePossiblyNestedJson(value: unknown, maxDepth = 2): unknown {
  let current = value

  for (let i = 0; i < maxDepth; i++) {
    if (typeof current !== 'string') break
    const trimmed = current.trim()
    if (!trimmed) return undefined

    try {
      current = JSON.parse(trimmed)
    } catch {
      return current
    }
  }

  return current
}

function ensureStringArray(value: unknown): string[] {
  const parsed = parsePossiblyNestedJson(value)
  if (!Array.isArray(parsed)) return []

  return parsed
    .map((item) => (typeof item === 'string' ? item : String(item ?? '')))
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function ensureJsonObject(value: unknown): Record<string, any> | undefined {
  const parsed = parsePossiblyNestedJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined
  }
  return parsed as Record<string, any>
}

function normalizeKeywordsWithVolume(
  value: unknown
): KeywordWithVolume[] | undefined {
  const parsed = parsePossiblyNestedJson(value)
  if (!Array.isArray(parsed)) return undefined

  const normalized: KeywordWithVolume[] = []

  for (const item of parsed) {
    if (typeof item === 'string') {
      const keyword = item.trim()
      if (!keyword) continue
      normalized.push({
        keyword,
        searchVolume: 0,
        source: 'AI_GENERATED',
      })
      continue
    }

    if (!item || typeof item !== 'object') continue

    const keyword = String((item as any).keyword ?? (item as any).text ?? '').trim()
    if (!keyword) continue

    const parsedSearchVolume = Number(
      (item as any).searchVolume ?? (item as any).search_volume ?? 0
    )
    const parsedCompetitionIndex = Number(
      (item as any).competitionIndex ?? (item as any).competition_index
    )

    const sourceRaw =
      typeof (item as any).source === 'string'
        ? (item as any).source.toUpperCase()
        : undefined
    const source =
      sourceRaw &&
      ['AI_GENERATED', 'KEYWORD_EXPANSION', 'MERGED', 'KEYWORD_POOL'].includes(
        sourceRaw
      )
        ? (sourceRaw as KeywordWithVolume['source'])
        : undefined

    const matchTypeRaw =
      typeof (item as any).matchType === 'string'
        ? (item as any).matchType.toUpperCase()
        : typeof (item as any).match_type === 'string'
          ? (item as any).match_type.toUpperCase()
          : undefined
    const matchType =
      matchTypeRaw && ['EXACT', 'PHRASE', 'BROAD'].includes(matchTypeRaw)
        ? (matchTypeRaw as KeywordWithVolume['matchType'])
        : undefined

    const volumeUnavailableReasonRaw =
      typeof (item as any).volumeUnavailableReason === 'string'
        ? (item as any).volumeUnavailableReason.toUpperCase()
        : undefined
    const volumeUnavailableReason =
      volumeUnavailableReasonRaw &&
      ['SERVICE_ACCOUNT_UNSUPPORTED', 'DEV_TOKEN_TEST_ONLY'].includes(
        volumeUnavailableReasonRaw
      )
        ? (volumeUnavailableReasonRaw as KeywordWithVolume['volumeUnavailableReason'])
        : undefined

    normalized.push({
      keyword,
      searchVolume: Number.isFinite(parsedSearchVolume) ? parsedSearchVolume : 0,
      competition:
        typeof (item as any).competition === 'string'
          ? (item as any).competition
          : undefined,
      competitionIndex: Number.isFinite(parsedCompetitionIndex)
        ? parsedCompetitionIndex
        : undefined,
      source,
      matchType,
      volumeUnavailableReason,
    })
  }

  return normalized.length > 0 ? normalized : undefined
}

/**
 * 创建广告创意记录
 */
export async function createAdCreative(
  userId: number,
  offerId: number,
  data: GeneratedAdCreativeData & {
    final_url: string
    final_url_suffix?: string
    ai_model?: string
    generation_round?: number
    // 新增：允许外部传入评分（Ad Strength 7维度评估结果）
    score?: number
    score_breakdown?: {
      relevance: number
      quality: number
      engagement: number
      diversity: number
      clarity: number
      brandSearchVolume: number
      competitivePositioning: number
    }
    // 🔧 新增：完整的 Ad Strength 评估数据（7维度）
    adStrength?: {
      rating: string
      score: number
      isExcellent?: boolean
      dimensions: any
      suggestions?: string[]
    }
    // 🆕 v4.10: 关键词池桶信息
    keyword_bucket?: 'A' | 'B' | 'C' | 'D' | 'S'  // A/B/C/D=关键词桶, S=综合创意
    keyword_pool_id?: number
    bucket_intent?: string
  }
): Promise<AdCreative> {
  const db = await getDatabase()

  const normalizedHeadlines = ensureStringArray(data.headlines)
  const normalizedDescriptions = ensureStringArray(data.descriptions)
  const normalizedKeywords = ensureStringArray(data.keywords)
  const normalizedKeywordsWithVolume = normalizeKeywordsWithVolume(
    data.keywordsWithVolume
  )
  const normalizedNegativeKeywords = ensureStringArray(data.negativeKeywords)
  const normalizedCallouts = normalizeCallouts(
    parsePossiblyNestedJson(data.callouts)
  )
  const normalizedSitelinks = normalizeSitelinks(
    parsePossiblyNestedJson(data.sitelinks),
    data.final_url
  )

  // 如果外部传入了score，优先使用（来自Ad Strength评估）
  // 否则使用旧的评分算法计算（向后兼容）
  const scoreResult = data.score && data.score_breakdown
    ? {
        total_score: data.score,
        breakdown: data.score_breakdown,
        explanation: data.explanation || '由Ad Strength评估系统生成'
      }
    : await calculateAdCreativeScore(data, offerId)

  const result = await db.exec(`
    INSERT INTO ad_creatives (
      offer_id, user_id,
      headlines, descriptions, keywords, keywords_with_volume, negative_keywords, callouts, sitelinks,
      final_url, final_url_suffix, path1, path2,
      score, score_breakdown, score_explanation,
      generation_round, theme, ai_model,
      ad_strength_data,
      keyword_bucket, keyword_pool_id, bucket_intent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    offerId,
    userId,
    JSON.stringify(normalizedHeadlines),
    JSON.stringify(normalizedDescriptions),
    JSON.stringify(normalizedKeywords),
    normalizedKeywordsWithVolume ? JSON.stringify(normalizedKeywordsWithVolume) : null,
    normalizedNegativeKeywords.length > 0 ? JSON.stringify(normalizedNegativeKeywords) : null,  // 🎯 新增：保存否定关键词
    normalizedCallouts ? JSON.stringify(normalizedCallouts) : null,
    normalizedSitelinks ? JSON.stringify(normalizedSitelinks) : null,
    data.final_url,
    data.final_url_suffix || null,
    data.path1 || null,  // 🆕 v4.7: RSA Display Path
    data.path2 || null,  // 🆕 v4.7: RSA Display Path
    scoreResult.total_score,
    JSON.stringify(scoreResult.breakdown),
    scoreResult.explanation,
    data.generation_round || 1,
    data.theme,
    data.ai_model || GEMINI_ACTIVE_MODEL,
    data.adStrength ? JSON.stringify(data.adStrength) : null,  // 🔧 保存完整的 Ad Strength 数据
    // 🆕 v4.10: 关键词池桶信息
    data.keyword_bucket || null,
    data.keyword_pool_id || null,
    data.bucket_intent || null
  ])

  const insertedId = getInsertedId(result, db.type)
  const creative = await findAdCreativeById(insertedId, userId)
  if (!creative) {
    throw new Error('广告创意创建失败')
  }

  // KISS自动动作：仅在“创意生成并保存”时触发
  // 失败不阻塞创意生成主流程
  const autoNegativeConfig = getSearchTermAutoNegativeConfigFromEnv()
  const autoPositiveConfig = getSearchTermAutoPositiveConfigFromEnv()

  if (autoNegativeConfig.enabled || autoPositiveConfig.enabled) {
    const cappedNegativeMaxPerUser = Math.min(autoNegativeConfig.maxPerUser, 5)
    const cappedPositiveMaxPerUser = Math.min(autoPositiveConfig.maxPerUser, 3)

    // 非阻塞执行，避免拉长创意生成接口时延
    void (async () => {
      if (autoNegativeConfig.enabled) {
        await runSearchTermAutoNegatives({
          userId,
          offerId,
          dryRun: false,
          lookbackDays: autoNegativeConfig.lookbackDays,
          minClicks: autoNegativeConfig.minClicks,
          minCost: autoNegativeConfig.minCost,
          maxPerAdGroup: autoNegativeConfig.maxPerAdGroup,
          maxPerUser: cappedNegativeMaxPerUser,
        })
      }

      if (autoPositiveConfig.enabled) {
        await runSearchTermAutoPositiveKeywords({
          userId,
          offerId,
          dryRun: false,
          lookbackDays: autoPositiveConfig.lookbackDays,
          minClicks: autoPositiveConfig.minClicks,
          minConversions: autoPositiveConfig.minConversions,
          maxPerAdGroup: autoPositiveConfig.maxPerAdGroup,
          maxPerUser: cappedPositiveMaxPerUser,
        })
      }
    })().catch((error) => {
      console.warn('[AdCreative] 自动关键词优化执行失败（忽略，不影响创意生成）:', error)
    })
  }

  return creative
}

/**
 * 查找广告创意
 */
export async function findAdCreativeById(id: number, userId: number): Promise<AdCreative | null> {
  const db = await getDatabase()
  const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'
  const row = await db.queryOne(`
    SELECT * FROM ad_creatives
    WHERE id = ? AND user_id = ? AND ${isDeletedCheck}
  `, [id, userId]) as any

  if (!row) return null

  return parseAdCreativeRow(row)
}

/**
 * 获取Offer的所有广告创意
 */
export async function listAdCreativesByOffer(
  offerId: number,
  userId: number,
  options?: {
    generation_round?: number
    is_selected?: boolean
  }
): Promise<AdCreative[]> {
  const db = await getDatabase()

  const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'
  let whereConditions = ['offer_id = ?', 'user_id = ?', isDeletedCheck]
  const params: any[] = [offerId, userId]

  if (options?.generation_round) {
    whereConditions.push('generation_round = ?')
    params.push(options.generation_round)
  }

  if (options?.is_selected !== undefined) {
    whereConditions.push('is_selected = ?')
    params.push(options.is_selected ? 1 : 0)
  }

  const rows = await db.query(`
    SELECT * FROM ad_creatives
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY score DESC, created_at DESC
  `, params) as any[]

  return rows.map(parseAdCreativeRow)
}

/**
 * 标记广告创意为已选中
 */
export async function selectAdCreative(id: number, userId: number): Promise<void> {
  const db = await getDatabase()

  // 先取消该Offer的其他已选中创意
  const creative = await findAdCreativeById(id, userId)
  if (!creative) {
    throw new Error('广告创意不存在')
  }

  // PostgreSQL 使用 BOOLEAN，SQLite 使用 INTEGER
  const isSelectedTrue = db.type === 'postgres' ? 'is_selected = true' : 'is_selected = 1'
  const isSelectedFalse = db.type === 'postgres' ? 'is_selected = false' : 'is_selected = 0'

  await db.exec(`
    UPDATE ad_creatives
    SET ${isSelectedFalse},
        updated_at = ${nowFunc(db.type)}
    WHERE offer_id = ? AND user_id = ? AND ${isSelectedTrue}
  `, [creative.offer_id, userId])

  // 标记当前创意为已选中
  await db.exec(`
    UPDATE ad_creatives
    SET ${isSelectedTrue},
        updated_at = ${nowFunc(db.type)}
    WHERE id = ? AND user_id = ?
  `, [id, userId])
}

function normalizeSitelinks(
  raw: any,
  fallbackUrl?: string
): Array<{ text: string; url: string; description?: string }> | undefined {
  if (!Array.isArray(raw)) return undefined

  const normalized = raw
    .map((link: any) => {
      if (!link) return null

      // 兼容：旧数据可能是 string 数组
      if (typeof link === 'string') {
        const text = link.trim().substring(0, 25)
        if (!text) return null
        const url = (fallbackUrl || '/').trim()
        return { text, url }
      }

      if (typeof link !== 'object') return null

      const textRaw =
        (typeof link.text === 'string' && link.text) ||
        (typeof link.title === 'string' && link.title) ||
        (typeof link.name === 'string' && link.name) ||
        ''
      const text = String(textRaw).trim().substring(0, 25)
      if (!text) return null

      const urlRaw =
        (typeof link.url === 'string' && link.url) ||
        (typeof link.href === 'string' && link.href) ||
        (typeof link.link === 'string' && link.link) ||
        fallbackUrl ||
        '/'
      const url = String(urlRaw).trim()
      if (!url) return null

      const descriptionCandidates = [
        link.description,
        link.desc,
        link.description1,
        link.description_1,
        link.description2,
        link.description_2,
        Array.isArray(link.descriptions) ? link.descriptions[0] : undefined,
      ]
      const description = descriptionCandidates.find(
        (v: any) => typeof v === 'string' && v.trim().length > 0
      ) as string | undefined

      return {
        text,
        url,
        description: description ? description.trim().substring(0, 35) : undefined,
      }
    })
    .filter((v: any): v is { text: string; url: string; description?: string } => v !== null)

  return normalized.length > 0 ? normalized : undefined
}

/**
 * 解析数据库行为AdCreative对象
 */
function parseAdCreativeRow(row: any): AdCreative {
  const parsedScoreBreakdown = ensureJsonObject(row.score_breakdown) || {}
  const parsedAdStrength = ensureJsonObject(row.ad_strength_data)

  return {
    ...row,
    headlines: ensureStringArray(row.headlines),
    descriptions: ensureStringArray(row.descriptions),
    keywords: ensureStringArray(row.keywords),
    keywordsWithVolume: normalizeKeywordsWithVolume(row.keywords_with_volume),
    negativeKeywords: ensureStringArray(row.negative_keywords),  // 🎯 新增：解析否定关键词
    callouts: normalizeCallouts(parsePossiblyNestedJson(row.callouts)),
    // 兼容：历史/AI不稳定输出可能产生 description1/description_1 等字段
    sitelinks: normalizeSitelinks(parsePossiblyNestedJson(row.sitelinks), row.final_url),
    score_breakdown: {
      relevance: Number(parsedScoreBreakdown.relevance || 0),
      quality: Number(parsedScoreBreakdown.quality || 0),
      engagement: Number(parsedScoreBreakdown.engagement || 0),
      diversity: Number(parsedScoreBreakdown.diversity || 0),
      clarity: Number(parsedScoreBreakdown.clarity || 0),
      brandSearchVolume: Number(parsedScoreBreakdown.brandSearchVolume || 0),
      competitivePositioning: Number(parsedScoreBreakdown.competitivePositioning || 0),
    },
    // 🔧 解析完整的 Ad Strength 评估数据（7维度）
    adStrength: parsedAdStrength,
  }
}

export function normalizeCallouts(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined

  const normalized = input
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        if ('text' in item) return String((item as any).text ?? '')
        if ('value' in item) return String((item as any).value ?? '')
        if ('name' in item) return String((item as any).name ?? '')
      }
      return String(item ?? '')
    })
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => v.substring(0, 25)) // Callout text max length

  return normalized.length > 0 ? normalized : undefined
}

/**
 * 计算广告创意评分
 *
 * @deprecated 该评分算法已废弃，请使用 evaluateCreativeAdStrength (Ad Strength评估系统)
 * @see evaluateCreativeAdStrength in @/lib/scoring
 *
 * 评分维度（旧版）：
 * 1. 相关性 (30分) - 与Offer产品的相关程度
 * 2. 质量 (25分) - Headlines和Descriptions的质量
 * 3. 吸引力 (25分) - 用户点击的吸引程度
 * 4. 多样性 (10分) - Headlines和Descriptions的多样性
 * 5. 清晰度 (10分) - 信息传达的清晰程度
 */
export async function calculateAdCreativeScore(
  data: GeneratedAdCreativeData & { final_url: string },
  offerId: number
): Promise<{
  total_score: number
  breakdown: {
    relevance: number
    quality: number
    engagement: number
    diversity: number
    clarity: number
  }
  explanation: string
}> {
  // 警告：旧评分算法已废弃
  console.warn('⚠️ calculateAdCreativeScore已废弃，建议使用Ad Strength评估系统 (evaluateCreativeAdStrength)')

  const db = await getDatabase()

  // 获取Offer数据用于相关性评分
  const offer = await db.queryOne(`
    SELECT brand, category, brand_description, unique_selling_points,
           product_highlights, target_audience
    FROM offers WHERE id = ?
  `, [offerId]) as any

  // 1. 相关性评分 (0-30分)
  let relevanceScore = 0
  const offerKeywords = [
    offer.brand,
    offer.category,
    ...(offer.unique_selling_points || '').split(/[,;、]/),
    ...(offer.product_highlights || '').split(/[,;、]/)
  ].filter(k => k && k.trim().length > 0)

  // 检查headlines和descriptions是否包含Offer关键信息
  const allCreativeText = [
    ...data.headlines,
    ...data.descriptions,
    ...data.keywords
  ].join(' ').toLowerCase()

  let matchCount = 0
  for (const keyword of offerKeywords) {
    if (keyword && allCreativeText.includes(keyword.toLowerCase().trim())) {
      matchCount++
    }
  }
  relevanceScore = Math.min(30, (matchCount / Math.max(offerKeywords.length, 1)) * 30)

  // 2. 质量评分 (0-25分)
  let qualityScore = 0

  // Headlines质量：长度适中（15-30字符）、包含数字或特殊符号、无重复
  const headlineQuality = data.headlines.reduce((sum, h) => {
    let score = 5
    const len = h.length
    if (len >= 15 && len <= 30) score += 2
    if (/\d/.test(h)) score += 1 // 包含数字
    if (/[%$￥€£!]/.test(h)) score += 1 // 包含特殊符号
    return sum + Math.min(score, 10)
  }, 0) / data.headlines.length

  // Descriptions质量：长度适中（60-90字符）、包含行动号召
  const descQuality = data.descriptions.reduce((sum, d) => {
    let score = 5
    const len = d.length
    if (len >= 60 && len <= 90) score += 3
    if (/立即|马上|现在|限时|免费|优惠|buy now|order|get/i.test(d)) score += 2
    return sum + Math.min(score, 10)
  }, 0) / data.descriptions.length

  qualityScore = (headlineQuality + descQuality) / 2 * 2.5 // 转换为25分制

  // 3. 吸引力评分 (0-25分)
  let engagementScore = 15 // 基础分

  // 使用问句或感叹号
  if (data.headlines.some(h => /[?？!！]/.test(h))) engagementScore += 3

  // 包含优惠相关词汇
  const promoWords = ['优惠', '折扣', '免费', '限时', 'sale', 'discount', 'free', 'limited']
  if (promoWords.some(w => allCreativeText.includes(w))) engagementScore += 3

  // 包含紧迫感词汇
  const urgencyWords = ['现在', '立即', '今日', '仅限', 'now', 'today', 'only']
  if (urgencyWords.some(w => allCreativeText.includes(w))) engagementScore += 4

  engagementScore = Math.min(25, engagementScore)

  // 4. 多样性评分 (0-10分)
  const uniqueHeadlines = new Set(data.headlines).size
  const uniqueDescriptions = new Set(data.descriptions).size
  const diversityScore = Math.min(10,
    (uniqueHeadlines / data.headlines.length) * 5 +
    (uniqueDescriptions / data.descriptions.length) * 5
  )

  // 5. 清晰度评分 (0-10分)
  let clarityScore = 10

  // Headlines过长扣分
  if (data.headlines.some(h => h.length > 30)) clarityScore -= 2

  // Descriptions过长扣分
  if (data.descriptions.some(d => d.length > 90)) clarityScore -= 2

  // 关键词过多扣分
  if (data.keywords.length > 20) clarityScore -= 2

  clarityScore = Math.max(0, clarityScore)

  // 计算总分
  const totalScore = Math.round(
    relevanceScore + qualityScore + engagementScore + diversityScore + clarityScore
  )

  // 生成评分说明
  const explanation = `
相关性 ${relevanceScore.toFixed(1)}/30: ${relevanceScore >= 24 ? '与产品高度相关' : relevanceScore >= 18 ? '相关性良好' : '相关性有待提升'}
质量 ${qualityScore.toFixed(1)}/25: ${qualityScore >= 20 ? '文案质量优秀' : qualityScore >= 15 ? '文案质量良好' : '文案质量需优化'}
吸引力 ${engagementScore.toFixed(1)}/25: ${engagementScore >= 20 ? '极具吸引力' : engagementScore >= 15 ? '有一定吸引力' : '吸引力不足'}
多样性 ${diversityScore.toFixed(1)}/10: ${diversityScore >= 8 ? '变化丰富' : diversityScore >= 6 ? '变化适中' : '变化较少'}
清晰度 ${clarityScore.toFixed(1)}/10: ${clarityScore >= 8 ? '表达清晰' : clarityScore >= 6 ? '表达尚可' : '表达不够清晰'}
  `.trim()

  return {
    total_score: totalScore,
    breakdown: {
      relevance: Math.round(relevanceScore * 10) / 10,
      quality: Math.round(qualityScore * 10) / 10,
      engagement: Math.round(engagementScore * 10) / 10,
      diversity: Math.round(diversityScore * 10) / 10,
      clarity: Math.round(clarityScore * 10) / 10,
    },
    explanation
  }
}

/**
 * 对比多个广告创意
 */
export async function compareAdCreatives(creativeIds: number[], userId: number): Promise<{
  creatives: AdCreative[]
  comparison: {
    best_overall: number          // 综合得分最高的ID
    best_relevance: number        // 相关性最高的ID
    best_engagement: number       // 吸引力最高的ID
    recommendation: string        // 推荐说明
  }
}> {
  const creativesResults = await Promise.all(
    creativeIds.map(id => findAdCreativeById(id, userId))
  )
  const creatives = creativesResults.filter(c => c !== null) as AdCreative[]

  if (creatives.length === 0) {
    throw new Error('未找到有效的广告创意')
  }

  // 找出各项最佳
  const bestOverall = creatives.reduce((best, current) =>
    current.score > best.score ? current : best
  )

  const bestRelevance = creatives.reduce((best, current) =>
    current.score_breakdown.relevance > best.score_breakdown.relevance ? current : best
  )

  const bestEngagement = creatives.reduce((best, current) =>
    current.score_breakdown.engagement > best.score_breakdown.engagement ? current : best
  )

  // 生成推荐
  let recommendation = `推荐选择创意#${bestOverall.id}（综合得分${bestOverall.score}分）。`

  if (bestOverall.id !== bestRelevance.id) {
    recommendation += `\n如果更注重相关性，可以考虑创意#${bestRelevance.id}（相关性${bestRelevance.score_breakdown.relevance}分）。`
  }

  if (bestOverall.id !== bestEngagement.id) {
    recommendation += `\n如果更注重吸引力，可以考虑创意#${bestEngagement.id}（吸引力${bestEngagement.score_breakdown.engagement}分）。`
  }

  return {
    creatives,
    comparison: {
      best_overall: bestOverall.id,
      best_relevance: bestRelevance.id,
      best_engagement: bestEngagement.id,
      recommendation
    }
  }
}

/**
 * 更新广告创意
 */
export async function updateAdCreative(
  id: number,
  userId: number,
  updates: Partial<{
    headlines: string[]
    descriptions: string[]
    keywords: string[]
    callouts: string[]
    path_1: string
    path_2: string
    final_url: string
    score: number
    ad_group_id: number
    ad_id: string
    creation_status: string
    creation_error: string
    last_sync_at: string
  }>
): Promise<AdCreative | null> {
  const db = await getDatabase()

  // 验证权限
  const creative = await findAdCreativeById(id, userId)
  if (!creative) {
    return null
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.headlines !== undefined) {
    fields.push('headlines = ?')
    values.push(JSON.stringify(updates.headlines))
  }
  if (updates.descriptions !== undefined) {
    fields.push('descriptions = ?')
    values.push(JSON.stringify(updates.descriptions))
  }
  if (updates.keywords !== undefined) {
    fields.push('keywords = ?')
    values.push(JSON.stringify(updates.keywords))
  }
  if (updates.callouts !== undefined) {
    fields.push('callouts = ?')
    values.push(JSON.stringify(updates.callouts))
  }
  if (updates.path_1 !== undefined) {
    fields.push('path_1 = ?')
    values.push(updates.path_1)
  }
  if (updates.path_2 !== undefined) {
    fields.push('path_2 = ?')
    values.push(updates.path_2)
  }
  if (updates.final_url !== undefined) {
    fields.push('final_url = ?')
    values.push(updates.final_url)
  }
  if (updates.score !== undefined) {
    fields.push('score = ?')
    values.push(updates.score)
  }
  if (updates.ad_group_id !== undefined) {
    fields.push('ad_group_id = ?')
    values.push(updates.ad_group_id)
  }
  if (updates.ad_id !== undefined) {
    fields.push('ad_id = ?')
    values.push(updates.ad_id)
  }
  if (updates.creation_status !== undefined) {
    fields.push('creation_status = ?')
    values.push(updates.creation_status)
  }
  if (updates.creation_error !== undefined) {
    fields.push('creation_error = ?')
    values.push(updates.creation_error)
  }
  if (updates.last_sync_at !== undefined) {
    fields.push('last_sync_at = ?')
    values.push(updates.last_sync_at)
  }

  if (fields.length === 0) {
    return creative
  }

  fields.push('updated_at = datetime(\'now\')')
  values.push(id, userId)

  await db.exec(`
    UPDATE ad_creatives
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `, values)

  return await findAdCreativeById(id, userId)
}

/**
 * 删除广告创意（软删除）
 *
 * 🔧 修改历史：
 * - 2025-12-29: 改为软删除，保留performance数据和创意历史
 */
export async function deleteAdCreative(id: number, userId: number): Promise<boolean> {
  const db = await getDatabase()

  const result = await db.exec(`
    UPDATE ad_creatives
    SET is_deleted = ${db.type === 'sqlite' ? '1' : 'TRUE'},
        deleted_at = ${db.type === 'sqlite' ? "datetime('now')" : 'NOW()'}
    WHERE id = ? AND user_id = ?
  `, [id, userId])

  return result.changes > 0
}

/**
 * 获取Offer的所有创意（兼容creatives.ts API）
 */
export async function findAdCreativesByOfferId(offerId: number, userId: number): Promise<AdCreative[]> {
  return await listAdCreativesByOffer(offerId, userId)
}

/**
 * 获取用户的所有创意（兼容creatives.ts API）
 */
export async function findAdCreativesByUserId(userId: number, limit?: number): Promise<AdCreative[]> {
  const db = await getDatabase()

  const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'
  let sql = `
    SELECT * FROM ad_creatives
    WHERE user_id = ? AND ${isDeletedCheck}
    ORDER BY created_at DESC
  `

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const rows = await db.query(sql, [userId]) as any[]
  return rows.map(parseAdCreativeRow)
}
