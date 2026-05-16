import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

// PATCH /api/admin/ai-models/[id] — 修改模型字段
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = parseInt(params.id, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: '无效的模型 ID' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const setClauses: string[] = []
    const values: any[] = []

    if (body.display_name !== undefined) { setClauses.push('display_name = ?'); values.push(String(body.display_name).trim()) }
    if (body.cost_label !== undefined)   { setClauses.push('cost_label = ?');   values.push(String(body.cost_label).trim()) }
    if (body.is_enabled !== undefined)   { setClauses.push('is_enabled = ?');   values.push(Boolean(body.is_enabled)) }
    if (body.sort_order !== undefined)   { setClauses.push('sort_order = ?');   values.push(Number(body.sort_order)) }
    if (body.notes !== undefined)        { setClauses.push('notes = ?');         values.push(String(body.notes).trim()) }
    if (body.model_id !== undefined)     { setClauses.push('model_id = ?');      values.push(String(body.model_id).trim()) }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 })
    }

    values.push(id)
    const db = getDatabase()
    const model = await db.queryOne(
      `UPDATE ai_models SET ${setClauses.join(', ')} WHERE id = ?
       RETURNING id, model_id, display_name, cost_label, is_enabled, sort_order, notes, created_at, updated_at`,
      values
    )

    if (!model) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 })
    }

    return NextResponse.json({ model })
  } catch (error: any) {
    if (error.code === '23505' || error.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: '模型 ID 已存在' }, { status: 409 })
    }
    console.error('[admin/ai-models PATCH]', error)
    return NextResponse.json({ error: error.message || '更新失败' }, { status: 500 })
  }
}

// DELETE /api/admin/ai-models/[id] — 删除模型
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = parseInt(params.id, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: '无效的模型 ID' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const deleted = await db.queryOne(
      `DELETE FROM ai_models WHERE id = ? RETURNING id, model_id`,
      [id]
    )

    if (!deleted) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 })
    }

    return NextResponse.json({ deleted })
  } catch (error: any) {
    console.error('[admin/ai-models DELETE]', error)
    return NextResponse.json({ error: error.message || '删除失败' }, { status: 500 })
  }
}
