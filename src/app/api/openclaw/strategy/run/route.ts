import { NextRequest, NextResponse } from 'next/server'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { mode?: string }
  const mode = typeof body?.mode === 'string' && body.mode.trim() ? body.mode.trim() : 'manual'
  const parentRequestId = request.headers.get('x-request-id') || undefined

  const queue = getQueueManagerForTaskType('openclaw-strategy')
  const taskId = await queue.enqueue(
    'openclaw-strategy',
    {
      userId: auth.userId,
      mode,
      trigger: 'manual',
    },
    auth.userId,
    {
      priority: 'normal',
      maxRetries: 0,
      parentRequestId,
    }
  )

  return NextResponse.json({ success: true, taskId })
}
