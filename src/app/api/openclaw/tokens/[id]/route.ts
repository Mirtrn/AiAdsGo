import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { revokeOpenclawToken } from '@/lib/openclaw/tokens'
import { isOpenclawEnabledForUser } from '@/lib/openclaw/request-auth'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: auth.error || '未授权' }, { status: 401 })
  }

  const openclawEnabled = await isOpenclawEnabledForUser(auth.user.userId)
  if (!openclawEnabled) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启' }, { status: 403 })
  }

  const tokenId = parseInt(params.id, 10)
  if (!Number.isFinite(tokenId)) {
    return NextResponse.json({ error: 'Invalid token id' }, { status: 400 })
  }

  const revoked = await revokeOpenclawToken(auth.user.userId, tokenId)
  if (!revoked) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
