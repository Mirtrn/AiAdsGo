import { getDatabase } from './db'

export interface Keyword {
  id: number
  userId: number
  adGroupId: number
  keywordId: string | null
  keywordText: string
  matchType: string
  status: string
  cpcBidMicros: number | null
  finalUrl: string | null
  isNegative: boolean
  qualityScore: number | null
  aiGenerated: boolean
  generationSource: string | null
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateKeywordInput {
  userId: number
  adGroupId: number
  keywordText: string
  matchType?: string
  status?: string
  cpcBidMicros?: number
  finalUrl?: string
  isNegative?: boolean
  aiGenerated?: boolean
  generationSource?: string
}

/**
 * 创建Keyword
 */
export function createKeyword(input: CreateKeywordInput): Keyword {
  const db = getDatabase()

  const stmt = db.prepare(`
    INSERT INTO keywords (
      user_id, ad_group_id, keyword_text,
      match_type, status, cpc_bid_micros,
      final_url, is_negative, ai_generated,
      generation_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const info = stmt.run(
    input.userId,
    input.adGroupId,
    input.keywordText,
    input.matchType || 'BROAD',
    input.status || 'PAUSED',
    input.cpcBidMicros || null,
    input.finalUrl || null,
    input.isNegative ? 1 : 0,
    input.aiGenerated ? 1 : 0,
    input.generationSource || null
  )

  return findKeywordById(info.lastInsertRowid as number, input.userId)!
}

/**
 * 查找Keyword（带权限验证）
 */
export function findKeywordById(id: number, userId: number): Keyword | null {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM keywords
    WHERE id = ? AND user_id = ?
  `)

  const row = stmt.get(id, userId) as any

  if (!row) {
    return null
  }

  return mapRowToKeyword(row)
}

/**
 * 根据Google Ads keyword_id查找
 */
export function findKeywordByGoogleId(keywordId: string, userId: number): Keyword | null {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM keywords
    WHERE keyword_id = ? AND user_id = ?
  `)

  const row = stmt.get(keywordId, userId) as any

  if (!row) {
    return null
  }

  return mapRowToKeyword(row)
}

/**
 * 查找Ad Group的所有Keywords
 */
export function findKeywordsByAdGroupId(adGroupId: number, userId: number): Keyword[] {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM keywords
    WHERE ad_group_id = ? AND user_id = ?
    ORDER BY created_at DESC
  `)

  const rows = stmt.all(adGroupId, userId) as any[]
  return rows.map(mapRowToKeyword)
}

/**
 * 查找用户的所有Keywords
 */
export function findKeywordsByUserId(userId: number, limit?: number): Keyword[] {
  const db = getDatabase()
  let sql = `
    SELECT * FROM keywords
    WHERE user_id = ?
    ORDER BY created_at DESC
  `

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const stmt = db.prepare(sql)
  const rows = stmt.all(userId) as any[]
  return rows.map(mapRowToKeyword)
}

/**
 * 查找AI生成的Keywords
 */
export function findAIGeneratedKeywords(adGroupId: number, userId: number): Keyword[] {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM keywords
    WHERE ad_group_id = ? AND user_id = ? AND ai_generated = 1
    ORDER BY created_at DESC
  `)

  const rows = stmt.all(adGroupId, userId) as any[]
  return rows.map(mapRowToKeyword)
}

/**
 * 更新Keyword
 */
export function updateKeyword(
  id: number,
  userId: number,
  updates: Partial<
    Pick<
      Keyword,
      | 'keywordText'
      | 'matchType'
      | 'status'
      | 'cpcBidMicros'
      | 'finalUrl'
      | 'isNegative'
      | 'qualityScore'
      | 'keywordId'
      | 'creationStatus'
      | 'creationError'
      | 'lastSyncAt'
    >
  >
): Keyword | null {
  const db = getDatabase()

  // 验证权限
  const keyword = findKeywordById(id, userId)
  if (!keyword) {
    return null
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.keywordText !== undefined) {
    fields.push('keyword_text = ?')
    values.push(updates.keywordText)
  }
  if (updates.matchType !== undefined) {
    fields.push('match_type = ?')
    values.push(updates.matchType)
  }
  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.cpcBidMicros !== undefined) {
    fields.push('cpc_bid_micros = ?')
    values.push(updates.cpcBidMicros)
  }
  if (updates.finalUrl !== undefined) {
    fields.push('final_url = ?')
    values.push(updates.finalUrl)
  }
  if (updates.isNegative !== undefined) {
    fields.push('is_negative = ?')
    values.push(updates.isNegative ? 1 : 0)
  }
  if (updates.qualityScore !== undefined) {
    fields.push('quality_score = ?')
    values.push(updates.qualityScore)
  }
  if (updates.keywordId !== undefined) {
    fields.push('keyword_id = ?')
    values.push(updates.keywordId)
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
    return keyword
  }

  fields.push('updated_at = datetime("now")')
  values.push(id, userId)

  const stmt = db.prepare(`
    UPDATE keywords
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `)

  stmt.run(...values)

  return findKeywordById(id, userId)
}

/**
 * 删除Keyword
 */
export function deleteKeyword(id: number, userId: number): boolean {
  const db = getDatabase()

  const stmt = db.prepare(`
    DELETE FROM keywords
    WHERE id = ? AND user_id = ?
  `)

  const info = stmt.run(id, userId)
  return info.changes > 0
}

/**
 * 批量创建Keywords
 */
export function createKeywordsBatch(keywords: CreateKeywordInput[]): Keyword[] {
  const db = getDatabase()

  const transaction = db.transaction((kws: CreateKeywordInput[]) => {
    const results: Keyword[] = []

    for (const kw of kws) {
      const keyword = createKeyword(kw)
      results.push(keyword)
    }

    return results
  })

  return transaction(keywords)
}

/**
 * 批量更新Keywords状态
 */
export function updateKeywordsStatus(
  keywordIds: number[],
  userId: number,
  status: string
): number {
  const db = getDatabase()

  const transaction = db.transaction((ids: number[], uid: number, newStatus: string) => {
    let updateCount = 0

    for (const id of ids) {
      const result = updateKeyword(id, uid, { status: newStatus })
      if (result) {
        updateCount++
      }
    }

    return updateCount
  })

  return transaction(keywordIds, userId, status)
}

/**
 * 删除Ad Group的所有Keywords
 */
export function deleteKeywordsByAdGroupId(adGroupId: number, userId: number): number {
  const db = getDatabase()

  const stmt = db.prepare(`
    DELETE FROM keywords
    WHERE ad_group_id = ? AND user_id = ?
  `)

  const info = stmt.run(adGroupId, userId)
  return info.changes
}

/**
 * 数据库行映射为Keyword对象
 */
function mapRowToKeyword(row: any): Keyword {
  return {
    id: row.id,
    userId: row.user_id,
    adGroupId: row.ad_group_id,
    keywordId: row.keyword_id,
    keywordText: row.keyword_text,
    matchType: row.match_type,
    status: row.status,
    cpcBidMicros: row.cpc_bid_micros,
    finalUrl: row.final_url,
    isNegative: row.is_negative === 1,
    qualityScore: row.quality_score,
    aiGenerated: row.ai_generated === 1,
    generationSource: row.generation_source,
    creationStatus: row.creation_status,
    creationError: row.creation_error,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
