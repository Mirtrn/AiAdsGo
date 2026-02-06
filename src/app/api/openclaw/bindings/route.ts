import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

const createBindingSchema = z.object({
  channel: z.string().min(1),
  openId: z.string().min(1),
  unionId: z.string().optional(),
  tenantKey: z.string().optional(),
})

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const db = await getDatabase()
  const bindings = await db.query<any>(
    `SELECT id, channel, tenant_key, open_id, union_id, status, created_at, updated_at
     FROM openclaw_user_bindings
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [auth.user.userId]
  )

  return NextResponse.json({ success: true, bindings })
}

export async function POST(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = createBindingSchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  const db = await getDatabase()
  await db.exec(
    `INSERT INTO openclaw_user_bindings (user_id, channel, tenant_key, open_id, union_id, status)
     VALUES (?, ?, ?, ?, ?, 'active')
     ON CONFLICT(channel, open_id)
     DO UPDATE SET
       user_id = excluded.user_id,
       tenant_key = excluded.tenant_key,
       union_id = excluded.union_id,
       status = 'active',
       updated_at = datetime('now')`,
    [
      auth.user.userId,
      parsed.data.channel,
      parsed.data.tenantKey || null,
      parsed.data.openId,
      parsed.data.unionId || null,
    ]
  )

  return NextResponse.json({ success: true })
}
