import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getSQLiteDatabase } from '@/lib/db'
import bcrypt from 'bcrypt'

// POST: Reset user password
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = parseInt(params.id)
    const db = getSQLiteDatabase()

    // Check if user exists
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as { id: number; username: string } | undefined
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Generate new random password (12 characters: letters + numbers)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let newPassword = ''
    for (let i = 0; i < 12; i++) {
      newPassword += chars.charAt(Math.floor(Math.random() * chars.length))
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(newPassword, 10)

    // Update user password and set must_change_password flag
    const result = db.prepare(`
      UPDATE users
      SET password_hash = ?, must_change_password = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(hashedPassword, userId)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      username: user.username,
      newPassword
    })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
