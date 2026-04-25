/**
 * GET /api/announcements
 * 获取当前用户未读的有效公告（用于前端弹窗）
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

export async function GET(req: NextRequest) {
  const db = getDatabase()
  const userId = req.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userIdNum = parseInt(userId, 10)

  try {
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    const nowCast = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    // 查询有效的、用户未读的公告
    const announcements = await db.query<{
      id: string
      title: string
      content: string
      type: string
      scheduled_at: string | null
      expires_at: string | null
      created_at: string
    }>(`
      SELECT a.id, a.title, a.content, a.type, a.scheduled_at, a.expires_at, a.created_at
      FROM announcements a
      WHERE a.is_active = ${db.type === 'postgres' ? 'TRUE' : '1'}
        AND (a.expires_at IS NULL OR a.expires_at > ${nowCast})
        AND NOT EXISTS (
          SELECT 1 FROM announcement_reads ar
          WHERE ar.announcement_id = a.id AND ar.user_id = ?
        )
      ORDER BY a.created_at DESC
      LIMIT 10
    `, [userIdNum])

    return NextResponse.json({ announcements: announcements || [] })
  } catch (error: any) {
    console.error('获取公告失败:', error)
    return NextResponse.json({ announcements: [] })
  }
}
