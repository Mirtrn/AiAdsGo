import { fetchBrandSearchSupplement } from './google-brand-search'
import { getProxyUrlForCountry } from './settings'
import { updateOfferExtractionMetadata } from './offers'

export interface BrandOfficialSite {
  url: string
  origin: string
  query: string
  resolvedAt: string
  source: 'google_serp' | 'cached'
}

function safeParseJsonObject(value: string | null | undefined): Record<string, any> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, any>) : null
  } catch {
    return null
  }
}

function tryGetBrandOfficialSiteFromMetadata(extractionMetadata: string | null | undefined): BrandOfficialSite | null {
  const meta = safeParseJsonObject(extractionMetadata)
  if (!meta) return null

  const direct = meta.brandOfficialSite
  if (direct && typeof direct === 'object') {
    const url = typeof direct.url === 'string' ? direct.url.trim() : ''
    const origin = typeof direct.origin === 'string' ? direct.origin.trim() : ''
    const query = typeof direct.query === 'string' ? direct.query.trim() : ''
    if (url && origin && query) {
      return {
        url,
        origin,
        query,
        resolvedAt: typeof direct.resolvedAt === 'string' ? direct.resolvedAt : new Date().toISOString(),
        source: direct.source === 'google_serp' || direct.source === 'cached' ? direct.source : 'cached',
      }
    }
  }

  const maybeSupplementUrl = meta?.brandSearchSupplement?.officialSite?.url
  if (typeof maybeSupplementUrl === 'string' && maybeSupplementUrl.trim()) {
    try {
      const url = maybeSupplementUrl.trim()
      const origin = new URL(url).origin
      return {
        url,
        origin,
        query: typeof meta?.brandSearchSupplement?.query === 'string' ? meta.brandSearchSupplement.query : 'unknown',
        resolvedAt: typeof meta?.brandSearchSupplement?.searchedAt === 'string' ? meta.brandSearchSupplement.searchedAt : new Date().toISOString(),
        source: 'cached',
      }
    } catch {
      return null
    }
  }

  return null
}

function isMarketplaceHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  return (
    /(^|\.)amazon\./i.test(h) ||
    /(^|\.)ebay\./i.test(h) ||
    /(^|\.)walmart\./i.test(h) ||
    /(^|\.)aliexpress\./i.test(h) ||
    /(^|\.)temu\./i.test(h) ||
    /(^|\.)etsy\./i.test(h)
  )
}

function normalizeTokens(input: string): string[] {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return []

  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in', 'on', 'by',
    'official', 'store', 'shop', 'website', 'site', 'online',
  ])

  const tokens = cleaned
    .split(' ')
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => t.length >= 3)
    .filter(t => !stop.has(t))

  return Array.from(new Set(tokens))
}

function buildBrandOfficialSiteQuery(params: {
  brand: string
  category?: string | null
  productName?: string | null
}): string {
  const brand = params.brand.trim()
  const brandTokens = new Set(normalizeTokens(brand))

  const hintSource = (params.category && params.category.trim())
    ? params.category
    : (params.productName && params.productName.trim())
      ? params.productName
      : ''

  const hintTokens = normalizeTokens(hintSource).filter(t => !brandTokens.has(t))
  const hint = hintTokens.slice(0, 4).join(' ')

  // Prefer "brand + category" to reduce ambiguity; fall back to brand-only if no usable hint.
  return hint ? `${brand} ${hint}` : brand
}

export async function ensureOfferBrandOfficialSite(params: {
  offerId: number
  userId: number
  brand: string
  targetCountry: string
  finalUrl?: string | null
  url?: string | null
  category?: string | null
  productName?: string | null
  extractionMetadata?: string | null
}): Promise<BrandOfficialSite | null> {
  const cached = tryGetBrandOfficialSiteFromMetadata(params.extractionMetadata)
  if (cached?.origin) return cached

  const primaryUrl = params.finalUrl || params.url || ''
  const needForMarketplace = (() => {
    try {
      const host = new URL(primaryUrl).hostname
      return isMarketplaceHost(host)
    } catch {
      return false
    }
  })()
  if (!needForMarketplace) return null

  const proxyApiUrl = await getProxyUrlForCountry(params.targetCountry, params.userId)
  if (!proxyApiUrl) return null

  const query = buildBrandOfficialSiteQuery({
    brand: params.brand,
    category: params.category,
    productName: params.productName,
  })

  const supplement = await fetchBrandSearchSupplement({
    brandName: params.brand,
    query,
    targetCountry: params.targetCountry,
    proxyApiUrl,
    maxProxyRetries: 1,
  })

  const officialUrl = supplement?.officialSite?.url?.trim()
  if (!officialUrl) return null

  let origin: string
  try {
    origin = new URL(officialUrl).origin
  } catch {
    return null
  }

  const existing = safeParseJsonObject(params.extractionMetadata) || {}
  const resolvedAt = new Date().toISOString()

  const brandOfficialSite: BrandOfficialSite = {
    url: officialUrl,
    origin,
    query: supplement?.query || query,
    resolvedAt,
    source: 'google_serp',
  }

  const minimizedSupplement = {
    query: supplement?.query || query,
    targetCountry: params.targetCountry,
    searchedAt: supplement?.searchedAt || resolvedAt,
    officialSite: supplement?.officialSite || { url: officialUrl },
  }

  const merged = {
    ...existing,
    brandOfficialSite,
    brandSearchSupplement: minimizedSupplement,
  }

  const mergedString = JSON.stringify(merged)
  await updateOfferExtractionMetadata(params.offerId, params.userId, mergedString)

  return brandOfficialSite
}

