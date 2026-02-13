import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import {
  type FeishuChatHealthDecision,
  backfillFeishuChatHealthRunLinks,
  recordFeishuChatHealthLog,
} from '@/lib/openclaw/feishu-chat-health'
import { verifyOpenclawGatewayToken } from '@/lib/openclaw/auth'
import { parseFeishuAccountUserId } from '@/lib/openclaw/feishu-accounts'
import { resolveOpenclawUserFromBinding } from '@/lib/openclaw/bindings'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

const ingestSchema = z.object({
  accountId: z.string().min(1),
  messageId: z.string().optional(),
  chatId: z.string().optional(),
  chatType: z.string().optional(),
  messageType: z.string().optional(),
  senderPrimaryId: z.string().optional(),
  senderOpenId: z.string().optional(),
  senderUnionId: z.string().optional(),
  senderUserId: z.string().optional(),
  senderCandidates: z.array(z.string()).optional(),
  decision: z.enum(['allowed', 'blocked', 'error']),
  reasonCode: z.string().min(1),
  reasonMessage: z.string().optional(),
  messageText: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  tenantKey: z.string().optional(),
})

type IngestPayload = z.infer<typeof ingestSchema>

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const value = authHeader.trim()
  if (!value) return null
  if (value.toLowerCase().startsWith('bearer ')) {
    return value.slice(7).trim()
  }
  return value
}

function normalizeFeishuId(value?: string | null): string {
  return String(value || '').trim().replace(/^(feishu|lark):/i, '').toLowerCase()
}

async function resolveUserIdFromFeishuAppId(accountId: string): Promise<number | null> {
  const normalized = normalizeFeishuId(accountId)
  if (!normalized || normalized.startsWith('user-')) {
    return null
  }

  const db = await getDatabase()
  const row = await db.queryOne<{ user_id: number }>(
    `SELECT user_id
     FROM system_settings
     WHERE category = 'openclaw'
       AND key = 'feishu_app_id'
       AND user_id IS NOT NULL
       AND lower(trim(value)) = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [normalized]
  )
  return row?.user_id ?? null
}

async function resolveUserIdForPayload(payload: IngestPayload): Promise<number | null> {
  const directUserId = parseFeishuAccountUserId(payload.accountId)
  if (directUserId) {
    return directUserId
  }

  const candidates = Array.from(
    new Set(
      [
        payload.senderOpenId,
        payload.senderUnionId,
        payload.senderUserId,
        payload.senderPrimaryId,
        ...(payload.senderCandidates || []),
      ]
        .map((item) => normalizeFeishuId(item))
        .filter(Boolean)
    )
  )

  for (const senderId of candidates) {
    const resolved = await resolveOpenclawUserFromBinding('feishu', senderId, {
      accountId: payload.accountId,
      tenantKey: payload.tenantKey,
    })
    if (resolved) {
      return resolved
    }
  }

  return await resolveUserIdFromFeishuAppId(payload.accountId)
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined
  }

  const limitedEntries = Object.entries(metadata)
    .slice(0, 40)
    .map(([key, value]) => {
      const normalizedKey = String(key || '').trim().slice(0, 80)
      if (!normalizedKey) return null
      if (value === null || value === undefined) {
        return [normalizedKey, value] as const
      }
      if (typeof value === 'string') {
        return [normalizedKey, value.slice(0, 1000)] as const
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return [normalizedKey, value] as const
      }
      try {
        return [normalizedKey, JSON.parse(JSON.stringify(value))] as const
      } catch {
        return [normalizedKey, String(value)] as const
      }
    })
    .filter(Boolean) as Array<readonly [string, unknown]>

  return Object.fromEntries(limitedEntries)
}

async function ensureIngestAuthorized(request: NextRequest): Promise<
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string }
> {
  const gatewayToken = extractBearerToken(request.headers.get('authorization'))
  if (gatewayToken && await verifyOpenclawGatewayToken(gatewayToken)) {
    return { ok: true }
  }

  const sessionAuth = await verifyOpenclawSessionAuth(request)
  if (!sessionAuth.authenticated) {
    return {
      ok: false,
      status: sessionAuth.status,
      error: sessionAuth.error,
    }
  }

  if (sessionAuth.user.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      error: '无权写入飞书聊天链路健康日志',
    }
  }

  return { ok: true }
}

export async function POST(request: NextRequest) {
  const authorized = await ensureIngestAuthorized(request)
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status })
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = ingestSchema.safeParse(rawBody || {})
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.errors[0]?.message || 'Invalid payload',
      },
      { status: 400 }
    )
  }

  try {
    const payload = parsed.data
    const userId = await resolveUserIdForPayload(payload)
    if (!userId) {
      return NextResponse.json({
        success: true,
        stored: false,
        skippedReason: 'user_unresolved',
      })
    }

    await recordFeishuChatHealthLog({
      userId,
      accountId: payload.accountId,
      messageId: payload.messageId,
      chatId: payload.chatId,
      chatType: payload.chatType,
      messageType: payload.messageType,
      senderPrimaryId: payload.senderPrimaryId,
      senderOpenId: payload.senderOpenId,
      senderUnionId: payload.senderUnionId,
      senderUserId: payload.senderUserId,
      senderCandidates: payload.senderCandidates,
      decision: payload.decision as FeishuChatHealthDecision,
      reasonCode: payload.reasonCode,
      reasonMessage: payload.reasonMessage,
      messageText: payload.messageText,
      metadata: sanitizeMetadata(payload.metadata),
    })

    if (payload.decision === 'allowed' && payload.messageId) {
      const senderIds = Array.from(
        new Set(
          [
            payload.senderOpenId,
            payload.senderUnionId,
            payload.senderUserId,
            payload.senderPrimaryId,
            ...(payload.senderCandidates || []),
          ]
            .map((item) => normalizeFeishuId(item))
            .filter(Boolean)
        )
      )

      try {
        await backfillFeishuChatHealthRunLinks({
          userId,
          messageId: payload.messageId,
          senderIds,
        })
      } catch (err: any) {
        console.error('[openclaw] feishu chat health backfill failed:', err?.message || String(err))
      }
    }

    return NextResponse.json({
      success: true,
      stored: true,
      userId,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || '写入飞书聊天链路健康日志失败',
      },
      { status: 500 }
    )
  }
}
