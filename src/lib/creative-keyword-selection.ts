import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from './brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'

export const CREATIVE_KEYWORD_MAX_COUNT = 50
export const CREATIVE_BRAND_KEYWORD_RESERVE = 10
export const CREATIVE_KEYWORD_MAX_WORDS = 5

type CreativeBucket = 'A' | 'B' | 'C' | 'D' | 'S'

export interface CreativeKeywordLike {
  keyword: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
  source?: string
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
  lowTopPageBid?: number
  highTopPageBid?: number
  volumeUnavailableReason?: 'SERVICE_ACCOUNT_UNSUPPORTED' | 'DEV_TOKEN_TEST_ONLY'
}

export interface SelectCreativeKeywordsInput {
  keywords?: string[]
  keywordsWithVolume?: CreativeKeywordLike[]
  brandName?: string
  bucket?: CreativeBucket | null
  maxKeywords?: number
  brandReserve?: number
  minBrandKeywords?: number
  brandOnly?: boolean
  maxWords?: number
}

export interface SelectCreativeKeywordsOutput {
  keywords: string[]
  keywordsWithVolume: CreativeKeywordLike[]
  truncated: boolean
}

interface RankedCandidate extends CreativeKeywordLike {
  normalized: string
  originalIndex: number
  isBrand: boolean
  isPureBrand: boolean
  sourceRank: number
  matchTypeRank: number
  intentRank: number
  wordCount: number
}

const D_INTENT_PATTERN = /\b(buy|price|deal|sale|discount|coupon|offer|cost|cheap|best|review|reviews?)\b/i
const A_TRUST_PATTERN = /\b(official|authentic|original|genuine|warranty|trusted|brand)\b/i
const B_SCENARIO_PATTERN = /\b(for|outdoor|indoor|home|office|garden|yard|driveway|wall|path|walkway|pool|tree)\b/i

function normalizeSourceRank(source: string | undefined): number {
  const normalized = String(source || '').toUpperCase()
  if (normalized === 'KEYWORD_POOL') return 4
  if (normalized === 'AI_ENHANCED') return 3
  if (normalized === 'KEYWORD_EXPANSION') return 2
  if (normalized === 'AI_GENERATED') return 2
  if (normalized === 'MERGED') return 1
  return 0
}

function normalizeMatchTypeRank(matchType: string | undefined): number {
  const normalized = String(matchType || '').toUpperCase()
  if (normalized === 'EXACT') return 3
  if (normalized === 'PHRASE') return 2
  if (normalized === 'BROAD') return 1
  return 0
}

function computeIntentRank(keyword: string, bucket: CreativeBucket | null | undefined, isBrand: boolean): number {
  if (!bucket) return 0
  const text = String(keyword || '')

  if (bucket === 'A') {
    let score = 0
    if (isBrand) score += 2
    if (A_TRUST_PATTERN.test(text)) score += 1
    return score
  }

  if (bucket === 'B' || bucket === 'C') {
    let score = 0
    if (!isBrand) score += 1
    if (B_SCENARIO_PATTERN.test(text)) score += 1
    return score
  }

  if (bucket === 'D' || bucket === 'S') {
    let score = 0
    if (D_INTENT_PATTERN.test(text)) score += 2
    if (!isBrand) score += 1
    return score
  }

  return 0
}

function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate): number {
  if (a.intentRank !== b.intentRank) return b.intentRank - a.intentRank
  if (a.isPureBrand !== b.isPureBrand) return Number(b.isPureBrand) - Number(a.isPureBrand)
  if (a.isBrand !== b.isBrand) return Number(b.isBrand) - Number(a.isBrand)
  if (a.sourceRank !== b.sourceRank) return b.sourceRank - a.sourceRank
  if (a.searchVolume !== b.searchVolume) return b.searchVolume - a.searchVolume
  if (a.matchTypeRank !== b.matchTypeRank) return b.matchTypeRank - a.matchTypeRank
  if (a.wordCount !== b.wordCount) return a.wordCount - b.wordCount
  if (a.keyword.length !== b.keyword.length) return a.keyword.length - b.keyword.length
  return a.originalIndex - b.originalIndex
}

function composeBrandedKeyword(keyword: string, normalizedBrand: string, maxWords: number): string | null {
  const brandTokens = normalizedBrand.split(/\s+/).filter(Boolean)
  if (brandTokens.length === 0) return null

  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)
  if (!normalizedKeyword) return null
  const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean)
  if (keywordTokens.length === 0) return null

  const remainder: string[] = []
  for (let i = 0; i < keywordTokens.length;) {
    let matchesBrand = true
    for (let j = 0; j < brandTokens.length; j += 1) {
      if (keywordTokens[i + j] !== brandTokens[j]) {
        matchesBrand = false
        break
      }
    }

    if (matchesBrand) {
      i += brandTokens.length
      continue
    }

    remainder.push(keywordTokens[i])
    i += 1
  }

  const combinedTokens = [...brandTokens, ...remainder]
  if (combinedTokens.length < 2 || combinedTokens.length > maxWords) return null
  return combinedTokens.join(' ')
}

function ensureBrandCoverage(
  candidates: RankedCandidate[],
  input: SelectCreativeKeywordsInput,
  maxWords: number,
  targetBrandCount: number
): RankedCandidate[] {
  if (targetBrandCount <= 0) return candidates

  const normalizedBrand = normalizeGoogleAdsKeyword(input.brandName || '')
  if (!normalizedBrand || normalizedBrand === 'unknown') return candidates

  const pureBrandKeywords = getPureBrandKeywords(normalizedBrand)
  if (pureBrandKeywords.length === 0) return candidates

  const existing = new Set(candidates.map(candidate => candidate.normalized))
  const existingBrandCount = candidates.filter(candidate => candidate.isBrand).length
  if (existingBrandCount >= targetBrandCount) return candidates

  const nonBrandCandidates = candidates
    .filter(candidate => !candidate.isBrand)
    .sort(compareRankedCandidates)

  const augmented: RankedCandidate[] = [...candidates]
  let nextIndex = candidates.reduce((max, candidate) => Math.max(max, candidate.originalIndex), -1) + 1
  let brandCount = existingBrandCount

  for (const candidate of nonBrandCandidates) {
    if (brandCount >= targetBrandCount) break

    const brandedKeyword = composeBrandedKeyword(candidate.keyword, normalizedBrand, maxWords)
    if (!brandedKeyword) continue

    const normalized = normalizeGoogleAdsKeyword(brandedKeyword)
    if (!normalized || existing.has(normalized)) continue

    const wordCount = normalized.split(/\s+/).filter(Boolean).length || 1
    if (wordCount > maxWords) continue

    const isBrand = containsPureBrand(brandedKeyword, pureBrandKeywords)
    if (!isBrand) continue

    const augmentedCandidate: RankedCandidate = {
      ...candidate,
      keyword: brandedKeyword,
      normalized,
      originalIndex: nextIndex,
      isBrand: true,
      isPureBrand: isPureBrandKeyword(brandedKeyword, pureBrandKeywords),
      intentRank: computeIntentRank(brandedKeyword, input.bucket, true),
      wordCount,
    }
    nextIndex += 1
    brandCount += 1
    existing.add(normalized)
    augmented.push(augmentedCandidate)
  }

  return augmented
}

function toRankedCandidates(input: SelectCreativeKeywordsInput, maxWords: number): RankedCandidate[] {
  const normalizedBrand = normalizeGoogleAdsKeyword(input.brandName || '')
  const pureBrandKeywords =
    normalizedBrand && normalizedBrand !== 'unknown'
      ? getPureBrandKeywords(normalizedBrand)
      : []

  const merged: CreativeKeywordLike[] = []

  if (Array.isArray(input.keywordsWithVolume)) {
    for (const item of input.keywordsWithVolume) {
      if (!item || typeof item !== 'object') continue
      merged.push({
        keyword: String(item.keyword || '').trim(),
        searchVolume: Number(item.searchVolume || 0) || 0,
        competition: item.competition,
        competitionIndex: item.competitionIndex,
        source: item.source,
        matchType: item.matchType,
        lowTopPageBid: item.lowTopPageBid,
        highTopPageBid: item.highTopPageBid,
        volumeUnavailableReason: item.volumeUnavailableReason,
      })
    }
  }

  if (Array.isArray(input.keywords)) {
    for (const rawKeyword of input.keywords) {
      const keyword = String(rawKeyword || '').trim()
      if (!keyword) continue
      merged.push({
        keyword,
        searchVolume: 0,
        source: 'AI_GENERATED',
        matchType: 'PHRASE',
      })
    }
  }

  const deduped = new Map<string, RankedCandidate>()
  for (let i = 0; i < merged.length; i += 1) {
    const candidate = merged[i]
    const keyword = String(candidate.keyword || '').trim()
    if (!keyword) continue

    const normalized = normalizeGoogleAdsKeyword(keyword)
    if (!normalized) continue
    const wordCount = normalized.split(/\s+/).filter(Boolean).length || 1
    if (wordCount > maxWords) continue

    const isBrand = pureBrandKeywords.length > 0
      ? containsPureBrand(keyword, pureBrandKeywords)
      : false
    const isPureBrand = pureBrandKeywords.length > 0
      ? isPureBrandKeyword(keyword, pureBrandKeywords)
      : false

    const ranked: RankedCandidate = {
      ...candidate,
      keyword,
      normalized,
      originalIndex: i,
      isBrand,
      isPureBrand,
      sourceRank: normalizeSourceRank(candidate.source),
      matchTypeRank: normalizeMatchTypeRank(candidate.matchType),
      intentRank: computeIntentRank(keyword, input.bucket, isBrand),
      wordCount,
      searchVolume: Number(candidate.searchVolume || 0) || 0,
    }

    const existing = deduped.get(normalized)
    if (!existing || compareRankedCandidates(ranked, existing) < 0) {
      deduped.set(normalized, ranked)
    }
  }

  return Array.from(deduped.values())
}

export function selectCreativeKeywords(input: SelectCreativeKeywordsInput): SelectCreativeKeywordsOutput {
  const maxKeywordsInput = Number(input.maxKeywords)
  const maxKeywords = Number.isFinite(maxKeywordsInput)
    ? Math.max(1, Math.floor(maxKeywordsInput))
    : CREATIVE_KEYWORD_MAX_COUNT

  const brandReserveInput = Number(input.brandReserve)
  const brandReserve = Number.isFinite(brandReserveInput)
    ? Math.max(0, Math.floor(brandReserveInput))
    : CREATIVE_BRAND_KEYWORD_RESERVE
  const minBrandKeywordsInput = Number(input.minBrandKeywords)
  const minBrandKeywords = Number.isFinite(minBrandKeywordsInput)
    ? Math.max(0, Math.floor(minBrandKeywordsInput))
    : CREATIVE_BRAND_KEYWORD_RESERVE
  const requestedBrandOnly = Boolean(input.brandOnly)

  const maxWordsInput = Number(input.maxWords)
  const maxWords = Number.isFinite(maxWordsInput)
    ? Math.max(1, Math.floor(maxWordsInput))
    : CREATIVE_KEYWORD_MAX_WORDS

  const requiredBrandCount = requestedBrandOnly
    ? maxKeywords
    : Math.min(maxKeywords, minBrandKeywords)

  const rankedCandidates = ensureBrandCoverage(
    toRankedCandidates(input, maxWords),
    input,
    maxWords,
    requiredBrandCount
  )
  if (rankedCandidates.length === 0) {
    return {
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
    }
  }

  const selected = new Map<string, RankedCandidate>()

  const brandCandidates = rankedCandidates
    .filter(candidate => candidate.isBrand)
    .sort(compareRankedCandidates)
  const enforceBrandOnly = requestedBrandOnly && brandCandidates.length > 0

  if (enforceBrandOnly) {
    for (const candidate of brandCandidates) {
      if (selected.size >= maxKeywords) break
      selected.set(candidate.normalized, candidate)
    }
  } else {
    for (const candidate of brandCandidates) {
      if (selected.size >= requiredBrandCount) break
      selected.set(candidate.normalized, candidate)
    }

    const reservedBrandCount = Math.min(maxKeywords, Math.max(requiredBrandCount, brandReserve))
    for (const candidate of brandCandidates) {
      if (selected.size >= reservedBrandCount) break
      if (!selected.has(candidate.normalized)) {
        selected.set(candidate.normalized, candidate)
      }
    }
  }

  if (!enforceBrandOnly) {
    const allCandidates = [...rankedCandidates].sort(compareRankedCandidates)
    for (const candidate of allCandidates) {
      if (selected.size >= maxKeywords) break
      if (!selected.has(candidate.normalized)) {
        selected.set(candidate.normalized, candidate)
      }
    }
  }

  const selectedList = Array.from(selected.values()).sort(compareRankedCandidates)
  const keywordsWithVolume: CreativeKeywordLike[] = selectedList.map(candidate => ({
    keyword: candidate.keyword,
    searchVolume: Number(candidate.searchVolume || 0) || 0,
    competition: candidate.competition,
    competitionIndex: candidate.competitionIndex,
    source: candidate.source,
    matchType: candidate.matchType,
    lowTopPageBid: candidate.lowTopPageBid,
    highTopPageBid: candidate.highTopPageBid,
    volumeUnavailableReason: candidate.volumeUnavailableReason,
  }))

  return {
    keywords: keywordsWithVolume.map(item => item.keyword),
    keywordsWithVolume,
    truncated: rankedCandidates.length > keywordsWithVolume.length,
  }
}
