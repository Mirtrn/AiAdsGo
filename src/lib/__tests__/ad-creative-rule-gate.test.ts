import { describe, expect, it } from 'vitest'
import type { GeneratedAdCreativeData } from '../ad-creative'
import {
  CREATIVE_RELEVANCE_NOISE_TERMS,
  createCreativeRuleContext,
  evaluateCreativeRuleGate,
  filterPromptExtrasByRelevance
} from '../ad-creative-rule-gate'

function buildCreative(partial?: Partial<GeneratedAdCreativeData>): GeneratedAdCreativeData {
  return {
    headlines: [
      'Seamless Sports Bra for Workouts',
      'Breathable Yoga Support Bra',
      'Shop Activewear Essentials'
    ],
    descriptions: [
      'Stay comfortable with medium support and breathable fabric. Shop Now.',
      'Trusted fit for gym sessions and daily movement. Learn More.',
      'Lightweight support with premium comfort for women.'
    ],
    keywords: ['sports bra', 'yoga bra', 'workout bra'],
    callouts: ['Breathable Fabric', 'Flexible Support'],
    sitelinks: [{ text: 'Shop Sports Bra', url: '/', description: 'Find Your Best Fit' }],
    theme: 'test',
    explanation: 'test',
    ...partial
  }
}

describe('ad-creative-rule-gate', () => {
  it('exposes enumerable noise terms', () => {
    expect(CREATIVE_RELEVANCE_NOISE_TERMS.length).toBeGreaterThan(8)
    expect(CREATIVE_RELEVANCE_NOISE_TERMS).toContain('repair')
    expect(CREATIVE_RELEVANCE_NOISE_TERMS).toContain('drill')
  })

  it('blocks off-topic repair/tool language for non-tool products', () => {
    const creative = buildCreative({
      headlines: [
        'Reliable Fix for Real Projects',
        'Tackle Repairs With Confidence',
        'Tool-Grade Performance'
      ],
      descriptions: [
        'Repair jobs made easier. Buy now.',
        'Perfect drill companion for workshop tasks.',
        'Trusted quality for hardware projects.'
      ]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en'
    })

    expect(result.relevance.passed).toBe(false)
    expect(result.relevance.offTopicHits.some(hit => /repair|fix|tool|drill/i.test(hit))).toBe(true)
  })

  it('passes relevant sports-bra creatives', () => {
    const creative = buildCreative()
    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en'
    })

    expect(result.relevance.passed).toBe(true)
  })

  it('flags low diversity when headlines are duplicated', () => {
    const creative = buildCreative({
      headlines: Array.from({ length: 10 }, () => 'Shop Sports Bra Today')
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en'
    })

    expect(result.diversity.passed).toBe(false)
    expect(result.diversity.reasons.join(' ')).toMatch(/uniqueness|duplicate/i)
  })

  it('filters noisy prompt extras by relevance context', () => {
    const context = createCreativeRuleContext({
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: ['sports bra', 'workout bra'],
      targetLanguage: 'en'
    })

    const filtered = filterPromptExtrasByRelevance([
      'CORE FEATURES: Breathable fabric, medium support',
      'COMPETITOR WEAKNESSES: Great for tackle repairs and drill projects'
    ], context)

    expect(filtered.filtered.length).toBe(1)
    expect(filtered.removed.length).toBe(1)
    expect(filtered.removed[0]).toMatch(/repair|drill/i)
  })
})
