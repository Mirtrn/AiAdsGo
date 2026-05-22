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
// 仅包含实际可用的模型（已验证）
export const LITELLM_SUPPORTED_MODELS = [
  // ─── MiniMax（不可用，仅占位）─────────────────────────────
  'minimax/minimax-m2.7',   // 不可用
  'minimax/minimax-m2.5',   // 不可用

  // ─── OpenAI GPT-5.x（对话类）──────────────────────────────
  'gpt-5.3-codex',          // ✅ 可用
  'gpt-5.4',                // ✅ 可用
  'gpt-5.5',                // ✅ 可用

  // ─── Google Gemini（对话类）───────────────────────────────
  'google/gemini-3.1-pro-preview', // ✅ 可用
  'google/gemini-3-flash-preview', // ✅ 可用（默认）
] as const
export type LiteLLMModel = typeof LITELLM_SUPPORTED_MODELS[number]
export const LITELLM_DEFAULT_MODEL: LiteLLMModel = 'google/gemini-3-flash-preview'
export const LITELLM_DEFAULT_BASE_URL = 'https://openllmapi.com'

// 注意：getLiteLLMFallbackChain() 已移至 litellm.ts，因为它需要访问数据库
// 这样可以避免客户端组件（如 settings/page.tsx）导入服务器端代码

// ─── 模型展示别名（单一数据源，报错弹窗 / 下拉列表统一使用）────────
// 修改模型别名只需改这里，其他地方自动同步
export const LITELLM_MODEL_ALIAS: Record<string, string> = {
  'minimax/minimax-m2.7':          'minimax-m2.7',
  'minimax/minimax-m2.5':          'minimax-m2.5',
  'gpt-5.3-codex':                 'Codex',
  'gpt-5.4':                       'Blaze-D',
  'gpt-5.5':                       'Surge',
  'google/gemini-3.1-pro-preview': 'Nova',
  'google/gemini-3-flash-preview': 'Spark',
}

// ─── 模型单条消耗价格（单一数据源）───────────────────────────────
export const LITELLM_MODEL_COST: Record<string, string> = {
  'minimax/minimax-m2.7':          '≈¥0.8/条',
  'minimax/minimax-m2.5':          '≈¥0.5/条',
  'gpt-5.3-codex':                 '≈¥1.0/条',
  'gpt-5.4':                       '≈¥1.5/条',
  'gpt-5.5':                       '≈¥2.5/条',
  'google/gemini-3.1-pro-preview': '≈¥0.6/条',
  'google/gemini-3-flash-preview': '≈¥0.3/条',
}

/** 根据模型 ID 返回用户友好的展示名称（别名 → 兜底 shortName） */
export function getLiteLLMModelDisplayName(modelId: string): string {
  if (LITELLM_MODEL_ALIAS[modelId]) return LITELLM_MODEL_ALIAS[modelId]
  return modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId
}

export function isValidLiteLLMModel(model?: string | null): model is LiteLLMModel {
  return !!model && (LITELLM_SUPPORTED_MODELS as readonly string[]).includes(model)
}

export function normalizeLiteLLMModel(model?: string | null): LiteLLMModel {
  if (isValidLiteLLMModel(model)) return model
  return LITELLM_DEFAULT_MODEL
}

// ─── 官方 Gemini 模型（直连 Google AI Studio）────────────────────
export const GEMINI_OFFICIAL_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
] as const
export type GeminiOfficialModel = typeof GEMINI_OFFICIAL_MODELS[number]
export const GEMINI_OFFICIAL_DEFAULT: GeminiOfficialModel = 'gemini-3.5-flash'
export const GEMINI_OFFICIAL_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

export const GEMINI_OFFICIAL_MODEL_LABELS: Record<string, string> = {
  'gemini-3.5-flash':       'Gemini 3.5 Flash（旗舰）',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro（高级）',
  'gemini-3-flash-preview': 'Gemini 3 Flash（快速）',
}

// ─── 官方 OpenAI 模型（直连 OpenAI API）──────────────────────────
export const OPENAI_OFFICIAL_MODELS = [
  'gpt-5.5',
  'gpt-5.4-mini',
] as const
export type OpenAIOfficialModel = typeof OPENAI_OFFICIAL_MODELS[number]
export const OPENAI_OFFICIAL_DEFAULT: OpenAIOfficialModel = 'gpt-5.4-mini'
export const OPENAI_OFFICIAL_BASE_URL = 'https://api.openai.com'

export const OPENAI_OFFICIAL_MODEL_LABELS: Record<string, string> = {
  'gpt-5.5':     'GPT-5.5（旗舰）',
  'gpt-5.4-mini': 'GPT-5.4 Mini（快速）',
}

// ─── 统一 AI 提供商类型 ─────────────────────────────────────────
export type AIProvider = 'litellm' | 'gemini_official' | 'openai_official'
export const AI_PROVIDER_DEFAULT: AIProvider = 'litellm'

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
