export type OpenclawCommandRiskLevel = 'low' | 'medium' | 'high' | 'critical'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const HIGH_RISK_PATH_PATTERNS: RegExp[] = [
  /\/delete\b/i,
  /\/offline\b/i,
  /\/blacklist\b/i,
  /\/pause\b/i,
  /\/publish\b/i,
  /\/budget\b/i,
  /\/offers?\//i,
  /\/campaigns?\//i,
]

const CRITICAL_PATH_PATTERNS: RegExp[] = [
  /\/bulk\b/i,
  /\/batch\b/i,
  /\/all\b/i,
]

function parseBoolean(value?: string | null): boolean {
  if (!value) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export function deriveOpenclawCommandRiskLevel(params: {
  method: string
  path: string
}): OpenclawCommandRiskLevel {
  const method = params.method.toUpperCase()
  const path = params.path

  if (!WRITE_METHODS.has(method)) {
    return 'low'
  }

  if (method === 'DELETE') {
    if (CRITICAL_PATH_PATTERNS.some(pattern => pattern.test(path))) {
      return 'critical'
    }
    return 'high'
  }

  const isCritical = CRITICAL_PATH_PATTERNS.some(pattern => pattern.test(path))
  const isHigh = HIGH_RISK_PATH_PATTERNS.some(pattern => pattern.test(path))

  if (isCritical && isHigh) {
    return 'critical'
  }
  if (isHigh) {
    return 'high'
  }

  return 'medium'
}

export function requiresOpenclawCommandConfirmation(riskLevel: OpenclawCommandRiskLevel): boolean {
  if (riskLevel === 'critical' || riskLevel === 'high') {
    return true
  }

  if (riskLevel === 'medium') {
    return parseBoolean(process.env.OPENCLAW_CONFIRM_MEDIUM_RISK)
  }

  return false
}
