export const GEMINI_ACTIVE_MODEL = 'gemini-3-flash-preview' as const

export const GEMINI_DEPRECATED_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
] as const

export type GeminiModel = typeof GEMINI_ACTIVE_MODEL

const DEPRECATED_MODEL_SET = new Set<string>(GEMINI_DEPRECATED_MODELS)

export function isSupportedGeminiModel(model?: string | null): model is GeminiModel {
  return model === GEMINI_ACTIVE_MODEL
}

export function isDeprecatedGeminiModel(model?: string | null): boolean {
  return !!model && DEPRECATED_MODEL_SET.has(model)
}

export function normalizeGeminiModel(model?: string | null): GeminiModel {
  if (isSupportedGeminiModel(model)) {
    return model
  }

  return GEMINI_ACTIVE_MODEL
}
