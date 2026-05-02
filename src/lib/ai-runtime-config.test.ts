import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LITELLM_DEFAULT_MODEL } from './gemini-models'

type SettingValue = { value: any } | null

const settingStore = new Map<string, any>()
const getStoreKey = (category: string, key: string, userId: number) =>
  `${userId}:${category}.${key}`

function getSettingValue(category: string, key: string, userId: number): SettingValue {
  const storeKey = getStoreKey(category, key, userId)
  if (!settingStore.has(storeKey)) return null
  return { value: settingStore.get(storeKey) }
}

vi.mock('./settings', () => ({
  getUserOnlySetting: vi.fn(async (category: string, key: string, userId: number) => {
    return getSettingValue(category, key, userId)
  }),
}))

describe('resolveActiveAIConfig', () => {
  beforeEach(() => {
    settingStore.clear()
  })

  it('resolves litellm config when api key is set', async () => {
    const userId = 3101
    settingStore.set(getStoreKey('ai', 'litellm_api_key', userId), 'test-api-key')
    settingStore.set(getStoreKey('ai', 'litellm_model', userId), LITELLM_DEFAULT_MODEL)

    const { resolveActiveAIConfig } = await import('./ai-runtime-config')
    const config = await resolveActiveAIConfig(userId)

    expect(config.type).toBe('litellm')
    expect(config.litellmAPI?.apiKey).toBe('test-api-key')
    expect(config.litellmAPI?.model).toBe(LITELLM_DEFAULT_MODEL)
  })

  it('returns null type when no api key is set', async () => {
    const userId = 3102

    const { resolveActiveAIConfig } = await import('./ai-runtime-config')
    const config = await resolveActiveAIConfig(userId)

    expect(config.type).toBeNull()
    expect(config.litellmAPI).toBeUndefined()
  })

  it('uses default model when no model is configured', async () => {
    const userId = 3103
    settingStore.set(getStoreKey('ai', 'litellm_api_key', userId), 'test-key')

    const { resolveActiveAIConfig } = await import('./ai-runtime-config')
    const config = await resolveActiveAIConfig(userId)

    expect(config.type).toBe('litellm')
    expect(config.litellmAPI?.model).toBe(LITELLM_DEFAULT_MODEL)
  })
})
