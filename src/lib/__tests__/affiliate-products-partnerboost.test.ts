import { describe, expect, it } from 'vitest'
import {
  extractPartnerboostProductsPayload,
  normalizePartnerboostStatusCode,
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
})
