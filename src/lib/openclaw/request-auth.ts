import type { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { verifyOpenclawGatewayToken } from '@/lib/openclaw/auth'
import { verifyOpenclawUserToken } from '@/lib/openclaw/tokens'
import { resolveOpenclawUserFromBinding } from '@/lib/openclaw/bindings'

type ResolvedUser = {
  userId: number
  authType: 'session' | 'user-token' | 'gateway-binding'
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
    return { userId: auth.user.userId, authType: 'session' }
  }

  const token = extractBearerToken(request.headers.get('authorization'))
  if (!token) return null

  if (await verifyOpenclawGatewayToken(token)) {
    const channel = request.headers.get('x-openclaw-channel')
    const senderId = request.headers.get('x-openclaw-sender')
    const userId = await resolveOpenclawUserFromBinding(channel, senderId)
    if (!userId) return null
    return { userId, authType: 'gateway-binding' }
  }

  const tokenRecord = await verifyOpenclawUserToken(token)
  if (!tokenRecord) return null
  return { userId: tokenRecord.user_id, authType: 'user-token' }
}
