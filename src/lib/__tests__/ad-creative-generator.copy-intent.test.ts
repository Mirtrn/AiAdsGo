import { describe, expect, it } from 'vitest'
import type { GeneratedAdCreativeData } from '../ad-creative'
import { softlyReinforceTypeCopy } from '../ad-creative-generator'

function buildCreativeDraft(): GeneratedAdCreativeData {
  return {
    headlines: [
      '{KeyWord:ToolPro} Official',
      'Powerful Drill for Home',
      'Cordless Hammer Drill',
      'Reliable Tool for Repairs'
    ],
    descriptions: [
      'Durable power tool for daily projects',
      'Built for heavy tasks in your workshop',
      'Trusted quality and easy handling',
      'Strong performance for home and garden'
    ],
    keywords: ['hammer drill', 'cordless drill', 'garden repair tool'],
    callouts: [],
    sitelinks: [],
    theme: 'test',
    explanation: 'test'
  }
}

describe('ad-creative-generator softlyReinforceTypeCopy', () => {
  it('applies soft reinforcement for French copy without touching keywords', () => {
    const creative = buildCreativeDraft()
    const originalKeywords = [...creative.keywords]

    const fix = softlyReinforceTypeCopy(creative, 'B', 'fr', 'ToolPro')

    expect(fix.descriptionFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(en savoir plus|acheter maintenant|commander)/i.test(d))).toBe(true)
    expect(creative.keywords).toEqual(originalKeywords)
  })

  it('supports additional mapped language variants (Swiss German -> de)', () => {
    const creative = buildCreativeDraft()

    const fix = softlyReinforceTypeCopy(creative, 'D', 'Swiss German', 'WerkPro')

    expect(fix.descriptionFixes + fix.headlineFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(jetzt kaufen|mehr erfahren|bestellen)/i.test(d))).toBe(true)
  })

  it('applies soft reinforcement for Spanish copy', () => {
    const creative = buildCreativeDraft()

    const fix = softlyReinforceTypeCopy(creative, 'B', 'es-MX', 'ToolPro')

    expect(fix.descriptionFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(comprar ahora|más información|pedir)/i.test(d))).toBe(true)
  })

  it('applies soft reinforcement for Chinese copy', () => {
    const creative = buildCreativeDraft()

    const fix = softlyReinforceTypeCopy(creative, 'D', 'zh-CN', 'ToolPro')

    expect(fix.descriptionFixes + fix.headlineFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(立即购买|了解更多|立即下单)/.test(d))).toBe(true)
  })

  it('applies soft reinforcement for Arabic copy', () => {
    const creative = buildCreativeDraft()

    const fix = softlyReinforceTypeCopy(creative, 'A', 'ar', 'ToolPro')

    expect(fix.descriptionFixes + fix.headlineFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(اشتري الآن|اعرف المزيد|اطلب الآن)/.test(d))).toBe(true)
  })

  it('keeps unsupported languages unchanged', () => {
    const creative = buildCreativeDraft()
    const before = JSON.stringify(creative)

    const fix = softlyReinforceTypeCopy(creative, 'D', 'hi', 'ToolPro')

    expect(fix.headlineFixes).toBe(0)
    expect(fix.descriptionFixes).toBe(0)
    expect(JSON.stringify(creative)).toBe(before)
  })

  it('preserves English soft reinforcement behavior', () => {
    const creative = buildCreativeDraft()

    const fix = softlyReinforceTypeCopy(creative, 'D', 'en', 'ToolPro')

    expect(fix.descriptionFixes + fix.headlineFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(shop now|learn more|buy now)/i.test(d))).toBe(true)
  })
})
