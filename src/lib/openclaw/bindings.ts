import { getDatabase } from '@/lib/db'
import { parseFeishuAccountUserId } from '@/lib/openclaw/feishu-accounts'

export async function resolveOpenclawUserFromBinding(
  channel?: string | null,
  senderId?: string | null,
  options?: { accountId?: string | null; tenantKey?: string | null }
): Promise<number | null> {
  const accountUserId = parseFeishuAccountUserId(options?.accountId)
  if (accountUserId) return accountUserId
  if (!channel || !senderId) return null
  const db = await getDatabase()
  const tenantKey = options?.tenantKey?.trim()
  if (tenantKey) {
    const scoped = await db.queryOne<{ user_id: number }>(
      `SELECT user_id FROM openclaw_user_bindings
       WHERE channel = ?
         AND tenant_key = ?
         AND status = 'active'
         AND (open_id = ? OR union_id = ?)
       LIMIT 1`,
      [channel, tenantKey, senderId, senderId]
    )
    if (scoped?.user_id) return scoped.user_id
  }
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
