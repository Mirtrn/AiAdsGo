import {
  persistAffiliateCommissionAttributions,
  type AffiliateCommissionRawEntry,
  type AffiliatePlatform,
} from '@/lib/openclaw/affiliate-commission-attribution'
import { getOpenclawSettingsMap, parseNumber } from '@/lib/openclaw/settings'

type PlatformQueryError = {
  platform: AffiliatePlatform | 'attribution'
  message: string
}

type PlatformBreakdown = {
  platform: AffiliatePlatform
  totalCommission: number
  records: number
  currency: string
}

type AttributionSummary = {
  attributedCommission: number
  unattributedCommission: number
  attributedOffers: number
  attributedCampaigns: number
  writtenRows: number
}

export type AffiliateCommissionRevenue = {
  reportDate: string
  configuredPlatforms: AffiliatePlatform[]
  queriedPlatforms: AffiliatePlatform[]
  totalCommission: number
  breakdown: PlatformBreakdown[]
  errors: PlatformQueryError[]
  attribution: AttributionSummary
}

const DEFAULT_PARTNERBOOST_BASE_URL = 'https://app.partnerboost.com'
const PARTNERBOOST_PAGE_SIZE = 100
const PARTNERBOOST_MAX_PAGES = 20
const YEAHPROMOS_DEFAULT_LIMIT = 1000
const YEAHPROMOS_MAX_PAGES = 5

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function parseNumberish(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').replace(/[^\d.-]/g, '').trim()
    if (!normalized) return fallback
    const parsed = Number(normalized)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function isEmptyValue(value: unknown): boolean {
  return value === null
    || value === undefined
    || (typeof value === 'string' && value.trim() === '')
}

function normalizeLookupKey(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function getFieldValue(row: any, aliases: string[]): unknown {
  if (!row || typeof row !== 'object') return undefined

  for (const alias of aliases) {
    const value = row?.[alias as keyof typeof row]
    if (!isEmptyValue(value)) return value
  }

  const normalizedValueMap = new Map<string, unknown>()
  for (const [key, value] of Object.entries(row)) {
    if (isEmptyValue(value)) continue
    const normalizedKey = normalizeLookupKey(key)
    if (!normalizedKey || normalizedValueMap.has(normalizedKey)) continue
    normalizedValueMap.set(normalizedKey, value)
  }

  for (const alias of aliases) {
    const value = normalizedValueMap.get(normalizeLookupKey(alias))
    if (!isEmptyValue(value)) return value
  }

  return undefined
}

function normalizeYmdDate(value: string): string {
  const trimmed = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.TZ || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed)
}

function toPartnerboostDate(ymd: string): string {
  return ymd.replace(/-/g, '')
}

function normalizePartnerboostReportRows(payload: any): any[] {
  const data = payload?.data
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.list)) return data.list
  if (Array.isArray(payload?.list)) return payload.list
  return []
}

function normalizeYeahPromosCode(payload: any): number | null {
  const codeRaw = payload?.Code ?? payload?.code
  if (codeRaw === null || codeRaw === undefined || codeRaw === '') return null
  const code = Number(codeRaw)
  return Number.isFinite(code) ? code : null
}

function normalizeYeahPromosPayloadRows(payload: any): { rows: any[]; pageTotal: number | null } {
  const container = payload?.Data ?? payload?.data ?? payload

  let rows: any[] = []
  if (Array.isArray(container)) {
    rows = container
  } else if (Array.isArray(container?.list)) {
    rows = container.list
  } else if (Array.isArray(container?.rows)) {
    rows = container.rows
  } else if (Array.isArray(payload?.List)) {
    rows = payload.List
  }

  const pageTotalRaw =
    container?.PageTotal
    ?? container?.page_total
    ?? container?.pageTotal
    ?? payload?.PageTotal
    ?? payload?.page_total
    ?? payload?.pageTotal

  const pageTotal = Number(pageTotalRaw)
  return {
    rows,
    pageTotal: Number.isFinite(pageTotal) && pageTotal > 0 ? Math.floor(pageTotal) : null,
  }
}

function normalizeAsin(value: unknown): string | null {
  const text = String(value || '').trim().toUpperCase()
  if (!text) return null
  const cleaned = text.replace(/[^A-Z0-9]/g, '')
  if (!cleaned) return null
  return cleaned.length > 10 ? cleaned.slice(0, 10) : cleaned
}

function extractAsinFromUrlLike(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const candidates = [raw]
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded && decoded !== raw) candidates.push(decoded)
    } catch {
      // ignore malformed percent-encoding
    }
  }

  const patterns = [
    /\/dp\/([A-Za-z0-9]{10})(?=[/?#&]|$)/i,
    /\/gp\/product\/([A-Za-z0-9]{10})(?=[/?#&]|$)/i,
    /[?&#]asin=([A-Za-z0-9]{10})(?=[&#]|$)/i,
  ]

  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const matched = candidate.match(pattern)
      if (!matched?.[1]) continue
      const asin = normalizeAsin(matched[1])
      if (asin) return asin
    }
  }

  return null
}

function pickAsin(...values: unknown[]): string | null {
  for (const value of values) {
    const asinFromUrl = extractAsinFromUrlLike(value)
    if (asinFromUrl) return asinFromUrl
    const asin = normalizeAsin(value)
    if (asin && asin.length === 10) return asin
  }
  return null
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

function isLikelyAsin(value: unknown): boolean {
  const text = String(value || '').trim()
  if (!/^[A-Za-z0-9]{10}$/.test(text)) {
    return false
  }
  const normalized = normalizeAsin(text)
  return Boolean(normalized && normalized.length === 10)
}

function pickMid(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (!text) continue
    if (isLikelyAsin(text)) continue
    return text
  }
  return null
}

type CommissionCollection = {
  totalCommission: number
  records: number
  entries: AffiliateCommissionRawEntry[]
}

async function fetchPartnerboostCommission(params: {
  token: string
  baseUrl: string
  reportDate: string
}): Promise<CommissionCollection> {
  const startDate = toPartnerboostDate(params.reportDate)
  const endDate = toPartnerboostDate(params.reportDate)

  let page = 1
  let totalCommission = 0
  let records = 0
  const entries: AffiliateCommissionRawEntry[] = []

  while (page <= PARTNERBOOST_MAX_PAGES) {
    const response = await fetch(`${params.baseUrl}/api/datafeed/get_amazon_report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: params.token,
        page_size: PARTNERBOOST_PAGE_SIZE,
        page,
        start_date: startDate,
        end_date: endDate,
        marketplace: '',
        asins: '',
        adGroupIds: '',
        order_ids: '',
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`PartnerBoost report API ${response.status}: ${text}`)
    }

    const payload = await response.json() as any
    const statusCode = Number(payload?.status?.code)
    if (!Number.isFinite(statusCode) || statusCode !== 0) {
      throw new Error(`PartnerBoost report error: ${payload?.status?.msg || statusCode}`)
    }

    const rows = normalizePartnerboostReportRows(payload)
    for (const row of rows) {
      const commission = parseNumberish(
        getFieldValue(row, [
          'estCommission',
          'est_commission',
          'EstCommission',
          'Est. Commission',
          'Est Commission',
          'est commission',
        ]),
        0
      )
      totalCommission += commission

      if (commission > 0) {
        const sourceLink = pickString(
          getFieldValue(row, [
            'link',
            'url',
            'product_link',
            'productLink',
            'landing_page',
            'landingPage',
            'final_url',
            'finalUrl',
            'Referrer URL',
            'referrer_url',
          ])
        )

        entries.push({
          platform: 'partnerboost',
          reportDate: params.reportDate,
          commission,
          currency: 'USD',
          sourceOrderId: pickString(
            getFieldValue(row, [
              'order_id',
              'orderId',
              'orderID',
              'oid',
              'Order ID',
              'order id',
            ])
          ),
          sourceMid: pickMid(
            getFieldValue(row, [
              'partnerboost_id',
              'PartnerBoost ID',
              'partnerboost id',
              'partnerboostid',
              'mcid',
              'MCID',
              'mid',
              'MID',
              'advert_id',
              'advertId',
              'adGroupId',
              'ad_group_id',
              'Ad Group Id',
              'product_mid',
              'productMid',
              'product_id',
              'productId',
            ])
          ),
          sourceAsin: normalizeAsin(
            pickAsin(
              getFieldValue(row, [
                'asin',
                'ASIN',
                'product_asin',
                'productAsin',
                'product_id',
                'productId',
                'Product ID',
                'product id',
                'sku',
                'SKU',
              ]),
              sourceLink
            )
          ),
          sourceLink,
          raw: row,
        })
      }
    }

    records += rows.length

    const hasMore = payload?.data?.has_more === true || payload?.data?.hasMore === true
    if (rows.length < PARTNERBOOST_PAGE_SIZE && !hasMore) {
      break
    }

    page += 1
  }

  return {
    totalCommission: roundTo2(totalCommission),
    records,
    entries,
  }
}

async function fetchYeahPromosCommission(params: {
  token: string
  siteId: string
  reportDate: string
  isAmazonOnly: boolean
  pageStart: number
  limit: number
}): Promise<CommissionCollection> {
  let page = params.pageStart
  let pageTotal: number | null = null
  let pagesFetched = 0
  let totalCommission = 0
  let records = 0
  const entries: AffiliateCommissionRawEntry[] = []

  while (pagesFetched < YEAHPROMOS_MAX_PAGES) {
    const url = new URL('https://yeahpromos.com/index/Getorder/getorder')
    url.searchParams.set('site_id', params.siteId)
    url.searchParams.set('startDate', params.reportDate)
    url.searchParams.set('endDate', params.reportDate)
    url.searchParams.set('page', String(page))
    url.searchParams.set('limit', String(params.limit))
    if (params.isAmazonOnly) {
      url.searchParams.set('is_amazon', '1')
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        token: params.token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`YeahPromos order API ${response.status}: ${text}`)
    }

    const payload = await response.json() as any
    const code = normalizeYeahPromosCode(payload)
    if (code !== null && code !== 100000) {
      throw new Error(`YeahPromos order error: ${code}`)
    }

    const normalized = normalizeYeahPromosPayloadRows(payload)
    const rows = normalized.rows

    for (const row of rows) {
      const commission = parseNumberish(row?.sale_comm, 0)
      totalCommission += commission

      if (commission > 0) {
        entries.push({
          platform: 'yeahpromos',
          reportDate: params.reportDate,
          commission,
          currency: 'USD',
          sourceOrderId: pickString(
            row?.oid,
            row?.order_id,
            row?.orderId,
            row?.id,
          ),
          sourceMid: pickString(
            row?.advert_id,
            row?.advertId,
            row?.mid,
          ),
          sourceAsin: normalizeAsin(
            pickAsin(
              row?.asin,
              row?.ASIN,
              row?.sku,
              row?.link,
              row?.url,
              row?.product_link,
              row?.productLink
            )
          ),
          sourceLink: pickString(
            row?.link,
            row?.url,
            row?.product_link,
            row?.productLink
          ),
          raw: row,
        })
      }
    }

    records += rows.length
    pagesFetched += 1
    pageTotal = normalized.pageTotal ?? pageTotal

    if (rows.length === 0) {
      break
    }

    if (pageTotal !== null && page >= pageTotal) {
      break
    }

    if (rows.length < params.limit) {
      break
    }

    page += 1
  }

  return {
    totalCommission: roundTo2(totalCommission),
    records,
    entries,
  }
}

export async function fetchAffiliateCommissionRevenue(params: {
  userId: number
  reportDate: string
}): Promise<AffiliateCommissionRevenue> {
  const settings = await getOpenclawSettingsMap(params.userId)
  const reportDate = normalizeYmdDate(params.reportDate)

  const configuredPlatforms: AffiliatePlatform[] = []
  const queriedPlatforms: AffiliatePlatform[] = []
  const breakdown: PlatformBreakdown[] = []
  const errors: PlatformQueryError[] = []
  const attributionEntries: AffiliateCommissionRawEntry[] = []

  const partnerboostToken = String(settings.partnerboost_token || '').trim()
  if (partnerboostToken) {
    configuredPlatforms.push('partnerboost')

    const baseUrl = String(settings.partnerboost_base_url || DEFAULT_PARTNERBOOST_BASE_URL)
      .trim()
      .replace(/\/+$/, '') || DEFAULT_PARTNERBOOST_BASE_URL

    try {
      const metrics = await fetchPartnerboostCommission({
        token: partnerboostToken,
        baseUrl,
        reportDate,
      })
      queriedPlatforms.push('partnerboost')
      breakdown.push({
        platform: 'partnerboost',
        totalCommission: metrics.totalCommission,
        records: metrics.records,
        currency: 'USD',
      })
      attributionEntries.push(...metrics.entries)
    } catch (error: any) {
      errors.push({
        platform: 'partnerboost',
        message: error?.message || 'PartnerBoost commission query failed',
      })
    }
  }

  const yeahPromosToken = String(settings.yeahpromos_token || '').trim()
  const yeahPromosSiteId = String(settings.yeahpromos_site_id || '').trim()
  if (yeahPromosToken && yeahPromosSiteId) {
    configuredPlatforms.push('yeahpromos')

    const pageStart = Math.max(1, parseNumber(settings.yeahpromos_page, 1) || 1)
    const limit = Math.max(1, parseNumber(settings.yeahpromos_limit, YEAHPROMOS_DEFAULT_LIMIT) || YEAHPROMOS_DEFAULT_LIMIT)
    const isAmazonOnly = String(settings.yeahpromos_is_amazon || '').trim() === '1'

    try {
      const metrics = await fetchYeahPromosCommission({
        token: yeahPromosToken,
        siteId: yeahPromosSiteId,
        reportDate,
        isAmazonOnly,
        pageStart,
        limit,
      })
      queriedPlatforms.push('yeahpromos')
      breakdown.push({
        platform: 'yeahpromos',
        totalCommission: metrics.totalCommission,
        records: metrics.records,
        currency: 'USD',
      })
      attributionEntries.push(...metrics.entries)
    } catch (error: any) {
      errors.push({
        platform: 'yeahpromos',
        message: error?.message || 'YeahPromos commission query failed',
      })
    }
  }

  const totalCommission = roundTo2(
    breakdown.reduce((sum, item) => sum + (Number(item.totalCommission) || 0), 0)
  )

  const shouldReplaceAttribution = queriedPlatforms.length > 0 || configuredPlatforms.length === 0
  let attribution: AttributionSummary = {
    attributedCommission: 0,
    unattributedCommission: totalCommission,
    attributedOffers: 0,
    attributedCampaigns: 0,
    writtenRows: 0,
  }

  try {
    const attributionResult = await persistAffiliateCommissionAttributions({
      userId: params.userId,
      reportDate,
      entries: attributionEntries,
      replaceExisting: shouldReplaceAttribution,
      lockHistorical: true,
    })

    attribution = {
      attributedCommission: roundTo2(attributionResult.attributedCommission),
      unattributedCommission: roundTo2(attributionResult.unattributedCommission),
      attributedOffers: attributionResult.attributedOffers,
      attributedCampaigns: attributionResult.attributedCampaigns,
      writtenRows: attributionResult.writtenRows,
    }
  } catch (error: any) {
    errors.push({
      platform: 'attribution',
      message: `[attribution] ${error?.message || 'Attribution persistence failed'}`,
    })
  }

  return {
    reportDate,
    configuredPlatforms,
    queriedPlatforms,
    totalCommission,
    breakdown,
    errors,
    attribution,
  }
}
