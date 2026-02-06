import { getDatabase } from '@/lib/db'
import { parseFeishuAccountUserId } from '@/lib/openclaw/feishu-accounts'

export async function resolveOpenclawUserFromBinding(
  channel?: string | null,
  senderId?: string | null,
  options?: { accountId?: string | null; tenantKey?: string | null }
): Promise<number | null> {
  const accountUserId = parseFeishuAccountUserId(options?.accountId)
  if (accountUserId) return accountUserId

  const normalizedChannel = (channel || '').trim()
  const normalizedSenderId = (senderId || '').trim()
  if (!normalizedChannel || !normalizedSenderId) return null

  const tenantKey = options?.tenantKey?.trim()
  const isFeishu = normalizedChannel.toLowerCase() === 'feishu'

  if (isFeishu && !tenantKey) {
    return null
  }

  const db = await getDatabase()

  if (tenantKey) {
    const scoped = await db.queryOne<{ user_id: number }>(
      `SELECT user_id FROM openclaw_user_bindings
       WHERE channel = ?
         AND tenant_key = ?
         AND status = 'active'
         AND (open_id = ? OR union_id = ?)
       LIMIT 1`,
      [normalizedChannel, tenantKey, normalizedSenderId, normalizedSenderId]
    )

    if (scoped?.user_id) return scoped.user_id

    if (isFeishu) {
      return null
    }
  }

  if (isFeishu) {
    return null
  }

  const record = await db.queryOne<{ user_id: number }>(
    `SELECT user_id FROM openclaw_user_bindings
     WHERE channel = ?
       AND status = 'active'
       AND (open_id = ? OR union_id = ?)
     LIMIT 1`,
    [normalizedChannel, normalizedSenderId, normalizedSenderId]
  )

  return record?.user_id ?? null
}
