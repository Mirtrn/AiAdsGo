import { getDatabase } from './db'
import { generateOfferName, getTargetLanguage, isOfferNameUnique } from './offer-utils'
import { generatePricingJSON, initializePromotionsJSON, initializeScrapedDataJSON } from './pricing-utils'

export interface Offer {
  id: number
  user_id: number
  url: string
  brand: string
  product_name: string | null  // 产品名称（数据库字段，之前遗漏）
  category: string | null
  target_country: string
  target_language: string | null
  offer_name: string | null
  affiliate_link: string | null
  brand_description: string | null
  unique_selling_points: string | null
  product_highlights: string | null
  target_audience: string | null
  // Final URL字段：存储解析后的最终落地页URL
  final_url: string | null
  final_url_suffix: string | null
  // 需求28：产品价格和佣金比例
  product_price: string | null
  commission_payout: string | null
  scrape_status: string
  scrape_error: string | null
  scraped_at: string | null
  // 注意：PostgreSQL 返回 boolean，SQLite 返回 number (0/1)
  is_active: number | boolean
  industry_code: string | null  // 行业代码（数据库字段，之前遗漏）
  // P0优化: 分析结果字段
  review_analysis: string | null
  competitor_analysis: string | null
  visual_analysis: string | null
  // 需求34: 广告元素提取结果字段
  extracted_keywords: string | null
  extracted_headlines: string | null
  extracted_descriptions: string | null
  extraction_metadata: string | null
  extracted_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null  // 软删除时间戳（数据库字段，之前遗漏）
  is_deleted: number  // 软删除标记（数据库字段，之前遗漏）
  // 增强数据字段（JSON格式存储）
  // ❌ 已删除冗余字段（2025-12-04）: pricing (与scraped_data重复)
  promotions: string | null  // 促销信息JSON
  scraped_data: string | null  // 原始爬虫数据（包含discount, salesRank, badge, reviews等所有字段）
  // 🎯 AI分析结果字段（数据库同步）
  ai_keywords: string | null  // AI生成的关键词JSON（从competitor_analysis等提取）
  ai_reviews: string | null  // AI分析的评论总结
  ai_competitive_edges: string | null  // AI分析的竞争优势
  ai_analysis_v32: string | null  // 新版AI分析结果JSON（v3.2架构）
  page_type: string | null  // 页面类型：'product' | 'store'
  // P1-11: 关联的Google Ads账号信息（运行时计算字段，非数据库字段）
  // 🔧 修复(2025-12-11): snake_case → camelCase
  linked_accounts?: Array<{
    accountId: number
    accountName: string | null
    customerId: string
    campaignCount: number
  }>
}

export interface CreateOfferInput {
  url: string
  brand?: string // 可选，抓取时自动提取
  category?: string
  target_country: string
  target_language?: string // 目标语言（如English, Spanish等）
  affiliate_link?: string
  brand_description?: string
  unique_selling_points?: string
  product_highlights?: string
  target_audience?: string
  // Final URL字段：存储解析后的最终落地页URL
  final_url?: string
  final_url_suffix?: string
  // 需求28：产品价格和佣金比例（可选）
  product_price?: string
  commission_payout?: string
  // 🔥 2025-12-16修复：添加product_name字段
  product_name?: string
  // AI分析结果字段（JSON字符串格式）
  review_analysis?: string
  competitor_analysis?: string
  extracted_keywords?: string
  extracted_headlines?: string
  extracted_descriptions?: string
  extraction_metadata?: string
  // 🔥 页面类型标识（店铺/单品）
  page_type?: 'store' | 'product'
}

export interface UpdateOfferInput {
  url?: string
  brand?: string
  category?: string
  target_country?: string
  affiliate_link?: string
  brand_description?: string
  unique_selling_points?: string
  product_highlights?: string
  target_audience?: string
  // Final URL字段：存储解析后的最终落地页URL
  final_url?: string
  final_url_suffix?: string
  is_active?: boolean
  // AI分析结果字段
  competitor_analysis?: string
  review_analysis?: string
  extracted_keywords?: string
  extracted_headlines?: string
  extracted_descriptions?: string
  // P0/P1/P2/P3优化：增强提取字段
  enhanced_keywords?: string
  enhanced_product_info?: string
  enhanced_review_analysis?: string
  extraction_quality_score?: number
  extraction_enhanced_at?: string
  enhanced_headlines?: string
  enhanced_descriptions?: string
  localization_adapt?: string
  brand_analysis?: string
  // v3.2架构：店铺/单品差异化分析字段
  ai_analysis_v32?: string
  page_type?: string
}

/**
 * 创建新Offer
 * 需求1: 自动生成offer_name和target_language
 * 增强功能: 自动生成pricing、promotions、scraped_data JSON
 */
export async function createOffer(userId: number, input: CreateOfferInput): Promise<Offer> {
  const db = await getDatabase()

  // ========== 需求1和需求5: 自动生成字段 ==========
  // 如果没有提供brand，使用临时值"Unknown"，等抓取完成后更新
  const brandValue = input.brand || 'Unknown'

  // 生成offer_name: 品牌名称_推广国家_序号（如 Reolink_US_01）
  const offerName = await generateOfferName(brandValue, input.target_country, userId)

  // Debug logging for PostgreSQL
  if (process.env.DEBUG_OFFERS) {
    console.log('[DEBUG] offerName:', offerName)
    console.log('[DEBUG] offerName type:', typeof offerName)
  }

  // 根据国家或用户输入自动映射推广语言（如 US→English, DE→German）
  const targetLanguage = input.target_language || getTargetLanguage(input.target_country)

  if (process.env.DEBUG_OFFERS) {
    console.log('[DEBUG] targetLanguage:', targetLanguage)
    console.log('[DEBUG] targetLanguage type:', typeof targetLanguage)
  }

  // ========== 自动生成pricing、promotions、scraped_data JSON ==========
  // 1. 如果有product_price，自动解析并生成pricing JSON
  const pricingJSON = input.product_price ? generatePricingJSON(input.product_price) : null

  // 2. 初始化空的promotions JSON结构
  const promotionsJSON = initializePromotionsJSON()

  // 3. 初始化scraped_data JSON（包含price信息）
  const scrapedDataJSON = initializeScrapedDataJSON(input.product_price)

  const params = [
    userId,
    input.url,
    brandValue, // 使用临时值或用户提供的值
    input.category || null,
    input.target_country,
    input.affiliate_link || null,
    input.brand_description || null,
    input.unique_selling_points || null,
    input.product_highlights || null,
    input.target_audience || null,
    input.final_url || null,  // 解析后的最终URL
    input.final_url_suffix || null,  // URL查询参数后缀
    offerName,  // 自动生成
    targetLanguage,  // 自动生成
    input.product_price || null,  // 需求28
    input.commission_payout || null,  // 需求28
    // 🔥 2025-12-16修复：添加product_name字段
    input.product_name || null,
    // 自动生成的JSON字段
    pricingJSON,      // 从product_price解析
    promotionsJSON,   // 初始化空结构
    scrapedDataJSON,  // 包含price信息的初始结构
    // AI分析结果字段
    input.review_analysis || null,
    input.competitor_analysis || null,
    input.extracted_keywords || null,
    input.extracted_headlines || null,
    input.extracted_descriptions || null,
    input.extraction_metadata || null,
    // P1-3修复: 如果有任何AI分析或广告元素提取结果，记录提取时间
    (input.review_analysis || input.competitor_analysis || input.extracted_keywords || input.extracted_headlines || input.extracted_descriptions) ? new Date().toISOString() : null,
    // 🔥 页面类型标识（店铺/单品）
    input.page_type || 'product'  // 默认为'product'
  ]

  // Debug: Check for undefined values
  if (db.type === 'postgres') {
    const undefinedIndices = params.map((p, i) => p === undefined ? i : -1).filter(i => i !== -1)
    if (undefinedIndices.length > 0) {
      console.error('❌ Found undefined parameters at indices:', undefinedIndices)
      console.error('Parameters:', params)
      throw new Error(`Cannot insert with undefined values at indices: ${undefinedIndices.join(', ')}`)
    }
  }

  const result = await db.exec(`
    INSERT INTO offers (
      user_id, url, brand, category, target_country, affiliate_link,
      brand_description, unique_selling_points, product_highlights,
      target_audience, final_url, final_url_suffix, scrape_status,
      offer_name, target_language,
      product_price, commission_payout, product_name,
      pricing, promotions, scraped_data,
      review_analysis, competitor_analysis,
      extracted_keywords, extracted_headlines, extracted_descriptions, extraction_metadata,
      extracted_at,
      page_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, params)

  const offer = await findOfferById(result.lastInsertRowid as number, userId)
  if (!offer) {
    throw new Error('Offer创建失败')
  }

  // 🔥 2025-12-17修复：新创建的Offer需要清理API缓存，确保前端轮询立即获取到最新数据
  // 这样当批量上传中的单个offer创建完成时，GET /api/offers 能返回最新的offer列表
  const { invalidateOfferCache } = await import('./api-cache')
  invalidateOfferCache(userId)

  return offer
}

/**
 * 通过ID查找Offer（包含用户验证，排除已删除）
 */
export async function findOfferById(id: number, userId: number): Promise<Offer | null> {
  const db = await getDatabase()
  const db_type = db.type
  const deletedCondition = db_type === 'postgres'
    ? '(is_deleted = false OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  const offer = await db.queryOne(`
    SELECT * FROM offers
    WHERE id = ? AND user_id = ? AND ${deletedCondition}
  `, [id, userId]) as Offer | undefined
  return offer || null
}

/**
 * 获取用户的所有Offer列表
 */
export async function listOffers(
  userId: number,
  options?: {
    limit?: number
    offset?: number
    isActive?: boolean
    targetCountry?: string
    searchQuery?: string
    includeDeleted?: boolean
    ids?: number[] // 批量查询特定ID的Offers
  }
): Promise<{ offers: Offer[]; total: number }> {
  const db = await getDatabase()

  let whereConditions = ['user_id = ?']
  const params: any[] = [userId]

  // 默认排除已删除的Offer（需求25）
  if (!options?.includeDeleted) {
    const db_type = db.type
    if (db_type === 'postgres') {
      whereConditions.push('(is_deleted = false OR is_deleted IS NULL)')
    } else {
      whereConditions.push('(is_deleted = 0 OR is_deleted IS NULL)')
    }
  }

  // 如果提供了ids参数，只查询特定ID的Offers（用于批量上传进度显示）
  if (options?.ids && options.ids.length > 0) {
    const placeholders = options.ids.map(() => '?').join(',')
    whereConditions.push(`id IN (${placeholders})`)
    params.push(...options.ids)
  }

  // 构建WHERE条件
  if (options?.isActive !== undefined) {
    whereConditions.push('is_active = ?')
    const db_type = db.type
    if (db_type === 'postgres') {
      params.push(options.isActive) // PostgreSQL uses boolean
    } else {
      params.push(options.isActive ? 1 : 0) // SQLite uses integer
    }
  }

  if (options?.targetCountry) {
    whereConditions.push('target_country = ?')
    params.push(options.targetCountry)
  }

  if (options?.searchQuery) {
    whereConditions.push('(brand LIKE ? OR url LIKE ? OR category LIKE ?)')
    const searchPattern = `%${options.searchQuery}%`
    params.push(searchPattern, searchPattern, searchPattern)
  }

  const whereClause = whereConditions.join(' AND ')

  // 获取总数
  const countQuery = `SELECT COUNT(*) as count FROM offers WHERE ${whereClause}`
  const { count } = await db.queryOne(countQuery, params) as { count: number }

  // 获取列表
  let listQuery = `SELECT * FROM offers WHERE ${whereClause} ORDER BY created_at DESC`

  if (options?.limit) {
    listQuery += ` LIMIT ${options.limit}`
  }

  if (options?.offset) {
    listQuery += ` OFFSET ${options.offset}`
  }

  const offers = await db.query(listQuery, params) as Offer[]

  // ⚡ P0性能优化: 使用单次JOIN查询关联账号，避免N+1查询问题
  // 为每个offer查询关联的Google Ads账号信息
  // 只显示活跃的campaigns（排除REMOVED状态），且排除MCC账号
  // ⚠️ 修复：忽略未成功发布到Google Ads的campaigns(google_campaign_id为空)

  if (offers.length === 0) {
    return { offers: [], total: count }
  }

  // 🔧 PostgreSQL兼容性修复: is_manager_account在PostgreSQL中是BOOLEAN类型
  // 使用SQL类型转换确保兼容性，而不是在参数中传递类型不匹配的值
  const isManagerCondition = db.type === 'postgres'
    ? 'gaa.is_manager_account = false'  // PostgreSQL: 直接使用false
    : 'gaa.is_manager_account = 0'      // SQLite: 使用0

  // 构建offer IDs的占位符
  const offerIds = offers.map(o => o.id)
  const placeholders = offerIds.map(() => '?').join(',')

  // 一次性查询所有offers的关联账号
  const linkedAccountsQuery = `
    SELECT DISTINCT
      c.offer_id,
      gaa.id as account_id,
      gaa.account_name,
      gaa.customer_id
    FROM campaigns c
    INNER JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    WHERE c.offer_id IN (${placeholders})
      AND c.user_id = ?
      AND c.status != 'REMOVED'
      AND ${isManagerCondition}
      AND c.google_campaign_id IS NOT NULL
      AND c.google_campaign_id != ''
    ORDER BY c.offer_id, gaa.account_name
  `

  const allLinkedAccounts = await db.query(linkedAccountsQuery, [...offerIds, userId]) as Array<{
    offer_id: number
    account_id: number
    account_name: string | null
    customer_id: string
  }>

  // 按offer_id分组关联账号
  // 🔧 修复(2025-12-11): snake_case → camelCase
  const accountsByOfferId = new Map<number, Array<{
    accountId: number
    accountName: string | null
    customerId: string
    campaignCount: number
  }>>()

  for (const account of allLinkedAccounts) {
    if (!accountsByOfferId.has(account.offer_id)) {
      accountsByOfferId.set(account.offer_id, [])
    }
    accountsByOfferId.get(account.offer_id)!.push({
      accountId: account.account_id,
      accountName: account.account_name,
      customerId: account.customer_id,
      campaignCount: 0
    })
  }

  // 合并关联账号到offers
  const offersWithAccounts = offers.map(offer => ({
    ...offer,
    linked_accounts: accountsByOfferId.get(offer.id)
  }))

  return {
    offers: offersWithAccounts,
    total: count,
  }
}

/**
 * 更新Offer
 */
export async function updateOffer(id: number, userId: number, input: UpdateOfferInput): Promise<Offer> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  // 验证Offer存在且属于该用户
  const existing = await findOfferById(id, userId)
  if (!existing) {
    throw new Error('Offer不存在或无权访问')
  }

  // 构建UPDATE语句
  const updates: string[] = []
  const params: any[] = []

  if (input.url !== undefined) {
    updates.push('url = ?')
    params.push(input.url)
  }
  if (input.brand !== undefined) {
    updates.push('brand = ?')
    params.push(input.brand)
  }
  if (input.category !== undefined) {
    updates.push('category = ?')
    params.push(input.category)
  }
  if (input.target_country !== undefined) {
    updates.push('target_country = ?')
    params.push(input.target_country)
  }
  if (input.affiliate_link !== undefined) {
    updates.push('affiliate_link = ?')
    params.push(input.affiliate_link)
  }
  if (input.brand_description !== undefined) {
    updates.push('brand_description = ?')
    params.push(input.brand_description)
  }
  if (input.unique_selling_points !== undefined) {
    updates.push('unique_selling_points = ?')
    params.push(input.unique_selling_points)
  }
  if (input.product_highlights !== undefined) {
    updates.push('product_highlights = ?')
    params.push(input.product_highlights)
  }
  if (input.target_audience !== undefined) {
    updates.push('target_audience = ?')
    params.push(input.target_audience)
  }
  if (input.final_url !== undefined) {
    updates.push('final_url = ?')
    params.push(input.final_url)
  }
  if (input.final_url_suffix !== undefined) {
    updates.push('final_url_suffix = ?')
    params.push(input.final_url_suffix)
  }
  if (input.is_active !== undefined) {
    updates.push('is_active = ?')
    const db_type = db.type
    if (db_type === 'postgres') {
      params.push(input.is_active) // PostgreSQL uses boolean
    } else {
      params.push(input.is_active ? 1 : 0) // SQLite uses integer
    }
  }
  // AI分析结果字段
  if (input.competitor_analysis !== undefined) {
    updates.push('competitor_analysis = ?')
    params.push(input.competitor_analysis)
  }
  if (input.review_analysis !== undefined) {
    updates.push('review_analysis = ?')
    params.push(input.review_analysis)
  }
  if (input.extracted_keywords !== undefined) {
    updates.push('extracted_keywords = ?')
    params.push(input.extracted_keywords)
  }
  if (input.extracted_headlines !== undefined) {
    updates.push('extracted_headlines = ?')
    params.push(input.extracted_headlines)
  }
  if (input.extracted_descriptions !== undefined) {
    updates.push('extracted_descriptions = ?')
    params.push(input.extracted_descriptions)
  }
  // P0/P1/P2/P3优化：增强提取字段
  if (input.enhanced_keywords !== undefined) {
    updates.push('enhanced_keywords = ?')
    params.push(input.enhanced_keywords)
  }
  if (input.enhanced_product_info !== undefined) {
    updates.push('enhanced_product_info = ?')
    params.push(input.enhanced_product_info)
  }
  if (input.enhanced_review_analysis !== undefined) {
    updates.push('enhanced_review_analysis = ?')
    params.push(input.enhanced_review_analysis)
  }
  if (input.extraction_quality_score !== undefined) {
    updates.push('extraction_quality_score = ?')
    params.push(input.extraction_quality_score)
  }
  if (input.extraction_enhanced_at !== undefined) {
    updates.push('extraction_enhanced_at = ?')
    params.push(input.extraction_enhanced_at)
  }
  if (input.enhanced_headlines !== undefined) {
    updates.push('enhanced_headlines = ?')
    params.push(input.enhanced_headlines)
  }
  if (input.enhanced_descriptions !== undefined) {
    updates.push('enhanced_descriptions = ?')
    params.push(input.enhanced_descriptions)
  }
  if (input.localization_adapt !== undefined) {
    updates.push('localization_adapt = ?')
    params.push(input.localization_adapt)
  }
  if (input.brand_analysis !== undefined) {
    updates.push('brand_analysis = ?')
    params.push(input.brand_analysis)
  }
  // v3.2架构：店铺/单品差异化分析字段
  if (input.ai_analysis_v32 !== undefined) {
    updates.push('ai_analysis_v32 = ?')
    params.push(input.ai_analysis_v32)
  }
  if (input.page_type !== undefined) {
    updates.push('page_type = ?')
    params.push(input.page_type)
  }

  if (updates.length === 0) {
    return existing
  }

  updates.push(`updated_at = ${nowFunc}`)

  const updateQuery = `
    UPDATE offers
    SET ${updates.join(', ')}
    WHERE id = ? AND user_id = ?
  `

  params.push(id, userId)
  await db.exec(updateQuery, params)

  const updated = await findOfferById(id, userId)
  if (!updated) {
    throw new Error('Offer更新失败')
  }

  return updated
}

/**
 * 删除Offer（软删除）
 * 需求25: 保留历史数据，解除Ads账号关联
 */
/**
 * 关联账号详情接口
 */
export interface LinkedAccountDetail {
  accountId: number
  customerId: string
  accountName: string | null
  campaignId: number
  campaignName: string
  status: string
  createdAt: string
}

/**
 * 删除Offer结果接口
 */
export interface DeleteOfferResult {
  success: boolean
  message: string
  hasLinkedAccounts?: boolean
  linkedAccounts?: LinkedAccountDetail[]
  accountCount?: number
  campaignCount?: number
}

/**
 * 删除Offer
 * @param id - Offer ID
 * @param userId - 用户ID
 * @param autoUnlink - 是否自动解除关联（默认false）
 * @returns 删除结果，包含关联账号详情（如果有）
 */
export async function deleteOffer(
  id: number,
  userId: number,
  autoUnlink: boolean = false
): Promise<DeleteOfferResult> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数和布尔值
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const isDeletedTrue = db.type === 'postgres' ? true : 1
  const isActiveFalse = db.type === 'postgres' ? false : 0

  // 验证Offer存在且属于该用户
  const existing = await findOfferById(id, userId)
  if (!existing) {
    throw new Error('Offer不存在或无权访问')
  }

  // 获取关联的Ads账号和Campaign详情
  // 使用INNER JOIN确保只检查有效账号，忽略孤儿campaigns
  // ⚠️ 修复：忽略未成功发布到Google Ads的campaigns(google_campaign_id为空)
  const linkedAccounts = (await db.query(`
    SELECT
      gaa.id as accountId,
      gaa.customer_id as customerId,
      gaa.account_name as accountName,
      c.id as campaignId,
      c.campaign_name as campaignName,
      c.status,
      c.created_at as createdAt
    FROM campaigns c
    INNER JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND c.status != 'REMOVED'
      AND c.google_campaign_id IS NOT NULL
      AND c.google_campaign_id != ''
    ORDER BY gaa.account_name, c.created_at DESC
  `, [id, userId])) as LinkedAccountDetail[]

  // 如果有关联且未开启自动解除，返回关联详情
  if (linkedAccounts.length > 0 && !autoUnlink) {
    const accountCount = new Set(linkedAccounts.map(a => a.accountId)).size
    return {
      success: false,
      message: `该Offer关联了 ${accountCount} 个Ads账号，共 ${linkedAccounts.length} 个广告系列。请选择"解除关联并删除"或先手动解除关联。`,
      hasLinkedAccounts: true,
      linkedAccounts,
      accountCount,
      campaignCount: linkedAccounts.length
    }
  }

  // 自动解除所有关联
  if (autoUnlink && linkedAccounts.length > 0) {
    await db.exec(`
      UPDATE campaigns
      SET status = 'REMOVED',
          updated_at = ${nowFunc}
      WHERE offer_id = ? AND user_id = ? AND status != 'REMOVED'
    `, [id, userId])
  }

  // 软删除Offer（保留历史数据）
  await db.exec(`
    UPDATE offers
    SET is_deleted = ?,
        deleted_at = ${nowFunc},
        is_active = ?,
        updated_at = ${nowFunc}
    WHERE id = ? AND user_id = ?
  `, [isDeletedTrue, isActiveFalse, id, userId])

  return {
    success: true,
    message: autoUnlink
      ? `Offer删除成功，已自动解除 ${linkedAccounts.length} 个广告系列的关联`
      : 'Offer删除成功'
  }
}

/**
 * 解除Offer与Ads账号的关联
 * 需求25: 手动解除关联功能
 */
export async function unlinkOfferFromAccount(
  offerId: number,
  accountId: number,
  userId: number
): Promise<{ unlinkedCount: number }> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  // 验证Offer存在
  const existing = await findOfferById(offerId, userId)
  if (!existing) {
    throw new Error('Offer不存在或无权访问')
  }

  // 将该Offer在该账号下的Campaigns标记为已移除
  const result = await db.exec(`
    UPDATE campaigns
    SET status = 'REMOVED',
        updated_at = ${nowFunc}
    WHERE offer_id = ?
      AND google_ads_account_id = ?
      AND user_id = ?
      AND status != 'REMOVED'
  `, [offerId, accountId, userId])

  // 🔥 2025-12-19修复：清理API缓存，确保前端立即看到解绑效果
  const { invalidateOfferCache } = await import('./api-cache')
  invalidateOfferCache(userId, offerId)

  // TODO: 实现闲置账号标记功能（需要先添加 is_idle 列到 google_ads_accounts 表）
  // 检查该账号是否还有其他活跃关联
  // const activeCount = await db.queryOne(`
  //   SELECT COUNT(*) as count
  //   FROM campaigns c
  //   JOIN offers o ON c.offer_id = o.id
  //   WHERE c.google_ads_account_id = ?
  //     AND c.user_id = ?
  //     AND o.is_deleted = 0
  //     AND c.status != 'REMOVED'
  // `, [accountId, userId]) as { count: number }

  // // 如果没有活跃关联，标记账号为闲置
  // if (activeCount.count === 0) {
  //   await db.exec(`
  //     UPDATE google_ads_accounts
  //     SET is_idle = 1, updated_at = datetime('now')
  //     WHERE id = ? AND user_id = ?
  //   `, [accountId, userId])
  // }

  return { unlinkedCount: result.changes }
}

/**
 * 获取闲置的Ads账号列表
 * 需求25: 便于其他Offer建立关联关系
 * 只返回ENABLED状态且非Manager的账号，且没有关联任何活跃Campaigns的账号
 */
export async function getIdleAdsAccounts(userId: number): Promise<any[]> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性修复: 布尔字段直接在SQL中比较
  const isActiveCondition = db.type === 'postgres' ? 'gaa.is_active = true' : 'gaa.is_active = 1'
  const isManagerCondition = db.type === 'postgres' ? 'gaa.is_manager_account = false' : 'gaa.is_manager_account = 0'
  const isDeletedCondition = db.type === 'postgres' ? 'o.is_deleted = false' : 'o.is_deleted = 0'

  // 通过子查询判断账号是否闲置（没有活跃的Campaign关联）
  return await db.query(`
    SELECT gaa.*
    FROM google_ads_accounts gaa
    WHERE gaa.user_id = ?
      AND ${isActiveCondition}
      AND gaa.status = 'ENABLED'
      AND ${isManagerCondition}
      AND NOT EXISTS (
        SELECT 1
        FROM campaigns c
        JOIN offers o ON c.offer_id = o.id
        WHERE c.google_ads_account_id = gaa.id
          AND c.user_id = gaa.user_id
          AND ${isDeletedCondition}
          AND c.status != 'REMOVED'
      )
    ORDER BY gaa.updated_at DESC
  `, [userId])
}

/**
 * 更新Offer抓取状态
 */
export async function updateOfferScrapeStatus(
  id: number,
  userId: number,
  status: 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed',
  error?: string,
  scrapedData?: {
    brand?: string
    url?: string
    // 🔥 2025-12-16修复：添加final_url_suffix字段到类型定义
    final_url_suffix?: string
    // 🔥 2025-12-16修复：添加product_name字段到类型定义
    product_name?: string
    brand_description?: string
    unique_selling_points?: string
    product_highlights?: string
    target_audience?: string
    category?: string
    // 增强数据字段
    pricing?: string
    reviews?: string
    promotions?: string
    competitive_edges?: string
    // P0优化: 分析结果字段
    review_analysis?: string
    competitor_analysis?: string
    visual_analysis?: string
    // 🎯 需求34: 广告元素提取结果字段
    extracted_keywords?: string
    extracted_headlines?: string
    extracted_descriptions?: string
    extraction_metadata?: string
    extracted_at?: string
    // 🎯 P0优化: 原始爬虫数据（JSON格式存储所有scraped字段）
    scraped_data?: string
    // 🆕 Phase 2: 产品分类元数据（Store Metadata Enhancement）
    product_categories?: string
    // 🔥 页面类型标识（店铺/单品）
    page_type?: 'store' | 'product'
  }
): Promise<void> {
  const db = await getDatabase()

  // 🔥 2025-12-17修复：更新状态前先清理API缓存，确保前端显示最新状态
  const { invalidateOfferCache } = await import('./api-cache')
  invalidateOfferCache(userId, id)

  if (status === 'completed' && scrapedData) {
    // 🔧 修复：当品牌名更新时，同步更新offer_name
    // 需要先查询当前的offer_name以提取序号
    let currentOffer: { offer_name: string; target_country: string } | undefined
    let newOfferName: string | null = null

    try {
      currentOffer = await db.queryOne(`
        SELECT offer_name, target_country FROM offers WHERE id = ? AND user_id = ?
      `, [id, userId]) as { offer_name: string; target_country: string } | undefined

      newOfferName = currentOffer?.offer_name || null

      // 如果提供了新的品牌名且不是Unknown，则更新offer_name
      if (scrapedData.brand && scrapedData.brand !== 'Unknown' && currentOffer) {
        // 从旧的offer_name中提取序号（格式：Brand_Country_序号）
        const parts = currentOffer.offer_name.split('_')
        const sequenceNumber = parts.length >= 3 ? parts[parts.length - 1] : '01'
        const proposedOfferName = `${scrapedData.brand}_${currentOffer.target_country}_${sequenceNumber}`

        // 🔧 修复：检查新offer_name是否已被占用，如果是则重新生成唯一名称
        const isUnique = await isOfferNameUnique(proposedOfferName, userId, id)
        if (isUnique) {
          newOfferName = proposedOfferName
        } else {
          // 已被占用，使用generateOfferName生成新的唯一名称
          newOfferName = await generateOfferName(scrapedData.brand, currentOffer.target_country, userId)
        }
      }
    } catch (nameError: any) {
      // 🔥 修复（2025-12-10）: offer_name更新失败不应阻止状态更新
      console.error('❌ offer_name更新失败:', nameError.message)
      // 继续使用原有的offer_name
    }

    // 🔧 PostgreSQL兼容性修复：使用NOW()替代datetime('now')
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    // 🔥 修复（2025-12-11）: 移除不存在的列 reviews 和 competitive_edges
    // PostgreSQL offers表中没有这两个字段，导致UPDATE语句失败
    // reviews数据应该存储在 review_analysis 或 ai_reviews 字段
    // competitive_edges数据应该存储在 competitor_analysis 或 ai_competitive_edges 字段
    await db.exec(`
      UPDATE offers
      SET scrape_status = ?,
          scraped_at = ${nowFunc},
          brand = COALESCE(?, brand),
          offer_name = COALESCE(?, offer_name),
          url = COALESCE(?, url),
          final_url_suffix = COALESCE(?, final_url_suffix),
          product_name = COALESCE(?, product_name),
          brand_description = COALESCE(?, brand_description),
          unique_selling_points = COALESCE(?, unique_selling_points),
          product_highlights = COALESCE(?, product_highlights),
          target_audience = COALESCE(?, target_audience),
          category = COALESCE(?, category),
          pricing = COALESCE(?, pricing),
          promotions = COALESCE(?, promotions),
          review_analysis = COALESCE(?, review_analysis),
          competitor_analysis = COALESCE(?, competitor_analysis),
          visual_analysis = COALESCE(?, visual_analysis),
          extracted_keywords = COALESCE(?, extracted_keywords),
          extracted_headlines = COALESCE(?, extracted_headlines),
          extracted_descriptions = COALESCE(?, extracted_descriptions),
          extraction_metadata = COALESCE(?, extraction_metadata),
          extracted_at = COALESCE(?, extracted_at),
          scraped_data = COALESCE(?, scraped_data),
          product_categories = COALESCE(?, product_categories),
          page_type = COALESCE(?, page_type),
          updated_at = ${nowFunc}
      WHERE id = ? AND user_id = ?
    `, [
      status,
      scrapedData.brand || null,
      newOfferName,
      scrapedData.url || null,
      scrapedData.final_url_suffix || null,
      scrapedData.product_name || null,
      scrapedData.brand_description || null,
      scrapedData.unique_selling_points || null,
      scrapedData.product_highlights || null,
      scrapedData.target_audience || null,
      scrapedData.category || null,
      scrapedData.pricing || null,
      scrapedData.promotions || null,
      scrapedData.review_analysis || null,
      scrapedData.competitor_analysis || null,
      scrapedData.visual_analysis || null,
      scrapedData.extracted_keywords || null,
      scrapedData.extracted_headlines || null,
      scrapedData.extracted_descriptions || null,
      scrapedData.extraction_metadata || null,
      scrapedData.extracted_at || null,
      scrapedData.scraped_data || null,
      scrapedData.product_categories || null,
      scrapedData.page_type || null,
      id,
      userId
    ])
  } else {
    // 🔧 修复: 为了兼容PostgreSQL，使用条件更新而不是CASE表达式
    // SQLite中scraped_at是TEXT，PostgreSQL中是TIMESTAMP，CASE会导致类型不匹配
    // 🔧 PostgreSQL兼容性修复：使用NOW()替代datetime('now')
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    if (status === 'completed') {
      await db.exec(`
        UPDATE offers
        SET scrape_status = ?,
            scrape_error = ?,
            scraped_at = ${nowFunc},
            updated_at = ${nowFunc}
        WHERE id = ? AND user_id = ?
      `, [status, error || null, id, userId])
    } else {
      await db.exec(`
        UPDATE offers
        SET scrape_status = ?,
            scrape_error = ?,
            updated_at = ${nowFunc}
        WHERE id = ? AND user_id = ?
      `, [status, error || null, id, userId])
    }
  }
}
