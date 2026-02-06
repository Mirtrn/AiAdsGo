import { verifyOpenclawGatewayToken } from '@/lib/openclaw/auth'
import { verifyOpenclawUserToken } from '@/lib/openclaw/tokens'
import { fetchAutoadsAsUser } from '@/lib/openclaw/autoads-client'
import { recordOpenclawAction } from '@/lib/openclaw/action-logs'
import { checkOpenclawRateLimit } from '@/lib/openclaw/rate-limit'
import { resolveOpenclawUserFromBinding } from '@/lib/openclaw/bindings'

export type OpenclawProxyRequest = {
  method: string
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: any
  channel?: string | null
  senderId?: string | null
  accountId?: string | null
  tenantKey?: string | null
}

type ResolvedOpenclawUser = {
  userId: number
  authType: 'user-token' | 'gateway-binding'
}

const BLOCKED_PREFIXES = ['/api/admin', '/api/cron', '/api/test', '/api/openclaw']
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_PATH_LENGTH = 512

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const value = authHeader.trim()
  if (!value) return null
  if (value.toLowerCase().startsWith('bearer ')) {
    return value.slice(7).trim()
  }
  return value
}


async function resolveOpenclawUser(params: {
  authHeader: string | null
  channel?: string | null
  senderId?: string | null
  accountId?: string | null
  tenantKey?: string | null
}): Promise<ResolvedOpenclawUser | null> {
  const token = extractBearerToken(params.authHeader)
  if (!token) return null

  if (await verifyOpenclawGatewayToken(token)) {
    const userId = await resolveOpenclawUserFromBinding(params.channel, params.senderId, {
      accountId: params.accountId,
      tenantKey: params.tenantKey,
    })
    if (!userId) return null
    return { userId, authType: 'gateway-binding' }
  }

  const tokenRecord = await verifyOpenclawUserToken(token)
  if (!tokenRecord) return null
  return { userId: tokenRecord.user_id, authType: 'user-token' }
}

function validateProxyPath(path: string) {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid path')
  }
  if (path.length > MAX_PATH_LENGTH) {
    throw new Error('Path too long')
  }
  if (path.includes('://')) {
    throw new Error('Absolute URLs are not allowed')
  }
  if (!path.startsWith('/api/')) {
    throw new Error('Only /api routes are allowed')
  }
  if (path.includes('..')) {
    throw new Error('Invalid path traversal')
  }
  for (const prefix of BLOCKED_PREFIXES) {
    if (path.startsWith(prefix)) {
      throw new Error(`Path blocked: ${prefix}`)
    }
  }
}

function validateProxyMethod(method: string) {
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`Method not allowed: ${method}`)
  }
}

function deriveTarget(path: string): { targetType?: string; targetId?: string } {
  const clean = path.split('?')[0]
  const parts = clean.split('/').filter(Boolean)
  if (parts.length < 2 || parts[0] !== 'api') {
    return {}
  }
  return {
    targetType: parts[1],
    targetId: parts[2],
  }
}

export async function handleOpenclawProxyRequest(params: {
  request: OpenclawProxyRequest
  authHeader: string | null
}): Promise<Response> {
  const { request } = params
  const resolved = await resolveOpenclawUser({
    authHeader: params.authHeader,
    channel: request.channel,
    senderId: request.senderId,
    accountId: request.accountId,
    tenantKey: request.tenantKey,
  })

  if (!resolved) {
    throw new Error('OpenClaw authentication failed')
  }

  const method = (request.method || 'GET').toUpperCase()

  validateProxyPath(request.path)
  validateProxyMethod(method)

  checkOpenclawRateLimit(`user:${resolved.userId}`)

  const { targetType, targetId } = deriveTarget(request.path)
  const action = `${method} ${request.path}`
  const requestBodyString = request.body ? JSON.stringify(request.body) : null

  const upstream = await fetchAutoadsAsUser({
    userId: resolved.userId,
    path: request.path,
    method,
    query: request.query,
    body: request.body,
  })

  const contentType = upstream.headers.get('content-type') || ''
  const isEventStream = contentType.includes('text/event-stream')

  let responseBodyText: string | null = null
  if (!isEventStream) {
    const cloned = upstream.clone()
    try {
      responseBodyText = await cloned.text()
    } catch {
      responseBodyText = null
    }
  }

  await recordOpenclawAction({
    userId: resolved.userId,
    channel: request.channel || null,
    senderId: request.senderId || null,
    action,
    targetType,
    targetId,
    requestBody: requestBodyString,
    responseBody: responseBodyText,
    status: upstream.ok ? 'success' : 'error',
    errorMessage: upstream.ok ? null : responseBodyText,
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  })
}
