import { getDatabase } from './db'

export interface AdGroup {
  id: number
  userId: number
  campaignId: number
  adGroupId: string | null
  adGroupName: string
  status: string
  cpcBidMicros: number | null
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAdGroupInput {
  userId: number
  campaignId: number
  adGroupName: string
  status?: string
  cpcBidMicros?: number
}

/**
 * 创建Ad Group
 */
export function createAdGroup(input: CreateAdGroupInput): AdGroup {
  const db = getDatabase()

  const stmt = db.prepare(`
    INSERT INTO ad_groups (
      user_id, campaign_id, ad_group_name,
      status, cpc_bid_micros
    ) VALUES (?, ?, ?, ?, ?)
  `)

  const info = stmt.run(
    input.userId,
    input.campaignId,
    input.adGroupName,
    input.status || 'PAUSED',
    input.cpcBidMicros || null
  )

  return findAdGroupById(info.lastInsertRowid as number, input.userId)!
}

/**
 * 查找Ad Group（带权限验证）
 */
export function findAdGroupById(id: number, userId: number): AdGroup | null {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM ad_groups
    WHERE id = ? AND user_id = ?
  `)

  const row = stmt.get(id, userId) as any

  if (!row) {
    return null
  }

  return mapRowToAdGroup(row)
}

/**
 * 根据Google Ads ad_group_id查找
 */
export function findAdGroupByGoogleId(adGroupId: string, userId: number): AdGroup | null {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM ad_groups
    WHERE ad_group_id = ? AND user_id = ?
  `)

  const row = stmt.get(adGroupId, userId) as any

  if (!row) {
    return null
  }

  return mapRowToAdGroup(row)
}

/**
 * 查找Campaign的所有Ad Groups
 */
export function findAdGroupsByCampaignId(campaignId: number, userId: number): AdGroup[] {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM ad_groups
    WHERE campaign_id = ? AND user_id = ?
    ORDER BY created_at DESC
  `)

  const rows = stmt.all(campaignId, userId) as any[]
  return rows.map(mapRowToAdGroup)
}

/**
 * 查找用户的所有Ad Groups
 */
export function findAdGroupsByUserId(userId: number, limit?: number): AdGroup[] {
  const db = getDatabase()
  let sql = `
    SELECT * FROM ad_groups
    WHERE user_id = ?
    ORDER BY created_at DESC
  `

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const stmt = db.prepare(sql)
  const rows = stmt.all(userId) as any[]
  return rows.map(mapRowToAdGroup)
}

/**
 * 更新Ad Group
 */
export function updateAdGroup(
  id: number,
  userId: number,
  updates: Partial<
    Pick<
      AdGroup,
      | 'adGroupName'
      | 'status'
      | 'cpcBidMicros'
      | 'adGroupId'
      | 'creationStatus'
      | 'creationError'
      | 'lastSyncAt'
    >
  >
): AdGroup | null {
  const db = getDatabase()

  // 验证权限
  const adGroup = findAdGroupById(id, userId)
  if (!adGroup) {
    return null
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.adGroupName !== undefined) {
    fields.push('ad_group_name = ?')
    values.push(updates.adGroupName)
  }
  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.cpcBidMicros !== undefined) {
    fields.push('cpc_bid_micros = ?')
    values.push(updates.cpcBidMicros)
  }
  if (updates.adGroupId !== undefined) {
    fields.push('ad_group_id = ?')
    values.push(updates.adGroupId)
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
    return adGroup
  }

  fields.push('updated_at = datetime("now")')
  values.push(id, userId)

  const stmt = db.prepare(`
    UPDATE ad_groups
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `)

  stmt.run(...values)

  return findAdGroupById(id, userId)
}

/**
 * 删除Ad Group
 */
export function deleteAdGroup(id: number, userId: number): boolean {
  const db = getDatabase()

  const stmt = db.prepare(`
    DELETE FROM ad_groups
    WHERE id = ? AND user_id = ?
  `)

  const info = stmt.run(id, userId)
  return info.changes > 0
}

/**
 * 更新Ad Group状态
 */
export function updateAdGroupStatus(id: number, userId: number, status: string): AdGroup | null {
  return updateAdGroup(id, userId, { status })
}

/**
 * 批量创建Ad Groups
 */
export function createAdGroupsBatch(adGroups: CreateAdGroupInput[]): AdGroup[] {
  const db = getDatabase()

  const transaction = db.transaction((groups: CreateAdGroupInput[]) => {
    const results: AdGroup[] = []

    for (const group of groups) {
      const adGroup = createAdGroup(group)
      results.push(adGroup)
    }

    return results
  })

  return transaction(adGroups)
}

/**
 * 数据库行映射为AdGroup对象
 */
function mapRowToAdGroup(row: any): AdGroup {
  return {
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id,
    adGroupId: row.ad_group_id,
    adGroupName: row.ad_group_name,
    status: row.status,
    cpcBidMicros: row.cpc_bid_micros,
    creationStatus: row.creation_status,
    creationError: row.creation_error,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
