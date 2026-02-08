import { getDatabase } from '@/lib/db'
import { collectUserFeishuAccounts, parseFeishuAccountUserId } from '@/lib/openclaw/feishu-accounts'

type FeishuAuthMode = 'strict' | 'compat'
type FeishuAuthSettings = {
  authMode: FeishuAuthMode
  requireTenantKey: boolean
  strictAutoBind: boolean
}
type FeishuAccountConfigForBinding = {
  allowFrom?: string[]
  authMode?: string
  requireTenantKey?: boolean
  strictAutoBind?: boolean
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (!normalized) return fallback
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function resolveFeishuAuthMode(): FeishuAuthMode {
  const normalized = (process.env.OPENCLAW_FEISHU_AUTH_MODE || '').trim().toLowerCase()
  return normalized === 'compat' ? 'compat' : 'strict'
}

function resolveFeishuAuthSettingsFromOptions(params: {
  accountConfig?: FeishuAccountConfigForBinding | null
}): FeishuAuthSettings {
  const configModeRaw = String(params.accountConfig?.authMode || '').trim().toLowerCase()
  const authMode = configModeRaw === 'compat'
    ? 'compat'
    : configModeRaw === 'strict'
      ? 'strict'
      : resolveFeishuAuthMode()

  const requireTenantKey = typeof params.accountConfig?.requireTenantKey === 'boolean'
    ? params.accountConfig.requireTenantKey
    : resolveFeishuRequireTenantKey()

  const strictAutoBind = typeof params.accountConfig?.strictAutoBind === 'boolean'
    ? params.accountConfig.strictAutoBind
    : resolveFeishuStrictAutoBind()

  return { authMode, requireTenantKey, strictAutoBind }
}

async function collectFeishuAccountsSafe(): Promise<Record<string, FeishuAccountConfigForBinding> | null> {
  try {
    return await collectUserFeishuAccounts()
  } catch (error) {
    console.warn('[openclaw] failed to collect feishu accounts for binding fallback:', error)
    return null
  }
}

async function resolveFeishuAuthSettingsForAccount(accountId?: string | null): Promise<{
  settings: FeishuAuthSettings
  accounts: Record<string, FeishuAccountConfigForBinding> | null
}> {
  const normalizedAccountId = String(accountId || '').trim()
  if (!normalizedAccountId) {
    return {
      settings: resolveFeishuAuthSettingsFromOptions({ accountConfig: null }),
      accounts: null,
    }
  }

  const accounts = await collectFeishuAccountsSafe()
  if (!accounts) {
    return {
      settings: resolveFeishuAuthSettingsFromOptions({ accountConfig: null }),
      accounts: null,
    }
  }

  const accountConfig = accounts[normalizedAccountId] || null
  return {
    settings: resolveFeishuAuthSettingsFromOptions({ accountConfig }),
    accounts,
  }
}

function resolveFeishuRequireTenantKey(): boolean {
  return parseBooleanEnv(process.env.OPENCLAW_FEISHU_REQUIRE_TENANT_KEY, true)
}

function resolveFeishuStrictAutoBind(): boolean {
  return parseBooleanEnv(process.env.OPENCLAW_FEISHU_STRICT_AUTO_BIND, true)
}

function normalizeFeishuId(value?: string | null): string {
  return String(value || '').trim().replace(/^(feishu|lark):/i, '').toLowerCase()
}

async function findFeishuTenantBinding(params: {
  tenantKey: string
  senderId: string
}): Promise<number | null> {
  const db = await getDatabase()
  const scoped = await db.queryOne<{ user_id: number }>(
    `SELECT user_id FROM openclaw_user_bindings
     WHERE channel = 'feishu'
       AND tenant_key = ?
       AND status = 'active'
       AND (open_id = ? OR union_id = ?)
     LIMIT 1`,
    [params.tenantKey, params.senderId, params.senderId]
  )
  return scoped?.user_id ?? null
}

async function ensureStrictFeishuBinding(params: {
  userId: number
  tenantKey: string
  senderId: string
}): Promise<boolean> {
  const db = await getDatabase()
  const nowSql = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const existing = await db.queryOne<{ id: number; user_id: number }>(
    `SELECT id, user_id
     FROM openclaw_user_bindings
     WHERE channel = 'feishu'
       AND tenant_key = ?
       AND (open_id = ? OR union_id = ?)
     LIMIT 1`,
    [params.tenantKey, params.senderId, params.senderId]
  )

  if (existing && existing.user_id !== params.userId) {
    return false
  }

  if (existing) {
    await db.exec(
      `UPDATE openclaw_user_bindings
       SET tenant_key = ?,
           open_id = ?,
           union_id = ?,
           status = 'active',
           updated_at = ${nowSql}
       WHERE id = ?`,
      [params.tenantKey, params.senderId, params.senderId, existing.id]
    )
    return true
  }

  await db.exec(
    `INSERT INTO openclaw_user_bindings (user_id, channel, tenant_key, open_id, union_id, status)
     VALUES (?, 'feishu', ?, ?, ?, 'active')`,
    [params.userId, params.tenantKey, params.senderId, params.senderId]
  )

  return true
}

async function resolveStrictFeishuUser(params: {
  accountUserId: number | null
  senderId: string
  tenantKey?: string
  requireTenantKey: boolean
  strictAutoBind: boolean
}): Promise<number | null> {
  if (!params.accountUserId) {
    return null
  }

  if (!params.tenantKey) {
    if (params.requireTenantKey) {
      return null
    }
    return params.accountUserId
  }

  const tenantBindingUserId = await findFeishuTenantBinding({
    tenantKey: params.tenantKey,
    senderId: params.senderId,
  })

  if (tenantBindingUserId) {
    if (tenantBindingUserId !== params.accountUserId) {
      return null
    }
    return tenantBindingUserId
  }

  if (!params.strictAutoBind) {
    return null
  }

  const bound = await ensureStrictFeishuBinding({
    userId: params.accountUserId,
    tenantKey: params.tenantKey,
    senderId: params.senderId,
  })

  return bound ? params.accountUserId : null
}

async function resolveFeishuUserFromAllowlist(
  senderId: string,
  preloadedAccounts?: Record<string, FeishuAccountConfigForBinding> | null
): Promise<number | null> {
  const normalizedSenderId = normalizeFeishuId(senderId)
  if (!normalizedSenderId) return null

  const accounts = preloadedAccounts ?? await collectFeishuAccountsSafe()
  if (!accounts) {
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
  const accountId = (options?.accountId || '').trim()
  const accountUserId = parseFeishuAccountUserId(accountId)
  const normalizedChannel = (channel || '').trim()
  const normalizedSenderId = (senderId || '').trim()
  if (!normalizedChannel || !normalizedSenderId) return null

  const tenantKey = (options?.tenantKey || '').trim() || undefined
  const isFeishu = normalizedChannel.toLowerCase() === 'feishu'

  let feishuSettings: FeishuAuthSettings | null = null
  let feishuAccounts: Record<string, FeishuAccountConfigForBinding> | null = null
  if (isFeishu) {
    const resolved = await resolveFeishuAuthSettingsForAccount(accountId)
    feishuSettings = resolved.settings
    feishuAccounts = resolved.accounts
  }

  if (isFeishu && feishuSettings?.authMode === 'strict') {
    return await resolveStrictFeishuUser({
      accountUserId,
      senderId: normalizedSenderId,
      tenantKey,
      requireTenantKey: feishuSettings.requireTenantKey,
      strictAutoBind: feishuSettings.strictAutoBind,
    })
  }

  if (accountUserId) return accountUserId

  if (isFeishu && !tenantKey) {
    const feishuFallback = await resolveFeishuUserFromAllowlist(normalizedSenderId, feishuAccounts)
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
      const feishuFallback = await resolveFeishuUserFromAllowlist(normalizedSenderId, feishuAccounts)
      if (feishuFallback) return feishuFallback
      return null
    }
  }

  if (isFeishu) {
    const feishuFallback = await resolveFeishuUserFromAllowlist(normalizedSenderId, feishuAccounts)
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
