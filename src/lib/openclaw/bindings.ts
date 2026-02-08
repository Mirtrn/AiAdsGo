import { getDatabase } from '@/lib/db'
import { collectUserFeishuAccounts, parseFeishuAccountUserId } from '@/lib/openclaw/feishu-accounts'

function normalizeFeishuId(value?: string | null): string {
  return String(value || '').trim().replace(/^(feishu|lark):/i, '').toLowerCase()
}

async function resolveFeishuUserFromAllowlist(senderId: string): Promise<number | null> {
  const normalizedSenderId = normalizeFeishuId(senderId)
  if (!normalizedSenderId) return null

  let accounts: Record<string, { allowFrom?: string[] }>
  try {
    accounts = await collectUserFeishuAccounts()
  } catch (error) {
    console.warn('[openclaw] failed to collect feishu accounts for binding fallback:', error)
    return null
  }

  const matchedUserIds = new Set<number>()

  for (const [accountId, accountConfig] of Object.entries(accounts)) {
    const userId = parseFeishuAccountUserId(accountId)
    if (!userId) continue

    const allowFrom = Array.isArray(accountConfig?.allowFrom)
      ? accountConfig.allowFrom
      : []
    if (allowFrom.length === 0) continue

    const isAllowed = allowFrom.some((entry) => normalizeFeishuId(entry) === normalizedSenderId)
    if (isAllowed) {
      matchedUserIds.add(userId)
    }
  }

  if (matchedUserIds.size !== 1) return null
  return Array.from(matchedUserIds)[0] ?? null
}

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
    const feishuFallback = await resolveFeishuUserFromAllowlist(normalizedSenderId)
    if (feishuFallback) return feishuFallback
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
      const feishuFallback = await resolveFeishuUserFromAllowlist(normalizedSenderId)
      if (feishuFallback) return feishuFallback
      return null
    }
  }

  if (isFeishu) {
    const feishuFallback = await resolveFeishuUserFromAllowlist(normalizedSenderId)
    if (feishuFallback) return feishuFallback
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
