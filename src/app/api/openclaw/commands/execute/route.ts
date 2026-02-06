import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { executeOpenclawCommand } from '@/lib/openclaw/commands/command-service'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

const executeSchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  query: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  body: z.unknown().optional(),
  channel: z.string().optional(),
  senderId: z.string().optional(),
  intent: z.string().optional(),
  idempotencyKey: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = executeSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || '请求参数错误' },
      { status: 400 }
    )
  }

  const channel = parsed.data.channel || request.headers.get('x-openclaw-channel') || undefined
  const senderId = parsed.data.senderId || request.headers.get('x-openclaw-sender') || undefined
  const parentRequestId = request.headers.get('x-request-id') || undefined

  try {
    const result = await executeOpenclawCommand({
      userId: auth.userId,
      authType: auth.authType,
      method: parsed.data.method,
      path: parsed.data.path,
      query: parsed.data.query,
      body: parsed.data.body,
      channel,
      senderId,
      intent: parsed.data.intent,
      idempotencyKey: parsed.data.idempotencyKey,
      parentRequestId,
    })

    const status = result.status === 'pending_confirm' ? 202 : 200
    return NextResponse.json({ success: true, ...result }, { status })
  } catch (error: any) {
    const message = error?.message || 'OpenClaw 命令执行失败'
    const status = message.includes('not allowed') || message.includes('Invalid') || message.includes('blocked')
      ? 400
      : 500
    return NextResponse.json({ error: message }, { status })
  }
}
