import { describe, expect, it } from 'vitest'
import {
  detectAffiliateLandingPageType,
  extractPartnerboostProductsPayload,
  normalizePartnerboostStatusCode,
  resolvePartnerboostCountryCode,
  resolvePartnerboostPromoLinks,
} from '@/lib/affiliate-products'

describe('normalizePartnerboostStatusCode', () => {
  it('supports number and string status code', () => {
    expect(normalizePartnerboostStatusCode(0)).toBe(0)
    expect(normalizePartnerboostStatusCode('0')).toBe(0)
    expect(normalizePartnerboostStatusCode('200')).toBe(200)
  })

  it('returns null for invalid or empty value', () => {
    expect(normalizePartnerboostStatusCode(undefined)).toBeNull()
    expect(normalizePartnerboostStatusCode(null)).toBeNull()
    expect(normalizePartnerboostStatusCode('')).toBeNull()
    expect(normalizePartnerboostStatusCode('ERROR')).toBeNull()
  })
})

describe('extractPartnerboostProductsPayload', () => {
  it('extracts products from object list and reads has_more flag', () => {
    const payload = {
      status: { code: '0', msg: 'success' },
      data: {
        list: {
          first: { product_id: 'p1', asin: 'B000000001' },
          second: { product_id: 'p2', asin: 'B000000002' },
        },
        has_more: '1',
      },
    }

    const extracted = extractPartnerboostProductsPayload(payload)

    expect(extracted.products).toHaveLength(2)
    expect(extracted.hasMore).toBe(true)
  })

  it('supports hasMore fallback and false-like flag values', () => {
    const payload = {
      status: { code: 0, msg: 'success' },
      data: {
        list: [{ product_id: 'p3' }],
        hasMore: '0',
      },
    }

    const extracted = extractPartnerboostProductsPayload(payload)

    expect(extracted.products).toHaveLength(1)
    expect(extracted.hasMore).toBe(false)
  })
})

describe('resolvePartnerboostPromoLinks', () => {
  it('prefers partnerboost short link', () => {
    const resolved = resolvePartnerboostPromoLinks({
      productIdLink: 'https://amazon.example/product',
      asinLink: 'https://amazon.example/asin',
      asinPartnerboostLink: 'https://pboost.me/short',
    })

    expect(resolved.shortPromoLink).toBe('https://pboost.me/short')
    expect(resolved.promoLink).toBe('https://pboost.me/short')
  })

  it('falls back to ASIN link then product-id link', () => {
    const fromAsin = resolvePartnerboostPromoLinks({
      productIdLink: 'https://amazon.example/product',
      asinLink: 'https://amazon.example/asin',
      asinPartnerboostLink: '',
    })
    expect(fromAsin.shortPromoLink).toBeNull()
    expect(fromAsin.promoLink).toBe('https://amazon.example/asin')

    const fromProductId = resolvePartnerboostPromoLinks({
      productIdLink: 'https://amazon.example/product',
      asinLink: '',
      asinPartnerboostLink: '',
    })
    expect(fromProductId.shortPromoLink).toBeNull()
    expect(fromProductId.promoLink).toBe('https://amazon.example/product')
  })

  it('uses short link when ASIN lookup returns partnerboost_link', () => {
    const resolved = resolvePartnerboostPromoLinks({
      productIdLink: 'https://www.amazon.com/dp/B000000001?tag=long',
      asinLink: 'https://www.amazon.com/dp/B000000001?tag=asin-long',
      asinPartnerboostLink: 'https://pboost.me/abc123',
    })

    expect(resolved.shortPromoLink).toBe('https://pboost.me/abc123')
    expect(resolved.promoLink).toBe('https://pboost.me/abc123')
  })
})

describe('resolvePartnerboostCountryCode', () => {
  it('returns uppercase country when configured', () => {
    expect(resolvePartnerboostCountryCode('ca')).toBe('CA')
    expect(resolvePartnerboostCountryCode(' us ')).toBe('US')
  })

  it('falls back to provided fallback value', () => {
    expect(resolvePartnerboostCountryCode('', 'gb')).toBe('GB')
    expect(resolvePartnerboostCountryCode(undefined, 'jp')).toBe('JP')
  })

  it('falls back to US when both are empty', () => {
    expect(resolvePartnerboostCountryCode('')).toBe('US')
    expect(resolvePartnerboostCountryCode(undefined, '')).toBe('US')
  })
})

describe('detectAffiliateLandingPageType', () => {
  it('returns amazon_product when asin exists', () => {
    expect(detectAffiliateLandingPageType({ asin: 'B0ABC12345' })).toBe('amazon_product')
  })

  it('returns amazon_store for amazon store url', () => {
    expect(detectAffiliateLandingPageType({ productUrl: 'https://www.amazon.com/stores/page/ABC123' })).toBe('amazon_store')
  })

  it('returns independent_product for product-like path', () => {
    expect(detectAffiliateLandingPageType({ productUrl: 'https://brand.example.com/products/camera-x1' })).toBe('independent_product')
  })

  it('returns independent_store for root path', () => {
    expect(detectAffiliateLandingPageType({ productUrl: 'https://brand.example.com/' })).toBe('independent_store')
  })

  it('returns unknown when no valid signal', () => {
    expect(detectAffiliateLandingPageType({})).toBe('unknown')
  })
})
