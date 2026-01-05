import 'server-only'

import { headers } from 'next/headers'

export type RequestContext = {
  requestId?: string
  userId?: number
}

function parseOptionalInt(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function getRequestContextFromHeaders(input: Headers): RequestContext {
  const requestId = input.get('x-request-id') || undefined
  const userId = parseOptionalInt(input.get('x-user-id'))
  return { requestId, userId }
}

/**
 * 仅在 Next.js 服务器请求上下文中可用；在队列/脚本等非请求上下文会返回空对象。
 */
export function tryGetCurrentRequestContext(): RequestContext {
  try {
    return getRequestContextFromHeaders(headers())
  } catch {
    return {}
  }
}

