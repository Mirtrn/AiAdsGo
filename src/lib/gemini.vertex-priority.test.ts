import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SettingValue = { value: any } | null

const settingStore = new Map<string, any>()
const getStoreKey = (category: string, key: string, userId?: number) =>
  `${userId ?? 'global'}:${category}.${key}`

const getSettingValue = (category: string, key: string, userId?: number): SettingValue => {
  const storeKey = getStoreKey(category, key, userId)
  if (!settingStore.has(storeKey)) return null
  return { value: settingStore.get(storeKey) }
}

vi.mock('./settings', () => ({
  getUserOnlySetting: vi.fn(async (category: string, key: string, userId: number) => {
    return getSettingValue(category, key, userId)
  }),
  getSetting: vi.fn(async (category: string, key: string, userId?: number) => {
    return getSettingValue(category, key, userId)
  }),
}))

const vertexGenerateContent = vi.fn(async (_params: any) => ({
  text: 'ok-from-vertex',
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  model: 'vertex-model',
}))

vi.mock('./gemini-vertex', () => ({
  resetVertexAIClient: vi.fn(),
  generateContent: vertexGenerateContent,
}))

describe('Gemini routing prefers Vertex AI', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    settingStore.clear()
    vertexGenerateContent.mockClear()
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value
    }
  })

  it('uses Vertex AI when use_vertex_ai=true even if gemini_provider=relay', async () => {
    const userId = 62

    settingStore.set(getStoreKey('ai', 'use_vertex_ai', userId), 'true')
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gcp_project_id', userId), 'proj-1')
    settingStore.set(getStoreKey('ai', 'gcp_location', userId), 'us-central1')
    settingStore.set(getStoreKey('ai', 'gcp_service_account_json', userId), '{"type":"service_account"}')
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userId), 'relay-key')

    const { generateContent } = await import('./gemini')
    const result = await generateContent(
      { prompt: 'hi', enableAutoModelSelection: false, model: 'gemini-2.5-pro' },
      userId
    )

    expect(vertexGenerateContent).toHaveBeenCalledTimes(1)
    expect(result.apiType).toBe('vertex-ai')
    expect(result.text).toBe('ok-from-vertex')
  })

  it('keeps backward compatibility: gemini_provider=vertex enables Vertex AI', async () => {
    const userId = 7

    settingStore.set(getStoreKey('ai', 'use_vertex_ai', userId), 'false')
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'vertex')
    settingStore.set(getStoreKey('ai', 'gcp_project_id', userId), 'proj-2')
    settingStore.set(getStoreKey('ai', 'gcp_location', userId), 'us-central1')
    settingStore.set(getStoreKey('ai', 'gcp_service_account_json', userId), '{"type":"service_account"}')

    const { generateContent } = await import('./gemini')
    const result = await generateContent(
      { prompt: 'hi', enableAutoModelSelection: false, model: 'gemini-2.5-pro' },
      userId
    )

    expect(vertexGenerateContent).toHaveBeenCalledTimes(1)
    expect(result.apiType).toBe('vertex-ai')
  })

  it('maps gemini-3-flash-preview to stable Pro on Vertex AI for Pro operations', async () => {
    const userId = 62

    settingStore.set(getStoreKey('ai', 'use_vertex_ai', userId), 'true')
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gcp_project_id', userId), 'proj-1')
    settingStore.set(getStoreKey('ai', 'gcp_location', userId), 'us-central1')
    settingStore.set(getStoreKey('ai', 'gcp_service_account_json', userId), '{"type":"service_account"}')
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userId), 'relay-key')

    const { generateContent } = await import('./gemini')
    await generateContent(
      {
        prompt: 'hi',
        enableAutoModelSelection: false,
        model: 'gemini-3-flash-preview',
        operationType: 'ad_creative_generation_main',
      },
      userId
    )

    expect(vertexGenerateContent).toHaveBeenCalledTimes(1)
    expect(vertexGenerateContent.mock.calls[0]?.[0]?.model).toBe('gemini-2.5-pro')
  })

  it('maps gemini-3-flash-preview to stable Flash on Vertex AI for Flash operations', async () => {
    const userId = 62

    settingStore.set(getStoreKey('ai', 'use_vertex_ai', userId), 'true')
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gcp_project_id', userId), 'proj-1')
    settingStore.set(getStoreKey('ai', 'gcp_location', userId), 'us-central1')
    settingStore.set(getStoreKey('ai', 'gcp_service_account_json', userId), '{"type":"service_account"}')
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userId), 'relay-key')

    const { generateContent } = await import('./gemini')
    await generateContent(
      {
        prompt: 'hi',
        enableAutoModelSelection: false,
        model: 'gemini-3-flash-preview',
        operationType: 'connection_test',
      },
      userId
    )

    expect(vertexGenerateContent).toHaveBeenCalledTimes(1)
    expect(vertexGenerateContent.mock.calls[0]?.[0]?.model).toBe('gemini-2.5-flash')
  })
})
