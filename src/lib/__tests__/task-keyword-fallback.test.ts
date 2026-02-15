import { describe, expect, it } from 'vitest'

import { resolveTaskCampaignKeywords } from '@/lib/campaign-publish/task-keyword-fallback'

describe('resolveTaskCampaignKeywords', () => {
  it('prefers configured keywords and negative keywords when provided', () => {
    const result = resolveTaskCampaignKeywords({
      configuredKeywords: [{ text: 'soocas', matchType: 'EXACT' }, { keyword: 'soocas toothbrush', matchType: 'PHRASE' }],
      configuredNegativeKeywords: ['free', ' trial '],
      fallbackKeywords: ['fallback kw'],
      fallbackNegativeKeywords: ['fallback neg'],
    })

    expect(result.keywords).toEqual([
      { text: 'soocas', matchType: 'EXACT' },
      { keyword: 'soocas toothbrush', matchType: 'PHRASE' },
    ])
    expect(result.negativeKeywords).toEqual(['free', 'trial'])
    expect(result.usedKeywordFallback).toBe(false)
    expect(result.usedNegativeKeywordFallback).toBe(false)
  })

  it('falls back to creative keywords when campaignConfig keywords are missing', () => {
    const result = resolveTaskCampaignKeywords({
      configuredKeywords: undefined,
      configuredNegativeKeywords: undefined,
      fallbackKeywords: ['soocas', 'soocas toothbrush'],
      fallbackNegativeKeywords: ['free', 'trial'],
    })

    expect(result.keywords).toEqual(['soocas', 'soocas toothbrush'])
    expect(result.negativeKeywords).toEqual(['free', 'trial'])
    expect(result.usedKeywordFallback).toBe(true)
    expect(result.usedNegativeKeywordFallback).toBe(true)
  })

  it('treats empty keyword arrays as missing and triggers fallback', () => {
    const result = resolveTaskCampaignKeywords({
      configuredKeywords: [' ', { text: '   ' }],
      configuredNegativeKeywords: ['   '],
      fallbackKeywords: ['fallback kw'],
      fallbackNegativeKeywords: ['fallback neg'],
    })

    expect(result.keywords).toEqual(['fallback kw'])
    expect(result.negativeKeywords).toEqual(['fallback neg'])
    expect(result.usedKeywordFallback).toBe(true)
    expect(result.usedNegativeKeywordFallback).toBe(true)
  })
})
