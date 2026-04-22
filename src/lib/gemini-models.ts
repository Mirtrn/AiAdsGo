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
// 🔧 更新：GPT-5.4 系列为当前旗舰（2026-03）
// 参考: https://platform.openai.com/docs/models
export const OPENAI_SUPPORTED_MODELS = [
  // ─── GPT-5.4 系列（最新旗舰，推荐）─────────────────────────
  'gpt-5.4',          // 旗舰：复杂推理/编程/Agent，$2.50/$15 per MTok，1M ctx
  'gpt-5.4-mini',     // 强力 mini：编程/子 Agent，$0.75/$4.50 per MTok，400K ctx
  'gpt-5.4-nano',     // 最便宜：高频简单任务，$0.20/$1.25 per MTok，400K ctx
  // ─── GPT-4.x 系列（仍可用）──────────────────────────────────
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  // ─── o 系列推理模型──────────────────────────────────────────
  'o3',
  'o4-mini',
] as const
export type OpenAIModel = typeof OPENAI_SUPPORTED_MODELS[number]
export const OPENAI_DEFAULT_MODEL: OpenAIModel = 'gpt-5.4'

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

// ─── LiteLLM / OpenLLM / New-API Gateway 模型 ──────────────────
// 代理 openllmapi.com（New-API + OpenRouter），2026-04 同步更新
export const LITELLM_SUPPORTED_MODELS = [
  // ─── Moonshot / Kimi ───────────────────────────────────────
  'moonshotai/kimi-k2.6',       // 🏆 推荐默认：Kimi 最强旗舰，广告创意首选
  'moonshotai/kimi-k2.5',       // Kimi 上一代旗舰

  // ─── MiniMax ───────────────────────────────────────────────
  'minimax/minimax-m2.7',
  'minimax/minimax-m2.5',

  // ─── DeepSeek ──────────────────────────────────────────────
  'deepseek/deepseek-v3.2',     // DeepSeek V3 最新，超高性价比
  'deepseek/deepseek-r1',       // DeepSeek R1 推理模型

  // ─── OpenAI ────────────────────────────────────────────────
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/o3',
  'openai/o4-mini',
  'openai/o4-mini-high',

  // ─── Anthropic ─────────────────────────────────────────────
  'anthropic/claude-opus-4.7',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-3.7-sonnet',

  // ─── Google ────────────────────────────────────────────────
  'google/gemini-3.1-pro-preview',
  'google/gemini-3.1-flash-lite-preview',
  'google/gemini-2.5-pro-preview-05-06',
  'google/gemini-2.0-flash-001',

  // ─── Meta Llama ────────────────────────────────────────────
  'meta-llama/llama-4-maverick',
  'meta-llama/llama-4-scout',

  // ─── Qwen ──────────────────────────────────────────────────
  'qwen/qwen3-235b-a22b',
  'qwen/qwq-32b',
] as const
export type LiteLLMModel = typeof LITELLM_SUPPORTED_MODELS[number]
export const LITELLM_DEFAULT_MODEL: LiteLLMModel = 'moonshotai/kimi-k2.6'
export const LITELLM_DEFAULT_BASE_URL = 'https://openllmapi.com'

// ─── AiCodeCat Gateway 模型 ────────────────────────────────────
// 代理 aicode.cat（第三方中转），注册链接附带推广码
export const AICODECAT_BASE_URL = 'https://aicode.cat'
export const AICODECAT_REGISTER_URL = 'https://aicode.cat/register?ref=AIADSGO01'
// AiCodeCat 支持与 OpenLLM 相同的模型列表（均为 OpenRouter 全系）
export const AICODECAT_SUPPORTED_MODELS = LITELLM_SUPPORTED_MODELS
export type AiCodeCatModel = LiteLLMModel
export const AICODECAT_DEFAULT_MODEL: AiCodeCatModel = LITELLM_DEFAULT_MODEL

export function isValidAiCodeCatModel(model?: string | null): model is AiCodeCatModel {
  return isValidLiteLLMModel(model)
}

export function normalizeAiCodeCatModel(model?: string | null): AiCodeCatModel {
  return normalizeLiteLLMModel(model)
}

export function isValidLiteLLMModel(model?: string | null): model is LiteLLMModel {
  return !!model && (LITELLM_SUPPORTED_MODELS as readonly string[]).includes(model)
}

export function normalizeLiteLLMModel(model?: string | null): LiteLLMModel {
  if (isValidLiteLLMModel(model)) return model
  return LITELLM_DEFAULT_MODEL
}

// ─── 统一 AI 提供商类型 ─────────────────────────────────────────
export type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'litellm' | 'aicodecat'

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
