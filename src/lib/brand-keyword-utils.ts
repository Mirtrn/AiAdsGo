import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'

const TITLE_BRAND_PREFIXES = new Set([
  'dr', 'mr', 'mrs', 'ms', 'miss', 'sir', 'madam', 'prof', 'professor',
])

const DETERMINER_BRAND_PREFIXES = new Set([
  'the', 'a', 'an',
])

const GENERIC_BRAND_PREFIXES = new Set([
  ...TITLE_BRAND_PREFIXES,
  ...DETERMINER_BRAND_PREFIXES,
])

const BROAD_FIRST_WORDS = new Set([
  'real',
])

export const PRODUCT_WORD_PATTERNS = [
  'pro', 'max', 'ultra', 'plus', 'mini', 'lite', 'air', 's',
  'se', 'x', 'c', 'e', 'a', 'v', 't',
  'edition', 'version', 'gen', 'generation',
  'camera', 'cam', 'vacuum', 'robot', 'cleaner',
  'doorbell', 'security', 'tracker', 'sensor',
  'starter', 'bundle', 'kit', 'set', 'pack'
]

function hasBrandConnector(rawBrand: string): boolean {
  if (!rawBrand) return false
  const lower = rawBrand.toLowerCase()
  if (lower.includes('&')) return true
  return /\b(and)\b/.test(lower)
}

export function getPureBrandKeywords(brandName: string): string[] {
  const normalizedFull = normalizeGoogleAdsKeyword(brandName || '')
  if (!normalizedFull) return []

  const words = normalizedFull.split(/\s+/).filter(Boolean)
  const pureBrandKeywords: string[] = [normalizedFull]

  if (words.length > 1) {
    const first = words[0]
    const hasConnector = hasBrandConnector(brandName)

    // Skip short tokens for connector-style or overly broad first-word brands.
    if (!hasConnector) {
      if (first && TITLE_BRAND_PREFIXES.has(first)) {
        const meaningful = words.find((w, idx) => idx > 0 && !GENERIC_BRAND_PREFIXES.has(w))
        if (meaningful) pureBrandKeywords.push(meaningful)
      } else if (first && DETERMINER_BRAND_PREFIXES.has(first) && words.length > 2) {
        pureBrandKeywords.push(words.slice(1).join(' '))
      } else if (first && !GENERIC_BRAND_PREFIXES.has(first) && !BROAD_FIRST_WORDS.has(first)) {
        pureBrandKeywords.push(first)
      }
    }
  }

  return Array.from(new Set(pureBrandKeywords))
}

export function containsPureBrand(keyword: string, pureBrandKeywords: string[]): boolean {
  if (!keyword || !pureBrandKeywords || pureBrandKeywords.length === 0) {
    return false
  }

  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)
  if (!normalizedKeyword) return false

  const keywordTokens = normalizedKeyword.split(' ').filter(Boolean)
  const haystack = ` ${normalizedKeyword} `

  for (const brand of pureBrandKeywords) {
    const normalizedBrand = normalizeGoogleAdsKeyword(brand || '')
    if (!normalizedBrand) continue

    if (haystack.includes(` ${normalizedBrand} `)) return true

    const concatenatedBrand = normalizedBrand.replace(/\s+/g, '')
    if (concatenatedBrand && concatenatedBrand !== normalizedBrand) {
      if (haystack.includes(` ${concatenatedBrand} `)) return true
    }

    if (concatenatedBrand) {
      for (let start = 0; start < keywordTokens.length; start++) {
        let combined = ''
        for (let end = start; end < keywordTokens.length; end++) {
          combined += keywordTokens[end]
          if (combined.length > concatenatedBrand.length) break
          if (combined === concatenatedBrand) return true
        }
      }
    }
  }

  for (const brand of pureBrandKeywords) {
    const normalizedBrand = normalizeGoogleAdsKeyword(brand || '')
    if (!normalizedBrand) continue

    const brandNoSpace = normalizedBrand.replace(/\s+/g, '')
    if (!brandNoSpace) continue

    for (const token of keywordTokens) {
      if (!token.startsWith(brandNoSpace) || token.length <= brandNoSpace.length) continue

      const suffix = token.slice(brandNoSpace.length)
      if (!suffix) continue

      if (/\d/.test(suffix)) return true

      if (PRODUCT_WORD_PATTERNS.includes(suffix)) return true

      if (PRODUCT_WORD_PATTERNS.some(word => suffix.startsWith(word) && /\d/.test(suffix.slice(word.length)))) {
        return true
      }
    }
  }

  return false
}

export function isPureBrandKeyword(keyword: string, pureBrandKeywords: string[]): boolean {
  if (!keyword || !pureBrandKeywords || pureBrandKeywords.length === 0) {
    return false
  }

  const kwNorm = normalizeGoogleAdsKeyword(keyword)
  if (!kwNorm) return false

  const kwCompact = kwNorm.replace(/\s+/g, '')

  return pureBrandKeywords.some(brand => {
    const brandNorm = normalizeGoogleAdsKeyword(brand || '')
    if (!brandNorm) return false
    if (kwNorm === brandNorm) return true
    return kwCompact === brandNorm.replace(/\s+/g, '')
  })
}
