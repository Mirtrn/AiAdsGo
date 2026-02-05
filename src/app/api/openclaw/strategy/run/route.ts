import { NextRequest, NextResponse } from 'next/server'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { mode?: string }
  const mode = typeof body?.mode === 'string' && body.mode.trim() ? body.mode.trim() : 'manual'
  const parentRequestId = request.headers.get('x-request-id') || undefined

  const queue = getQueueManager()
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
