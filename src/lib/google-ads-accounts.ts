import { getDatabase } from './db'

export interface GoogleAdsAccount {
  id: number
  userId: number
  customerId: string
  accountName: string | null
  currency: string
  timezone: string
  isManagerAccount: boolean
  isActive: boolean
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: string | null
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateGoogleAdsAccountInput {
  userId: number
  customerId: string
  accountName?: string
  currency?: string
  timezone?: string
  isManagerAccount?: boolean
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: string
}

/**
 * 创建Google Ads账号
 */
export function createGoogleAdsAccount(input: CreateGoogleAdsAccountInput): GoogleAdsAccount {
  const db = getDatabase()

  const stmt = db.prepare(`
    INSERT INTO google_ads_accounts (
      user_id, customer_id, account_name,
      currency, timezone, is_manager_account,
      access_token, refresh_token, token_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const info = stmt.run(
    input.userId,
    input.customerId,
    input.accountName || null,
    input.currency || 'USD',
    input.timezone || 'America/New_York',
    input.isManagerAccount ? 1 : 0,
    input.accessToken || null,
    input.refreshToken || null,
    input.tokenExpiresAt || null
  )

  return findGoogleAdsAccountById(info.lastInsertRowid as number, input.userId)!
}

/**
 * 查找Google Ads账号（带权限验证）
 */
export function findGoogleAdsAccountById(id: number, userId: number): GoogleAdsAccount | null {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM google_ads_accounts
    WHERE id = ? AND user_id = ?
  `)

  const row = stmt.get(id, userId) as any

  if (!row) {
    return null
  }

  return mapRowToGoogleAdsAccount(row)
}

/**
 * 根据customer_id查找账号
 */
export function findGoogleAdsAccountByCustomerId(
  customerId: string,
  userId: number
): GoogleAdsAccount | null {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM google_ads_accounts
    WHERE customer_id = ? AND user_id = ?
  `)

  const row = stmt.get(customerId, userId) as any

  if (!row) {
    return null
  }

  return mapRowToGoogleAdsAccount(row)
}

/**
 * 查找用户的所有Google Ads账号
 */
export function findGoogleAdsAccountsByUserId(userId: number): GoogleAdsAccount[] {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM google_ads_accounts
    WHERE user_id = ?
    ORDER BY created_at DESC
  `)

  const rows = stmt.all(userId) as any[]
  return rows.map(mapRowToGoogleAdsAccount)
}

/**
 * 查找用户的激活账号
 */
export function findActiveGoogleAdsAccounts(userId: number): GoogleAdsAccount[] {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM google_ads_accounts
    WHERE user_id = ? AND is_active = 1
    ORDER BY created_at DESC
  `)

  const rows = stmt.all(userId) as any[]
  return rows.map(mapRowToGoogleAdsAccount)
}

/**
 * 更新Google Ads账号
 */
export function updateGoogleAdsAccount(
  id: number,
  userId: number,
  updates: Partial<
    Pick<
      GoogleAdsAccount,
      | 'accountName'
      | 'currency'
      | 'timezone'
      | 'isActive'
      | 'accessToken'
      | 'refreshToken'
      | 'tokenExpiresAt'
      | 'lastSyncAt'
    >
  >
): GoogleAdsAccount | null {
  const db = getDatabase()

  // 验证权限
  const account = findGoogleAdsAccountById(id, userId)
  if (!account) {
    return null
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.accountName !== undefined) {
    fields.push('account_name = ?')
    values.push(updates.accountName)
  }
  if (updates.currency !== undefined) {
    fields.push('currency = ?')
    values.push(updates.currency)
  }
  if (updates.timezone !== undefined) {
    fields.push('timezone = ?')
    values.push(updates.timezone)
  }
  if (updates.isActive !== undefined) {
    fields.push('is_active = ?')
    values.push(updates.isActive ? 1 : 0)
  }
  if (updates.accessToken !== undefined) {
    fields.push('access_token = ?')
    values.push(updates.accessToken)
  }
  if (updates.refreshToken !== undefined) {
    fields.push('refresh_token = ?')
    values.push(updates.refreshToken)
  }
  if (updates.tokenExpiresAt !== undefined) {
    fields.push('token_expires_at = ?')
    values.push(updates.tokenExpiresAt)
  }
  if (updates.lastSyncAt !== undefined) {
    fields.push('last_sync_at = ?')
    values.push(updates.lastSyncAt)
  }

  if (fields.length === 0) {
    return account
  }

  fields.push('updated_at = datetime("now")')
  values.push(id, userId)

  const stmt = db.prepare(`
    UPDATE google_ads_accounts
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `)

  stmt.run(...values)

  return findGoogleAdsAccountById(id, userId)
}

/**
 * 删除Google Ads账号
 */
export function deleteGoogleAdsAccount(id: number, userId: number): boolean {
  const db = getDatabase()

  const stmt = db.prepare(`
    DELETE FROM google_ads_accounts
    WHERE id = ? AND user_id = ?
  `)

  const info = stmt.run(id, userId)
  return info.changes > 0
}

/**
 * 设置默认激活账号（将其他账号设为不激活）
 */
export function setActiveGoogleAdsAccount(id: number, userId: number): boolean {
  const db = getDatabase()

  // 开始事务
  const setActive = db.transaction((accountId: number, uid: number) => {
    // 将所有账号设为不激活
    db.prepare(`
      UPDATE google_ads_accounts
      SET is_active = 0
      WHERE user_id = ?
    `).run(uid)

    // 将指定账号设为激活
    const info = db
      .prepare(`
      UPDATE google_ads_accounts
      SET is_active = 1, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `)
      .run(accountId, uid)

    return info.changes > 0
  })

  return setActive(id, userId)
}

/**
 * 数据库行映射为GoogleAdsAccount对象
 */
function mapRowToGoogleAdsAccount(row: any): GoogleAdsAccount {
  return {
    id: row.id,
    userId: row.user_id,
    customerId: row.customer_id,
    accountName: row.account_name,
    currency: row.currency,
    timezone: row.timezone,
    isManagerAccount: row.is_manager_account === 1,
    isActive: row.is_active === 1,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
