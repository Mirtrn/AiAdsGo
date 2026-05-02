export const GEMINI_ACTIVE_MODEL = 'gemini-3-flash-preview' as const
export const RELAY_GPT_52_MODEL = 'gpt-5.2' as const

export const GEMINI_DEPRECATED_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
] as const

export const OFFICIAL_SUPPORTED_MODELS = [GEMINI_ACTIVE_MODEL] as const
export const RELAY_SUPPORTED_MODELS = [GEMINI_ACTIVE_MODEL, RELAY_GPT_52_MODEL] as const

export type GeminiModel = typeof OFFICIAL_SUPPORTED_MODELS[number]
export type RelayModel = typeof RELAY_SUPPORTED_MODELS[number]
export type AIModel = RelayModel

// ─── LiteLLM / OpenLLM / New-API Gateway 模型 ──────────────────
// 代理 openllmapi.com（New-API + OpenRouter）
// 模型 ID 经 https://openrouter.ai/api/v1/models 核验，2026-04 同步
// 规则：仅保留纯对话类模型，删除推理类（r1/thinking/k2.5）和图像类（image/pro-image）
export const LITELLM_SUPPORTED_MODELS = [
  // ─── MoonShot Kimi（对话类）────────────────────────────────
  'moonshotai/kimi-k2.6',   // 最新版本
  'moonshotai/kimi-k2',     // 基础版

  // ─── MiniMax（对话类）─────────────────────────────────────
  'minimax/minimax-m2.7',   // 最新旗舰
  'minimax/minimax-m2.5',   // 稳定版
  'minimax/minimax-m2.5:free',

  // ─── DeepSeek（对话类）────────────────────────────────────
  'deepseek/deepseek-v3.2', // 🏆 推荐默认：超高性价比，广告创意首选

  // ─── OpenAI GPT-5.4（对话类）──────────────────────────────
  'openai/gpt-5.4',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.4-pro',
  'openai/gpt-5.4-nano',

  // ─── Google Gemini（对话类）───────────────────────────────
  'google/gemini-3.1-pro-preview',
  'google/gemini-3-flash-preview',
] as const
export type LiteLLMModel = typeof LITELLM_SUPPORTED_MODELS[number]
export const LITELLM_DEFAULT_MODEL: LiteLLMModel = 'deepseek/deepseek-v3.2'
export const LITELLM_DEFAULT_BASE_URL = 'https://openllmapi.com'

export function isValidLiteLLMModel(model?: string | null): model is LiteLLMModel {
  return !!model && (LITELLM_SUPPORTED_MODELS as readonly string[]).includes(model)
}

export function normalizeLiteLLMModel(model?: string | null): LiteLLMModel {
  if (isValidLiteLLMModel(model)) return model
  return LITELLM_DEFAULT_MODEL
}

// ─── 统一 AI 提供商类型 ─────────────────────────────────────────
export type AIProvider = 'litellm'

const DEPRECATED_MODEL_SET = new Set<string>(GEMINI_DEPRECATED_MODELS)
const OFFICIAL_MODEL_SET = new Set<string>(OFFICIAL_SUPPORTED_MODELS)
const RELAY_MODEL_SET = new Set<string>(RELAY_SUPPORTED_MODELS)

export function getSupportedModelsForProvider(provider?: string | null): readonly AIModel[] {
  if (provider === 'relay') {
    return RELAY_SUPPORTED_MODELS
  }

  return OFFICIAL_SUPPORTED_MODELS
}

export function isSupportedGeminiModel(model?: string | null): model is GeminiModel {
  return !!model && OFFICIAL_MODEL_SET.has(model)
}

export function isSupportedRelayModel(model?: string | null): model is RelayModel {
  return !!model && RELAY_MODEL_SET.has(model)
}

export function isModelSupportedByProvider(model?: string | null, provider?: string | null): boolean {
  if (!model) {
    return false
  }

  const modelSet = provider === 'relay' ? RELAY_MODEL_SET : OFFICIAL_MODEL_SET
  return modelSet.has(model)
}

export function getDefaultModelForProvider(_provider?: string | null): AIModel {
  return GEMINI_ACTIVE_MODEL
}

export function isDeprecatedGeminiModel(model?: string | null): boolean {
  return !!model && DEPRECATED_MODEL_SET.has(model)
}

/**
 * 历史函数名保留：现在返回系统支持的 AI 模型（Gemini / GPT-5.2）
 */
export function normalizeGeminiModel(model?: string | null): AIModel {
  if (isSupportedRelayModel(model)) {
    return model
  }

  return GEMINI_ACTIVE_MODEL
}

export function normalizeModelForProvider(model?: string | null, provider?: string | null): AIModel {
  if (isModelSupportedByProvider(model, provider)) {
    return model as AIModel
  }

  return getDefaultModelForProvider(provider)
}
