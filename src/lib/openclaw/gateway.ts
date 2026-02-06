import { getSetting } from '@/lib/settings'
import { getOpenclawGatewayToken } from '@/lib/openclaw/auth'

function parseNumber(value: string | null | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
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
  const port = parseNumber(portSetting?.value, 18789)
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

