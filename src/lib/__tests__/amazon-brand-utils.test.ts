import { describe, it, expect } from 'vitest'
import { extractAmazonBrandFromByline } from '@/lib/amazon-brand-utils'

describe('extractAmazonBrandFromByline', () => {
  it('extracts brand from German byline text with Store suffix', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Besuchen Sie den Comfyer-Store',
      bylineHref: null,
    })).toBe('Comfyer')
  })

  it('extracts brand from German byline text with Shop suffix', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Besuchen Sie den Comfyer-Shop',
      bylineHref: null,
    })).toBe('Comfyer')
  })

  it('extracts brand from href when byline text is only locale boilerplate', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Besuchen',
      bylineHref: '/stores/Comfyer/page/123',
    })).toBe('Comfyer')
  })

  it('returns null when only boilerplate is available', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Besuchen',
      bylineHref: null,
    })).toBeNull()
  })
})

