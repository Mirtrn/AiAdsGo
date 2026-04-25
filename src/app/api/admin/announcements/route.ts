/**
 * GET  /api/admin/announcements  — 获取所有公告列表（含已读数统计）
 * POST /api/admin/announcements  — 创建新公告
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

function requireAdmin(req: NextRequest) {
  const role = req.headers.get('x-user-role')
  if (role !== 'admin') return false
  return true
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const db = getDatabase()
  try {
    const rows = await db.query<{
      id: string
      title: string
      content: string
      type: string
      is_active: number | boolean
      scheduled_at: string | null
      expires_at: string | null
      created_at: string
      read_count: number
    }>(`
      SELECT
        a.id, a.title, a.content, a.type, a.is_active,
        a.scheduled_at, a.expires_at, a.created_at,
        COUNT(ar.id) AS read_count
      FROM announcements a
      LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `)
    return NextResponse.json({ announcements: rows || [] })
  } catch (error: any) {
    console.error('获取公告列表失败:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const db = getDatabase()
  const userId = req.headers.get('x-user-id')
  try {
    const { title, content, type = 'info', scheduled_at, expires_at } = await req.json()
    if (!title || !content) {
      return NextResponse.json({ error: '标题和内容为必填' }, { status: 400 })
    }

    const id = crypto.randomUUID()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    const isActiveVal = db.type === 'postgres' ? 'TRUE' : '1'

    await db.exec(`
      INSERT INTO announcements (id, title, content, type, is_active, scheduled_at, expires_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ${isActiveVal}, ?, ?, ?, ${nowFunc}, ${nowFunc})
    `, [id, title, content, type, scheduled_at || null, expires_at || null, userId ? parseInt(userId, 10) : null])

    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    console.error('创建公告失败:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
