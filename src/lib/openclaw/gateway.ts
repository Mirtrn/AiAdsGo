import { getSetting } from '@/lib/settings'
import { getOpenclawGatewayToken } from '@/lib/openclaw/auth'

const DEFAULT_GATEWAY_PORT = 18789

function parseGatewayPort(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback
  const trimmed = String(value).trim()
  if (!trimmed) return fallback
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback
  return parsed
}

function resolveGatewayHost(bind: string | null | undefined): string {
  const normalized = (bind || '').trim().toLowerCase()
  if (!normalized || normalized === 'loopback') {
    return '127.0.0.1'
  }
  if (normalized === 'auto' || normalized === 'lan' || normalized === 'tailnet') {
    return '127.0.0.1'
  }
  return '127.0.0.1'
}

export async function resolveOpenclawGatewayBaseUrl(): Promise<string> {
  const override = (process.env.OPENCLAW_GATEWAY_URL || '').trim()
  if (override) return override.replace(/\/+$/, '')

  const portSetting = await getSetting('openclaw', 'gateway_port')
  const bindSetting = await getSetting('openclaw', 'gateway_bind')
  const port = parseGatewayPort(portSetting?.value, DEFAULT_GATEWAY_PORT)
  const host = resolveGatewayHost(bindSetting?.value)

  return `http://${host}:${port}`
}

export async function invokeOpenclawTool(payload: {
  tool: string
  action?: string
  args?: Record<string, any>
  sessionKey?: string
}): Promise<any> {
  const baseUrl = await resolveOpenclawGatewayBaseUrl()
  const token = await getOpenclawGatewayToken()

  const response = await fetch(`${baseUrl}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenClaw gateway error (${response.status}): ${text}`)
  }

  return await response.json()
}
