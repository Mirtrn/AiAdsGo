import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

// PATCH: Update user details
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = parseInt(params.id)
    const body = await request.json()
    const { packageType, packageExpiresAt, isActive } = body

    const db = getDatabase()

    // Build update query dynamically
    const updates: string[] = []
    const values: any[] = []

    if (packageType !== undefined) {
      updates.push('package_type = ?')
      values.push(packageType)
    }
    if (packageExpiresAt !== undefined) {
      updates.push('package_expires_at = ?')
      values.push(packageExpiresAt)
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?')
      values.push(isActive ? 1 : 0)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    updates.push('updated_at = datetime(\'now\')')
    values.push(userId)

    const result = db.prepare(`
      UPDATE users 
      SET ${updates.join(', ')} 
      WHERE id = ?
    `).run(...values)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const updatedUser = db.prepare('SELECT id, username, email, package_type, package_expires_at, is_active FROM users WHERE id = ?').get(userId)

    return NextResponse.json({ success: true, user: updatedUser })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: Soft delete/disable user
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = parseInt(params.id)
    const db = getDatabase()

    // Prevent deleting self
    if (auth.user?.userId === userId) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    // Soft delete (set is_active = 0)
    const result = db.prepare('UPDATE users SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(userId)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'User disabled successfully' })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
