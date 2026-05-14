import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'

export const PRODUCT_WORD_PATTERNS = [
  'pro', 'max', 'ultra', 'plus', 'mini', 'lite', 'air', 's',
  'se', 'x', 'c', 'e', 'a', 'v', 't',
  'edition', 'version', 'gen', 'generation',
  'camera', 'cam', 'vacuum', 'robot', 'cleaner',
  'doorbell', 'security', 'tracker', 'sensor',
  'starter', 'bundle', 'kit', 'set', 'pack'
]

/**
 * 纯企业法律后缀集合：当品牌名尾部包含这些词时，
 * 额外生成去掉后缀的"核心品牌词"，以确保 containsPureBrand 能匹配扩展关键词。
 *
 * ⚠️ 仅包含法律注册后缀，不包含产品品类词（security/beauty/clothing 等），
 * 因为后者可能是品牌名的真实组成部分（如 "Eufy Security"、"Ring Alarm Security"）。
 *
 * 🔥 修复(2026-05-14): 解决含企业法律后缀品牌的关键词池 buckets 为空问题
 * 例如: "Wahl Clipper Corporation" / "Youth Beauty Corporation"
 */
const LEGAL_ENTITY_SUFFIXES = new Set([
  'inc', 'ltd', 'llc', 'corp', 'corporation', 'limited',
  'co', 'company', 'group', 'holdings', 'enterprises',
  'international', 'global',
])

/**
 * 去掉品牌名末尾的企业法律后缀，返回核心品牌词。
 * 策略：**最多剥掉1个尾部 token**，避免过度剥离品牌核心词。
 * 例如:
 *   "wahl clipper corporation" → "wahl clipper"（去掉 corporation）
 *   "youth beauty corporation" → "youth beauty"（去掉 corporation，保留 beauty）
 *   "apple inc"                → "apple"（去掉 inc）
 *   "eufy security"            → null（security 不是法律后缀，不剥离）
 *   "nike"                     → null（单词，不剥离）
 */
function stripTrailingLegalSuffix(normalized: string): string | null {
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1) return null  // 只有 1 个词，不剥离

  const lastToken = tokens[tokens.length - 1]
  if (!LEGAL_ENTITY_SUFFIXES.has(lastToken)) return null  // 末尾词不是法律后缀，不剥离

  // 最多剥掉最后 1 个 token
  return tokens.slice(0, tokens.length - 1).join(' ')
}

export function getPureBrandKeywords(brandName: string): string[] {
  const normalizedFull = normalizeGoogleAdsKeyword(brandName || '')
  if (!normalizedFull) return []

  const result: string[] = [normalizedFull]

  // 🔥 修复(2026-05-14): 额外加入去掉企业法律后缀后的核心品牌词
  // 例如: "wahl clipper corporation" → 额外加 "wahl clipper"
  //       "youth beauty corporation" → 额外加 "youth beauty"
  //       "apple inc"                → 额外加 "apple"
  // 注意: 不含 "democracy clothing"（clothing 不是法律后缀），由 keyword-pool-helpers
  //       中的 containsAnyBrandToken 宽松匹配来处理此类品牌的关键词过滤。
  const stripped = stripTrailingLegalSuffix(normalizedFull)
  if (stripped) {
    result.push(stripped)
  }

  return result
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
