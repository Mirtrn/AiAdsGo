import { describe, expect, it } from 'vitest'
import { extractYeahPromosPayload, normalizeYeahPromosResultCode } from '@/lib/affiliate-products'

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
})
