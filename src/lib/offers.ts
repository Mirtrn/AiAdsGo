import { getDatabase } from './db'

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
 */
export function createOffer(userId: number, input: CreateOfferInput): Offer {
  const db = getDatabase()

  const result = db.prepare(`
    INSERT INTO offers (
      user_id, url, brand, category, target_country, affiliate_link,
      brand_description, unique_selling_points, product_highlights,
      target_audience, scrape_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
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
    input.target_audience || null
  )

  const offer = findOfferById(result.lastInsertRowid as number, userId)
  if (!offer) {
    throw new Error('Offer创建失败')
  }

  return offer
}

/**
 * 通过ID查找Offer（包含用户验证）
 */
export function findOfferById(id: number, userId: number): Offer | null {
  const db = getDatabase()
  const offer = db.prepare('SELECT * FROM offers WHERE id = ? AND user_id = ?').get(id, userId) as Offer | undefined
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
  }
): { offers: Offer[]; total: number } {
  const db = getDatabase()

  let whereConditions = ['user_id = ?']
  const params: any[] = [userId]

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

  return {
    offers,
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
 * 删除Offer
 */
export function deleteOffer(id: number, userId: number): void {
  const db = getDatabase()

  // 验证Offer存在且属于该用户
  const existing = findOfferById(id, userId)
  if (!existing) {
    throw new Error('Offer不存在或无权访问')
  }

  // 删除Offer（级联删除会自动删除关联的creatives, campaigns等）
  db.prepare('DELETE FROM offers WHERE id = ? AND user_id = ?').run(id, userId)
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
