/**
 * POST /api/announcements/read
 * 标记公告为已读
 * Body: { announcementId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

export async function POST(req: NextRequest) {
  const db = getDatabase()
  const userId = req.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userIdNum = parseInt(userId, 10)

  try {
    const { announcementId } = await req.json()
    if (!announcementId) {
      return NextResponse.json({ error: 'announcementId required' }, { status: 400 })
    }

    const id = crypto.randomUUID()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    if (db.type === 'postgres') {
      await db.exec(`
        INSERT INTO announcement_reads (id, announcement_id, user_id, read_at)
        VALUES (?, ?, ?, NOW())
        ON CONFLICT (announcement_id, user_id) DO NOTHING
      `, [id, announcementId, userIdNum])
    } else {
      await db.exec(`
        INSERT OR IGNORE INTO announcement_reads (id, announcement_id, user_id, read_at)
        VALUES (?, ?, ?, datetime('now'))
      `, [id, announcementId, userIdNum])
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('标记已读失败:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
