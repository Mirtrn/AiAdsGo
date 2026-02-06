import crypto from 'crypto'
import { getSetting, updateSettings } from '@/lib/settings'
import { generateRandomKey } from '@/lib/crypto'

const GATEWAY_TOKEN_KEY = 'gateway_token'

export async function getOpenclawGatewayToken(): Promise<string> {
  const existing = await getSetting('openclaw', GATEWAY_TOKEN_KEY)
  const value = (existing?.value || '').trim()
  if (value) {
    return value
  }

  const token = generateRandomKey(32)
  await updateSettings([{ category: 'openclaw', key: GATEWAY_TOKEN_KEY, value: token }])
  return token
}

export async function verifyOpenclawGatewayToken(token: string | null): Promise<boolean> {
  if (!token) return false
  const expected = await getOpenclawGatewayToken()
  return timingSafeEqual(expected, token)
}

export function hashOpenclawToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}
