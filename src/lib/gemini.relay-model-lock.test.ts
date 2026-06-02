import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GEMINI_ACTIVE_MODEL, RELAY_GPT_52_MODEL } from './gemini-models'

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

vi.mock('./db', () => ({
  getDatabase: vi.fn(() => ({
    query: vi.fn(async () => [
      { model_id: RELAY_GPT_52_MODEL },
      { model_id: GEMINI_ACTIVE_MODEL },
    ]),
    queryOne: vi.fn(async () => ({ force_stream: false })),
  })),
}))

const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body || '{}'))
  return new Response(JSON.stringify({
    choices: [
      {
        message: { content: 'ok-from-relay' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    model: body.model,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

function setRelayConfig(userId: number, model = RELAY_GPT_52_MODEL) {
  settingStore.set(getStoreKey('ai', 'ai_provider', userId), 'litellm')
  settingStore.set(getStoreKey('ai', 'litellm_api_key', userId), 'relay-key')
  settingStore.set(getStoreKey('ai', 'litellm_model', userId), model)
}

function getLastRequestBody(): any {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body || '{}'))
}

describe('Gemini relay model routing', () => {
  beforeEach(() => {
    settingStore.clear()
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('uses the caller-requested model when one is passed', async () => {
    const userId = 1001
    setRelayConfig(userId, RELAY_GPT_52_MODEL)

    const { generateContent } = await import('./gemini')
    const result = await generateContent(
      {
        prompt: 'hello',
        model: GEMINI_ACTIVE_MODEL,
        enableAutoModelSelection: false,
      },
      userId
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getLastRequestBody().model).toBe(GEMINI_ACTIVE_MODEL)
    expect(result.model).toBe(GEMINI_ACTIVE_MODEL)
  })

  it('uses user-saved model when no model/operationType is provided', async () => {
    const userId = 1002
    setRelayConfig(userId, RELAY_GPT_52_MODEL)

    const { generateContent } = await import('./gemini')
    await generateContent(
      {
        prompt: 'hello',
        enableAutoModelSelection: false,
      },
      userId
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getLastRequestBody().model).toBe(RELAY_GPT_52_MODEL)
  })

  it('always follows the latest saved relay model when caller does not pass one', async () => {
    const userId = 1003
    setRelayConfig(userId, RELAY_GPT_52_MODEL)

    const { generateContent } = await import('./gemini')

    await generateContent(
      {
        prompt: 'hello',
        enableAutoModelSelection: false,
      },
      userId
    )
    expect(getLastRequestBody().model).toBe(RELAY_GPT_52_MODEL)

    settingStore.set(getStoreKey('ai', 'litellm_model', userId), GEMINI_ACTIVE_MODEL)

    await generateContent(
      {
        prompt: 'hello again',
        enableAutoModelSelection: false,
      },
      userId
    )
    expect(getLastRequestBody().model).toBe(GEMINI_ACTIVE_MODEL)
  })

  it('keeps user-level isolation and never reuses another user relay config', async () => {
    const userA = 2001
    const userB = 2002

    setRelayConfig(userA, RELAY_GPT_52_MODEL)

    const { generateContent } = await import('./gemini')

    await expect(generateContent(
      {
        prompt: 'user-b-request',
        enableAutoModelSelection: false,
      },
      userB
    )).rejects.toThrow('未配置有效的 AI 服务')

    expect(fetchMock).toHaveBeenCalledTimes(0)
  })
})
