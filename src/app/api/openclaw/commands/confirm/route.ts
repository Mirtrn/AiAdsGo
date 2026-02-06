import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { confirmOpenclawCommand } from '@/lib/openclaw/commands/command-service'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

const confirmSchema = z.object({
  runId: z.string().min(1),
  confirmToken: z.string().min(8),
  decision: z.enum(['confirm', 'cancel']).optional(),
  action: z.enum(['confirm', 'cancel']).optional(),
  channel: z.string().optional(),
  callbackEventId: z.string().optional(),
  callbackEventType: z.string().optional(),
  callbackPayload: z.unknown().optional(),
})

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = confirmSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || '请求参数错误' },
      { status: 400 }
    )
  }

  const decision = parsed.data.decision || parsed.data.action || 'confirm'
  const channel = parsed.data.channel || request.headers.get('x-openclaw-channel') || undefined
  const parentRequestId = request.headers.get('x-request-id') || undefined

  try {
    const result = await confirmOpenclawCommand({
      runId: parsed.data.runId,
      userId: auth.userId,
      confirmToken: parsed.data.confirmToken,
      decision,
      channel,
      callbackEventId: parsed.data.callbackEventId,
      callbackEventType: parsed.data.callbackEventType,
      callbackPayload: parsed.data.callbackPayload,
      parentRequestId,
    })

    if (result.status === 'not_found') {
      return NextResponse.json({ error: '命令不存在', ...result }, { status: 404 })
    }

    if (result.status === 'invalid_token') {
      return NextResponse.json({ error: '确认凭证无效', ...result }, { status: 403 })
    }

    if (result.status === 'expired') {
      return NextResponse.json({ error: '确认已过期', ...result }, { status: 410 })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    const message = error?.message || 'OpenClaw 命令确认失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
