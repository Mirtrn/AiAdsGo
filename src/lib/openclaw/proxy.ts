import { verifyOpenclawGatewayToken } from '@/lib/openclaw/auth'
import { verifyOpenclawUserToken } from '@/lib/openclaw/tokens'
import { fetchAutoadsAsUser } from '@/lib/openclaw/autoads-client'
import { recordOpenclawAction } from '@/lib/openclaw/action-logs'
import { checkOpenclawRateLimit } from '@/lib/openclaw/rate-limit'
import { resolveOpenclawUserFromBinding } from '@/lib/openclaw/bindings'
import { isOpenclawEnabledForUser } from '@/lib/openclaw/request-auth'
import { executeOpenclawCommand } from '@/lib/openclaw/commands/command-service'
import { resolveOpenclawParentRequestId, type OpenclawParentRequestIdSource } from '@/lib/openclaw/request-correlation'
import {
  assertOpenclawProxyRouteAllowed,
  isOpenclawWriteMethod,
  validateOpenclawApiRequest,
} from '@/lib/openclaw/canonical-routes'

export type OpenclawProxyRequest = {
  method: string
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: any
  intent?: string | null
  idempotencyKey?: string | null
  channel?: string | null
  senderId?: string | null
  accountId?: string | null
  tenantKey?: string | null
  parentRequestId?: string | null
  parentRequestIdSource?: OpenclawParentRequestIdSource
}

type ResolvedOpenclawUser = {
  userId: number
  authType: 'user-token' | 'gateway-binding'
}

type ProxyQuery = Record<string, string | number | boolean | null | undefined>

type NormalizedProxyTarget = {
  path: string
  query: ProxyQuery | undefined
  rewritten: boolean
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const OPENCLAW_PROXY_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.OPENCLAW_PROXY_TIMEOUT_MS,
  45000
)
const OPENCLAW_PROXY_STREAM_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.OPENCLAW_PROXY_STREAM_TIMEOUT_MS,
  20 * 60 * 1000
)

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

function withQueryPatch(
  baseQuery: ProxyQuery | undefined,
  patch: ProxyQuery
): ProxyQuery | undefined {
  const merged: ProxyQuery = {
    ...(baseQuery || {}),
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || String(value).trim() === '') {
      continue
    }
    merged[key] = value
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

export function normalizeOpenclawProxyTarget(params: {
  path: string
  query?: ProxyQuery
}): NormalizedProxyTarget {
  const path = (params.path || '').trim()
  const query = params.query

  // Legacy Google Ads account listing aliases (read-only):
  // map them to canonical /api/google-ads-accounts to avoid
  // accidental match with /api/campaigns/:id (NaN id errors).
  if (
    path === '/api/google-ads/accounts'
    || path === '/api/campaigns/accounts'
    || path === '/api/campaigns/google-ads-accounts'
  ) {
    return {
      path: '/api/google-ads-accounts',
      query,
      rewritten: true,
    }
  }

  const googleAdsAccountDetailMatch = path.match(/^\/api\/google-ads\/accounts\/(\d+)$/)
  if (googleAdsAccountDetailMatch) {
    return {
      path: `/api/google-ads-accounts/${googleAdsAccountDetailMatch[1]}`,
      query,
      rewritten: true,
    }
  }

  if (path === '/api/reports/campaigns' || path === '/api/google-ads/reports') {
    return {
      path: '/api/campaigns/performance',
      query,
      rewritten: true,
    }
  }

  if (path === '/api/google-ads/campaigns') {
    return {
      path: '/api/campaigns',
      query,
      rewritten: true,
    }
  }

  const accountCampaignsMatch = path.match(/^\/api\/google-ads\/accounts\/(\d+)\/campaigns$/)
  if (accountCampaignsMatch) {
    return {
      path: '/api/campaigns',
      query: withQueryPatch(query, { googleAdsAccountId: accountCampaignsMatch[1] }),
      rewritten: true,
    }
  }

  const campaignMetricsMatch = path.match(/^\/api\/campaigns\/(\d+)\/(metrics|performance)$/)
  if (campaignMetricsMatch) {
    return {
      path: '/api/campaigns/performance',
      query: withQueryPatch(query, { campaignId: campaignMetricsMatch[1] }),
      rewritten: true,
    }
  }

  return {
    path,
    query,
    rewritten: false,
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

  const openclawEnabled = await isOpenclawEnabledForUser(resolved.userId)
  if (!openclawEnabled) {
    throw new Error('OpenClaw access denied')
  }

  const requestedTarget = validateOpenclawApiRequest(request.method || 'GET', String(request.path || '').trim())

  checkOpenclawRateLimit(`user:${resolved.userId}`)

  const resolvedParentRequestId = await resolveOpenclawParentRequestId({
    explicitParentRequestId: request.parentRequestId || undefined,
    explicitSource: request.parentRequestIdSource || undefined,
    userId: resolved.userId,
    channel: request.channel || null,
    senderId: request.senderId || null,
    accountId: request.accountId || null,
  })

  // Backward compatibility bridge:
  // if caller still sends write operations to /api/openclaw/proxy,
  // route them through the command queue so we keep run/confirm/action linkage.
  if (isOpenclawWriteMethod(requestedTarget.method)) {
    const result = await executeOpenclawCommand({
      userId: resolved.userId,
      authType: resolved.authType,
      method: requestedTarget.method,
      path: requestedTarget.path,
      query: request.query,
      body: request.body,
      channel: request.channel || null,
      senderId: request.senderId || null,
      intent: request.intent || undefined,
      idempotencyKey: request.idempotencyKey || undefined,
      parentRequestId: resolvedParentRequestId,
    })

    const status = result.status === 'pending_confirm' ? 202 : 200
    return Response.json(
      {
        success: true,
        bridged: true,
        ...result,
      },
      {
        status,
        headers: {
          'x-openclaw-proxy-bridge': 'commands-execute',
        },
      }
    )
  }

  const normalizedTarget = normalizeOpenclawProxyTarget({
    path: requestedTarget.path,
    query: request.query,
  })

  const canonicalTarget = assertOpenclawProxyRouteAllowed({
    method: requestedTarget.method,
    path: normalizedTarget.path,
  })

  const method = canonicalTarget.method
  const finalPath = canonicalTarget.normalizedPath

  const { targetType, targetId } = deriveTarget(finalPath)
  const actionPath = normalizedTarget.rewritten
    ? `${requestedTarget.path} -> ${finalPath}`
    : finalPath
  const action = `${method} ${actionPath}`
  const requestBodyString = request.body ? JSON.stringify(request.body) : null
  const startedAt = Date.now()
  const timeoutMs = finalPath.includes('/stream')
    ? OPENCLAW_PROXY_STREAM_TIMEOUT_MS
    : OPENCLAW_PROXY_TIMEOUT_MS
  let upstream: Response

  try {
    upstream = await fetchAutoadsAsUser({
      userId: resolved.userId,
      path: finalPath,
      method,
      query: normalizedTarget.query,
      body: request.body,
      timeoutMs,
    })
  } catch (error: any) {
    const latencyMs = Date.now() - startedAt
    const errorMessage = error?.message || 'OpenClaw proxy upstream request failed'
    await recordOpenclawAction({
      userId: resolved.userId,
      channel: request.channel || null,
      senderId: request.senderId || null,
      action,
      targetType,
      targetId,
      requestBody: requestBodyString,
      status: 'error',
      errorMessage,
      latencyMs,
    })
    throw error
  }

  const latencyMs = Date.now() - startedAt

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
    latencyMs,
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  })
}
