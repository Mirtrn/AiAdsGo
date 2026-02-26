import { describe, expect, it } from 'vitest'
import {
  __testOnly,
  extractYeahPromosPayload,
  extractYeahPromosTransactionsPayload,
  normalizeYeahPromosResultCode,
  parseYeahPromosMerchantCommission,
} from '@/lib/affiliate-products'

describe('normalizeYeahPromosResultCode', () => {
  it('parses success code from number and string', () => {
    expect(normalizeYeahPromosResultCode(100000)).toBe(100000)
    expect(normalizeYeahPromosResultCode('100000')).toBe(100000)
  })

  it('returns null for empty or invalid values', () => {
    expect(normalizeYeahPromosResultCode(undefined)).toBeNull()
    expect(normalizeYeahPromosResultCode(null)).toBeNull()
    expect(normalizeYeahPromosResultCode('')).toBeNull()
    expect(normalizeYeahPromosResultCode('ERR')).toBeNull()
  })

  it('extracts merchants and paging from nested data payload', () => {
    const payload = {
      code: '100000',
      data: {
        PageTotal: 3,
        PageNow: '1',
        Data: [
          {
            mid: 123,
            merchant_name: 'demo',
            tracking_url: 'https://example.com/track',
            advert_status: 1,
          },
        ],
      },
    }

    const extracted = extractYeahPromosPayload(payload)

    expect(extracted.pageTotal).toBe(3)
    expect(extracted.pageNow).toBe(1)
    expect(extracted.merchants).toHaveLength(1)
    expect(extracted.merchants[0]?.mid).toBe(123)
  })

  it('extracts transactions and paging from nested data payload', () => {
    const payload = {
      code: 100000,
      data: {
        PageTotal: '2',
        pageNow: 1,
        Data: [
          {
            advert_id: '123',
            amount: '19.99',
            sale_comm: '2.5',
          },
        ],
      },
    }

    const extracted = extractYeahPromosTransactionsPayload(payload)

    expect(extracted.pageTotal).toBe(2)
    expect(extracted.pageNow).toBe(1)
    expect(extracted.transactions).toHaveLength(1)
    expect(extracted.transactions[0]?.advert_id).toBe('123')
  })

  it('parses merchant commission as amount when payout_unit is currency', () => {
    const parsed = parseYeahPromosMerchantCommission('60.00', '€')
    expect(parsed.mode).toBe('amount')
    expect(parsed.rate).toBeNull()
    expect(parsed.amount).toBe(60)
  })

  it('parses merchant commission as rate when payout_unit is percent', () => {
    const parsed = parseYeahPromosMerchantCommission('12.5', '%')
    expect(parsed.mode).toBe('rate')
    expect(parsed.rate).toBe(12.5)
    expect(parsed.amount).toBeNull()
  })

  it('treats value with percent symbol as rate', () => {
    const parsed = parseYeahPromosMerchantCommission('7.2%', 'USD')
    expect(parsed.mode).toBe('rate')
    expect(parsed.rate).toBe(7.2)
    expect(parsed.amount).toBeNull()
  })
})

describe('isYeahPromosRateLimited', () => {
  it('detects HTTP 429 and common YP rate-limit code', () => {
    expect(__testOnly.isYeahPromosRateLimited(null, '', 429)).toBe(true)
    expect(__testOnly.isYeahPromosRateLimited(429, '')).toBe(true)
  })

  it('detects message-based rate-limit signals', () => {
    expect(__testOnly.isYeahPromosRateLimited(null, 'Too many request')).toBe(true)
    expect(__testOnly.isYeahPromosRateLimited(null, 'rate limit exceeded')).toBe(true)
  })

  it('returns false for normal cases', () => {
    expect(__testOnly.isYeahPromosRateLimited(100000, 'success')).toBe(false)
    expect(__testOnly.isYeahPromosRateLimited(100001, 'invalid token')).toBe(false)
  })
})

describe('isYeahPromosTransientError', () => {
  it('detects HTTP 5xx gateway errors', () => {
    const error = new Error('YeahPromos 商品拉取失败 (502): <html><title>502 Bad Gateway</title></html>')
    expect(__testOnly.isYeahPromosTransientError(error)).toBe(true)
  })

  it('detects non-json parse failures from upstream transient responses', () => {
    const error = new SyntaxError(`Unexpected token 'R', \"Request to\"... is not valid JSON`)
    expect(__testOnly.isYeahPromosTransientError(error)).toBe(true)
  })

  it('detects enriched non-json parse failures with response snippet', () => {
    const error = new SyntaxError(
      `YeahPromos 商品拉取失败 (200): Unexpected token 'R', \"Request to\"... is not valid JSON; response=Request too frequent`
    )
    expect(__testOnly.isYeahPromosTransientError(error)).toBe(true)
  })

  it('returns false for normal business errors', () => {
    const error = new Error('YeahPromos 商品拉取失败: 100001')
    expect(__testOnly.isYeahPromosTransientError(error)).toBe(false)
  })
})
