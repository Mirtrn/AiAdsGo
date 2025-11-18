import { getDatabase } from './db'

export interface Creative {
  id: number
  userId: number
  offerId: number
  version: number
  headline1: string
  headline2: string | null
  headline3: string | null
  description1: string
  description2: string | null
  finalUrl: string
  path1: string | null
  path2: string | null
  aiModel: string
  generationPrompt: string | null
  qualityScore: number | null
  isApproved: boolean
  approvedBy: number | null
  approvedAt: string | null
  createdAt: string
}

export interface CreateCreativeInput {
  userId: number
  offerId: number
  headline1: string
  headline2?: string
  headline3?: string
  description1: string
  description2?: string
  finalUrl: string
  path1?: string
  path2?: string
  aiModel: string
  generationPrompt?: string
  qualityScore?: number
}

/**
 * 创建新的创意
 */
export function createCreative(input: CreateCreativeInput): Creative {
  const db = getDatabase()

  // 获取该Offer的最新版本号
  const maxVersionStmt = db.prepare(`
    SELECT MAX(version) as max_version
    FROM creatives
    WHERE user_id = ? AND offer_id = ?
  `)
  const result = maxVersionStmt.get(input.userId, input.offerId) as { max_version: number | null }
  const newVersion = (result.max_version || 0) + 1

  const stmt = db.prepare(`
    INSERT INTO creatives (
      user_id, offer_id, version,
      headline_1, headline_2, headline_3,
      description_1, description_2,
      final_url, path_1, path_2,
      ai_model, generation_prompt, quality_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const info = stmt.run(
    input.userId,
    input.offerId,
    newVersion,
    input.headline1,
    input.headline2 || null,
    input.headline3 || null,
    input.description1,
    input.description2 || null,
    input.finalUrl,
    input.path1 || null,
    input.path2 || null,
    input.aiModel,
    input.generationPrompt || null,
    input.qualityScore || null
  )

  return findCreativeById(info.lastInsertRowid as number, input.userId)!
}

/**
 * 批量创建创意
 */
export function createCreatives(inputs: CreateCreativeInput[]): Creative[] {
  const db = getDatabase()
  const createBatch = db.transaction((creatives: CreateCreativeInput[]) => {
    return creatives.map(input => createCreative(input))
  })

  return createBatch(inputs)
}

/**
 * 查找单个创意（带权限验证）
 */
export function findCreativeById(id: number, userId: number): Creative | null {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM creatives
    WHERE id = ? AND user_id = ?
  `)

  const row = stmt.get(id, userId) as any

  if (!row) {
    return null
  }

  return mapRowToCreative(row)
}

/**
 * 查找Offer的所有创意
 */
export function findCreativesByOfferId(offerId: number, userId: number): Creative[] {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT * FROM creatives
    WHERE offer_id = ? AND user_id = ?
    ORDER BY version DESC, created_at DESC
  `)

  const rows = stmt.all(offerId, userId) as any[]
  return rows.map(mapRowToCreative)
}

/**
 * 查找用户的所有创意
 */
export function findCreativesByUserId(userId: number, limit?: number): Creative[] {
  const db = getDatabase()
  let sql = `
    SELECT * FROM creatives
    WHERE user_id = ?
    ORDER BY created_at DESC
  `

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const stmt = db.prepare(sql)
  const rows = stmt.all(userId) as any[]
  return rows.map(mapRowToCreative)
}

/**
 * 更新创意
 */
export function updateCreative(
  id: number,
  userId: number,
  updates: Partial<Pick<Creative, 'headline1' | 'headline2' | 'headline3' | 'description1' | 'description2' | 'finalUrl' | 'path1' | 'path2' | 'qualityScore'>>
): Creative | null {
  const db = getDatabase()

  // 验证权限
  const creative = findCreativeById(id, userId)
  if (!creative) {
    return null
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.headline1 !== undefined) {
    fields.push('headline_1 = ?')
    values.push(updates.headline1)
  }
  if (updates.headline2 !== undefined) {
    fields.push('headline_2 = ?')
    values.push(updates.headline2)
  }
  if (updates.headline3 !== undefined) {
    fields.push('headline_3 = ?')
    values.push(updates.headline3)
  }
  if (updates.description1 !== undefined) {
    fields.push('description_1 = ?')
    values.push(updates.description1)
  }
  if (updates.description2 !== undefined) {
    fields.push('description_2 = ?')
    values.push(updates.description2)
  }
  if (updates.finalUrl !== undefined) {
    fields.push('final_url = ?')
    values.push(updates.finalUrl)
  }
  if (updates.path1 !== undefined) {
    fields.push('path_1 = ?')
    values.push(updates.path1)
  }
  if (updates.path2 !== undefined) {
    fields.push('path_2 = ?')
    values.push(updates.path2)
  }
  if (updates.qualityScore !== undefined) {
    fields.push('quality_score = ?')
    values.push(updates.qualityScore)
  }

  if (fields.length === 0) {
    return creative
  }

  values.push(id, userId)

  const stmt = db.prepare(`
    UPDATE creatives
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `)

  stmt.run(...values)

  return findCreativeById(id, userId)
}

/**
 * 批准创意
 */
export function approveCreative(id: number, userId: number, approvedByUserId: number): Creative | null {
  const db = getDatabase()

  const stmt = db.prepare(`
    UPDATE creatives
    SET is_approved = 1,
        approved_by = ?,
        approved_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `)

  const info = stmt.run(approvedByUserId, id, userId)

  if (info.changes === 0) {
    return null
  }

  return findCreativeById(id, userId)
}

/**
 * 取消批准
 */
export function unapproveCreative(id: number, userId: number): Creative | null {
  const db = getDatabase()

  const stmt = db.prepare(`
    UPDATE creatives
    SET is_approved = 0,
        approved_by = NULL,
        approved_at = NULL
    WHERE id = ? AND user_id = ?
  `)

  const info = stmt.run(id, userId)

  if (info.changes === 0) {
    return null
  }

  return findCreativeById(id, userId)
}

/**
 * 删除创意
 */
export function deleteCreative(id: number, userId: number): boolean {
  const db = getDatabase()

  const stmt = db.prepare(`
    DELETE FROM creatives
    WHERE id = ? AND user_id = ?
  `)

  const info = stmt.run(id, userId)
  return info.changes > 0
}

/**
 * 获取Offer的最新创意版本号
 */
export function getLatestCreativeVersion(offerId: number, userId: number): number {
  const db = getDatabase()

  const stmt = db.prepare(`
    SELECT MAX(version) as max_version
    FROM creatives
    WHERE offer_id = ? AND user_id = ?
  `)

  const result = stmt.get(offerId, userId) as { max_version: number | null }
  return result.max_version || 0
}

/**
 * 数据库行映射为Creative对象
 */
function mapRowToCreative(row: any): Creative {
  return {
    id: row.id,
    userId: row.user_id,
    offerId: row.offer_id,
    version: row.version,
    headline1: row.headline_1,
    headline2: row.headline_2,
    headline3: row.headline_3,
    description1: row.description_1,
    description2: row.description_2,
    finalUrl: row.final_url,
    path1: row.path_1,
    path2: row.path_2,
    aiModel: row.ai_model,
    generationPrompt: row.generation_prompt,
    qualityScore: row.quality_score,
    isApproved: row.is_approved === 1,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  }
}
