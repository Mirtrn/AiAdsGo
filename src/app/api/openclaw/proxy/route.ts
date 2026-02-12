import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { handleOpenclawProxyRequest } from '@/lib/openclaw/proxy'

const proxySchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  query: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  body: z.unknown().optional(),
  intent: z.string().optional(),
  idempotencyKey: z.string().optional(),
  channel: z.string().optional(),
  senderId: z.string().optional(),
  accountId: z.string().optional(),
  tenantKey: z.string().optional(),
})

function normalizeHeaderValue(value: string | null | undefined): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function resolveParentRequestId(request: NextRequest): string | undefined {
  return normalizeHeaderValue(
    request.headers.get('x-openclaw-message-id')
    || request.headers.get('x-openclaw-inbound-message-id')
    || request.headers.get('x-request-id')
  )
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const rawBody = await request.json().catch(() => null)
    const parsed = proxySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || 'Invalid request body' },
        { status: 400 }
      )
    }

    const channel = parsed.data.channel || request.headers.get('x-openclaw-channel') || undefined
    const senderId = parsed.data.senderId || request.headers.get('x-openclaw-sender') || undefined
    const accountId = parsed.data.accountId || request.headers.get('x-openclaw-account-id') || undefined
    const tenantKey = parsed.data.tenantKey || request.headers.get('x-openclaw-tenant-key') || undefined
    const parentRequestId = resolveParentRequestId(request)

    const response = await handleOpenclawProxyRequest({
      request: {
        ...parsed.data,
        channel,
        senderId,
        accountId,
        tenantKey,
        parentRequestId,
      },
      authHeader,
    })

    return response
  } catch (error: any) {
    const message = error?.message || 'OpenClaw proxy error'
    const status = message.includes('authentication') ? 401
      : message.includes('access denied') ? 403
      : message.includes('blocked') ? 403
        : message.includes('only supports read methods') ? 400
          : message.includes('canonical web flow') ? 400
        : message.includes('频繁') ? 429
        : 400
    return NextResponse.json({ error: message }, { status })
  }
}
