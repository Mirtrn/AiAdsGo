import { getDatabase } from '@/lib/db'
import type { QueueConfig } from './types'

export function mergeQueueConfig(
  base: Partial<QueueConfig>,
  override: Partial<QueueConfig> | null | undefined
): Partial<QueueConfig> {
  if (!override) return base

  return {
    ...base,
    ...override,
    perTypeConcurrency: {
      ...(base.perTypeConcurrency || {}),
      ...(override.perTypeConcurrency || {}),
    } as QueueConfig['perTypeConcurrency'],
  }
}

export async function loadPersistedQueueConfigFromDB(): Promise<Partial<QueueConfig> | null> {
  try {
    const db = await getDatabase()
    const row = await db.queryOne<{ value: string }>(`
      SELECT value FROM system_settings
      WHERE category = 'queue' AND key = 'config' AND user_id IS NULL
      LIMIT 1
    `)
    if (!row?.value) return null

    const parsed = JSON.parse(row.value) as Partial<QueueConfig>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (error) {
    console.warn('⚠️ Failed to load persisted queue config from DB, using startup config:', error)
    return null
  }
}
