import {
  LITELLM_DEFAULT_BASE_URL,
  type LiteLLMModel,
  normalizeLiteLLMModel,
} from './gemini-models'
import { getUserOnlySetting } from './settings'

export interface ResolvedAIConfig {
  type: 'litellm' | null
  /** 当 type=litellm 时有效 */
  litellmAPI?: {
    apiKey: string
    model: LiteLLMModel
    baseUrl: string
  }
}

/**
 * 统一解析用户当前生效的 AI 配置（仅 OpenLLM/LiteLLM）
 */
export async function resolveActiveAIConfig(userId: number): Promise<ResolvedAIConfig> {
  if (!userId || userId <= 0) {
    return { type: null }
  }

  // ─── LiteLLM / OpenLLM Gateway ────────────────────────────────
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
      litellmAPI: { apiKey, model, baseUrl },
    }
  }

  return { type: null }
}
