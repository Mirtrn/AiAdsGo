import { getDatabase } from '@/lib/db'
import { datetimeMinusHours } from '@/lib/db-helpers'

export type FeishuChatHealthDecision = 'allowed' | 'blocked' | 'error'
export type FeishuChatHealthExecutionState =
  | 'not_applicable'
  | 'waiting'
  | 'missing'
  | 'pending_confirm'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'unknown'

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

type OpenclawCommandRunLinkRow = {
  id: string
  parent_request_id: string | null
  status: string
  created_at: string | Date
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
  executionState: FeishuChatHealthExecutionState
  executionRunId: string | null
  executionRunStatus: string | null
  executionRunCount: number
  executionRunCreatedAt: string | null
  executionDetail: string
  ageSeconds: number
  createdAt: string
}

export type FeishuChatHealthListResult = {
  rows: FeishuChatHealthLogItem[]
  stats: {
    total: number
    allowed: number
    blocked: number
    error: number
    execution: {
      linked: number
      completed: number
      inProgress: number
      waiting: number
      missing: number
      failed: number
      notApplicable: number
      unknown: number
    }
  }
}

const FEISHU_HEALTH_RETENTION_DAYS = 7
const FEISHU_HEALTH_RETENTION_HOURS = FEISHU_HEALTH_RETENTION_DAYS * 24
const FEISHU_HEALTH_MESSAGE_EXCERPT_LIMIT = 500
const FEISHU_HEALTH_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const FEISHU_HEALTH_EXECUTION_MISSING_SECONDS = 180

let lastCleanupAt = 0

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function resolveExecutionMissingSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_FEISHU_EXECUTION_MISSING_SECONDS)
  if (!Number.isFinite(envValue)) {
    return FEISHU_HEALTH_EXECUTION_MISSING_SECONDS
  }
  return clamp(envValue, 30, 3600)
}

export function getFeishuChatHealthExecutionMissingSeconds(): number {
  return resolveExecutionMissingSeconds()
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

function mapRunStatusToExecutionState(status: string): FeishuChatHealthExecutionState {
  const normalized = String(status || '').trim().toLowerCase()
  if (!normalized) return 'unknown'

  if (normalized === 'completed') return 'completed'
  if (normalized === 'running') return 'running'
  if (normalized === 'queued' || normalized === 'draft') return 'queued'
  if (normalized === 'pending_confirm' || normalized === 'confirmed') return 'pending_confirm'
  if (normalized === 'failed') return 'failed'
  if (normalized === 'canceled') return 'canceled'
  if (normalized === 'expired') return 'expired'

  return 'unknown'
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
  const withinHours = clamp(params.withinHours || FEISHU_CHAT_HEALTH_WINDOW_HOURS, 1, FEISHU_HEALTH_RETENTION_HOURS)
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

  const allowedMessageIds = Array.from(
    new Set(
      rows
        .filter((row) => row.decision === 'allowed')
        .map((row) => normalizeShortText(row.message_id, 120))
        .filter((value): value is string => Boolean(value))
    )
  )

  const runsByMessageId = new Map<string, OpenclawCommandRunLinkRow[]>()
  if (allowedMessageIds.length > 0) {
    const placeholders = allowedMessageIds.map(() => '?').join(', ')
    const runRows = await db.query<OpenclawCommandRunLinkRow>(
      `SELECT id, parent_request_id, status, created_at
       FROM openclaw_command_runs
       WHERE user_id = ?
         AND parent_request_id IN (${placeholders})
       ORDER BY created_at DESC`,
      [params.userId, ...allowedMessageIds]
    )

    for (const run of runRows) {
      const key = normalizeShortText(run.parent_request_id, 120)
      if (!key) continue
      const bucket = runsByMessageId.get(key) || []
      bucket.push(run)
      runsByMessageId.set(key, bucket)
    }
  }

  const executionMissingSeconds = getFeishuChatHealthExecutionMissingSeconds()
  const nowMs = Date.now()
  const mapped: FeishuChatHealthLogItem[] = rows.map((row) => {
    const messageText = normalizeMessageText(row.message_text)
    const senderCandidates = safeParseJsonArray(row.sender_candidates_json)
    const metadata = safeParseJsonObject(row.metadata_json)
    const createdAt = toIsoTimestamp(row.created_at)
    const createdMs = Date.parse(createdAt)
    const ageSeconds = Number.isFinite(createdMs)
      ? Math.max(0, Math.floor((nowMs - createdMs) / 1000))
      : 0

    let executionState: FeishuChatHealthExecutionState = 'not_applicable'
    let executionRunId: string | null = null
    let executionRunStatus: string | null = null
    let executionRunCount = 0
    let executionRunCreatedAt: string | null = null
    let executionDetail = '非放行消息，无执行链路'

    if (row.decision === 'allowed') {
      const messageId = normalizeShortText(row.message_id, 120)
      if (!messageId) {
        executionState = 'unknown'
        executionDetail = '放行消息缺少 message_id，无法关联执行链路'
      } else {
        const linkedRuns = runsByMessageId.get(messageId) || []
        executionRunCount = linkedRuns.length

        if (linkedRuns.length === 0) {
          if (ageSeconds >= executionMissingSeconds) {
            executionState = 'missing'
            executionDetail = `放行后超过 ${executionMissingSeconds}s 仍无命令执行记录`
          } else {
            executionState = 'waiting'
            executionDetail = '放行后等待命令链路落库中'
          }
        } else {
          const latestRun = linkedRuns[0]
          executionRunId = latestRun.id || null
          executionRunStatus = normalizeShortText(latestRun.status, 64)
          executionRunCreatedAt = toIsoTimestamp(latestRun.created_at)
          executionState = mapRunStatusToExecutionState(latestRun.status)
          executionDetail = `已关联 ${executionRunCount} 条命令记录，最新状态 ${executionRunStatus || 'unknown'}`
        }
      }
    }

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
      executionState,
      executionRunId,
      executionRunStatus,
      executionRunCount,
      executionRunCreatedAt,
      executionDetail,
      ageSeconds,
      createdAt,
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

  const executionStats = mapped.reduce(
    (acc, row) => {
      if (row.executionState === 'not_applicable') {
        acc.notApplicable += 1
        return acc
      }
      if (row.executionState === 'waiting') {
        acc.waiting += 1
        return acc
      }
      if (row.executionState === 'missing') {
        acc.missing += 1
        return acc
      }
      if (row.executionState === 'completed') {
        acc.linked += 1
        acc.completed += 1
        return acc
      }
      if (row.executionState === 'failed' || row.executionState === 'canceled' || row.executionState === 'expired') {
        acc.linked += 1
        acc.failed += 1
        return acc
      }
      if (row.executionState === 'pending_confirm' || row.executionState === 'queued' || row.executionState === 'running') {
        acc.linked += 1
        acc.inProgress += 1
        return acc
      }
      acc.unknown += 1
      return acc
    },
    {
      linked: 0,
      completed: 0,
      inProgress: 0,
      waiting: 0,
      missing: 0,
      failed: 0,
      notApplicable: 0,
      unknown: 0,
    }
  )

  void cleanupFeishuChatHealthLogsIfNeeded().catch(() => {})

  return {
    rows: mapped,
    stats: {
      ...stats,
      execution: executionStats,
    },
  }
}

export const FEISHU_CHAT_HEALTH_RETENTION_DAYS = FEISHU_HEALTH_RETENTION_DAYS
export const FEISHU_CHAT_HEALTH_WINDOW_HOURS = FEISHU_HEALTH_RETENTION_HOURS
export const FEISHU_CHAT_HEALTH_EXCERPT_LIMIT = FEISHU_HEALTH_MESSAGE_EXCERPT_LIMIT
export const FEISHU_CHAT_HEALTH_EXECUTION_MISSING_SECONDS = FEISHU_HEALTH_EXECUTION_MISSING_SECONDS
