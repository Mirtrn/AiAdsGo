import { getOpenclawSettingsMap, parseNumber } from '@/lib/openclaw/settings'

type AffiliatePlatform = 'partnerboost' | 'yeahpromos'

type PlatformQueryError = {
  platform: AffiliatePlatform
  message: string
}

type PlatformBreakdown = {
  platform: AffiliatePlatform
  totalCommission: number
  records: number
  currency: string
}

export type AffiliateCommissionRevenue = {
  reportDate: string
  configuredPlatforms: AffiliatePlatform[]
  queriedPlatforms: AffiliatePlatform[]
  totalCommission: number
  breakdown: PlatformBreakdown[]
  errors: PlatformQueryError[]
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

async function fetchPartnerboostCommission(params: {
  token: string
  baseUrl: string
  reportDate: string
}): Promise<{ totalCommission: number; records: number }> {
  const startDate = toPartnerboostDate(params.reportDate)
  const endDate = toPartnerboostDate(params.reportDate)

  let page = 1
  let totalCommission = 0
  let records = 0

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
      totalCommission += parseNumberish(row?.estCommission, 0)
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
  }
}

async function fetchYeahPromosCommission(params: {
  token: string
  siteId: string
  reportDate: string
  isAmazonOnly: boolean
  pageStart: number
  limit: number
}): Promise<{ totalCommission: number; records: number }> {
  let page = params.pageStart
  let pageTotal: number | null = null
  let pagesFetched = 0
  let totalCommission = 0
  let records = 0

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
      totalCommission += parseNumberish(row?.sale_comm, 0)
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

  return {
    reportDate,
    configuredPlatforms,
    queriedPlatforms,
    totalCommission,
    breakdown,
    errors,
  }
}
