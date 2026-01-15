import { describe, expect, it } from 'vitest'
import { getGoogleAdsTextEffectiveLength, sanitizeGoogleAdsAdText, sanitizeGoogleAdsPath } from '../google-ads-ad-text'

describe('google-ads-ad-text', () => {
  it('counts DKI token as defaultText only', () => {
    const text = '{KeyWord:Sportsroyals} Official' // raw=31
    expect(getGoogleAdsTextEffectiveLength(text)).toBe('Sportsroyals'.length + ' Official'.length)
  })

  it('counts non-DKI text as raw length', () => {
    const text = 'Hello world'
    expect(getGoogleAdsTextEffectiveLength(text)).toBe(text.length)
  })

  it('counts CJK characters as double width (effective length)', () => {
    const text = '한글ab' // 2 CJK + 2 Latin
    expect(getGoogleAdsTextEffectiveLength(text)).toBe(2 * 2 + 2)
  })

  it('sanitizes prohibited ± symbol without breaking length constraints', () => {
    const text = '±0,02 mm Maßtoleranz'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('+/-0,02 mm Maßtoleranz')
  })

  it('sanitizes prohibited ~ symbol without breaking readability', () => {
    const text = 'Save ~30% Today'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('Save 30% Today')
  })

  it('sanitizes rsa path values', () => {
    expect(sanitizeGoogleAdsPath('Best ~ Deals', 15)).toBe('Best-Deals')
  })

  it('truncates text that is still too long after sanitization', () => {
    const text = '가'.repeat(100)
    const sanitized = sanitizeGoogleAdsAdText(text, 90)
    expect(getGoogleAdsTextEffectiveLength(sanitized)).toBeLessThanOrEqual(90)
  })

  it('does not reject DKI strings that are over maxLen in raw length but under in effective length', () => {
    const text = '{KeyWord:Sportsroyals} Official' // effective=21
    expect(() => sanitizeGoogleAdsAdText(text, 30)).not.toThrow()
  })
})
