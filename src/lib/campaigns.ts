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
export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const db = await getDatabase()

  const result = await db.exec(`
    INSERT INTO campaigns (
      user_id, offer_id, google_ads_account_id,
      campaign_name, budget_amount, budget_type,
      target_cpa, max_cpc, status,
      start_date, end_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
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
  ])

  return (await findCampaignById(result.lastInsertRowid as number, input.userId))!
}

/**
 * 查找广告系列（带权限验证）
 */
export async function findCampaignById(id: number, userId: number): Promise<Campaign | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM campaigns
    WHERE id = ? AND user_id = ?
  `, [id, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToCampaign(row)
}

/**
 * 根据Google Ads campaign_id查找
 */
export async function findCampaignByGoogleId(campaignId: string, userId: number): Promise<Campaign | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM campaigns
    WHERE campaign_id = ? AND user_id = ?
  `, [campaignId, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToCampaign(row)
}

/**
 * 查找Offer的所有广告系列（排除已删除）
 */
export async function findCampaignsByOfferId(offerId: number, userId: number): Promise<Campaign[]> {
  const db = await getDatabase()

  // 🔧 修复: 排除已软删除的campaigns
  const isDeletedFalse = db.type === 'postgres' ? false : 0

  const rows = await db.query(`
    SELECT * FROM campaigns
    WHERE offer_id = ? AND user_id = ? AND is_deleted = ?
    ORDER BY created_at DESC
  `, [offerId, userId, isDeletedFalse]) as any[]

  return rows.map(mapRowToCampaign)
}

/**
 * 查找用户的所有广告系列（排除已删除）
 */
export async function findCampaignsByUserId(userId: number, limit?: number): Promise<Campaign[]> {
  const db = await getDatabase()

  // 🔧 修复: 排除已软删除的campaigns
  const isDeletedFalse = db.type === 'postgres' ? false : 0

  let sql = `
    SELECT * FROM campaigns
    WHERE user_id = ? AND is_deleted = ?
    ORDER BY created_at DESC
  `

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const rows = await db.query(sql, [userId, isDeletedFalse]) as any[]
  return rows.map(mapRowToCampaign)
}

/**
 * 查找Google Ads账号的所有广告系列（排除已删除）
 */
export async function findCampaignsByAccountId(
  googleAdsAccountId: number,
  userId: number
): Promise<Campaign[]> {
  const db = await getDatabase()

  // 🔧 修复: 排除已软删除的campaigns
  const isDeletedFalse = db.type === 'postgres' ? false : 0

  const rows = await db.query(`
    SELECT * FROM campaigns
    WHERE google_ads_account_id = ? AND user_id = ? AND is_deleted = ?
    ORDER BY created_at DESC
  `, [googleAdsAccountId, userId, isDeletedFalse]) as any[]

  return rows.map(mapRowToCampaign)
}

/**
 * 更新广告系列
 */
export async function updateCampaign(
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
): Promise<Campaign | null> {
  const db = await getDatabase()

  // 验证权限
  const campaign = await findCampaignById(id, userId)
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

  // 🔧 修复: PostgreSQL兼容性 - 使用NOW()而非datetime('now')
  const db_type = db.type
  const nowFunc = db_type === 'postgres' ? 'NOW()' : 'datetime("now")'
  fields.push(`updated_at = ${nowFunc}`)
  values.push(id, userId)

  await db.exec(`
    UPDATE campaigns
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `, values)

  return findCampaignById(id, userId)
}

/**
 * 删除广告系列（软删除，保留历史数据）
 */
export async function deleteCampaign(id: number, userId: number): Promise<boolean> {
  const db = await getDatabase()

  // 🔧 修复: 使用软删除而非物理删除，保留历史performance数据
  const db_type = db.type
  const nowFunc = db_type === 'postgres' ? 'NOW()' : 'datetime("now")'
  const isDeletedTrue = db_type === 'postgres' ? 'true' : '1'

  const result = await db.exec(`
    UPDATE campaigns
    SET is_deleted = ${isDeletedTrue},
        deleted_at = ${nowFunc},
        status = 'REMOVED'
    WHERE id = ? AND user_id = ?
  `, [id, userId])

  return result.changes > 0
}

/**
 * 更新广告系列状态
 */
export async function updateCampaignStatus(
  id: number,
  userId: number,
  status: string
): Promise<Campaign | null> {
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
