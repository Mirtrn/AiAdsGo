import { getDatabase } from './db'

export interface Campaign {
  id: number
  userId: number
  offerId: number
  googleAdsAccountId: number
  campaignId: string | null
  campaignName: string
  budgetAmount: number
  budgetType: string
  targetCpa: number | null
  maxCpc: number | null
  status: string
  startDate: string | null
  endDate: string | null
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateCampaignInput {
  userId: number
  offerId: number
  googleAdsAccountId: number
  campaignName: string
  budgetAmount: number
  budgetType?: string
  targetCpa?: number
  maxCpc?: number
  status?: string
  startDate?: string
  endDate?: string
}

/**
 * 创建广告系列
 */
export function createCampaign(input: CreateCampaignInput): Campaign {
  const db = getDatabase()

  const stmt = db.prepare(`
    INSERT INTO campaigns (
      user_id, offer_id, google_ads_account_id,
      campaign_name, budget_amount, budget_type,
      target_cpa, max_cpc, status,
      start_date, end_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const info = stmt.run(
    input.userId,
    input.offerId,
    input.googleAdsAccountId,
    input.campaignName,
    input.budgetAmount,
    input.budgetType || 'DAILY',
    input.targetCpa || null,
    input.maxCpc || null,
    input.status || 'PAUSED',
    input.startDate || null,
    input.endDate || null
  )

  return findCampaignById(info.lastInsertRowid as number, input.userId)!
}

/**
 * 查找广告系列（带权限验证）
 */
export function findCampaignById(id: number, userId: number): Campaign | null {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM campaigns
    WHERE id = ? AND user_id = ?
  `)

  const row = stmt.get(id, userId) as any

  if (!row) {
    return null
  }

  return mapRowToCampaign(row)
}

/**
 * 根据Google Ads campaign_id查找
 */
export function findCampaignByGoogleId(campaignId: string, userId: number): Campaign | null {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM campaigns
    WHERE campaign_id = ? AND user_id = ?
  `)

  const row = stmt.get(campaignId, userId) as any

  if (!row) {
    return null
  }

  return mapRowToCampaign(row)
}

/**
 * 查找Offer的所有广告系列
 */
export function findCampaignsByOfferId(offerId: number, userId: number): Campaign[] {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM campaigns
    WHERE offer_id = ? AND user_id = ?
    ORDER BY created_at DESC
  `)

  const rows = stmt.all(offerId, userId) as any[]
  return rows.map(mapRowToCampaign)
}

/**
 * 查找用户的所有广告系列
 */
export function findCampaignsByUserId(userId: number, limit?: number): Campaign[] {
  const db = getDatabase()
  let sql = `
    SELECT * FROM campaigns
    WHERE user_id = ?
    ORDER BY created_at DESC
  `

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const stmt = db.prepare(sql)
  const rows = stmt.all(userId) as any[]
  return rows.map(mapRowToCampaign)
}

/**
 * 查找Google Ads账号的所有广告系列
 */
export function findCampaignsByAccountId(
  googleAdsAccountId: number,
  userId: number
): Campaign[] {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM campaigns
    WHERE google_ads_account_id = ? AND user_id = ?
    ORDER BY created_at DESC
  `)

  const rows = stmt.all(googleAdsAccountId, userId) as any[]
  return rows.map(mapRowToCampaign)
}

/**
 * 更新广告系列
 */
export function updateCampaign(
  id: number,
  userId: number,
  updates: Partial<
    Pick<
      Campaign,
      | 'campaignName'
      | 'budgetAmount'
      | 'budgetType'
      | 'targetCpa'
      | 'maxCpc'
      | 'status'
      | 'startDate'
      | 'endDate'
      | 'campaignId'
      | 'creationStatus'
      | 'creationError'
      | 'lastSyncAt'
    >
  >
): Campaign | null {
  const db = getDatabase()

  // 验证权限
  const campaign = findCampaignById(id, userId)
  if (!campaign) {
    return null
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.campaignName !== undefined) {
    fields.push('campaign_name = ?')
    values.push(updates.campaignName)
  }
  if (updates.budgetAmount !== undefined) {
    fields.push('budget_amount = ?')
    values.push(updates.budgetAmount)
  }
  if (updates.budgetType !== undefined) {
    fields.push('budget_type = ?')
    values.push(updates.budgetType)
  }
  if (updates.targetCpa !== undefined) {
    fields.push('target_cpa = ?')
    values.push(updates.targetCpa)
  }
  if (updates.maxCpc !== undefined) {
    fields.push('max_cpc = ?')
    values.push(updates.maxCpc)
  }
  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.startDate !== undefined) {
    fields.push('start_date = ?')
    values.push(updates.startDate)
  }
  if (updates.endDate !== undefined) {
    fields.push('end_date = ?')
    values.push(updates.endDate)
  }
  if (updates.campaignId !== undefined) {
    fields.push('campaign_id = ?')
    values.push(updates.campaignId)
  }
  if (updates.creationStatus !== undefined) {
    fields.push('creation_status = ?')
    values.push(updates.creationStatus)
  }
  if (updates.creationError !== undefined) {
    fields.push('creation_error = ?')
    values.push(updates.creationError)
  }
  if (updates.lastSyncAt !== undefined) {
    fields.push('last_sync_at = ?')
    values.push(updates.lastSyncAt)
  }

  if (fields.length === 0) {
    return campaign
  }

  fields.push('updated_at = datetime("now")')
  values.push(id, userId)

  const stmt = db.prepare(`
    UPDATE campaigns
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `)

  stmt.run(...values)

  return findCampaignById(id, userId)
}

/**
 * 删除广告系列
 */
export function deleteCampaign(id: number, userId: number): boolean {
  const db = getDatabase()

  const stmt = db.prepare(`
    DELETE FROM campaigns
    WHERE id = ? AND user_id = ?
  `)

  const info = stmt.run(id, userId)
  return info.changes > 0
}

/**
 * 更新广告系列状态
 */
export function updateCampaignStatus(
  id: number,
  userId: number,
  status: string
): Campaign | null {
  return updateCampaign(id, userId, { status })
}

/**
 * 数据库行映射为Campaign对象
 */
function mapRowToCampaign(row: any): Campaign {
  return {
    id: row.id,
    userId: row.user_id,
    offerId: row.offer_id,
    googleAdsAccountId: row.google_ads_account_id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    budgetAmount: row.budget_amount,
    budgetType: row.budget_type,
    targetCpa: row.target_cpa,
    maxCpc: row.max_cpc,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    creationStatus: row.creation_status,
    creationError: row.creation_error,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
