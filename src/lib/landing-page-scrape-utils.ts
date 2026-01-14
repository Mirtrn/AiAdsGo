import { normalizeBrandName } from './offer-utils'
import { deriveBrandFromProductTitle, isLikelyInvalidBrandName } from './brand-name-utils'

function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[\u00A0\u200B]/g, ' ').trim()
}

function stripWrappingPunctuation(value: string): string {
  return value.replace(/^[\s"'“”‘’\(\)\[\]\{\}\-–—:;,.!?]+/, '').replace(/[\s"'“”‘’\(\)\[\]\{\}\-–—:;,.!?]+$/, '').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const COMMON_SUBDOMAINS = new Set([
  'www',
  'm',
  'amp',
  // tracking / presell style subdomains
  'offer',
  'offers',
  'deal',
  'deals',
  'click',
  'go',
  'link',
  'track',
  'trk',
  'aff',
  'affiliate',
  'secure',
  'checkout',
  'shop',
  'store',
])

const BLOCKED_DOMAIN_LABELS = new Set([
  'myshopify',
  'shopify',
  'wixsite',
  'wordpress',
  'blogspot',
  'github',
  'pages',
])

const IGNORED_PATH_SEGMENTS = new Set([
  '',
  'en',
  'us',
  'uk',
  'ca',
  'au',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'jp',
  'kr',
  'cn',
  'v1',
  'v2',
  'v3',
  'v4',
  'pre',
  'presell',
  'inter',
  'int',
  'checkout',
  'products',
  'product',
  'p',
  'dp',
  'item',
  'collections',
  'collection',
  'shop',
  'store',
  'category',
  'catalog',
  'catalogue',
  'index',
  'index.html',
])

function isIgnoredPathSegment(segment: string): boolean {
  const lower = segment.toLowerCase()
  if (IGNORED_PATH_SEGMENTS.has(lower)) return true
  if (/^v\d+$/i.test(segment)) return true
  if (/^pre\d*$/i.test(segment)) return true
  if (/^int\d*$/i.test(segment)) return true
  return false
}

export function getRegistrableDomainLabelFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.trim().toLowerCase().replace(/\.+$/, '')
    if (!hostname) return null

    const parts = hostname.split('.').filter(Boolean)
    if (parts.length < 2) return null

    let stripped = parts
    while (stripped.length > 2 && COMMON_SUBDOMAINS.has(stripped[0])) stripped = stripped.slice(1)
    if (stripped.length < 2) return null

    const tld = stripped[stripped.length - 1]
    const sld = stripped[stripped.length - 2]
    const sldIsCommonSecondLevel = new Set(['co', 'com', 'net', 'org', 'gov', 'edu'])

    let label = (tld.length === 2 && sldIsCommonSecondLevel.has(sld) && stripped.length >= 3)
      ? stripped[stripped.length - 3]
      : sld

    if (COMMON_SUBDOMAINS.has(label) && stripped.length >= 3) {
      label = stripped[stripped.length - 3]
    }

    const candidate = label.replace(/[^a-z0-9-]/g, '').trim()
    if (!candidate) return null
    if (BLOCKED_DOMAIN_LABELS.has(candidate)) return null

    return candidate
  } catch {
    return null
  }
}

export function getFirstMeaningfulPathSegment(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').map(s => s.trim()).filter(Boolean)
    for (const segment of segments) {
      if (isIgnoredPathSegment(segment)) continue
      if (/^\d+$/.test(segment)) continue
      return segment
    }
    return null
  } catch {
    return null
  }
}

function getLikelyProductSlugSegment(url: string, domainLabel: string | null): string | null {
  try {
    const segments = new URL(url).pathname.split('/').map(s => s.trim()).filter(Boolean)
    const meaningful = segments.filter(segment => {
      if (isIgnoredPathSegment(segment)) return false
      if (/^\d+$/.test(segment)) return false
      return true
    })
    if (meaningful.length === 0) return null

    const domainNorm = domainLabel ? normalizeForCompare(domainLabel) : ''
    const scored = meaningful.map(segment => {
      let score = segment.length
      const norm = normalizeForCompare(segment)
      if (domainNorm && norm === domainNorm) score -= 40
      if (/[a-z]/i.test(segment) && /\d/.test(segment)) score += 6
      return { segment, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored[0]?.segment || null
  } catch {
    return null
  }
}

function slugToTitle(slug: string): string {
  const cleaned = slug
    .replace(/\.html?$/i, '')
    .replace(/[^a-z0-9-_]+/gi, ' ')
    .trim()
  if (!cleaned) return ''

  const words = cleaned.split(/[-_\s]+/).filter(Boolean)
  return words
    .map(w => w.length <= 2 ? w.toUpperCase() : (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
    .trim()
}

function countOccurrences(haystackLower: string, needle: string): number {
  const needleLower = needle.toLowerCase()
  if (!needleLower) return 0
  const matches = haystackLower.match(new RegExp(escapeRegExp(needleLower), 'g'))
  return matches?.length || 0
}

function isReasonableNameCandidate(candidate: string): boolean {
  const cleaned = stripWrappingPunctuation(cleanText(candidate))
  if (!cleaned) return false
  if (cleaned.length < 2 || cleaned.length > 80) return false
  if (!/[A-Za-z]/.test(cleaned)) return false
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length > 8) return false
  return true
}

function looksLikePublisherOrCategoryTitle(candidate: string, domainLabel: string | null, slug: string | null): boolean {
  const cleaned = cleanText(candidate)
  const lower = cleaned.toLowerCase()
  const genericHits = [
    'home',
    'garden',
    'lifestyle',
    'essentials',
    'official site',
    'official',
    'store',
    'shop',
  ].filter(w => lower.includes(w)).length

  if (genericHits >= 2) {
    const normalized = normalizeForCompare(cleaned)
    const domainNorm = domainLabel ? normalizeForCompare(domainLabel) : ''
    const slugNorm = slug ? normalizeForCompare(slug) : ''
    if ((domainNorm && normalized.includes(domainNorm)) || (slugNorm && normalized.includes(slugNorm))) return false
    return true
  }

  return false
}

function extractJsonLdProductName($: any): string | null {
  try {
    const scripts = $('script[type="application/ld+json"]')
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts.eq(i).html()
      if (!text) continue
      try {
        const parsed = JSON.parse(text)
        const candidates = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of candidates) {
          if (!item) continue
          if (item['@type'] === 'Product' && typeof item.name === 'string' && item.name.trim()) return item.name.trim()
          if (Array.isArray(item['@graph'])) {
            for (const node of item['@graph']) {
              if (node?.['@type'] === 'Product' && typeof node.name === 'string' && node.name.trim()) return node.name.trim()
            }
          }
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return null
}

function extractCapitalizedPhrases(text: string): string[] {
  const cleaned = cleanText(text)
  if (!cleaned) return []
  const results: string[] = []

  // Word = TitleCase token or ALLCAPS token; phrase length <= 5 words.
  const re = /\b((?:[A-Z][A-Za-z0-9&'’.\-]{1,}|[A-Z]{2,})(?:\s+(?:[A-Z][A-Za-z0-9&'’.\-]{1,}|[A-Z]{2,})){0,4})\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(cleaned))) {
    if (match[1]) results.push(match[1])
  }
  return results
}

function shouldRejectProductPhrase(phrase: string): boolean {
  const cleaned = cleanText(phrase)
  if (!isReasonableNameCandidate(cleaned)) return true

  const lower = cleaned.toLowerCase()
  const firstWord = cleaned.split(/\s+/)[0]?.toLowerCase() || ''
  const rejectFirstWords = new Set(['discover', 'how', 'why', 'when', 'where', 'what', 'the', 'a', 'an', 'top'])
  if (rejectFirstWords.has(firstWord)) return true

  if (/\b(u\.s\.|us)\b/i.test(cleaned) && /\bdoctors?\b/i.test(cleaned)) return true
  if (/\bdoctors?\b/i.test(cleaned) && cleaned.split(/\s+/).length <= 3) return true

  // Avoid pure section headings that are obviously not product identifiers.
  if (/\b(privacy|terms|shipping|returns|policy)\b/i.test(lower)) return true

  return false
}

export function extractLandingProductName($: any, url: string): string | null {
  const domainLabel = getRegistrableDomainLabelFromUrl(url)
  const slug = getLikelyProductSlugSegment(url, domainLabel) || getFirstMeaningfulPathSegment(url)
  const slugTitle = slug ? slugToTitle(slug) : null

  const bodyText = cleanText($('body').text() || '')
  const bodyLower = bodyText.toLowerCase()

  const candidates = new Map<string, number>()
  const addCandidate = (raw: string | null | undefined, baseScore: number) => {
    if (!raw) return
    const cleaned = stripWrappingPunctuation(cleanText(raw))
    if (!isReasonableNameCandidate(cleaned)) return
    if (shouldRejectProductPhrase(cleaned)) return

    const normalized = normalizeForCompare(cleaned)
    const slugNorm = slug ? normalizeForCompare(slug) : ''
    const domainNorm = domainLabel ? normalizeForCompare(domainLabel) : ''

    let score = baseScore
    if (slugNorm && normalized.includes(slugNorm)) score += 35
    if (domainNorm && normalized.includes(domainNorm)) score += 20

    const freq = countOccurrences(bodyLower, cleaned)
    score += Math.min(freq, 10) * 6

    if (looksLikePublisherOrCategoryTitle(cleaned, domainLabel, slug)) score -= 30

    const prev = candidates.get(cleaned) || 0
    if (score > prev) candidates.set(cleaned, score)
  }

  // 1) Structured data (best)
  addCandidate(extractJsonLdProductName($), 120)

  // 2) CTA/button/link text (presell pages often embed the product name here)
  $('a, button').each((_: any, el: any) => {
    const text = cleanText($(el).text() || '')
    if (!text || text.length > 160) return
    for (const phrase of extractCapitalizedPhrases(text)) addCandidate(phrase, 90)

    const offMatch = text.match(/\bOFF\s+([A-Z][A-Za-z0-9&'’.\-]+(?:\s+(?:[A-Z][A-Za-z0-9&'’.\-]+|[A-Z]{2,})){0,3})\b/)
    if (offMatch?.[1]) addCandidate(offMatch[1], 95)
  })

  // 3) Headings / emphasis blocks
  $('h1, h2, h3, strong, b').each((_: any, el: any) => {
    const text = cleanText($(el).text() || '')
    if (!text || text.length > 200) return
    for (const phrase of extractCapitalizedPhrases(text)) addCandidate(phrase, 70)
  })

  // 4) Page meta/title fallbacks (often site name, so lower weight)
  addCandidate($('meta[property="og:title"]').attr('content'), 50)
  addCandidate($('meta[name="title"]').attr('content'), 45)
  const titleText = cleanText($('title').text() || '')
  if (titleText) {
    const parts = titleText
      .split(/[|–—-]/)
      .map(p => stripWrappingPunctuation(cleanText(p)))
      .filter(Boolean)
    if (parts.length >= 2 && domainLabel && normalizeForCompare(parts[0]) === normalizeForCompare(domainLabel)) {
      addCandidate(parts[1], 58)
    }
    addCandidate(titleText, 40)
  }
  addCandidate($('h1').first().text(), 35)

  // 5) URL path slug fallback (lowest confidence)
  if (slugTitle) addCandidate(slugTitle, 25)

  let best: { value: string; score: number } | null = null
  for (const [value, score] of candidates.entries()) {
    if (!best || score > best.score) best = { value, score }
  }

  return best?.value || null
}

function deriveBrandFromProductAndDomain(productName: string | null, domainLabel: string | null): string | null {
  const domainNorm = domainLabel ? normalizeForCompare(domainLabel) : ''
  if (productName) {
    const tokens = cleanText(productName).split(/\s+/).filter(Boolean)
    if (tokens.length >= 2 && domainNorm) {
      const firstTwoNorm = normalizeForCompare(tokens[0] + tokens[1])
      if (firstTwoNorm === domainNorm) return `${tokens[0]} ${tokens[1]}`
    }
    if (tokens.length >= 1 && domainNorm) {
      const firstNorm = normalizeForCompare(tokens[0])
      if (firstNorm === domainNorm) return tokens[0]
    }
  }
  return null
}

export function refineBrandNameForLandingPage(options: {
  url: string
  $: any
  productName: string | null
  currentBrandName: string | null
}): string | null {
  const { url, $, productName, currentBrandName } = options

  const domainLabel = getRegistrableDomainLabelFromUrl(url)
  const slug = getFirstMeaningfulPathSegment(url)
  const slugTitle = slug ? slugToTitle(slug) : null

  const normalizedCurrent = currentBrandName ? cleanText(currentBrandName) : ''
  const normalizedProduct = productName ? cleanText(productName) : ''

  const brandFromProductAndDomain = deriveBrandFromProductAndDomain(productName, domainLabel)
  const brandFromProduct = productName ? deriveBrandFromProductTitle(productName) : null

  const fallbackCandidates = [
    brandFromProductAndDomain,
    brandFromProduct,
    domainLabel ? normalizeBrandName(domainLabel) : null,
    slugTitle,
  ].filter(Boolean) as string[]

  const chooseBestFallback = (): string | null => {
    for (const candidate of fallbackCandidates) {
      if (!candidate) continue
      if (isLikelyInvalidBrandName(candidate)) continue
      return normalizeBrandName(candidate)
    }
    return null
  }

  const currentOk = !!(normalizedCurrent && !isLikelyInvalidBrandName(normalizedCurrent))
  if (!currentOk) return chooseBestFallback()

  // 🔥 presell/pre落地页：优先相信“商品名/CTA/域名”推导出的品牌，而不是<title>等发布方字段
  if (isPresellStyleUrl(url)) {
    const best = chooseBestFallback()
    if (best && normalizeForCompare(best) !== normalizeForCompare(normalizedCurrent)) return best
  }

  // If current brand is identical to product title, attempt to shorten using product+domain relation.
  if (normalizedProduct && normalizeForCompare(normalizedCurrent) === normalizeForCompare(normalizedProduct)) {
    const best = chooseBestFallback()
    if (best && normalizeForCompare(best) !== normalizeForCompare(normalizedCurrent)) return best
  }

  // If current brand looks like a publisher/site/category title and doesn't align with product or domain, prefer fallback.
  if (looksLikePublisherOrCategoryTitle(normalizedCurrent, domainLabel, slug)) {
    const best = chooseBestFallback()
    if (best && normalizeForCompare(best) !== normalizeForCompare(normalizedCurrent)) return best
  }

  return normalizeBrandName(normalizedCurrent)
}

export function extractLandingDescription(options: {
  $: any
  productName: string | null
  maxLength?: number
}): string | null {
  const { $, productName } = options
  const maxLength = typeof options.maxLength === 'number' ? options.maxLength : 420

  const metaDesc =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    null

  const cleanedMeta = metaDesc ? cleanText(metaDesc) : null

  const bodyCandidates: string[] = []
  const needle = productName ? productName.toLowerCase() : null

  $('p, div').each((_: any, el: any) => {
    const text = cleanText($(el).text() || '')
    if (!text) return
    if (text.length < 60) return
    if (text.length > 800) return
    if (needle && !text.toLowerCase().includes(needle)) return
    bodyCandidates.push(text)
    if (bodyCandidates.length >= 10) return false
  })

  const bestBody = bodyCandidates[0] || null
  const description = bestBody || cleanedMeta || null
  if (!description) return null

  return description.length > maxLength ? `${description.slice(0, maxLength - 1).trim()}…` : description
}

export function extractLandingImages($: any, baseUrl: string, maxImages: number = 5): string[] {
  const candidates: Array<{ url: string; score: number }> = []
  const seen = new Set<string>()

  const addImage = (rawUrl: string | null | undefined, baseScore: number, meta?: { width?: number; height?: number; alt?: string }) => {
    if (!rawUrl) return
    if (rawUrl.startsWith('data:')) return
    if (/facebook\.com\/tr/i.test(rawUrl)) return

    let absolute: string
    try {
      absolute = rawUrl.startsWith('http') ? rawUrl : new URL(rawUrl, baseUrl).href
    } catch {
      return
    }

    const normalized = absolute.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)

    const lower = normalized.toLowerCase()
    let score = baseScore

    if (/\.(webp|png|jpe?g|gif)(\?|#|$)/i.test(lower)) score += 10
    if (/(hero|header|product|main|banner|slider|content)/i.test(lower)) score += 8
    if (/(logo|favicon|sprite|icon|star|verified|badge)/i.test(lower)) score -= 12

    if (meta?.width && meta.width >= 400) score += 8
    if (meta?.height && meta.height >= 300) score += 6
    if (meta?.width && meta.width <= 60) score -= 10
    if (meta?.height && meta.height <= 60) score -= 10

    if (meta?.alt && meta.alt.trim().length > 3) score += 2

    candidates.push({ url: normalized, score })
  }

  addImage($('meta[property="og:image"]').attr('content'), 80)
  addImage($('meta[name="twitter:image"]').attr('content'), 75)

  $('img').each((_: any, el: any) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src')
    const widthAttr = $(el).attr('width')
    const heightAttr = $(el).attr('height')
    const width = widthAttr ? Number(widthAttr) : undefined
    const height = heightAttr ? Number(heightAttr) : undefined
    const alt = $(el).attr('alt') || ''

    addImage(src, 40, { width, height, alt })
  })

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, maxImages).map(c => c.url)
}

export function isPresellStyleUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (pathname.includes('/presell')) return true
    if (pathname.includes('/pre')) return true
    if (/\/pre\d*(\/|$)/i.test(pathname)) return true
    // 常见落地页：int/int1/int2...
    if (/\/int\d*(\/|$)/i.test(pathname)) return true
    // 常见漏斗：checkout页面通常包含价格/套餐信息
    if (/\/checkout(\.html)?(\/|$)/i.test(pathname)) return true
    return false
  } catch {
    return false
  }
}

export function extractLandingPrice($: any, url: string): string | null {
  if (!isPresellStyleUrl(url)) return null

  const text = cleanText($('body').text() || '')
  if (!text) return null

  // Prefer real prices with decimals; avoid copy like "Under $100".
  const re = /([$€£])\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2}))/g
  const matches: Array<{ raw: string; value: number }> = []

  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const symbol = match[1]
    const amountRaw = match[2]
    const value = Number(amountRaw.replace(/,/g, ''))
    if (!Number.isFinite(value) || value <= 0) continue
    matches.push({ raw: `${symbol}${amountRaw}`, value })
  }

  if (matches.length === 0) return null

  matches.sort((a, b) => a.value - b.value)
  return matches[0].raw
}
