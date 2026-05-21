import {
  LITELLM_DEFAULT_BASE_URL,
  GEMINI_OFFICIAL_BASE_URL,
  GEMINI_OFFICIAL_DEFAULT,
  OPENAI_OFFICIAL_BASE_URL,
  OPENAI_OFFICIAL_DEFAULT,
  type LiteLLMModel,
  type AIProvider,
  AI_PROVIDER_DEFAULT,
  normalizeLiteLLMModel,
} from './gemini-models'
import { getUserOnlySetting } from './settings'

export interface ResolvedAIConfig {
  type: 'litellm' | null
  /** 当 type=litellm 时有效 */
  litellmAPI?: {
    apiKey: string
    model: string
    baseUrl: string
    /** 原始 provider 类型，方便日志追踪 */
    provider: AIProvider
  }
}

/**
 * 统一解析用户当前生效的 AI 配置
 * 支持三种模式：
 *   litellm       → 中转服务（openllmapi.com）
 *   gemini_official → Google AI Studio 官方直连
 *   openai_official → OpenAI 官方直连
 *
 * 三种模式都复用同一个 OpenAI-compatible 调用链（litellmAPI），
 * 只是 baseUrl / apiKey / model 不同
 */
export async function resolveActiveAIConfig(userId: number): Promise<ResolvedAIConfig> {
  if (!userId || userId <= 0) {
    return { type: null }
  }

  // 读取用户保存的 provider 类型
  const providerSetting = await getUserOnlySetting('ai', 'ai_provider', userId)
  const provider = (providerSetting?.value as AIProvider) || AI_PROVIDER_DEFAULT

  // ─── Gemini 官方直连 ────────────────────────────────────────────
  if (provider === 'gemini_official') {
    const apiKeySetting = await getUserOnlySetting('ai', 'gemini_api_key', userId)
    const apiKey = apiKeySetting?.value || ''
    if (!apiKey) return { type: null }

    const modelSetting = await getUserOnlySetting('ai', 'gemini_official_model', userId)
    const model = modelSetting?.value || GEMINI_OFFICIAL_DEFAULT

    return {
      type: 'litellm',
      litellmAPI: {
        apiKey,
        model,
        baseUrl: GEMINI_OFFICIAL_BASE_URL,
        provider: 'gemini_official',
      },
    }
  }

  // ─── OpenAI 官方直连 ────────────────────────────────────────────
  if (provider === 'openai_official') {
    const apiKeySetting = await getUserOnlySetting('ai', 'openai_api_key', userId)
    const apiKey = apiKeySetting?.value || ''
    if (!apiKey) return { type: null }

    const modelSetting = await getUserOnlySetting('ai', 'openai_official_model', userId)
    const model = modelSetting?.value || OPENAI_OFFICIAL_DEFAULT

    return {
      type: 'litellm',
      litellmAPI: {
        apiKey,
        model,
        baseUrl: OPENAI_OFFICIAL_BASE_URL,
        provider: 'openai_official',
      },
    }
  }

  // ─── LiteLLM / OpenLLM 中转（默认）─────────────────────────────
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
      litellmAPI: { apiKey, model, baseUrl, provider: 'litellm' },
    }
  }

  return { type: null }
}
