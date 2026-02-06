import { decrypt } from '@/lib/crypto'
import { getDatabase } from '@/lib/db'
import type { SystemSetting } from '@/lib/settings'
import { getUserOnlySetting } from '@/lib/settings'

const FEISHU_USER_ACCOUNT_PREFIX = 'user-'
const FEISHU_USER_KEYS = [
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_bot_name',
  'feishu_domain',
]

type FeishuAccountConfig = {
  appId: string
  appSecret: string
  botName?: string
  domain?: string
  enabled?: boolean
  name?: string
}

export function getFeishuAccountIdForUser(userId: number): string {
  return `${FEISHU_USER_ACCOUNT_PREFIX}${userId}`
}

export function parseFeishuAccountUserId(accountId?: string | null): number | null {
  if (!accountId) return null
  const normalized = accountId.trim()
  if (!normalized.startsWith(FEISHU_USER_ACCOUNT_PREFIX)) return null
  const raw = normalized.slice(FEISHU_USER_ACCOUNT_PREFIX.length)
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

export async function resolveUserFeishuAccountId(userId: number): Promise<string | null> {
  const appId = await getUserOnlySetting('openclaw', 'feishu_app_id', userId)
  const appSecret = await getUserOnlySetting('openclaw', 'feishu_app_secret', userId)
  if (!appId?.value || !appSecret?.value) return null
  return getFeishuAccountIdForUser(userId)
}

function resolveSettingValue(setting: Pick<SystemSetting, 'value' | 'encrypted_value' | 'is_sensitive'>): string {
  const isSensitive = setting.is_sensitive === true || setting.is_sensitive === 1
  if (isSensitive && setting.encrypted_value) {
    return decrypt(setting.encrypted_value)
  }
  return setting.value ?? ''
}

export async function collectUserFeishuAccounts(): Promise<Record<string, FeishuAccountConfig>> {
  const db = await getDatabase()
  const placeholders = FEISHU_USER_KEYS.map(() => '?').join(', ')
  const rows = await db.query<SystemSetting>(
    `SELECT user_id, key, value, encrypted_value, is_sensitive
     FROM system_settings
     WHERE category = ?
       AND user_id IS NOT NULL
       AND key IN (${placeholders})`,
    ['openclaw', ...FEISHU_USER_KEYS]
  )

  const byUser = new Map<number, Record<string, string>>()
  for (const row of rows) {
    if (!row.user_id) continue
    const value = resolveSettingValue(row).trim()
    if (!value) continue
    const existing = byUser.get(row.user_id) || {}
    existing[row.key] = value
    byUser.set(row.user_id, existing)
  }

  const accounts: Record<string, FeishuAccountConfig> = {}
  for (const [userId, values] of byUser.entries()) {
    const appId = values.feishu_app_id?.trim()
    const appSecret = values.feishu_app_secret?.trim()
    if (!appId || !appSecret) continue
    const accountId = getFeishuAccountIdForUser(userId)
    accounts[accountId] = {
      appId,
      appSecret,
      botName: values.feishu_bot_name?.trim() || undefined,
      domain: values.feishu_domain?.trim() || undefined,
      enabled: true,
      name: `user-${userId}`,
    }
  }

  return accounts
}
