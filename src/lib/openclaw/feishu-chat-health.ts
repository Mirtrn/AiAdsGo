import { getDatabase } from '@/lib/db'
import { datetimeMinusHours } from '@/lib/db-helpers'

export type FeishuChatHealthDecision = 'allowed' | 'blocked' | 'error'

export type FeishuChatHealthLogInput = {
  userId: number
  accountId: string
  messageId?: string | null
  chatId?: string | null
  chatType?: string | null
  messageType?: string | null
  senderPrimaryId?: string | null
  senderOpenId?: string | null
  senderUnionId?: string | null
  senderUserId?: string | null
  senderCandidates?: string[]
  decision: FeishuChatHealthDecision
  reasonCode: string
  reasonMessage?: string | null
  messageText?: string | null
  metadata?: Record<string, unknown> | null
}

type FeishuChatHealthRow = {
  id: number
  user_id: number
  account_id: string
  message_id: string | null
  chat_id: string | null
  chat_type: string | null
  message_type: string | null
  sender_primary_id: string | null
  sender_open_id: string | null
  sender_union_id: string | null
  sender_user_id: string | null
  sender_candidates_json: string | null
  decision: FeishuChatHealthDecision
  reason_code: string
  reason_message: string | null
  message_text: string | null
  message_text_length: number
  metadata_json: string | null
  created_at: string | Date
}

type FeishuChatHealthStatsRow = {
  decision: string
  total: number | string
}

export type FeishuChatHealthLogItem = {
  id: number
  userId: number
  accountId: string
  messageId: string | null
  chatId: string | null
  chatType: string | null
  messageType: string | null
  senderPrimaryId: string | null
  senderOpenId: string | null
  senderUnionId: string | null
  senderUserId: string | null
  senderCandidates: string[]
  decision: FeishuChatHealthDecision
  reasonCode: string
  reasonMessage: string | null
  messageText: string | null
  messageExcerpt: string
  messageTextLength: number
  metadata: Record<string, unknown> | null
  createdAt: string
}

export type FeishuChatHealthListResult = {
  rows: FeishuChatHealthLogItem[]
  stats: {
    total: number
    allowed: number
    blocked: number
    error: number
  }
}

const FEISHU_HEALTH_RETENTION_DAYS = 7
const FEISHU_HEALTH_RETENTION_HOURS = FEISHU_HEALTH_RETENTION_DAYS * 24
const FEISHU_HEALTH_MESSAGE_EXCERPT_LIMIT = 500
const FEISHU_HEALTH_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

let lastCleanupAt = 0

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function normalizeShortText(value: unknown, maxLength: number): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  return text.slice(0, maxLength)
}

function normalizeMessageText(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  return text.slice(0, 20_000)
}

function safeParseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function safeParseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  const text = String(value || '').trim()
  if (!text) {
    return new Date().toISOString()
  }

  const normalized = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    return text
  }
  return date.toISOString()
}

function toMessageExcerpt(messageText: string | null): string {
  if (!messageText) return ''
  return messageText.length <= FEISHU_HEALTH_MESSAGE_EXCERPT_LIMIT
    ? messageText
    : `${messageText.slice(0, FEISHU_HEALTH_MESSAGE_EXCERPT_LIMIT)}…`
}

async function cleanupFeishuChatHealthLogsIfNeeded() {
  const now = Date.now()
  if (now - lastCleanupAt < FEISHU_HEALTH_CLEANUP_INTERVAL_MS) {
    return
  }
  lastCleanupAt = now

  const db = await getDatabase()
  const cutoffExpr = datetimeMinusHours(FEISHU_HEALTH_RETENTION_HOURS, db.type)
  await db.exec(
    `DELETE FROM openclaw_feishu_chat_health_logs
     WHERE created_at < ${cutoffExpr}`
  )
}

export async function recordFeishuChatHealthLog(input: FeishuChatHealthLogInput): Promise<void> {
  const db = await getDatabase()

  const accountId = normalizeShortText(input.accountId, 120)
  const reasonCode = normalizeShortText(input.reasonCode, 120)
  if (!accountId || !reasonCode) {
    throw new Error('accountId/reasonCode 不能为空')
  }

  const senderCandidates = Array.from(
    new Set(
      (input.senderCandidates || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 20)
    )
  )

  const messageText = normalizeMessageText(input.messageText)

  await db.exec(
    `INSERT INTO openclaw_feishu_chat_health_logs
     (user_id, account_id, message_id, chat_id, chat_type, message_type,
      sender_primary_id, sender_open_id, sender_union_id, sender_user_id,
      sender_candidates_json, decision, reason_code, reason_message,
      message_text, message_text_length, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      accountId,
      normalizeShortText(input.messageId, 120),
      normalizeShortText(input.chatId, 120),
      normalizeShortText(input.chatType, 32),
      normalizeShortText(input.messageType, 32),
      normalizeShortText(input.senderPrimaryId, 255),
      normalizeShortText(input.senderOpenId, 255),
      normalizeShortText(input.senderUnionId, 255),
      normalizeShortText(input.senderUserId, 255),
      senderCandidates.length > 0 ? JSON.stringify(senderCandidates) : null,
      input.decision,
      reasonCode,
      normalizeShortText(input.reasonMessage, 500),
      messageText,
      messageText ? messageText.length : 0,
      input.metadata && typeof input.metadata === 'object'
        ? JSON.stringify(input.metadata)
        : null,
    ]
  )

  void cleanupFeishuChatHealthLogsIfNeeded().catch(() => {})
}

export async function listFeishuChatHealthLogs(params: {
  userId: number
  withinHours?: number
  limit?: number
}): Promise<FeishuChatHealthListResult> {
  const db = await getDatabase()
  const withinHours = clamp(params.withinHours || 1, 1, 24)
  const limit = clamp(params.limit || 200, 20, 500)
  const cutoffExpr = datetimeMinusHours(withinHours, db.type)

  const rows = await db.query<FeishuChatHealthRow>(
    `SELECT
       id,
       user_id,
       account_id,
       message_id,
       chat_id,
       chat_type,
       message_type,
       sender_primary_id,
       sender_open_id,
       sender_union_id,
       sender_user_id,
       sender_candidates_json,
       decision,
       reason_code,
       reason_message,
       message_text,
       message_text_length,
       metadata_json,
       created_at
     FROM openclaw_feishu_chat_health_logs
     WHERE user_id = ?
       AND created_at >= ${cutoffExpr}
     ORDER BY created_at DESC
     LIMIT ?`,
    [params.userId, limit]
  )

  const statsRows = await db.query<FeishuChatHealthStatsRow>(
    `SELECT decision, COUNT(*) AS total
     FROM openclaw_feishu_chat_health_logs
     WHERE user_id = ?
       AND created_at >= ${cutoffExpr}
     GROUP BY decision`,
    [params.userId]
  )

  const mapped: FeishuChatHealthLogItem[] = rows.map((row) => {
    const messageText = normalizeMessageText(row.message_text)
    const senderCandidates = safeParseJsonArray(row.sender_candidates_json)
    const metadata = safeParseJsonObject(row.metadata_json)

    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      accountId: String(row.account_id || ''),
      messageId: row.message_id || null,
      chatId: row.chat_id || null,
      chatType: row.chat_type || null,
      messageType: row.message_type || null,
      senderPrimaryId: row.sender_primary_id || null,
      senderOpenId: row.sender_open_id || null,
      senderUnionId: row.sender_union_id || null,
      senderUserId: row.sender_user_id || null,
      senderCandidates,
      decision: row.decision,
      reasonCode: row.reason_code,
      reasonMessage: row.reason_message || null,
      messageText,
      messageExcerpt: toMessageExcerpt(messageText),
      messageTextLength: Number(row.message_text_length || (messageText ? messageText.length : 0)),
      metadata,
      createdAt: toIsoTimestamp(row.created_at),
    }
  })

  const stats = statsRows.reduce(
    (acc, row) => {
      const count = Number(row.total || 0)
      if (!Number.isFinite(count) || count <= 0) {
        return acc
      }
      if (row.decision === 'allowed') {
        acc.allowed += count
      } else if (row.decision === 'blocked') {
        acc.blocked += count
      } else if (row.decision === 'error') {
        acc.error += count
      }
      return acc
    },
    { total: 0, allowed: 0, blocked: 0, error: 0 }
  )

  stats.total = stats.allowed + stats.blocked + stats.error

  void cleanupFeishuChatHealthLogsIfNeeded().catch(() => {})

  return {
    rows: mapped,
    stats,
  }
}

export const FEISHU_CHAT_HEALTH_RETENTION_DAYS = FEISHU_HEALTH_RETENTION_DAYS
export const FEISHU_CHAT_HEALTH_WINDOW_HOURS = 1
export const FEISHU_CHAT_HEALTH_EXCERPT_LIMIT = FEISHU_HEALTH_MESSAGE_EXCERPT_LIMIT
