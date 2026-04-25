/**
 * PATCH  /api/admin/announcements/[id]  — 更新公告（切换激活状态 / 编辑内容）
 * DELETE /api/admin/announcements/[id]  — 删除公告
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

function requireAdmin(req: NextRequest) {
  return req.headers.get('x-user-role') === 'admin'
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const db = getDatabase()
  const { id } = params
  try {
    const body = await req.json()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    const setClauses: string[] = []
    const values: any[] = []

    if (body.title !== undefined) { setClauses.push('title = ?'); values.push(body.title) }
    if (body.content !== undefined) { setClauses.push('content = ?'); values.push(body.content) }
    if (body.type !== undefined) { setClauses.push('type = ?'); values.push(body.type) }
    if (body.is_active !== undefined) {
      const val = db.type === 'postgres' ? (body.is_active ? 'TRUE' : 'FALSE') : (body.is_active ? '1' : '0')
      setClauses.push(`is_active = ${val}`)
    }
    if (body.scheduled_at !== undefined) { setClauses.push('scheduled_at = ?'); values.push(body.scheduled_at || null) }
    if (body.expires_at !== undefined) { setClauses.push('expires_at = ?'); values.push(body.expires_at || null) }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    setClauses.push(`updated_at = ${nowFunc}`)
    values.push(id)

    await db.exec(
      `UPDATE announcements SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('更新公告失败:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const db = getDatabase()
  const { id } = params
  try {
    await db.exec('DELETE FROM announcements WHERE id = ?', [id])
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('删除公告失败:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
