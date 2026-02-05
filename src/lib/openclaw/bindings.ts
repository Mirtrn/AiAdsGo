import { getDatabase } from '@/lib/db'

export async function resolveOpenclawUserFromBinding(
  channel?: string | null,
  senderId?: string | null
): Promise<number | null> {
  if (!channel || !senderId) return null
  const db = await getDatabase()
  const record = await db.queryOne<{ user_id: number }>(
    `SELECT user_id FROM openclaw_user_bindings
     WHERE channel = ?
       AND status = 'active'
       AND (open_id = ? OR union_id = ?)`,
    [channel, senderId, senderId]
  )
  if (record?.user_id) return record.user_id

  if (channel !== 'feishu') return null

  const fallback = await db.queryOne<{ user_id: number }>(
    `SELECT user_id FROM system_settings
     WHERE category = 'openclaw'
       AND key = 'feishu_target'
       AND user_id IS NOT NULL
       AND value = ?
     LIMIT 1`,
    [senderId]
  )

  return fallback?.user_id ?? null
}
