import { getGeminiEndpoint, type GeminiProvider } from './gemini-config'
import {
  GEMINI_ACTIVE_MODEL,
  OPENAI_DEFAULT_MODEL,
  ANTHROPIC_DEFAULT_MODEL,
  LITELLM_DEFAULT_BASE_URL,
  AICODECAT_BASE_URL,
  type AIModel,
  type OpenAIModel,
  type AnthropicModel,
  type LiteLLMModel,
  type AiCodeCatModel,
  type AIProvider,
  normalizeModelForProvider,
  normalizeOpenAIModel,
  normalizeAnthropicModel,
  normalizeLiteLLMModel,
  normalizeAiCodeCatModel,
} from './gemini-models'
import { getUserOnlySetting } from './settings'

export interface ResolvedAIConfig {
  type: 'gemini-api' | 'openai' | 'anthropic' | 'litellm' | 'aicodecat' | null
  /** 当 type=gemini-api 时有效 */
  provider: GeminiProvider
  model: AIModel
  endpoint: string
  geminiAPI?: {
    apiKey: string
    model: AIModel
    provider: 'official' | 'relay'
    endpoint: string
  }
  /** 当 type=openai 时有效 */
  openaiAPI?: {
    apiKey: string
    model: OpenAIModel
  }
  /** 当 type=anthropic 时有效 */
  anthropicAPI?: {
    apiKey: string
    model: AnthropicModel
  }
  /** 当 type=litellm 时有效 */
  litellmAPI?: {
    apiKey: string
    model: LiteLLMModel
    baseUrl: string
  }
  /** 当 type=aicodecat 时有效 */
  aicodecatAPI?: {
    apiKey: string
    model: AiCodeCatModel
    baseUrl: string
  }
}

function normalizeProvider(value?: string | null): GeminiProvider {
  if (value === 'official' || value === 'relay') {
    return value
  }

  return 'official'
}

/**
 * 统一解析用户当前生效的 AI 配置。
 *
 * 规则：
 * 1. 仅使用用户级配置（不回退全局）
 * 2. 严格按 provider 取 key，不跨 provider 混用 key
 * 3. 只返回“最后保存并可生效”的单一模型
 */
export async function resolveActiveAIConfig(userId: number): Promise<ResolvedAIConfig> {
  const fallbackModel = GEMINI_ACTIVE_MODEL
  const fallbackProvider: GeminiProvider = 'official'
  const fallbackEndpoint = getGeminiEndpoint(fallbackProvider, fallbackModel)

  if (!userId || userId <= 0) {
    return {
      type: null,
      provider: fallbackProvider,
      model: fallbackModel,
      endpoint: fallbackEndpoint,
    }
  }

  // 读取主 AI 提供商选择（gemini / openai / anthropic / litellm / aicodecat，默认 gemini）
  const aiProviderSetting = await getUserOnlySetting('ai', 'ai_provider', userId)
  const aiProvider: AIProvider = (
    aiProviderSetting?.value === 'openai' ||
    aiProviderSetting?.value === 'anthropic' ||
    aiProviderSetting?.value === 'litellm' ||
    aiProviderSetting?.value === 'aicodecat'
      ? aiProviderSetting.value
      : 'gemini'
  )

  // ─── OpenAI ────────────────────────────────────────────────────
  if (aiProvider === 'openai') {
    const [apiKeySetting, modelSetting] = await Promise.all([
      getUserOnlySetting('ai', 'openai_api_key', userId),
      getUserOnlySetting('ai', 'openai_model', userId),
    ])
    const apiKey = apiKeySetting?.value || ''
    const model = normalizeOpenAIModel(modelSetting?.value)
    if (apiKey) {
      return {
        type: 'openai',
        provider: fallbackProvider,
        model: fallbackModel,
        endpoint: 'https://api.openai.com/v1/chat/completions',
        openaiAPI: { apiKey, model },
      }
    }
    return { type: null, provider: fallbackProvider, model: fallbackModel, endpoint: fallbackEndpoint }
  }

  // ─── Anthropic ─────────────────────────────────────────────────
  if (aiProvider === 'anthropic') {
    const [apiKeySetting, modelSetting] = await Promise.all([
      getUserOnlySetting('ai', 'anthropic_api_key', userId),
      getUserOnlySetting('ai', 'anthropic_model', userId),
    ])
    const apiKey = apiKeySetting?.value || ''
    const model = normalizeAnthropicModel(modelSetting?.value)
    if (apiKey) {
      return {
        type: 'anthropic',
        provider: fallbackProvider,
        model: fallbackModel,
        endpoint: 'https://api.anthropic.com/v1/messages',
        anthropicAPI: { apiKey, model },
      }
    }
    return { type: null, provider: fallbackProvider, model: fallbackModel, endpoint: fallbackEndpoint }
  }

  // ─── LiteLLM / OpenLLM Gateway ────────────────────────────────
  if (aiProvider === 'litellm') {
    const [apiKeySetting, modelSetting] = await Promise.all([
      getUserOnlySetting('ai', 'litellm_api_key', userId),
      getUserOnlySetting('ai', 'litellm_model', userId),
    ])
    const apiKey = apiKeySetting?.value || ''
    const model = normalizeLiteLLMModel(modelSetting?.value)
    const baseUrl = LITELLM_DEFAULT_BASE_URL
    if (apiKey) {
      return {
        type: 'litellm',
        provider: fallbackProvider,
        model: fallbackModel,
        endpoint: `${baseUrl}/v1/chat/completions`,
        litellmAPI: { apiKey, model, baseUrl },
      }
    }
    return { type: null, provider: fallbackProvider, model: fallbackModel, endpoint: fallbackEndpoint }
  }

  // ─── AiCodeCat Gateway ────────────────────────────────────────
  if (aiProvider === 'aicodecat') {
    const [apiKeySetting, modelSetting] = await Promise.all([
      getUserOnlySetting('ai', 'aicodecat_api_key', userId),
      getUserOnlySetting('ai', 'aicodecat_model', userId),
    ])
    const apiKey = apiKeySetting?.value || ''
    const model = normalizeAiCodeCatModel(modelSetting?.value)
    const baseUrl = AICODECAT_BASE_URL
    if (apiKey) {
      return {
        type: 'aicodecat',
        provider: fallbackProvider,
        model: fallbackModel,
        endpoint: `${baseUrl}/v1/chat/completions`,
        aicodecatAPI: { apiKey, model, baseUrl },
      }
    }
    return { type: null, provider: fallbackProvider, model: fallbackModel, endpoint: fallbackEndpoint }
  }

  // ─── Gemini（默认）────────────────────────────────────────────
  const [providerSetting, modelSetting, officialApiKeySetting, relayApiKeySetting] = await Promise.all([
    getUserOnlySetting('ai', 'gemini_provider', userId),
    getUserOnlySetting('ai', 'gemini_model', userId),
    getUserOnlySetting('ai', 'gemini_api_key', userId),
    getUserOnlySetting('ai', 'gemini_relay_api_key', userId),
  ])

  const rawProvider = normalizeProvider(providerSetting?.value)
  const directProvider: 'official' | 'relay' = rawProvider === 'relay' ? 'relay' : 'official'
  const directModel = normalizeModelForProvider(modelSetting?.value || fallbackModel, directProvider)

  const directApiKey = directProvider === 'relay'
    ? relayApiKeySetting?.value || ''
    : officialApiKeySetting?.value || ''
  const directEndpoint = getGeminiEndpoint(directProvider, directModel)

  if (directApiKey) {
    return {
      type: 'gemini-api',
      provider: directProvider,
      model: directModel,
      endpoint: directEndpoint,
      geminiAPI: {
        apiKey: directApiKey,
        model: directModel,
        provider: directProvider,
        endpoint: directEndpoint,
      },
    }
  }

  return {
    type: null,
    provider: directProvider,
    model: directModel,
    endpoint: directEndpoint,
  }
}
