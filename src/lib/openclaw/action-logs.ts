import { getDatabase } from '@/lib/db'

const MAX_LOG_BODY = 20000
const REDACT_PATTERNS: Array<[RegExp, string]> = [
  [/oc_[A-Za-z0-9_-]{16,}/g, 'oc_***'],
  [/(\"apiKey\"\s*:\s*\")([^\"]+)(\")/gi, '$1***$3'],
  [/(\"appSecret\"\s*:\s*\")([^\"]+)(\")/gi, '$1***$3'],
  [/(\"token\"\s*:\s*\")([^\"]+)(\")/gi, '$1***$3'],
]

function truncate(value: string | null | undefined): string | null {
  if (!value) return null
  let normalized = value
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    normalized = normalized.replace(pattern, replacement)
  }
  if (normalized.length <= MAX_LOG_BODY) return normalized
  return `${normalized.slice(0, MAX_LOG_BODY)}...`
}

export async function recordOpenclawAction(params: {
  userId: number
  channel?: string | null
  senderId?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  requestBody?: string | null
  responseBody?: string | null
  status?: 'success' | 'error'
  errorMessage?: string | null
  runId?: string | null
  riskLevel?: string | null
  confirmStatus?: string | null
  latencyMs?: number | null
}): Promise<void> {
  const db = await getDatabase()
  const latencyMs = typeof params.latencyMs === 'number' && Number.isFinite(params.latencyMs)
    ? Math.max(0, Math.round(params.latencyMs))
    : null

  await db.exec(
    `INSERT INTO openclaw_action_logs
     (user_id, channel, sender_id, action, target_type, target_id, request_body, response_body, status, error_message, run_id, risk_level, confirm_status, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      params.channel || null,
      params.senderId || null,
      params.action,
      params.targetType || null,
      params.targetId || null,
      truncate(params.requestBody),
      truncate(params.responseBody),
      params.status || 'success',
      truncate(params.errorMessage || null),
      params.runId || null,
      params.riskLevel || null,
      params.confirmStatus || null,
      latencyMs,
    ]
  )
}
