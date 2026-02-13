import { datetimeMinusHours } from '@/lib/db-helpers'
import { getDatabase } from '@/lib/db'

export type OpenclawParentRequestIdSource =
  | 'none'
  | 'message_id'
  | 'inbound_message_id'
  | 'request_id'
  | 'manual'

export type OpenclawParentRequestIdResolution = {
  parentRequestId?: string
  source: OpenclawParentRequestIdSource
}

type FeishuHealthMessageRow = {
  message_id: string | null
  created_at: string | Date
}

const FEISHU_PARENT_REQUEST_FALLBACK_SECONDS = 15 * 60

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function resolveFallbackSeconds(): number {
  const raw = Number(process.env.OPENCLAW_PARENT_REQUEST_FALLBACK_SECONDS)
  if (!Number.isFinite(raw)) {
    return FEISHU_PARENT_REQUEST_FALLBACK_SECONDS
  }
  return clamp(raw, 30, 3600)
}

function normalizeHeaderValue(value: string | null | undefined): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function normalizeShortText(value: unknown, maxLength: number): string | undefined {
  const normalized = String(value || '').trim()
  if (!normalized) return undefined
  return normalized.slice(0, maxLength)
}

function toEpochMs(value: string | Date): number | undefined {
  if (value instanceof Date) {
    const ts = value.getTime()
    return Number.isFinite(ts) ? ts : undefined
  }

  const text = String(value || '').trim()
  if (!text) return undefined

  const normalized = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`
  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

export function resolveOpenclawParentRequestIdFromHeaders(
  headers: { get(name: string): string | null }
): OpenclawParentRequestIdResolution {
  const messageId = normalizeHeaderValue(headers.get('x-openclaw-message-id'))
  if (messageId) {
    return {
      parentRequestId: messageId,
      source: 'message_id',
    }
  }

  const inboundMessageId = normalizeHeaderValue(headers.get('x-openclaw-inbound-message-id'))
  if (inboundMessageId) {
    return {
      parentRequestId: inboundMessageId,
      source: 'inbound_message_id',
    }
  }

  const requestId = normalizeHeaderValue(headers.get('x-request-id'))
  if (requestId) {
    return {
      parentRequestId: requestId,
      source: 'request_id',
    }
  }

  return {
    source: 'none',
  }
}

async function resolveFeishuMessageIdFallback(params: {
  userId: number
  senderId: string
  accountId?: string
}): Promise<string | undefined> {
  const db = await getDatabase()
  const cutoffExpr = datetimeMinusHours(1, db.type)
  const normalizedAccountId = normalizeShortText(params.accountId, 120)

  const sql = normalizedAccountId
    ? `SELECT message_id, created_at
       FROM openclaw_feishu_chat_health_logs
       WHERE user_id = ?
         AND decision = 'allowed'
         AND reason_code = 'reply_dispatched'
         AND message_id IS NOT NULL
         AND account_id = ?
         AND created_at >= ${cutoffExpr}
         AND (
           sender_primary_id = ?
           OR sender_open_id = ?
           OR sender_union_id = ?
           OR sender_user_id = ?
         )
       ORDER BY created_at DESC
       LIMIT 20`
    : `SELECT message_id, created_at
       FROM openclaw_feishu_chat_health_logs
       WHERE user_id = ?
         AND decision = 'allowed'
         AND reason_code = 'reply_dispatched'
         AND message_id IS NOT NULL
         AND created_at >= ${cutoffExpr}
         AND (
           sender_primary_id = ?
           OR sender_open_id = ?
           OR sender_union_id = ?
           OR sender_user_id = ?
         )
       ORDER BY created_at DESC
       LIMIT 20`

  const rows = normalizedAccountId
    ? await db.query<FeishuHealthMessageRow>(sql, [
      params.userId,
      normalizedAccountId,
      params.senderId,
      params.senderId,
      params.senderId,
      params.senderId,
    ])
    : await db.query<FeishuHealthMessageRow>(sql, [
      params.userId,
      params.senderId,
      params.senderId,
      params.senderId,
      params.senderId,
    ])

  if (!rows.length) {
    return undefined
  }

  const nowMs = Date.now()
  const maxAgeMs = resolveFallbackSeconds() * 1000
  for (const row of rows) {
    const messageId = normalizeShortText(row.message_id, 120)
    if (!messageId) continue

    const createdAtMs = toEpochMs(row.created_at)
    if (createdAtMs === undefined) continue

    const ageMs = nowMs - createdAtMs
    if (ageMs < 0 || ageMs > maxAgeMs) {
      continue
    }
    return messageId
  }

  return undefined
}

export async function resolveOpenclawParentRequestId(params: {
  explicitParentRequestId?: string | null
  explicitSource?: OpenclawParentRequestIdSource
  userId: number
  channel?: string | null
  senderId?: string | null
  accountId?: string | null
}): Promise<string | undefined> {
  const normalizedParentRequestId = normalizeShortText(params.explicitParentRequestId, 255)
  const source = params.explicitSource || (normalizedParentRequestId ? 'manual' : 'none')
  const normalizedChannel = normalizeShortText(params.channel, 32)?.toLowerCase()
  const normalizedSenderId = normalizeShortText(params.senderId, 255)

  if (normalizedChannel === 'feishu' && normalizedSenderId && (source === 'none' || source === 'request_id')) {
    const fallbackMessageId = await resolveFeishuMessageIdFallback({
      userId: params.userId,
      senderId: normalizedSenderId,
      accountId: normalizeShortText(params.accountId, 120),
    })
    if (fallbackMessageId) {
      return fallbackMessageId
    }
  }

  return normalizedParentRequestId
}
