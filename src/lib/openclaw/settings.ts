import fs from 'fs'
import { getUserOnlySettingsByCategory, getSettingsByCategory, type SettingValue } from '@/lib/settings'

export type OpenclawSettingMap = Record<string, string | null>

export function buildSettingMap(settings: SettingValue[]): OpenclawSettingMap {
  return settings.reduce<OpenclawSettingMap>((acc, setting) => {
    acc[setting.key] = setting.value
    return acc
  }, {})
}

export function parseBoolean(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export function parseNumber(value: string | null | undefined, fallback?: number): number | undefined {
  if (value === null || value === undefined) return fallback
  const trimmed = String(value).trim()
  if (!trimmed) return fallback
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

export function parseJsonArray(value: string | null | undefined): any[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function parseJsonObject(value: string | null | undefined): Record<string, any> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, any>
  } catch {
    return undefined
  }
}

export async function getOpenclawSettingsMap(userId?: number): Promise<OpenclawSettingMap> {
  const settings = userId
    ? await getUserOnlySettingsByCategory('openclaw', userId)
    : await getSettingsByCategory('openclaw')
  return buildSettingMap(settings)
}

export function readSecretFile(filePath?: string | null): string | undefined {
  if (!filePath) return undefined
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim()
    return content || undefined
  } catch {
    return undefined
  }
}
