import { getDatabase } from './db'
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
  brand: string
  category?: string
  target_country: string
  affiliate_link?: string
  brand_description?: string
  unique_selling_points?: string
  product_highlights?: string
  target_audience?: string
  // 需求28：产品价格和佣金比例（可选）
  product_price?: string
  commission_payout?: string
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
  is_active?: boolean
}

/**
 * 创建新Offer
 * 需求1: 自动生成offer_name和target_language
 */
export function createOffer(userId: number, input: CreateOfferInput): Offer {
  const db = getDatabase()

  // ========== 需求1和需求5: 自动生成字段 ==========
  // 生成offer_name: 品牌名称_推广国家_序号（如 Reolink_US_01）
  const offerName = generateOfferName(input.brand, input.target_country, userId)

  // 根据国家自动映射推广语言（如 US→English, DE→German）
  const targetLanguage = getTargetLanguage(input.target_country)

  const result = db.prepare(`
    INSERT INTO offers (
      user_id, url, brand, category, target_country, affiliate_link,
      brand_description, unique_selling_points, product_highlights,
      target_audience, scrape_status,
      offer_name, target_language,
      product_price, commission_payout
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    userId,
    input.url,
    input.brand,
    input.category || null,
    input.target_country,
    input.affiliate_link || null,
    input.brand_description || null,
    input.unique_selling_points || null,
    input.product_highlights || null,
    input.target_audience || null,
    offerName,  // 自动生成
    targetLanguage,  // 自动生成
    input.product_price || null,  // 需求28
    input.commission_payout || null  // 需求28
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
  const db = getDatabase()
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
  }
): { offers: Offer[]; total: number } {
  const db = getDatabase()

  let whereConditions = ['user_id = ?']
  const params: any[] = [userId]

  // 默认排除已删除的Offer（需求25）
  if (!options?.includeDeleted) {
    whereConditions.push('(is_deleted = 0 OR is_deleted IS NULL)')
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
  const offersWithAccounts = offers.map(offer => {
    const linkedAccounts = db.prepare(`
      SELECT DISTINCT
        gaa.id as account_id,
        gaa.account_name,
        gaa.customer_id,
        COUNT(DISTINCT c.id) as campaign_count
      FROM campaigns c
      INNER JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.offer_id = ? AND c.user_id = ?
      GROUP BY gaa.id, gaa.account_name, gaa.customer_id
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
  const db = getDatabase()

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
  const db = getDatabase()

  // 验证Offer存在且属于该用户
  const existing = findOfferById(id, userId)
  if (!existing) {
    throw new Error('Offer不存在或无权访问')
  }

  // 使用事务确保数据一致性
  const transaction = db.transaction(() => {
    // 1. 软删除Offer（保留历史数据）
    db.prepare(`
      UPDATE offers
      SET is_deleted = 1,
          deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(id, userId)

    // 2. 将关联的Campaigns标记为无关联（但保留数据用于历史分析）
    db.prepare(`
      UPDATE campaigns
      SET status = 'REMOVED',
          updated_at = datetime('now')
      WHERE offer_id = ? AND user_id = ?
    `).run(id, userId)

    // 3. 检查并标记闲置的Ads账号
    // 找到该Offer关联的所有Ads账号
    const accounts = db.prepare(`
      SELECT DISTINCT google_ads_account_id
      FROM campaigns
      WHERE offer_id = ? AND user_id = ?
    `).all(id, userId) as { google_ads_account_id: number }[]

    for (const account of accounts) {
      // 检查该账号是否还有其他活跃的Offer关联
      const activeOffers = db.prepare(`
        SELECT COUNT(*) as count
        FROM campaigns c
        JOIN offers o ON c.offer_id = o.id
        WHERE c.google_ads_account_id = ?
          AND c.user_id = ?
          AND o.is_deleted = 0
          AND c.status != 'REMOVED'
      `).get(account.google_ads_account_id, userId) as { count: number }

      // 如果没有活跃Offer，标记账号为闲置
      if (activeOffers.count === 0) {
        db.prepare(`
          UPDATE google_ads_accounts
          SET is_idle = 1, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?
        `).run(account.google_ads_account_id, userId)
      }
    }
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
  const db = getDatabase()

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

    // 检查该账号是否还有其他活跃关联
    const activeCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM campaigns c
      JOIN offers o ON c.offer_id = o.id
      WHERE c.google_ads_account_id = ?
        AND c.user_id = ?
        AND o.is_deleted = 0
        AND c.status != 'REMOVED'
    `).get(accountId, userId) as { count: number }

    // 如果没有活跃关联，标记账号为闲置
    if (activeCount.count === 0) {
      db.prepare(`
        UPDATE google_ads_accounts
        SET is_idle = 1, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(accountId, userId)
    }

    return result.changes
  })

  return { unlinkedCount: transaction() }
}

/**
 * 获取闲置的Ads账号列表
 * 需求25: 便于其他Offer建立关联关系
 */
export function getIdleAdsAccounts(userId: number): any[] {
  const db = getDatabase()

  return db.prepare(`
    SELECT * FROM google_ads_accounts
    WHERE user_id = ?
      AND is_idle = 1
      AND is_active = 1
    ORDER BY updated_at DESC
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
    brand_description?: string
    unique_selling_points?: string
    product_highlights?: string
    target_audience?: string
    category?: string
  }
): void {
  const db = getDatabase()

  if (status === 'completed' && scrapedData) {
    db.prepare(`
      UPDATE offers
      SET scrape_status = ?,
          scraped_at = datetime('now'),
          brand_description = COALESCE(?, brand_description),
          unique_selling_points = COALESCE(?, unique_selling_points),
          product_highlights = COALESCE(?, product_highlights),
          target_audience = COALESCE(?, target_audience),
          category = COALESCE(?, category),
          updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(
      status,
      scrapedData.brand_description || null,
      scrapedData.unique_selling_points || null,
      scrapedData.product_highlights || null,
      scrapedData.target_audience || null,
      scrapedData.category || null,
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
