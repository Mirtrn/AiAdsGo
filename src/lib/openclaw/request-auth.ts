import type { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { verifyOpenclawGatewayToken } from '@/lib/openclaw/auth'
import { verifyOpenclawUserToken } from '@/lib/openclaw/tokens'
import { resolveOpenclawUserFromBinding } from '@/lib/openclaw/bindings'

type ResolvedUser = {
  userId: number
  authType: 'session' | 'user-token' | 'gateway-binding'
}

export async function isOpenclawEnabledForUser(userId: number): Promise<boolean> {
  const db = await getDatabase()
  const user = await db.queryOne<{ openclaw_enabled: boolean | number; is_active: boolean | number }>(
    'SELECT openclaw_enabled, is_active FROM users WHERE id = ?',
    [userId]
  )
  if (!user) return false

  const isActive = (user.is_active as any) === true || (user.is_active as any) === 1
  if (!isActive) return false

  return (user.openclaw_enabled as any) === true || (user.openclaw_enabled as any) === 1
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const value = authHeader.trim()
  if (!value) return null
  if (value.toLowerCase().startsWith('bearer ')) {
    return value.slice(7).trim()
  }
  return value
}

export async function resolveOpenclawRequestUser(
  request: NextRequest
): Promise<ResolvedUser | null> {
  const auth = await verifyAuth(request)
  if (auth.authenticated && auth.user) {
    const openclawEnabled = await isOpenclawEnabledForUser(auth.user.userId)
    if (!openclawEnabled) {
      return null
    }
    return { userId: auth.user.userId, authType: 'session' }
  }

  const token = extractBearerToken(request.headers.get('authorization'))
  if (!token) return null

  if (await verifyOpenclawGatewayToken(token)) {
    const channel = request.headers.get('x-openclaw-channel')
    const senderId = request.headers.get('x-openclaw-sender')
    const accountId = request.headers.get('x-openclaw-account-id')
    const tenantKey = request.headers.get('x-openclaw-tenant-key')
    const userId = await resolveOpenclawUserFromBinding(channel, senderId, { accountId, tenantKey })
    if (!userId) return null
    const openclawEnabled = await isOpenclawEnabledForUser(userId)
    if (!openclawEnabled) {
      return null
    }
    return { userId, authType: 'gateway-binding' }
  }

  const tokenRecord = await verifyOpenclawUserToken(token)
  if (!tokenRecord) return null
  const openclawEnabled = await isOpenclawEnabledForUser(tokenRecord.user_id)
  if (!openclawEnabled) {
    return null
  }
  return { userId: tokenRecord.user_id, authType: 'user-token' }
}
