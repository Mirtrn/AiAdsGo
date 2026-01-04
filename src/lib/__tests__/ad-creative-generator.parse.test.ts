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
})

