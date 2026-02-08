import { describe, expect, it } from 'vitest'
import { buildAffiliateProductsOrderBy } from '../affiliate-products'

describe('affiliate-products order by', () => {
  it('keeps null values last for numeric sort fields in asc', () => {
    const orderBy = buildAffiliateProductsOrderBy({ sortBy: 'priceAmount', sortOrder: 'asc' })

    expect(orderBy).toContain('(p.price_amount IS NULL) ASC')
    expect(orderBy).toContain('p.price_amount ASC')
    expect(orderBy).toContain('p.id DESC')
  })

  it('keeps null values last for numeric sort fields in desc', () => {
    const orderBy = buildAffiliateProductsOrderBy({ sortBy: 'commissionRate', sortOrder: 'desc' })

    expect(orderBy).toContain('(p.commission_rate IS NULL) ASC')
    expect(orderBy).toContain('p.commission_rate DESC')
    expect(orderBy).toContain('p.id DESC')
  })

  it('supports review count sorting with nulls last', () => {
    const orderBy = buildAffiliateProductsOrderBy({ sortBy: 'reviewCount', sortOrder: 'desc' })

    expect(orderBy).toContain('(p.review_count IS NULL) ASC')
    expect(orderBy).toContain('p.review_count DESC')
    expect(orderBy).toContain('p.id DESC')
  })

  it('uses normal sort for non-numeric fields', () => {
    const orderBy = buildAffiliateProductsOrderBy({ sortBy: 'mid', sortOrder: 'asc' })

    expect(orderBy).toContain('p.mid ASC')
    expect(orderBy).toContain('p.id DESC')
    expect(orderBy).not.toContain('IS NULL')
  })
})
