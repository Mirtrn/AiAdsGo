import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/url-resolver-enhanced', () => ({
  resolveAffiliateLink: vi.fn(),
  BATCH_MODE_RETRY_CONFIG: { retryCount: 1, timeout: 3000 },
  getProxyPool: () => ({
    getProxyInfo: () => ({
      proxy: null,
      isTargetCountryMatch: true,
      usedCountry: 'US',
    }),
  }),
}))

vi.mock('@/lib/scraper', () => ({
  extractProductInfo: vi.fn(),
}))

vi.mock('@/lib/stealth-scraper', () => ({
  scrapeAmazonStoreDeep: vi.fn(),
  scrapeIndependentStoreDeep: vi.fn(),
  scrapeAmazonProduct: vi.fn(),
  scrapeIndependentProduct: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getProxyUrlForCountry: vi.fn(),
}))

vi.mock('@/lib/proxy-warmup', () => ({
  warmupAffiliateLink: vi.fn(),
}))

vi.mock('@/lib/google-brand-search', () => ({
  fetchBrandSearchSupplement: vi.fn(),
}))

vi.mock('@/lib/offer-utils', () => ({
  detectPageType: vi.fn(() => ({
    pageType: 'unknown',
    isAmazonStore: false,
    isAmazonProductPage: false,
    isIndependentStore: false,
  })),
  initializeProxyPool: vi.fn(async () => {}),
  getTargetLanguage: vi.fn(() => 'en'),
  normalizeBrandName: (brand: string) => {
    const trimmed = typeof brand === 'string' ? brand.trim() : ''
    if (!trimmed) return trimmed
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  },
}))

describe('extractOffer brand fallback', () => {
  it('falls back to domain brand when independent product scraping times out', async () => {
    const { extractOffer } = await import('@/lib/offer-extraction-core')
    const { resolveAffiliateLink } = await import('@/lib/url-resolver-enhanced')
    const { extractProductInfo } = await import('@/lib/scraper')
    const { scrapeIndependentProduct } = await import('@/lib/stealth-scraper')
    const { getProxyUrlForCountry } = await import('@/lib/settings')

    vi.mocked(getProxyUrlForCountry).mockResolvedValue('https://proxy-provider.example/api?cc=US')
    vi.mocked(resolveAffiliateLink).mockResolvedValue({
      finalUrl: 'https://www.hitmanpro.com/en-us',
      finalUrlSuffix: 'affiliate=abc',
      brand: null,
      redirectCount: 3,
      redirectChain: ['https://click-ecom.com/', 'https://prf.hn/', 'https://www.hitmanpro.com/en-us'],
      pageTitle: null,
      statusCode: 200,
      resolveMethod: 'http',
      proxyUsed: 'US',
    })

    vi.mocked(extractProductInfo).mockRejectedValue(new Error('timeout of 30000ms exceeded'))
    vi.mocked(scrapeIndependentProduct).mockRejectedValue(new Error('playwright failed'))

    const result = await extractOffer({
      affiliateLink: 'https://click-ecom.com/?a=284403&c=275883&co=347178&mt=5',
      targetCountry: 'US',
      userId: 1,
      skipWarmup: true,
    })

    expect(result.success).toBe(true)
    expect(result.data?.brand).toBe('Hitmanpro')

    expect(vi.mocked(extractProductInfo)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(extractProductInfo).mock.calls[0]?.[2]).toBe('https://proxy-provider.example/api?cc=US')
  })
})
