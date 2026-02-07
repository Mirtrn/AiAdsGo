import type { OpenclawCommandRiskLevel } from './risk-policy'
import { deriveOpenclawCommandRiskLevel, requiresOpenclawCommandConfirmation } from './risk-policy'

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const BLOCKED_PREFIXES = ['/api/admin', '/api/cron', '/api/test', '/api/openclaw']
const MAX_PATH_LENGTH = 512

export type ParseOpenclawCommandInput = {
  method: string
  path: string
  intent?: string | null
}

export type ParsedOpenclawCommandIntent = {
  method: string
  path: string
  intent: string
  riskLevel: OpenclawCommandRiskLevel
  requiresConfirmation: boolean
  summary: string
}

function validateMethodAndPath(method: string, path: string) {
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`Method not allowed: ${method}`)
  }

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

function deriveIntentFromPath(path: string): string {
  const cleanPath = path.split('?')[0]
  const parts = cleanPath.split('/').filter(Boolean)
  if (parts.length < 2) {
    return 'api.request'
  }

  const resource = parts[1]
  const target = parts[2]
  if (!target) {
    return `${resource}.list`
  }

  return `${resource}.${target}`
}

function buildSummary(params: {
  method: string
  path: string
  riskLevel: OpenclawCommandRiskLevel
  requiresConfirmation: boolean
}): string {
  const confirmLabel = params.requiresConfirmation ? '需要卡片确认' : '可直接执行'
  return `${params.method} ${params.path}（风险: ${params.riskLevel}，${confirmLabel}）`
}

export function parseOpenclawCommandIntent(
  input: ParseOpenclawCommandInput
): ParsedOpenclawCommandIntent {
  const method = (input.method || '').trim().toUpperCase()
  const path = String(input.path || '').trim()

  validateMethodAndPath(method, path)

  const riskLevel = deriveOpenclawCommandRiskLevel({ method, path })
  const requiresConfirmation = requiresOpenclawCommandConfirmation(riskLevel)
  const intent = String(input.intent || '').trim() || deriveIntentFromPath(path)

  return {
    method,
    path,
    intent,
    riskLevel,
    requiresConfirmation,
    summary: buildSummary({ method, path, riskLevel, requiresConfirmation }),
  }
}
