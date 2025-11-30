import { getDatabase, getSQLiteDatabase } from './db'
import { generateOfferName, getTargetLanguage } from './offer-utils'

export interface Offer {
  id: number
  user_id: number
  url: string
  brand: string
  category: string | null
  target_country: string
  affiliate_link: string | null
  brand_description: string | null
  unique_selling_points: string | null
  product_highlights: string | null
  target_audience: string | null
  // Final URL字段：存储解析后的最终落地页URL
  final_url: string | null
  final_url_suffix: string | null
  scrape_status: string
  scrape_error: string | null
  scraped_at: string | null
  is_active: number
  created_at: string
  updated_at: string
  // 新增字段（需求1和需求5）
  offer_name: string | null
  target_language: string | null
  // 需求28：产品价格和佣金比例
  product_price: string | null
  commission_payout: string | null
  // 增强数据字段（JSON格式存储）
  pricing: string | null
  reviews: string | null
  promotions: string | null
  competitive_edges: string | null
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
  // P0优化: 原始爬虫数据（包含discount, salesRank, badge等所有字段）
  scraped_data: string | null
  // P1-11: 关联的Google Ads账号信息
  linked_accounts?: Array<{
    account_id: number
    account_name: string | null
    customer_id: string
    campaign_count: number
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
  // AI分析结果字段（JSON字符串格式）
  review_analysis?: string
  competitor_analysis?: string
  extracted_keywords?: string
  extracted_headlines?: string
  extracted_descriptions?: string
  extraction_metadata?: string
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
}

/**
 * 创建新Offer
 * 需求1: 自动生成offer_name和target_language
 */
export function createOffer(userId: number, input: CreateOfferInput): Offer {
  const db = getSQLiteDatabase()

  // ========== 需求1和需求5: 自动生成字段 ==========
  // 如果没有提供brand，使用临时值"Unknown"，等抓取完成后更新
  const brandValue = input.brand || 'Unknown'

  // 生成offer_name: 品牌名称_推广国家_序号（如 Reolink_US_01）
  const offerName = generateOfferName(brandValue, input.target_country, userId)

  // 根据国家或用户输入自动映射推广语言（如 US→English, DE→German）
  const targetLanguage = input.target_language || getTargetLanguage(input.target_country)

  const result = db.prepare(`
    INSERT INTO offers (
      user_id, url, brand, category, target_country, affiliate_link,
      brand_description, unique_selling_points, product_highlights,
      target_audience, final_url, final_url_suffix, scrape_status,
      offer_name, target_language,
      product_price, commission_payout,
      review_analysis, competitor_analysis,
      extracted_keywords, extracted_headlines, extracted_descriptions, extraction_metadata,
      extracted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    // AI分析结果字段
    input.review_analysis || null,
    input.competitor_analysis || null,
    input.extracted_keywords || null,
    input.extracted_headlines || null,
    input.extracted_descriptions || null,
    input.extraction_metadata || null,
    input.review_analysis || input.competitor_analysis ? new Date().toISOString() : null  // 如果有AI分析结果，记录提取时间
  )

  const offer = findOfferById(result.lastInsertRowid as number, userId)
  if (!offer) {
    throw new Error('Offer创建失败')
  }

  return offer
}

/**
 * 通过ID查找Offer（包含用户验证，排除已删除）
 */
export function findOfferById(id: number, userId: number): Offer | null {
  const db = getSQLiteDatabase()
  const offer = db.prepare(`
    SELECT * FROM offers
    WHERE id = ? AND user_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
  `).get(id, userId) as Offer | undefined
  return offer || null
}

/**
 * 获取用户的所有Offer列表
 */
export function listOffers(
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
): { offers: Offer[]; total: number } {
  const db = getSQLiteDatabase()

  let whereConditions = ['user_id = ?']
  const params: any[] = [userId]

  // 默认排除已删除的Offer（需求25）
  if (!options?.includeDeleted) {
    whereConditions.push('(is_deleted = 0 OR is_deleted IS NULL)')
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
    params.push(options.isActive ? 1 : 0)
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
  const { count } = db.prepare(countQuery).get(...params) as { count: number }

  // 获取列表
  let listQuery = `SELECT * FROM offers WHERE ${whereClause} ORDER BY created_at DESC`

  if (options?.limit) {
    listQuery += ` LIMIT ${options.limit}`
  }

  if (options?.offset) {
    listQuery += ` OFFSET ${options.offset}`
  }

  const offers = db.prepare(listQuery).all(...params) as Offer[]

  // P1-11: 为每个offer查询关联的Google Ads账号信息
  // 只显示活跃的campaigns（排除REMOVED状态），且排除MCC账号
  // ⚠️ 修复：忽略未成功发布到Google Ads的campaigns(google_campaign_id为空)
  const offersWithAccounts = offers.map(offer => {
    const linkedAccounts = db.prepare(`
      SELECT DISTINCT
        gaa.id as account_id,
        gaa.account_name as account_name,
        gaa.customer_id,
        0 as campaign_count
      FROM campaigns c
      INNER JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.offer_id = ?
        AND c.user_id = ?
        AND c.status != 'REMOVED'
        AND gaa.is_manager_account = 0
        AND c.google_campaign_id IS NOT NULL
        AND c.google_campaign_id != ''
    `).all(offer.id, userId) as Array<{
      account_id: number
      account_name: string | null
      customer_id: string
      campaign_count: number
    }>

    return {
      ...offer,
      linked_accounts: linkedAccounts.length > 0 ? linkedAccounts : undefined
    }
  })

  return {
    offers: offersWithAccounts,
    total: count,
  }
}

/**
 * 更新Offer
 */
export function updateOffer(id: number, userId: number, input: UpdateOfferInput): Offer {
  const db = getSQLiteDatabase()

  // 验证Offer存在且属于该用户
  const existing = findOfferById(id, userId)
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
    params.push(input.is_active ? 1 : 0)
  }

  if (updates.length === 0) {
    return existing
  }

  updates.push('updated_at = datetime(\'now\')')

  const updateQuery = `
    UPDATE offers
    SET ${updates.join(', ')}
    WHERE id = ? AND user_id = ?
  `

  params.push(id, userId)
  db.prepare(updateQuery).run(...params)

  const updated = findOfferById(id, userId)
  if (!updated) {
    throw new Error('Offer更新失败')
  }

  return updated
}

/**
 * 删除Offer（软删除）
 * 需求25: 保留历史数据，解除Ads账号关联
 */
export function deleteOffer(id: number, userId: number): void {
  const db = getSQLiteDatabase()

  // 验证Offer存在且属于该用户
  const existing = findOfferById(id, userId)
  if (!existing) {
    throw new Error('Offer不存在或无权访问')
  }

  // 检查是否有关联的Ads账号
  // 使用INNER JOIN确保只检查有效账号，忽略孤儿campaigns
  // ⚠️ 修复：忽略未成功发布到Google Ads的campaigns(google_campaign_id为空)
  const associatedAccounts = db.prepare(`
    SELECT COUNT(DISTINCT gaa.id) as account_count, COUNT(*) as campaign_count
    FROM campaigns c
    INNER JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND c.status != 'REMOVED'
      AND c.google_campaign_id IS NOT NULL
      AND c.google_campaign_id != ''
  `).get(id, userId) as { account_count: number; campaign_count: number }

  if (associatedAccounts.account_count > 0) {
    throw new Error(`无法删除Offer：该Offer关联了 ${associatedAccounts.account_count} 个Ads账号。请先在"关联Ads账号"列中解除所有账号的关联后再删除。`)
  }

  // 使用事务确保数据一致性
  const transaction = db.transaction(() => {
    // 软删除Offer（保留历史数据）
    // 注意：此时已经确认没有关联的活跃Campaigns，可以安全删除
    db.prepare(`
      UPDATE offers
      SET is_deleted = 1,
          deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(id, userId)

    // 注意：不再自动更新Campaigns状态，用户必须先手动解除关联
    // 此时应该不存在任何活跃的Campaigns关联（已在上面验证）

    // TODO: 检查并标记闲置的Ads账号
    // TODO: 实现闲置账号标记功能（需要先添加 is_idle 列到 google_ads_accounts 表）
    // 找到该Offer关联的所有Ads账号
    // const accounts = db.prepare(`
    //   SELECT DISTINCT google_ads_account_id
    //   FROM campaigns
    //   WHERE offer_id = ? AND user_id = ?
    // `).all(id, userId) as { google_ads_account_id: number }[]

    // for (const account of accounts) {
    //   // 检查该账号是否还有其他活跃的Offer关联
    //   const activeOffers = db.prepare(`
    //     SELECT COUNT(*) as count
    //     FROM campaigns c
    //     JOIN offers o ON c.offer_id = o.id
    //     WHERE c.google_ads_account_id = ?
    //       AND c.user_id = ?
    //       AND o.is_deleted = 0
    //       AND c.status != 'REMOVED'
    //   `).get(account.google_ads_account_id, userId) as { count: number }

    //   // 如果没有活跃Offer，标记账号为闲置
    //   if (activeOffers.count === 0) {
    //     db.prepare(`
    //       UPDATE google_ads_accounts
    //       SET is_idle = 1, updated_at = datetime('now')
    //       WHERE id = ? AND user_id = ?
    //     `).run(account.google_ads_account_id, userId)
    //   }
    // }
  })

  transaction()
}

/**
 * 解除Offer与Ads账号的关联
 * 需求25: 手动解除关联功能
 */
export function unlinkOfferFromAccount(
  offerId: number,
  accountId: number,
  userId: number
): { unlinkedCount: number } {
  const db = getSQLiteDatabase()

  // 验证Offer存在
  const existing = findOfferById(offerId, userId)
  if (!existing) {
    throw new Error('Offer不存在或无权访问')
  }

  const transaction = db.transaction(() => {
    // 将该Offer在该账号下的Campaigns标记为已移除
    const result = db.prepare(`
      UPDATE campaigns
      SET status = 'REMOVED',
          updated_at = datetime('now')
      WHERE offer_id = ?
        AND google_ads_account_id = ?
        AND user_id = ?
        AND status != 'REMOVED'
    `).run(offerId, accountId, userId)

    // TODO: 实现闲置账号标记功能（需要先添加 is_idle 列到 google_ads_accounts 表）
    // 检查该账号是否还有其他活跃关联
    // const activeCount = db.prepare(`
    //   SELECT COUNT(*) as count
    //   FROM campaigns c
    //   JOIN offers o ON c.offer_id = o.id
    //   WHERE c.google_ads_account_id = ?
    //     AND c.user_id = ?
    //     AND o.is_deleted = 0
    //     AND c.status != 'REMOVED'
    // `).get(accountId, userId) as { count: number }

    // // 如果没有活跃关联，标记账号为闲置
    // if (activeCount.count === 0) {
    //   db.prepare(`
    //     UPDATE google_ads_accounts
    //     SET is_idle = 1, updated_at = datetime('now')
    //     WHERE id = ? AND user_id = ?
    //   `).run(accountId, userId)
    // }

    return result.changes
  })

  return { unlinkedCount: transaction() }
}

/**
 * 获取闲置的Ads账号列表
 * 需求25: 便于其他Offer建立关联关系
 * 只返回ENABLED状态且非Manager的账号，且没有关联任何活跃Campaigns的账号
 */
export function getIdleAdsAccounts(userId: number): any[] {
  const db = getSQLiteDatabase()

  // 通过子查询判断账号是否闲置（没有活跃的Campaign关联）
  return db.prepare(`
    SELECT gaa.*
    FROM google_ads_accounts gaa
    WHERE gaa.user_id = ?
      AND gaa.is_active = 1
      AND gaa.status = 'ENABLED'
      AND gaa.is_manager_account = 0
      AND NOT EXISTS (
        SELECT 1
        FROM campaigns c
        JOIN offers o ON c.offer_id = o.id
        WHERE c.google_ads_account_id = gaa.id
          AND c.user_id = gaa.user_id
          AND o.is_deleted = 0
          AND c.status != 'REMOVED'
      )
    ORDER BY gaa.updated_at DESC
  `).all(userId)
}

/**
 * 更新Offer抓取状态
 */
export function updateOfferScrapeStatus(
  id: number,
  userId: number,
  status: 'pending' | 'in_progress' | 'completed' | 'failed',
  error?: string,
  scrapedData?: {
    brand?: string
    url?: string
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
  }
): void {
  const db = getSQLiteDatabase()

  if (status === 'completed' && scrapedData) {
    // 🔧 修复：当品牌名更新时，同步更新offer_name
    // 需要先查询当前的offer_name以提取序号
    const currentOffer = db.prepare(`
      SELECT offer_name, target_country FROM offers WHERE id = ? AND user_id = ?
    `).get(id, userId) as { offer_name: string; target_country: string } | undefined

    let newOfferName = currentOffer?.offer_name || null

    // 如果提供了新的品牌名且不是Unknown，则更新offer_name
    if (scrapedData.brand && scrapedData.brand !== 'Unknown' && currentOffer) {
      // 从旧的offer_name中提取序号（格式：Brand_Country_序号）
      const parts = currentOffer.offer_name.split('_')
      const sequenceNumber = parts.length >= 3 ? parts[parts.length - 1] : '01'
      newOfferName = `${scrapedData.brand}_${currentOffer.target_country}_${sequenceNumber}`
    }

    db.prepare(`
      UPDATE offers
      SET scrape_status = ?,
          scraped_at = datetime('now'),
          brand = COALESCE(?, brand),
          offer_name = COALESCE(?, offer_name),
          url = COALESCE(?, url),
          brand_description = COALESCE(?, brand_description),
          unique_selling_points = COALESCE(?, unique_selling_points),
          product_highlights = COALESCE(?, product_highlights),
          target_audience = COALESCE(?, target_audience),
          category = COALESCE(?, category),
          pricing = COALESCE(?, pricing),
          reviews = COALESCE(?, reviews),
          promotions = COALESCE(?, promotions),
          competitive_edges = COALESCE(?, competitive_edges),
          review_analysis = COALESCE(?, review_analysis),
          competitor_analysis = COALESCE(?, competitor_analysis),
          visual_analysis = COALESCE(?, visual_analysis),
          extracted_keywords = COALESCE(?, extracted_keywords),
          extracted_headlines = COALESCE(?, extracted_headlines),
          extracted_descriptions = COALESCE(?, extracted_descriptions),
          extraction_metadata = COALESCE(?, extraction_metadata),
          extracted_at = COALESCE(?, extracted_at),
          scraped_data = COALESCE(?, scraped_data),
          updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(
      status,
      scrapedData.brand || null,
      newOfferName,
      scrapedData.url || null,
      scrapedData.brand_description || null,
      scrapedData.unique_selling_points || null,
      scrapedData.product_highlights || null,
      scrapedData.target_audience || null,
      scrapedData.category || null,
      scrapedData.pricing || null,
      scrapedData.reviews || null,
      scrapedData.promotions || null,
      scrapedData.competitive_edges || null,
      scrapedData.review_analysis || null,
      scrapedData.competitor_analysis || null,
      scrapedData.visual_analysis || null,
      scrapedData.extracted_keywords || null,
      scrapedData.extracted_headlines || null,
      scrapedData.extracted_descriptions || null,
      scrapedData.extraction_metadata || null,
      scrapedData.extracted_at || null,
      scrapedData.scraped_data || null,
      id,
      userId
    )
  } else {
    db.prepare(`
      UPDATE offers
      SET scrape_status = ?,
          scrape_error = ?,
          scraped_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE scraped_at END,
          updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(status, error || null, status, id, userId)
  }
}
