import { describe, expect, it } from 'vitest'
import {
  AI_PROVIDERS,
  GEMINI_ACTIVE_MODEL,
  GEMINI_OFFICIAL_BASE_URL,
  OPENAI_OFFICIAL_BASE_URL,
  RELAY_GPT_52_MODEL,
  isAIProvider,
  isModelSupportedByProvider,
  normalizeAIProviderOverride,
  normalizeGeminiModel,
  normalizeModelForProvider,
} from './gemini-models'

describe('gemini-models', () => {
  it('normalizes gpt-5.2 as a supported AI model', () => {
    expect(normalizeGeminiModel(RELAY_GPT_52_MODEL)).toBe(RELAY_GPT_52_MODEL)
  })

  it('falls back to Gemini model when provider is official', () => {
    expect(normalizeModelForProvider(RELAY_GPT_52_MODEL, 'official')).toBe(GEMINI_ACTIVE_MODEL)
    expect(isModelSupportedByProvider(RELAY_GPT_52_MODEL, 'official')).toBe(false)
  })

  it('keeps gpt-5.2 when provider is relay', () => {
    expect(normalizeModelForProvider(RELAY_GPT_52_MODEL, 'relay')).toBe(RELAY_GPT_52_MODEL)
    expect(isModelSupportedByProvider(RELAY_GPT_52_MODEL, 'relay')).toBe(true)
  })

  it('recognizes all supported temporary AI provider overrides', () => {
    expect(AI_PROVIDERS).toEqual(['litellm', 'gemini_official', 'openai_official'])
    expect(isAIProvider('litellm')).toBe(true)
    expect(isAIProvider('gemini_official')).toBe(true)
    expect(isAIProvider('openai_official')).toBe(true)
    expect(isAIProvider('default')).toBe(false)
    expect(isAIProvider('openai')).toBe(false)
  })

  it('normalizes only explicit provider override values', () => {
    expect(normalizeAIProviderOverride('litellm')).toBe('litellm')
    expect(normalizeAIProviderOverride('gemini_official')).toBe('gemini_official')
    expect(normalizeAIProviderOverride('openai_official')).toBe('openai_official')
    expect(normalizeAIProviderOverride('default')).toBeUndefined()
    expect(normalizeAIProviderOverride('')).toBeUndefined()
    expect(normalizeAIProviderOverride(null)).toBeUndefined()
  })

  it('keeps official provider base urls available for override tests', () => {
    expect(GEMINI_OFFICIAL_BASE_URL).toContain('generativelanguage.googleapis.com')
    expect(OPENAI_OFFICIAL_BASE_URL).toContain('api.openai.com')
  })
})
