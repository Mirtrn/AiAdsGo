import { describe, expect, it } from 'vitest'
import { canonicalizeOfferBatchCsvHeader, decodeCsvTextSmart } from '@/lib/offers/batch-offer-csv'

describe('offer batch csv header', () => {
  it('supports Chinese headers (with BOM)', () => {
    expect(canonicalizeOfferBatchCsvHeader('\uFEFF推广链接')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('推广国家')).toBe('target_country')
    expect(canonicalizeOfferBatchCsvHeader('品牌名')).toBe('brand_name')
    expect(canonicalizeOfferBatchCsvHeader('产品价格')).toBe('product_price')
    expect(canonicalizeOfferBatchCsvHeader('佣金比例')).toBe('commission_payout')
  })

  it('supports headers with annotations', () => {
    expect(canonicalizeOfferBatchCsvHeader('推广链接 (affiliate_link)')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('推广国家（target_country）')).toBe('target_country')
    expect(canonicalizeOfferBatchCsvHeader('品牌名 / brand_name')).toBe('brand_name')
    expect(canonicalizeOfferBatchCsvHeader('产品价格 / product_price')).toBe('product_price')
    expect(canonicalizeOfferBatchCsvHeader('佣金比例｜commission_payout')).toBe('commission_payout')
  })

  it('supports common English variants', () => {
    expect(canonicalizeOfferBatchCsvHeader('affiliate_link')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('AffiliateLink')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('affiliate link')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('affiliate-link')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('targetCountry')).toBe('target_country')
    expect(canonicalizeOfferBatchCsvHeader('brand')).toBe('brand_name')
    expect(canonicalizeOfferBatchCsvHeader('brand_name')).toBe('brand_name')
    expect(canonicalizeOfferBatchCsvHeader('BrandName')).toBe('brand_name')
  })

  it('decodes GBK/GB18030 CSV exported by Excel', () => {
    const gb18030HeaderBytes = Uint8Array.from([
      0xcd, 0xc6, 0xb9, 0xe3, 0xc1, 0xb4, 0xbd, 0xd3, 0x2c, // 推广链接,
      0xcd, 0xc6, 0xb9, 0xe3, 0xb9, 0xfa, 0xbc, 0xd2, 0x2c, // 推广国家,
      0xb2, 0xfa, 0xc6, 0xb7, 0xbc, 0xdb, 0xb8, 0xf1, 0x2c, // 产品价格,
      0xd3, 0xb6, 0xbd, 0xf0, 0xb1, 0xc8, 0xc0, 0xfd, // 佣金比例
      0x0d, 0x0a,
    ])

    const text = decodeCsvTextSmart(gb18030HeaderBytes)
    expect(text).toContain('推广链接,推广国家,产品价格,佣金比例')
    expect(text).not.toContain('\uFFFD')
  })
})
