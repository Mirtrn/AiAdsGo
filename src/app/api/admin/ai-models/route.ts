import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

// GET /api/admin/ai-models — 返回所有模型（含禁用的），管理员专用
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = getDatabase()
    const models = await db.query(
      `SELECT id, model_id, display_name, cost_label, is_enabled, force_stream, sort_order, notes, created_at, updated_at
       FROM ai_models
       ORDER BY sort_order ASC, id ASC`
    )
    return NextResponse.json({ models })
  } catch (error: any) {
    console.error('[admin/ai-models GET]', error)
    return NextResponse.json({ error: error.message || '查询失败' }, { status: 500 })
  }
}

// POST /api/admin/ai-models — 新增模型
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { model_id, display_name, cost_label = '', is_enabled = true, force_stream = true, sort_order = 100, notes = '' } = body

    if (!model_id?.trim()) {
      return NextResponse.json({ error: '模型 ID 不能为空' }, { status: 400 })
    }
    if (!display_name?.trim()) {
      return NextResponse.json({ error: '展示名称不能为空' }, { status: 400 })
    }

    const db = getDatabase()
    const model = await db.queryOne(
      `INSERT INTO ai_models (model_id, display_name, cost_label, is_enabled, force_stream, sort_order, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id, model_id, display_name, cost_label, is_enabled, force_stream, sort_order, notes, created_at, updated_at`,
      [model_id.trim(), display_name.trim(), cost_label.trim(), is_enabled, force_stream, sort_order, notes.trim()]
    )
    return NextResponse.json({ model }, { status: 201 })
  } catch (error: any) {
    if (error.code === '23505' || error.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: '该模型 ID 已存在，请勿重复添加' }, { status: 409 })
    }
    console.error('[admin/ai-models POST]', error)
    return NextResponse.json({ error: error.message || '创建失败' }, { status: 500 })
  }
}
