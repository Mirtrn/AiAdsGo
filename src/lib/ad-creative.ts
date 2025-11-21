import { getDatabase } from './db'

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
  keywords: string[]            // 关键词列表
  callouts?: string[]           // 标注（每个最多25字符）
  sitelinks?: Array<{           // 站点链接
    text: string                // 链接文本（最多25字符）
    url: string                 // 链接URL
    description?: string        // 链接描述（最多35字符）
  }>

  // URL配置
  final_url: string
  final_url_suffix?: string

  // 评分信息
  score: number                 // 总评分 (0-100)
  score_breakdown: {
    relevance: number           // 相关性 (0-30)
    quality: number             // 质量 (0-25)
    engagement: number          // 吸引力 (0-25)
    diversity: number           // 多样性 (0-10)
    clarity: number             // 清晰度 (0-10)
  }
  score_explanation: string

  // 生成信息
  generation_round: number      // 第几轮生成
  theme: string                 // 广告主题
  ai_model: string             // 使用的AI模型
  is_selected: number          // 是否被用户选中

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
export interface GeneratedAdCreativeData {
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  callouts?: string[]
  sitelinks?: Array<{
    text: string
    url: string
    description?: string
  }>
  theme: string
  explanation: string           // 创意说明
}

/**
 * 创建广告创意记录
 */
export function createAdCreative(
  userId: number,
  offerId: number,
  data: GeneratedAdCreativeData & {
    final_url: string
    final_url_suffix?: string
    ai_model: string
    generation_round?: number
  }
): AdCreative {
  const db = getDatabase()

  // 计算评分
  const scoreResult = calculateAdCreativeScore(data, offerId)

  const result = db.prepare(`
    INSERT INTO ad_creatives (
      offer_id, user_id,
      headlines, descriptions, keywords, callouts, sitelinks,
      final_url, final_url_suffix,
      score, score_breakdown, score_explanation,
      generation_round, theme, ai_model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    offerId,
    userId,
    JSON.stringify(data.headlines),
    JSON.stringify(data.descriptions),
    JSON.stringify(data.keywords),
    data.callouts ? JSON.stringify(data.callouts) : null,
    data.sitelinks ? JSON.stringify(data.sitelinks) : null,
    data.final_url,
    data.final_url_suffix || null,
    scoreResult.total_score,
    JSON.stringify(scoreResult.breakdown),
    scoreResult.explanation,
    data.generation_round || 1,
    data.theme,
    data.ai_model
  )

  const creative = findAdCreativeById(result.lastInsertRowid as number, userId)
  if (!creative) {
    throw new Error('广告创意创建失败')
  }

  return creative
}

/**
 * 查找广告创意
 */
export function findAdCreativeById(id: number, userId: number): AdCreative | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT * FROM ad_creatives
    WHERE id = ? AND user_id = ?
  `).get(id, userId) as any

  if (!row) return null

  return parseAdCreativeRow(row)
}

/**
 * 获取Offer的所有广告创意
 */
export function listAdCreativesByOffer(
  offerId: number,
  userId: number,
  options?: {
    generation_round?: number
    is_selected?: boolean
  }
): AdCreative[] {
  const db = getDatabase()

  let whereConditions = ['offer_id = ?', 'user_id = ?']
  const params: any[] = [offerId, userId]

  if (options?.generation_round) {
    whereConditions.push('generation_round = ?')
    params.push(options.generation_round)
  }

  if (options?.is_selected !== undefined) {
    whereConditions.push('is_selected = ?')
    params.push(options.is_selected ? 1 : 0)
  }

  const rows = db.prepare(`
    SELECT * FROM ad_creatives
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY score DESC, created_at DESC
  `).all(...params) as any[]

  return rows.map(parseAdCreativeRow)
}

/**
 * 标记广告创意为已选中
 */
export function selectAdCreative(id: number, userId: number): void {
  const db = getDatabase()

  // 先取消该Offer的其他已选中创意
  const creative = findAdCreativeById(id, userId)
  if (!creative) {
    throw new Error('广告创意不存在')
  }

  db.prepare(`
    UPDATE ad_creatives
    SET is_selected = 0,
        updated_at = datetime('now')
    WHERE offer_id = ? AND user_id = ? AND is_selected = 1
  `).run(creative.offer_id, userId)

  // 标记当前创意为已选中
  db.prepare(`
    UPDATE ad_creatives
    SET is_selected = 1,
        updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(id, userId)
}

/**
 * 解析数据库行为AdCreative对象
 */
function parseAdCreativeRow(row: any): AdCreative {
  return {
    ...row,
    headlines: JSON.parse(row.headlines),
    descriptions: JSON.parse(row.descriptions),
    keywords: JSON.parse(row.keywords),
    callouts: row.callouts ? JSON.parse(row.callouts) : undefined,
    sitelinks: row.sitelinks ? JSON.parse(row.sitelinks) : undefined,
    score_breakdown: JSON.parse(row.score_breakdown),
  }
}

/**
 * 计算广告创意评分
 *
 * 评分维度：
 * 1. 相关性 (30分) - 与Offer产品的相关程度
 * 2. 质量 (25分) - Headlines和Descriptions的质量
 * 3. 吸引力 (25分) - 用户点击的吸引程度
 * 4. 多样性 (10分) - Headlines和Descriptions的多样性
 * 5. 清晰度 (10分) - 信息传达的清晰程度
 */
export function calculateAdCreativeScore(
  data: GeneratedAdCreativeData & { final_url: string },
  offerId: number
): {
  total_score: number
  breakdown: {
    relevance: number
    quality: number
    engagement: number
    diversity: number
    clarity: number
  }
  explanation: string
} {
  const db = getDatabase()

  // 获取Offer数据用于相关性评分
  const offer = db.prepare(`
    SELECT brand, category, brand_description, unique_selling_points,
           product_highlights, target_audience
    FROM offers WHERE id = ?
  `).get(offerId) as any

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
export function compareAdCreatives(creativeIds: number[], userId: number): {
  creatives: AdCreative[]
  comparison: {
    best_overall: number          // 综合得分最高的ID
    best_relevance: number        // 相关性最高的ID
    best_engagement: number       // 吸引力最高的ID
    recommendation: string        // 推荐说明
  }
} {
  const creatives = creativeIds
    .map(id => findAdCreativeById(id, userId))
    .filter(c => c !== null) as AdCreative[]

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
