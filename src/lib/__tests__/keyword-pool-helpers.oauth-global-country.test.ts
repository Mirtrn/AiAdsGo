import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoolKeywordData } from '../offer-keyword-pool'

let mockDb: any
const mockExpandKeywordsWithSeeds = vi.fn()
const mockGetKeywordSearchVolumes = vi.fn()

vi.mock('../db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../unified-keyword-service', () => ({
  expandKeywordsWithSeeds: (...args: any[]) => mockExpandKeywordsWithSeeds(...args),
}))

vi.mock('../keyword-planner', () => ({
  getKeywordSearchVolumes: (...args: any[]) => mockGetKeywordSearchVolumes(...args),
}))

vi.mock('../google-trends', () => ({
  getTrendsKeywords: vi.fn(async () => []),
}))

vi.mock('../google-suggestions', () => ({
  detectCountryInKeyword: vi.fn(() => []),
  filterLowIntentKeywords: vi.fn((keywords: string[]) => keywords),
  filterMismatchedGeoKeywords: vi.fn((keywords: string[]) => keywords),
  getBrandSearchSuggestions: vi.fn(async () => []),
}))

// Avoid native bcrypt binary issues in some test runners.
vi.mock('bcrypt', () => {
  const stub = {
    hash: async () => 'stub-hash',
    compare: async () => true,
  }
  return { default: stub, ...stub }
})

describe('keyword-pool-helpers.expandAllKeywords (OAuth global candidates)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockExpandKeywordsWithSeeds.mockReset()
    mockGetKeywordSearchVolumes.mockReset()

    mockExpandKeywordsWithSeeds.mockResolvedValue([])
    mockGetKeywordSearchVolumes.mockResolvedValue([])

    mockDb = {
      type: 'postgres',
      queryOne: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
      query: vi.fn(async (_sql: string, params: any[]) => {
        const countryParams = params.slice(0, 2)
        const language = params[2]
        const hasGb = countryParams.includes('GB')
        const hasUk = countryParams.includes('UK')
        if (hasGb && hasUk && language === 'en') {
          return [
            {
              keyword: 'hoover vacuum cleaner',
              search_volume: 12100,
              competition_level: 'HIGH',
              avg_cpc_micros: 1200000,
            },
            {
              keyword: 'hoover amazon',
              search_volume: 1900,
              competition_level: 'MEDIUM',
              avg_cpc_micros: 800000,
            },
          ]
        }
        return []
      }),
    }
  })

  it('queries global_keywords with normalized country (GB) when targetCountry is UK', async () => {
    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const initial: PoolKeywordData[] = [{ keyword: 'hoover', searchVolume: 0, source: 'TEST', matchType: 'BROAD' }]

    const out = await expandAllKeywords(
      initial,
      'Hoover',
      'Vacuum Cleaner',
      'UK',
      'English',
      'oauth',
      undefined,
      51,
      '1234567890',
      'refresh-token'
    )

    expect(mockDb.query).toHaveBeenCalled()
    const [sql, params] = mockDb.query.mock.calls[0]
    expect(String(sql)).toContain('country IN (')
    expect(params).toEqual(expect.arrayContaining(['GB', 'UK', 'en']))
    expect(out.map(k => k.keyword)).toContain('hoover vacuum cleaner')
  })

  it('keeps platform keyword when semantic term matches product URL platform', async () => {
    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const initial: PoolKeywordData[] = [{ keyword: 'hoover', searchVolume: 0, source: 'TEST', matchType: 'BROAD' }]

    const out = await expandAllKeywords(
      initial,
      'Hoover',
      'Vacuum Cleaner',
      'UK',
      'English',
      'oauth',
      {
        final_url: 'https://www.amazon.co.uk/dp/B0F94D3ZJ2',
        url: 'https://www.amazon.co.uk/dp/B0F94D3ZJ2',
      } as any,
      51,
      '1234567890',
      'refresh-token'
    )

    const keywords = out.map(k => k.keyword)
    expect(keywords).toContain('hoover amazon')
  })
})
