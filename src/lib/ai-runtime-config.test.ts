import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GEMINI_OFFICIAL_BASE_URL,
  GEMINI_OFFICIAL_DEFAULT,
  LITELLM_DEFAULT_BASE_URL,
  LITELLM_DEFAULT_MODEL,
  OPENAI_OFFICIAL_BASE_URL,
  OPENAI_OFFICIAL_DEFAULT,
} from './gemini-models'

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

  it('uses the requested Gemini provider instead of the saved default provider', async () => {
    const userId = 3104
    settingStore.set(getStoreKey('ai', 'ai_provider', userId), 'litellm')
    settingStore.set(getStoreKey('ai', 'litellm_api_key', userId), 'relay-key')
    settingStore.set(getStoreKey('ai', 'gemini_api_key', userId), 'gemini-key')

    const { resolveActiveAIConfig } = await import('./ai-runtime-config')
    const config = await resolveActiveAIConfig(userId, 'gemini_official')

    expect(config.type).toBe('litellm')
    expect(config.litellmAPI).toMatchObject({
      provider: 'gemini_official',
      apiKey: 'gemini-key',
      model: GEMINI_OFFICIAL_DEFAULT,
      baseUrl: GEMINI_OFFICIAL_BASE_URL,
    })
  })

  it('uses the requested OpenAI provider instead of the saved default provider', async () => {
    const userId = 3105
    settingStore.set(getStoreKey('ai', 'ai_provider', userId), 'litellm')
    settingStore.set(getStoreKey('ai', 'litellm_api_key', userId), 'relay-key')
    settingStore.set(getStoreKey('ai', 'openai_api_key', userId), 'openai-key')

    const { resolveActiveAIConfig } = await import('./ai-runtime-config')
    const config = await resolveActiveAIConfig(userId, 'openai_official')

    expect(config.type).toBe('litellm')
    expect(config.litellmAPI).toMatchObject({
      provider: 'openai_official',
      apiKey: 'openai-key',
      model: OPENAI_OFFICIAL_DEFAULT,
      baseUrl: OPENAI_OFFICIAL_BASE_URL,
    })
  })

  it('falls back to saved provider when an invalid override is passed', async () => {
    const userId = 3106
    settingStore.set(getStoreKey('ai', 'litellm_api_key', userId), 'relay-key')

    const { resolveActiveAIConfig } = await import('./ai-runtime-config')
    const config = await resolveActiveAIConfig(userId, 'default' as any)

    expect(config.type).toBe('litellm')
    expect(config.litellmAPI).toMatchObject({
      provider: 'litellm',
      apiKey: 'relay-key',
      baseUrl: LITELLM_DEFAULT_BASE_URL,
    })
  })
})
