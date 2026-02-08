import { describe, expect, it } from 'vitest'
import { __testOnly, type AffiliateProduct } from '../affiliate-products'

function buildBaseRow(overrides: Partial<AffiliateProduct> = {}): AffiliateProduct {
  return {
    id: 1,
    user_id: 7,
    platform: 'yeahpromos',
    mid: 'M-1',
    asin: null,
    brand: 'Demo',
    product_name: 'Demo Product',
    product_url: 'https://example.com/p',
    promo_link: 'https://example.com/track',
    short_promo_link: null,
    allowed_countries_json: '[]',
    price_amount: 100,
    price_currency: 'USD',
    commission_rate: 15,
    commission_amount: 15,
    raw_json: '{}',
    is_blacklisted: 0,
    last_synced_at: null,
    last_seen_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('affiliate-products display mapping', () => {
  it('keeps percent mode when commission is percentage', () => {
    const row = buildBaseRow({
      raw_json: JSON.stringify({
        payout_unit: '%',
      }),
      commission_rate: 12,
      commission_amount: 18,
    })

    const mapped = __testOnly.mapAffiliateProductRow(row)
    expect(mapped.commissionRateMode).toBe('percent')
    expect(mapped.commissionRate).toBe(12)
    expect(mapped.commissionAmount).toBe(18)
    expect(mapped.commissionCurrency).toBe('USD')
  })

  it('uses amount mode and aligns rate/amount when commission is absolute value', () => {
    const row = buildBaseRow({
      raw_json: JSON.stringify({
        payout_unit: 'USD',
      }),
      commission_rate: 20,
      commission_amount: 32.5,
    })

    const mapped = __testOnly.mapAffiliateProductRow(row)
    expect(mapped.commissionRateMode).toBe('amount')
    expect(mapped.commissionRate).toBe(32.5)
    expect(mapped.commissionAmount).toBe(32.5)
    expect(mapped.commissionCurrency).toBe('USD')
  })

  it('uses commission_currency from raw json when present', () => {
    const row = buildBaseRow({
      raw_json: JSON.stringify({
        commission_mode: 'amount',
        commission_currency: 'eur',
      }),
      price_currency: null,
      commission_rate: 10,
      commission_amount: 21.99,
    })

    const mapped = __testOnly.mapAffiliateProductRow(row)
    expect(mapped.commissionRateMode).toBe('amount')
    expect(mapped.commissionRate).toBe(21.99)
    expect(mapped.commissionAmount).toBe(21.99)
    expect(mapped.commissionCurrency).toBe('EUR')
  })
})
