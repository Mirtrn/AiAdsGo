import { describe, expect, it, vi } from 'vitest'
import { parseAIResponse } from '../ad-creative-generator'

describe('ad-creative-generator.parseAIResponse', () => {
  it('parses responsive_search_ads format (objects with text/group)', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const aiText = `\`\`\`json
{
  "responsive_search_ads": {
    "headlines": [
      { "group": "Brand", "text": "{KeyWord:Colijoy} Official Store" },
      { "group": "Brand", "text": "Colijoy Custom Photo Blanket" },
      { "group": "Features", "text": "Crystal Clear HD Printing" }
    ],
    "descriptions": [
      { "group": "Benefits", "text": "Premium HD printing & soft flannel." },
      { "group": "Benefits", "text": "Upload photos fast. Ships quickly." }
    ],
    "keywords": ["colijoy", "colijoy photo blanket"],
    "callouts": ["Free Shipping", "Easy Customization"],
    "sitelinks": [
      { "text": "Shop Blankets", "url": "https://example.com", "description": "Pick your size & style." }
    ]
  }
}
\`\`\``

    const result = parseAIResponse(aiText)
    expect(result.headlines.length).toBeGreaterThanOrEqual(3)
    expect(result.descriptions.length).toBeGreaterThanOrEqual(2)
    expect(result.keywords.length).toBeGreaterThanOrEqual(1)
    expect(result.callouts.length).toBeGreaterThanOrEqual(1)
    expect(result.sitelinks.length).toBeGreaterThanOrEqual(1)
    expect(result.headlines[0]).toContain('Colijoy')
  })

  it('clamps RSA asset counts (≤15 headlines, ≤4 descriptions)', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const payload = {
      responsive_search_ads: {
        headlines: Array.from({ length: 16 }, (_, i) => ({ group: 'Test', text: `Headline ${i + 1}` })),
        descriptions: Array.from({ length: 5 }, (_, i) => ({ group: 'Test', text: `Description ${i + 1}` })),
        keywords: ['kw1', 'kw2'],
        callouts: ['Callout 1'],
        sitelinks: [{ text: 'Sitelink 1', url: 'https://example.com', description: 'Desc' }],
      },
    }

    const aiText = `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``

    const result = parseAIResponse(aiText)
    expect(result.headlines).toHaveLength(15)
    expect(result.descriptions).toHaveLength(4)
  })

  it('repairs missing commas between objects in arrays', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const aiText = `{
  "headlines": [
    {"text": "A", "type": "brand", "length": 1}
    {"text": "B", "type": "feature", "length": 1},
    {"text": "C", "type": "cta", "length": 1}
  ],
  "descriptions": [
    {"text": "Desc 1", "type": "feature-benefit-cta", "length": 6}
    {"text": "Desc 2", "type": "feature-benefit-cta", "length": 6}
  ],
  "keywords": ["k1", "k2", "k3"],
  "callouts": ["Callout 1"],
  "sitelinks": [{"text": "Link 1", "url": "/", "description": "Desc"}]
}`

    const result = parseAIResponse(aiText)
    expect(result.headlines.length).toBeGreaterThanOrEqual(3)
    expect(result.descriptions.length).toBeGreaterThanOrEqual(2)
  })

  it('repairs raw newlines inside string values', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const aiText = `{
  "headlines": [
    {"text": "Line1
Line2", "type": "brand", "length": 10},
    {"text": "Two", "type": "feature", "length": 3},
    {"text": "Three", "type": "cta", "length": 5}
  ],
  "descriptions": [
    {"text": "Desc line1
line2", "type": "feature-benefit-cta", "length": 10},
    {"text": "Desc two", "type": "feature-benefit-cta", "length": 8}
  ],
  "keywords": ["k1", "k2", "k3"],
  "callouts": ["Callout 1"],
  "sitelinks": [{"text": "Link 1", "url": "/", "description": "Desc"}]
}`

    const result = parseAIResponse(aiText)
    expect(result.headlines[0]).toContain('Line1 Line2')
    expect(result.descriptions[0]).toContain('Desc line1 line2')
  })

  it('sanitizes policy-sensitive health terms in assets and keywords', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const aiText = `{
  "headlines": [
    {"text": "Sleep Apnea Ring", "type": "brand", "length": 16},
    {"text": "Diagnose Overnight", "type": "feature", "length": 18},
    {"text": "Clinical Sleep Tracking", "type": "cta", "length": 22}
  ],
  "descriptions": [
    {"text": "Diagnose sleep apnea at home.", "type": "feature-benefit-cta", "length": 30},
    {"text": "Treatment insights for patients.", "type": "feature-benefit-cta", "length": 31}
  ],
  "keywords": ["ringconn sleep apnea monitoring", "sleep apnea diagnosis ring", "clinical sleep ring"],
  "callouts": ["Sleep Apnea Support", "Clinical Grade Tracking"],
  "sitelinks": [{"text": "Sleep Apnea Info", "url": "/", "description": "Diagnosis and treatment guide"}]
}`

    const result = parseAIResponse(aiText)
    const combinedText = [
      ...result.headlines,
      ...result.descriptions,
      ...(result.callouts || []),
      ...(result.sitelinks || []).map((s) => `${s.text} ${s.description || ''}`),
      ...result.keywords
    ].join(' ').toLowerCase()

    expect(combinedText).not.toContain('sleep apnea')
    expect(combinedText).not.toContain('diagnos')
    expect(combinedText).not.toContain('clinical')
    expect(result.keywords.some((kw) => kw.toLowerCase().includes('sleep quality'))).toBe(true)
  })
})
