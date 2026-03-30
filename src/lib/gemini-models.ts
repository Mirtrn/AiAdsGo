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

// ─── OpenAI 模型 ───────────────────────────────────────────────
export const OPENAI_SUPPORTED_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'o3',
  'o4-mini',
] as const
export type OpenAIModel = typeof OPENAI_SUPPORTED_MODELS[number]
export const OPENAI_DEFAULT_MODEL: OpenAIModel = 'gpt-4o'

// ─── Anthropic Claude 模型 ──────────────────────────────────────
// 🔧 修复：使用 Anthropic 官方文档中的真实模型 ID
// 参考: https://docs.anthropic.com/en/docs/about-claude/models
// 别名（无日期后缀）由 Anthropic 官方维护，始终指向最新快照，可直接使用
export const ANTHROPIC_SUPPORTED_MODELS = [
  // ─── 最新一代（推荐使用）───────────────────────────
  'claude-opus-4-6',              // Claude Opus 4.6 - 最强，$5/$25 per MTok
  'claude-sonnet-4-6',            // Claude Sonnet 4.6 - 速度/智能最佳平衡，$3/$15 per MTok
  'claude-haiku-4-5-20251001',    // Claude Haiku 4.5 - 最快，$1/$5 per MTok
  // ─── 旧版（仍可用）────────────────────────────────
  'claude-opus-4-5-20251101',     // Claude Opus 4.5，$5/$25 per MTok
  'claude-sonnet-4-5-20250929',   // Claude Sonnet 4.5，$3/$15 per MTok
  'claude-opus-4-1-20250805',     // Claude Opus 4.1，$15/$75 per MTok
  'claude-sonnet-4-20250514',     // Claude Sonnet 4，$3/$15 per MTok
  'claude-opus-4-20250514',       // Claude Opus 4，$15/$75 per MTok
] as const
export type AnthropicModel = typeof ANTHROPIC_SUPPORTED_MODELS[number]
// 默认使用 Sonnet 4.6：速度与智能最佳平衡，成本合理
export const ANTHROPIC_DEFAULT_MODEL: AnthropicModel = 'claude-sonnet-4-6'

// ─── 统一 AI 提供商类型 ─────────────────────────────────────────
export type AIProvider = 'gemini' | 'openai' | 'anthropic'

export function isValidOpenAIModel(model?: string | null): model is OpenAIModel {
  return !!model && (OPENAI_SUPPORTED_MODELS as readonly string[]).includes(model)
}

export function isValidAnthropicModel(model?: string | null): model is AnthropicModel {
  return !!model && (ANTHROPIC_SUPPORTED_MODELS as readonly string[]).includes(model)
}

export function normalizeOpenAIModel(model?: string | null): OpenAIModel {
  if (isValidOpenAIModel(model)) return model
  return OPENAI_DEFAULT_MODEL
}

export function normalizeAnthropicModel(model?: string | null): AnthropicModel {
  if (isValidAnthropicModel(model)) return model
  return ANTHROPIC_DEFAULT_MODEL
}

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
