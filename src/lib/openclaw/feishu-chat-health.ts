import { getDatabase } from '@/lib/db'
import { datetimeMinusHours, nowFunc } from '@/lib/db-helpers'
import { failStaleQueuedCommandRuns } from './commands/queued-timeout'

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
  channel: string | null
  sender_id: string | null
  status: string
  created_at: string | Date
}

type FeishuChatHealthCreatedAtRow = {
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
const FEISHU_CHAT_HEALTH_NOISE_REASON_CODE = 'duplicate_message'
// Note: `created_at` in chat health logs is written when the gateway reports the event,
// which may happen after one or more command runs were already created. Keep a relatively
// forgiving "link before" window, but not too large to avoid cross-message mislinks.
const FEISHU_HEALTH_EXECUTION_LINK_BEFORE_SECONDS = 180
const FEISHU_HEALTH_EXECUTION_LINK_AFTER_SECONDS = 5 * 60

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

function resolveExecutionLinkBeforeSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_FEISHU_EXECUTION_LINK_BEFORE_SECONDS)
  if (!Number.isFinite(envValue)) {
    return FEISHU_HEALTH_EXECUTION_LINK_BEFORE_SECONDS
  }
  return clamp(envValue, 0, 3600)
}

function resolveExecutionLinkAfterSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_FEISHU_EXECUTION_LINK_AFTER_SECONDS)
  if (!Number.isFinite(envValue)) {
    return FEISHU_HEALTH_EXECUTION_LINK_AFTER_SECONDS
  }
  return clamp(envValue, 0, 3600)
}

function normalizeShortText(value: unknown, maxLength: number): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  return text.slice(0, maxLength)
}

function normalizeFeishuIdentifier(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  const normalized = text.replace(/^(feishu|lark):/i, '').toLowerCase()
  return normalized ? normalized.slice(0, 255) : null
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

export async function backfillFeishuChatHealthRunLinks(params: {
  userId: number
  messageId: string
  senderIds: string[]
}): Promise<{ updatedRuns: number }> {
  const db = await getDatabase()

  const messageId = normalizeShortText(params.messageId, 120)
  if (!messageId) return { updatedRuns: 0 }

  const senderIds = Array.from(
    new Set(params.senderIds.map((item) => normalizeFeishuIdentifier(item)).filter(Boolean))
  ) as string[]

  if (senderIds.length === 0) {
    return { updatedRuns: 0 }
  }

  const healthRow = await db.queryOne<FeishuChatHealthCreatedAtRow>(
    `SELECT created_at
     FROM openclaw_feishu_chat_health_logs
     WHERE user_id = ?
       AND message_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.userId, messageId]
  )

  const healthCreatedAt = healthRow ? toIsoTimestamp(healthRow.created_at) : new Date().toISOString()
  const healthMs = Date.parse(healthCreatedAt)
  if (!Number.isFinite(healthMs)) {
    return { updatedRuns: 0 }
  }

  const linkBeforeMs = resolveExecutionLinkBeforeSeconds() * 1000
  const linkAfterMs = resolveExecutionLinkAfterSeconds() * 1000
  const startMs = healthMs - linkBeforeMs
  const endMs = healthMs + linkAfterMs

  const cutoffExpr = datetimeMinusHours(6, db.type)
  const senderPlaceholders = senderIds.map(() => '?').join(', ')
  const candidateRuns = await db.query<OpenclawCommandRunLinkRow>(
    `SELECT id, parent_request_id, channel, sender_id, status, created_at
     FROM openclaw_command_runs
     WHERE user_id = ?
       AND channel = 'feishu'
       AND sender_id IN (${senderPlaceholders})
       AND created_at >= ${cutoffExpr}
     ORDER BY created_at DESC`,
    [params.userId, ...senderIds]
  )

  const runIds: string[] = []
  for (const run of candidateRuns) {
    const parent = normalizeShortText(run.parent_request_id, 120)
    if (parent && parent.toLowerCase().startsWith('om_')) {
      continue
    }

    const runMs = Date.parse(toIsoTimestamp(run.created_at))
    if (!Number.isFinite(runMs)) continue
    if (runMs < startMs || runMs > endMs) continue
    runIds.push(String(run.id))
  }

  const uniqueRunIds = Array.from(new Set(runIds)).slice(0, 50)
  if (uniqueRunIds.length === 0) {
    return { updatedRuns: 0 }
  }

  const nowSql = nowFunc(db.type)
  const runIdPlaceholders = uniqueRunIds.map(() => '?').join(', ')
  const result = await db.exec(
    `UPDATE openclaw_command_runs
     SET parent_request_id = ?, updated_at = ${nowSql}
     WHERE user_id = ?
       AND id IN (${runIdPlaceholders})
       AND (parent_request_id IS NULL OR lower(trim(parent_request_id)) NOT LIKE 'om_%')`,
    [messageId, params.userId, ...uniqueRunIds]
  )

  return {
    updatedRuns: Number(result?.changes || 0),
  }
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
  await failStaleQueuedCommandRuns({
    db,
    userId: params.userId,
  })
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
       AND lower(trim(reason_code)) <> '${FEISHU_CHAT_HEALTH_NOISE_REASON_CODE}'
     ORDER BY created_at DESC
     LIMIT ?`,
    [params.userId, limit]
  )

  const statsRows = await db.query<FeishuChatHealthStatsRow>(
    `SELECT decision, COUNT(*) AS total
     FROM openclaw_feishu_chat_health_logs
     WHERE user_id = ?
       AND created_at >= ${cutoffExpr}
       AND lower(trim(reason_code)) <> '${FEISHU_CHAT_HEALTH_NOISE_REASON_CODE}'
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
  const linkModeByMessageId = new Map<string, 'parent' | 'sender_time'>()
  if (allowedMessageIds.length > 0) {
    const placeholders = allowedMessageIds.map(() => '?').join(', ')
    const runRows = await db.query<OpenclawCommandRunLinkRow>(
      `SELECT id, parent_request_id, channel, sender_id, status, created_at
       FROM openclaw_command_runs
       WHERE user_id = ?
         AND channel = 'feishu'
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
      linkModeByMessageId.set(key, 'parent')
    }
  }

  const missingMessageIds = allowedMessageIds.filter((id) => (runsByMessageId.get(id) || []).length === 0)
  const missingMessageIdSet = new Set(missingMessageIds)
  if (missingMessageIdSet.size > 0) {
    const cutoffExpr = datetimeMinusHours(withinHours + 1, db.type)
    const candidateSenderSet = new Set<string>()
    const pushSenderCandidate = (value: unknown) => {
      const normalized = normalizeShortText(value, 255)
      if (normalized) candidateSenderSet.add(normalized)
    }

    for (const row of rows) {
      if (row.decision !== 'allowed') continue
      const messageId = normalizeShortText(row.message_id, 120)
      if (!messageId) continue
      if (!missingMessageIdSet.has(messageId)) continue

      pushSenderCandidate(row.sender_primary_id)
      pushSenderCandidate(row.sender_open_id)
      pushSenderCandidate(row.sender_union_id)
      pushSenderCandidate(row.sender_user_id)
      for (const candidate of safeParseJsonArray(row.sender_candidates_json)) {
        pushSenderCandidate(candidate)
      }
    }

    const candidateSendersAll = Array.from(candidateSenderSet).map((sender) => sender.trim()).filter(Boolean)
    const canUseSenderFilter = candidateSendersAll.length > 0 && candidateSendersAll.length <= 200
    const candidateSenders = canUseSenderFilter ? candidateSendersAll : []

    const candidateRuns = await (async () => {
      if (candidateSenders.length > 0) {
        const senderPlaceholders = candidateSenders.map(() => '?').join(', ')
        return await db.query<OpenclawCommandRunLinkRow>(
          `SELECT id, parent_request_id, channel, sender_id, status, created_at
           FROM openclaw_command_runs
           WHERE user_id = ?
             AND channel = 'feishu'
             AND sender_id IN (${senderPlaceholders})
             AND created_at >= ${cutoffExpr}
           ORDER BY created_at DESC`,
          [params.userId, ...candidateSenders]
        )
      }

      // Fallback: still keep channel in SQL to avoid scanning other channels.
      return await db.query<OpenclawCommandRunLinkRow>(
        `SELECT id, parent_request_id, channel, sender_id, status, created_at
         FROM openclaw_command_runs
         WHERE user_id = ?
           AND channel = 'feishu'
           AND created_at >= ${cutoffExpr}
         ORDER BY created_at DESC`,
        [params.userId]
      )
    })()

    const runsBySender = new Map<string, OpenclawCommandRunLinkRow[]>()
    for (const run of candidateRuns) {
      const sender = normalizeShortText(run.sender_id, 255)
      if (!sender) continue
      const bucket = runsBySender.get(sender) || []
      bucket.push(run)
      runsBySender.set(sender, bucket)
    }

    const linkBeforeMs = resolveExecutionLinkBeforeSeconds() * 1000
    const linkAfterMs = resolveExecutionLinkAfterSeconds() * 1000

    for (const row of rows) {
      if (row.decision !== 'allowed') continue
      const messageId = normalizeShortText(row.message_id, 120)
      if (!messageId) continue
      if (!missingMessageIdSet.has(messageId)) continue

      const createdAt = toIsoTimestamp(row.created_at)
      const createdMs = Date.parse(createdAt)
      if (!Number.isFinite(createdMs)) continue

      const startMs = createdMs - linkBeforeMs
      const endMs = createdMs + linkAfterMs

      const senderCandidates = new Set<string>()
      const pushCandidate = (value: unknown) => {
        const normalized = normalizeShortText(value, 255)
        if (normalized) senderCandidates.add(normalized)
      }

      pushCandidate(row.sender_primary_id)
      pushCandidate(row.sender_open_id)
      pushCandidate(row.sender_union_id)
      pushCandidate(row.sender_user_id)
      for (const candidate of safeParseJsonArray(row.sender_candidates_json)) {
        pushCandidate(candidate)
      }

      const linkedByTime = new Map<string, OpenclawCommandRunLinkRow>()
      for (const sender of senderCandidates) {
        const bucket = runsBySender.get(sender) || []
        for (const run of bucket) {
          const runCreatedAt = toIsoTimestamp(run.created_at)
          const runMs = Date.parse(runCreatedAt)
          if (!Number.isFinite(runMs)) continue
          if (runMs < startMs) {
            // Buckets are ordered DESC; older runs won't match either.
            break
          }
          if (runMs > endMs) {
            continue
          }
          linkedByTime.set(String(run.id), run)
        }
      }

      if (linkedByTime.size === 0) {
        continue
      }

      const merged = Array.from(linkedByTime.values()).sort((a, b) => {
        return Date.parse(toIsoTimestamp(b.created_at)) - Date.parse(toIsoTimestamp(a.created_at))
      })
      runsByMessageId.set(messageId, merged)
      if (!linkModeByMessageId.has(messageId)) {
        linkModeByMessageId.set(messageId, 'sender_time')
      }
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
          const linkMode = linkModeByMessageId.get(messageId)
          const modeHint = linkMode === 'sender_time' ? '（按 sender/time 推断）' : ''
          executionDetail = `已关联 ${executionRunCount} 条命令记录${modeHint}，最新状态 ${executionRunStatus || 'unknown'}`
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
