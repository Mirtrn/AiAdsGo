import { createOffer, deleteOffer } from '@/lib/offers'
import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import { getInsertedId, toBool } from '@/lib/db-helpers'
import { getUserOnlySetting } from '@/lib/settings'
import { createOfferExtractionTaskForExistingOffer } from '@/lib/offer-extraction-task'

export type AffiliatePlatform = 'yeahpromos' | 'partnerboost'
export type SyncMode = 'platform' | 'single' | 'delta'
export type AffiliateProductSyncProgress = {
  totalFetched: number
  processedCount: number
  createdCount: number
  updatedCount: number
  failedCount: number
}
export type AffiliateLandingPageType =
  | 'amazon_product'
  | 'amazon_store'
  | 'independent_product'
  | 'independent_store'
  | 'unknown'

export type AffiliateProduct = {
  id: number
  user_id: number
  platform: AffiliatePlatform
  mid: string
  asin: string | null
  brand: string | null
  product_name: string | null
  product_url: string | null
  promo_link: string | null
  short_promo_link: string | null
  allowed_countries_json: string | null
  price_amount: number | null
  price_currency: string | null
  commission_rate: number | null
  commission_amount: number | null
  review_count: number | null
  raw_json: string | null
  is_blacklisted: boolean | number
  last_synced_at: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export type AffiliateProductListItem = {
  id: number
  serial: number
  platform: AffiliatePlatform
  mid: string
  asin: string | null
  landingPageType: AffiliateLandingPageType
  isDeepLink: boolean | null
  brand: string | null
  productName: string | null
  productUrl: string | null
  allowedCountries: string[]
  priceAmount: number | null
  priceCurrency: string | null
  commissionRate: number | null
  commissionRateMode: 'percent' | 'amount'
  commissionAmount: number | null
  commissionCurrency: string | null
  reviewCount: number | null
  promoLink: string | null
  shortPromoLink: string | null
  relatedOfferCount: number
  isBlacklisted: boolean
  lastSyncedAt: string | null
  updatedAt: string
}

type NormalizedAffiliateProduct = {
  platform: AffiliatePlatform
  mid: string
  asin: string | null
  brand: string | null
  productName: string | null
  productUrl: string | null
  promoLink: string | null
  shortPromoLink: string | null
  allowedCountries: string[]
  priceAmount: number | null
  priceCurrency: string | null
  commissionRate: number | null
  commissionAmount: number | null
  reviewCount: number | null
  rawJson: string
}

export type ProductSortField =
  | 'serial'
  | 'platform'
  | 'mid'
  | 'asin'
  | 'allowedCountries'
  | 'priceAmount'
  | 'commissionRate'
  | 'commissionAmount'
  | 'reviewCount'
  | 'promoLink'
  | 'relatedOfferCount'
  | 'updatedAt'

export type ProductSortOrder = 'asc' | 'desc'

export type ProductListOptions = {
  page?: number
  pageSize?: number
  search?: string
  platform?: AffiliatePlatform | 'all'
  sortBy?: ProductSortField
  sortOrder?: ProductSortOrder
  reviewCountMin?: number
  reviewCountMax?: number
  priceAmountMin?: number
  priceAmountMax?: number
  commissionRateMin?: number
  commissionRateMax?: number
  commissionAmountMin?: number
  commissionAmountMax?: number
}

export type ProductListResult = {
  items: AffiliateProductListItem[]
  total: number
  productsWithLinkCount: number
  page: number
  pageSize: number
}

export type AffiliateProductOfflineFailure = {
  offerId: number
  error: string
}

export type AffiliateProductOfflineResult = {
  productId: number
  totalLinkedOffers: number
  deletedOfferCount: number
  deletedOfferIds: number[]
  failedOffers: AffiliateProductOfflineFailure[]
  offlined: boolean
  product: AffiliateProduct | null
}

export type BatchOfflineAffiliateProductsResult = {
  total: number
  successCount: number
  failureCount: number
  results: Array<{
    productId: number
    success: boolean
    deletedOfferCount?: number
    totalLinkedOffers?: number
    offlined?: boolean
    failedOffers?: AffiliateProductOfflineFailure[]
    error?: string
  }>
}

export class ConfigRequiredError extends Error {
  code = 'CONFIG_REQUIRED' as const
  platform: AffiliatePlatform
  missingKeys: string[]

  constructor(platform: AffiliatePlatform, missingKeys: string[]) {
    super(`${platform} 配置不完整`)
    this.name = 'ConfigRequiredError'
    this.platform = platform
    this.missingKeys = missingKeys
  }
}

type PlatformConfigCheck = {
  configured: boolean
  missingKeys: string[]
  values: Record<string, string>
}

const PLATFORM_KEY_REQUIREMENTS: Record<AffiliatePlatform, string[]> = {
  yeahpromos: ['yeahpromos_token', 'yeahpromos_site_id'],
  partnerboost: ['partnerboost_token'],
}

const DEFAULT_PB_BASE_URL = 'https://app.partnerboost.com'
const DEFAULT_PB_COUNTRY_CODE = 'US'
const DEFAULT_PB_PRODUCTS_PAGE_SIZE = 100
const MAX_PB_SYNC_MAX_PAGES = 20000
const MAX_PB_EMPTY_PAGE_STREAK = 3
const DEFAULT_PB_PRODUCTS_LINK_BATCH_SIZE = 20
const MAX_PB_PRODUCTS_LINK_BATCH_SIZE = 50
const DEFAULT_PB_ASIN_LINK_BATCH_SIZE = 20
const MAX_PB_ASIN_LINK_BATCH_SIZE = 50
const PB_LINK_HEARTBEAT_EVERY_BATCHES = 20
const DEFAULT_PB_DELTA_ASIN_BATCH_SIZE = 100
const MAX_PB_DELTA_ASIN_BATCH_SIZE = 300
const DEFAULT_PB_ACTIVE_DAYS = 14
const MAX_PB_ACTIVE_DAYS = 60
const DEFAULT_PB_REQUEST_DELAY_MS = 150
const MAX_PB_REQUEST_DELAY_MS = 5000
const DEFAULT_PB_RATE_LIMIT_MAX_RETRIES = 4
const DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS = 800
const DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS = 12000
const DEFAULT_PB_STREAM_WINDOW_PAGES = 10
const MAX_PB_STREAM_WINDOW_PAGES = 200
const DEFAULT_UPSERT_BATCH_SIZE_POSTGRES = 800
const DEFAULT_UPSERT_BATCH_SIZE_SQLITE = 40
const DEFAULT_YP_REQUEST_DELAY_MS = 120
const MAX_YP_REQUEST_DELAY_MS = 5000
const DEFAULT_YP_RATE_LIMIT_MAX_RETRIES = 3
const DEFAULT_YP_RATE_LIMIT_BASE_DELAY_MS = 600
const DEFAULT_YP_RATE_LIMIT_MAX_DELAY_MS = 10000
const MAX_YP_SYNC_MAX_PAGES = 1000
const MAX_YP_EMPTY_PAGE_STREAK = 3

type PartnerboostProduct = {
  product_id?: string
  product_name?: string
  asin?: string
  brand_name?: string
  url?: string
  country_code?: string
  original_price?: string | number
  discount_price?: string | number
  currency?: string
  commission?: string | number
  acc_commission?: string | number
  reviews?: string | number
  review_count?: string | number
  reviewCount?: string | number
  rating_count?: string | number
  ratings_total?: string | number
}

type PartnerboostProductsResponse = {
  status?: { code?: number | string; msg?: string }
  data?: {
    list?: PartnerboostProduct[] | Record<string, PartnerboostProduct>
    has_more?: boolean | number | string
    hasMore?: boolean | number | string
  }
}

type PartnerboostLinkItem = {
  product_id?: string
  asin?: string
  link?: string
  partnerboost_link?: string
  link_id?: string
}

type PartnerboostLinkResponse = {
  status?: { code?: number | string; msg?: string }
  data?: PartnerboostLinkItem[]
  error_list?: Array<{ product_id?: string; message?: string }>
}

type PartnerboostAsinLinkResponse = {
  status?: { code?: number | string; msg?: string }
  data?: PartnerboostLinkItem[]
  error_list?: Array<{ asin?: string; country_code?: string; message?: string }>
}

type PartnerboostPromotableFetchParams = {
  userId: number
  asins?: string[]
  maxPages?: number
  startPage?: number
  suppressMaxPagesWarning?: boolean
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}

type PartnerboostPromotableFetchResult = {
  items: NormalizedAffiliateProduct[]
  hasMore: boolean
  nextPage: number
  fetchedPages: number
}

type YeahPromosMerchant = {
  mid?: string | number
  merchant_name?: string
  url?: string
  site_url?: string
  tracking_url?: string
  is_deeplink?: string | number | boolean
  country?: string
  avg_payout?: string | number
  payout_unit?: string
  advert_status?: string | number
  reviews?: string | number
  review_count?: string | number
  reviewCount?: string | number
  rating_count?: string | number
  ratings_total?: string | number
}

type YeahPromosResponseData = {
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosMerchant[] | Record<string, YeahPromosMerchant>
  data?: YeahPromosMerchant[] | Record<string, YeahPromosMerchant>
}

type YeahPromosResponse = {
  Code?: number | string
  code?: number | string
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosMerchant[] | Record<string, YeahPromosMerchant>
  data?: YeahPromosMerchant[] | YeahPromosResponseData
}

type YeahPromosTransaction = {
  id?: string | number
  advert_id?: string | number
  oid?: string | number
  creationDate_time?: string
  amount?: string | number
  sale_comm?: string | number
  status?: string | number
  sku?: string
  tag1?: string
  tag2?: string
  tag3?: string
}

type YeahPromosTransactionsResponseData = {
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosTransaction[] | Record<string, YeahPromosTransaction>
  data?: YeahPromosTransaction[] | Record<string, YeahPromosTransaction>
}

type YeahPromosTransactionsResponse = {
  Code?: number | string
  code?: number | string
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosTransaction[] | Record<string, YeahPromosTransaction>
  data?: YeahPromosTransaction[] | YeahPromosTransactionsResponseData
}

type YeahPromosTransactionMetric = {
  priceAmount: number | null
  commissionAmount: number | null
  commissionRate: number | null
  sampleCount: number
}

type ParsedYeahPromosCommission = {
  mode: 'rate' | 'amount'
  rate: number | null
  amount: number | null
}

export function normalizeYeahPromosResultCode(code: unknown): number | null {
  if (code === null || code === undefined || code === '') {
    return null
  }

  const parsed = Number(code)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

export function normalizePartnerboostStatusCode(code: unknown): number | null {
  if (code === null || code === undefined || code === '') {
    return null
  }

  const parsed = Number(code)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function normalizePartnerboostProductsList(value: unknown): PartnerboostProduct[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as PartnerboostProduct[]
  }

  return []
}

function normalizeBoolFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes'
  }
  return false
}

export function extractPartnerboostProductsPayload(payload: PartnerboostProductsResponse): {
  products: PartnerboostProduct[]
  hasMore: boolean
} {
  const products = normalizePartnerboostProductsList(payload.data?.list)
  const hasMore = normalizeBoolFlag(payload.data?.has_more ?? payload.data?.hasMore)

  return {
    products,
    hasMore,
  }
}

function parseInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function parseIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = parseInteger(value, fallback)
  return Math.max(min, Math.min(parsed, max))
}

function resolveSyncMaxPages(
  requestedMaxPages: number | undefined,
  fallbackMaxPages: number | null,
  maxAllowedPages: number
): number | null {
  const candidates: Array<number | null | undefined> = [requestedMaxPages, fallbackMaxPages]
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue
    const parsed = Math.trunc(Number(candidate))
    if (!Number.isFinite(parsed) || parsed <= 0) continue
    return Math.min(parsed, maxAllowedPages)
  }
  return null
}

function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function calculateExponentialBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  if (attempt <= 0) return 0
  const delay = baseDelayMs * Math.pow(2, attempt - 1)
  return Math.min(delay, maxDelayMs)
}

function isPartnerboostRateLimited(payloadStatusCode: number | null, payloadStatusMessage: string, responseStatus?: number): boolean {
  if (responseStatus === 429) return true
  if (payloadStatusCode === 1002) return true

  const normalizedMessage = payloadStatusMessage.toLowerCase()
  return normalizedMessage.includes('too many request')
    || normalizedMessage.includes('rate limit')
}

function isPartnerboostRateLimitError(error: unknown): boolean {
  const raw = error as {
    message?: string
    status?: {
      code?: number | string
      msg?: string
    }
  }
  const message = String(raw?.message || '')
  const statusMatch = message.match(/\((\d{3})\):/)
  const responseStatus = statusMatch ? Number(statusMatch[1]) : undefined
  const payloadStatusCode = normalizePartnerboostStatusCode(raw?.status?.code)
  const payloadStatusMessage = String(raw?.status?.msg || message)

  if (isPartnerboostRateLimited(payloadStatusCode, payloadStatusMessage, responseStatus)) {
    return true
  }

  const normalizedMessage = message.toLowerCase()
  return normalizedMessage.includes('"code":1002')
    || normalizedMessage.includes('code:1002')
}

function isYeahPromosRateLimited(code: number | null, message: string, responseStatus?: number): boolean {
  if (responseStatus === 429) return true

  if (code !== null) {
    if (code === 429 || code === 100429 || code === 200429) return true
  }

  const normalizedMessage = message.toLowerCase()
  return normalizedMessage.includes('too many request')
    || normalizedMessage.includes('rate limit')
    || normalizedMessage.includes('too many requests')
}

function parseReviewCount(value: unknown): number | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Math.max(0, Math.trunc(value))
  }

  const raw = String(value).trim()
  if (!raw) return null

  const compact = raw.toLowerCase().replace(/[，,\s]/g, '')
  const shortMatch = compact.match(/^(\d+(?:\.\d+)?)([kmb])$/i)
  if (shortMatch) {
    const base = Number(shortMatch[1])
    const unit = shortMatch[2].toLowerCase()
    const multiplier = unit === 'k' ? 1000 : unit === 'm' ? 1000000 : 1000000000
    if (Number.isFinite(base)) {
      return Math.max(0, Math.trunc(base * multiplier))
    }
  }

  const numeric = compact.replace(/[^0-9]/g, '')
  if (!numeric) return null

  const parsed = Number(numeric)
  if (!Number.isFinite(parsed)) return null

  return Math.max(0, Math.trunc(parsed))
}

function parseCsvValues(value: string): string[] {
  return value
    .split(/[\n,;\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeAsin(value: unknown): string | null {
  const normalized = String(value || '').trim().toUpperCase()
  return normalized || null
}

export function resolvePartnerboostPromoLinks(input: {
  productIdLink?: string | null
  asinLink?: string | null
  asinPartnerboostLink?: string | null
}): {
  promoLink: string | null
  shortPromoLink: string | null
} {
  const shortPromoLink = normalizeUrl(input.asinPartnerboostLink)
  const promoLink = shortPromoLink
    || normalizeUrl(input.asinLink)
    || normalizeUrl(input.productIdLink)
    || null

  return {
    promoLink,
    shortPromoLink,
  }
}

export function resolvePartnerboostCountryCode(value: unknown, fallback: unknown = DEFAULT_PB_COUNTRY_CODE): string {
  const primary = normalizeCountryCode(String(value || ''))
  if (primary) return primary

  const backup = normalizeCountryCode(String(fallback || ''))
  if (backup) return backup

  return DEFAULT_PB_COUNTRY_CODE
}

function normalizeYeahPromosMerchants(value: unknown): YeahPromosMerchant[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as YeahPromosMerchant[]
  }

  return []
}

function normalizeYeahPromosTransactions(value: unknown): YeahPromosTransaction[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as YeahPromosTransaction[]
  }

  return []
}

export function extractYeahPromosPayload(payload: YeahPromosResponse): {
  merchants: YeahPromosMerchant[]
  pageTotal: number | null
  pageNow: number | null
} {
  const nested = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as YeahPromosResponseData
    : null

  const merchants = normalizeYeahPromosMerchants(
    payload.Data
    ?? (Array.isArray(payload.data) ? payload.data : undefined)
    ?? nested?.Data
    ?? nested?.data
  )

  const pageTotal = toNumber(payload.PageTotal ?? payload.pageTotal ?? nested?.PageTotal ?? nested?.pageTotal)
  const pageNow = toNumber(payload.PageNow ?? payload.pageNow ?? nested?.PageNow ?? nested?.pageNow)

  return {
    merchants,
    pageTotal,
    pageNow,
  }
}

export function extractYeahPromosTransactionsPayload(payload: YeahPromosTransactionsResponse): {
  transactions: YeahPromosTransaction[]
  pageTotal: number | null
  pageNow: number | null
} {
  const nested = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as YeahPromosTransactionsResponseData
    : null

  const transactions = normalizeYeahPromosTransactions(
    payload.Data
    ?? (Array.isArray(payload.data) ? payload.data : undefined)
    ?? nested?.Data
    ?? nested?.data
  )

  const pageTotal = toNumber(payload.PageTotal ?? payload.pageTotal ?? nested?.PageTotal ?? nested?.pageTotal)
  const pageNow = toNumber(payload.PageNow ?? payload.pageNow ?? nested?.PageNow ?? nested?.pageNow)

  return {
    transactions,
    pageTotal,
    pageNow,
  }
}

function normalizeUrl(value?: string | null): string | null {
  if (!value) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parsePercentage(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (value >= 0 && value <= 1) return value * 100
    return value
  }

  const raw = String(value).trim()
  if (!raw) return null
  const normalized = raw.replace('%', '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  if (raw.includes('%')) return parsed
  if (parsed >= 0 && parsed <= 1) return parsed * 100
  return parsed
}

function parsePriceAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const raw = String(value).trim()
  if (!raw) return null
  const numeric = raw.replace(/[^0-9.-]+/g, '')
  if (!numeric) return null
  const parsed = Number(numeric)
  return Number.isFinite(parsed) ? parsed : null
}

function hasCurrencySymbol(value: string): boolean {
  return /[$€£¥₴₽₩₹]/.test(value)
}

function looksLikeCurrencyUnit(value: string): boolean {
  const raw = value.trim()
  if (!raw) return false
  if (raw.includes('%')) return false
  if (hasCurrencySymbol(raw)) return true

  const upper = raw.toUpperCase()
  if (/^[A-Z]{3}$/.test(upper)) return true
  return false
}

function normalizeCurrencyUnit(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  if (/^[A-Za-z]{3}$/.test(raw)) {
    return raw.toUpperCase()
  }

  if (hasCurrencySymbol(raw)) {
    return raw
  }

  return null
}

function extractCurrencyUnitFromText(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const symbolMatch = raw.match(/[$€£¥₴₽₩₹]/)
  if (symbolMatch) {
    return symbolMatch[0]
  }

  const codeMatch = raw.match(/\b([A-Za-z]{3})\b/)
  if (codeMatch) {
    return codeMatch[1].toUpperCase()
  }

  return null
}

function parsePartnerboostCommission(value: unknown, fallbackCurrency: string | null): {
  mode: 'percent' | 'amount'
  rate: number | null
  amount: number | null
  currency: string | null
} {
  const raw = String(value || '').trim()
  if (!raw) {
    return {
      mode: 'percent',
      rate: null,
      amount: null,
      currency: fallbackCurrency,
    }
  }

  if (raw.includes('%')) {
    return {
      mode: 'percent',
      rate: parsePercentage(value),
      amount: null,
      currency: fallbackCurrency,
    }
  }

  const extractedCurrency = extractCurrencyUnitFromText(raw)
  if (extractedCurrency) {
    return {
      mode: 'amount',
      rate: null,
      amount: parsePriceAmount(value),
      currency: extractedCurrency,
    }
  }

  return {
    mode: 'percent',
    rate: parsePercentage(value),
    amount: null,
    currency: fallbackCurrency,
  }
}

export function parseYeahPromosMerchantCommission(avgPayout: unknown, payoutUnit: unknown): ParsedYeahPromosCommission {
  const avgText = String(avgPayout || '').trim()
  const unitText = String(payoutUnit || '').trim()

  const isRate = avgText.includes('%') || unitText.includes('%')
  if (isRate) {
    return {
      mode: 'rate',
      rate: parsePercentage(avgPayout),
      amount: null,
    }
  }

  const isAmount = hasCurrencySymbol(avgText) || looksLikeCurrencyUnit(unitText)
  if (isAmount) {
    return {
      mode: 'amount',
      rate: null,
      amount: parsePriceAmount(avgPayout),
    }
  }

  return {
    mode: 'rate',
    rate: parsePercentage(avgPayout),
    amount: null,
  }
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function computeCommissionAmount(priceAmount: number | null, commissionRate: number | null): number | null {
  if (priceAmount === null || commissionRate === null) return null
  return roundTo2(priceAmount * (commissionRate / 100))
}

function normalizeCountryCode(value: string): string | null {
  const code = value.trim().toUpperCase()
  if (!code) return null
  if (code.length === 2 || code.length === 3) return code
  return code
}

function normalizeCountries(input: unknown): string[] {
  if (!input) return []

  const fromArray = (arr: unknown[]): string[] => {
    const deduped = new Set<string>()
    for (const value of arr) {
      if (value === null || value === undefined) continue
      const code = normalizeCountryCode(String(value))
      if (code) deduped.add(code)
    }
    return Array.from(deduped)
  }

  if (Array.isArray(input)) {
    return fromArray(input)
  }

  const text = String(input).trim()
  if (!text) return []
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) {
        return fromArray(parsed)
      }
    } catch {
      // ignore
    }
  }

  return fromArray(text.split(/[;,|/\s]+/g).filter(Boolean))
}

function normalizeYmdDate(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return text
}

function formatYmdDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toJsonString(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}

function parseAllowedCountries(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return normalizeCountries(parsed)
  } catch {
    return normalizeCountries(value)
  }
}

function normalizePlatformValue(value: unknown): AffiliatePlatform | null {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (raw === 'yp' || raw === 'yeahpromos') return 'yeahpromos'
  if (raw === 'pb' || raw === 'partnerboost') return 'partnerboost'
  return null
}

function normalizeTriStateBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0

  const raw = String(value).trim().toLowerCase()
  if (!raw) return null
  if (raw === '1' || raw === 'true' || raw === 'yes') return true
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return null
}

export function detectAffiliateLandingPageType(params: {
  asin?: string | null
  productUrl?: string | null
  promoLink?: string | null
  shortPromoLink?: string | null
}): AffiliateLandingPageType {
  if (params.asin && String(params.asin).trim()) {
    return 'amazon_product'
  }

  const candidateUrls = [params.productUrl, params.shortPromoLink, params.promoLink]

  let parsedUrl: URL | null = null
  for (const value of candidateUrls) {
    const normalized = normalizeUrl(value)
    if (!normalized) continue
    try {
      parsedUrl = new URL(normalized)
      break
    } catch {
      continue
    }
  }

  if (!parsedUrl) return 'unknown'

  const hostname = parsedUrl.hostname.toLowerCase()
  const pathname = parsedUrl.pathname.toLowerCase()
  const isAmazonDomain = hostname.includes('amazon.')

  if (isAmazonDomain) {
    if (
      pathname.includes('/stores/')
      || pathname.includes('/store/')
      || pathname.includes('/storefront/')
    ) {
      return 'amazon_store'
    }

    if (pathname.includes('/dp/') || pathname.includes('/gp/product/')) {
      return 'amazon_product'
    }
  }

  const isIndependentProduct =
    pathname.includes('/products/')
    || pathname.includes('/product/')
    || pathname.includes('/p/')
    || pathname.includes('/item/')

  if (isIndependentProduct) {
    return 'independent_product'
  }

  const isIndependentStore =
    pathname === '/'
    || pathname === ''
    || pathname.includes('/collections')
    || pathname.includes('/shop')
    || pathname.includes('/store')

  if (isIndependentStore) {
    return 'independent_store'
  }

  return 'unknown'
}

export function normalizeAffiliatePlatform(value: unknown): AffiliatePlatform | null {
  return normalizePlatformValue(value)
}

function chooseOfferUrl(product: AffiliateProduct): string | null {
  const candidateUrls = [
    normalizeUrl(product.product_url),
    normalizeUrl(product.promo_link),
    product.asin ? `https://www.amazon.com/dp/${product.asin}` : null,
  ]

  for (const url of candidateUrls) {
    if (!url) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return url
      }
    } catch {
      continue
    }
  }

  return null
}

function formatPriceForOffer(product: AffiliateProduct): string | undefined {
  if (product.price_amount === null || product.price_amount === undefined) return undefined
  if (product.price_currency) {
    return `${String(product.price_currency).toUpperCase()} ${product.price_amount}`
  }
  return `${product.price_amount}`
}

function formatCommissionForOffer(product: AffiliateProduct): string | undefined {
  if (product.commission_rate === null || product.commission_rate === undefined) return undefined
  return `${roundTo2(product.commission_rate)}%`
}

async function getUserScopedSettingMap(userId: number, keys: string[]): Promise<Record<string, string>> {
  const values = await Promise.all(
    keys.map(async (key) => {
      const record = await getUserOnlySetting('openclaw', key, userId)
      return [key, (record?.value || '').trim()] as const
    })
  )

  return values.reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key] = value
    return acc
  }, {})
}

export async function checkAffiliatePlatformConfig(userId: number, platform: AffiliatePlatform): Promise<PlatformConfigCheck> {
  const requiredKeys = PLATFORM_KEY_REQUIREMENTS[platform]
  const optionalKeys = platform === 'partnerboost'
    ? [
        'partnerboost_base_url',
        'partnerboost_products_page_size',
        'partnerboost_products_page',
        'partnerboost_products_default_filter',
        'partnerboost_products_country_code',
        'partnerboost_products_brand_id',
        'partnerboost_products_sort',
        'partnerboost_products_asins',
        'partnerboost_products_relationship',
        'partnerboost_products_is_original_currency',
        'partnerboost_products_has_promo_code',
        'partnerboost_products_has_acc',
        'partnerboost_products_filter_sexual_wellness',
        'partnerboost_products_link_batch_size',
        'partnerboost_asin_link_batch_size',
        'partnerboost_request_delay_ms',
        'partnerboost_rate_limit_max_retries',
        'partnerboost_rate_limit_base_delay_ms',
        'partnerboost_rate_limit_max_delay_ms',
        'partnerboost_link_country_code',
        'partnerboost_link_uid',
        'partnerboost_link_return_partnerboost_link',
      ]
    : [
        'yeahpromos_start_date',
        'yeahpromos_end_date',
        'yeahpromos_is_amazon',
        'yeahpromos_page',
        'yeahpromos_limit',
        'yeahpromos_request_delay_ms',
        'yeahpromos_rate_limit_max_retries',
        'yeahpromos_rate_limit_base_delay_ms',
        'yeahpromos_rate_limit_max_delay_ms',
      ]

  const values = await getUserScopedSettingMap(userId, [...requiredKeys, ...optionalKeys])
  const missingKeys = requiredKeys.filter((key) => !values[key])

  return {
    configured: missingKeys.length === 0,
    missingKeys,
    values,
  }
}

function ensurePlatformConfigured(check: PlatformConfigCheck, platform: AffiliatePlatform): void {
  if (check.configured) return
  throw new ConfigRequiredError(platform, check.missingKeys)
}

async function fetchJsonOrThrow<T>(url: string, init: RequestInit, errorPrefix: string): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${errorPrefix} (${response.status}): ${text || '请求失败'}`)
  }
  return await response.json() as T
}

type PartnerboostRequestRateLimitOptions = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

type YeahPromosRequestRateLimitOptions = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

async function fetchPartnerboostJsonWithRateLimitRetry<T extends { status?: { code?: number | string; msg?: string } }>(
  url: string,
  init: RequestInit,
  errorPrefix: string,
  options: PartnerboostRequestRateLimitOptions
): Promise<T> {
  let attempt = 0
  while (true) {
    let responseStatus: number | undefined
    try {
      const payload = await fetchJsonOrThrow<T>(url, init, errorPrefix)
      const payloadStatusCode = normalizePartnerboostStatusCode(payload?.status?.code)
      const payloadStatusMessage = String(payload?.status?.msg || '')

      if (
        isPartnerboostRateLimited(payloadStatusCode, payloadStatusMessage, responseStatus)
        && attempt < options.maxRetries
      ) {
        attempt += 1
        const delayMs = calculateExponentialBackoffDelay(attempt, options.baseDelayMs, options.maxDelayMs)
        console.warn(`[partnerboost] rate limited(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`)
        await sleep(delayMs)
        continue
      }

      return payload
    } catch (error: any) {
      const message = String(error?.message || '')
      const statusMatch = message.match(/\((\d{3})\):/)
      responseStatus = statusMatch ? Number(statusMatch[1]) : undefined
      const payloadStatusCode = normalizePartnerboostStatusCode(error?.status?.code)
      const payloadStatusMessage = String(error?.status?.msg || message)

      if (
        isPartnerboostRateLimited(payloadStatusCode, payloadStatusMessage, responseStatus)
        && attempt < options.maxRetries
      ) {
        attempt += 1
        const delayMs = calculateExponentialBackoffDelay(attempt, options.baseDelayMs, options.maxDelayMs)
        console.warn(`[partnerboost] rate limited(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`)
        await sleep(delayMs)
        continue
      }

      throw error
    }
  }
}

async function fetchYeahPromosJsonWithRateLimitRetry<T extends {
  Code?: number | string
  code?: number | string
  message?: string
  msg?: string
}>(
  url: string,
  init: RequestInit,
  errorPrefix: string,
  options: YeahPromosRequestRateLimitOptions
): Promise<T> {
  let attempt = 0
  while (true) {
    let responseStatus: number | undefined
    try {
      const payload = await fetchJsonOrThrow<T>(url, init, errorPrefix)
      const code = normalizeYeahPromosResultCode(payload?.Code ?? payload?.code)
      const message = String(payload?.message || payload?.msg || '')

      if (isYeahPromosRateLimited(code, message, responseStatus) && attempt < options.maxRetries) {
        attempt += 1
        const delayMs = calculateExponentialBackoffDelay(attempt, options.baseDelayMs, options.maxDelayMs)
        console.warn(`[yeahpromos] rate limited(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`)
        await sleep(delayMs)
        continue
      }

      return payload
    } catch (error: any) {
      const message = String(error?.message || '')
      const statusMatch = message.match(/\((\d{3})\):/)
      responseStatus = statusMatch ? Number(statusMatch[1]) : undefined

      if (isYeahPromosRateLimited(null, message, responseStatus) && attempt < options.maxRetries) {
        attempt += 1
        const delayMs = calculateExponentialBackoffDelay(attempt, options.baseDelayMs, options.maxDelayMs)
        console.warn(`[yeahpromos] rate limited(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`)
        await sleep(delayMs)
        continue
      }

      throw error
    }
  }
}

async function fetchPartnerboostPromotableProductsWithMeta(
  params: PartnerboostPromotableFetchParams
): Promise<PartnerboostPromotableFetchResult> {
  const check = await checkAffiliatePlatformConfig(params.userId, 'partnerboost')
  ensurePlatformConfigured(check, 'partnerboost')

  const token = check.values.partnerboost_token
  const baseUrl = (check.values.partnerboost_base_url || DEFAULT_PB_BASE_URL).replace(/\/+$/, '')
  const pageSize = Math.max(1, Math.min(
    parseInteger(check.values.partnerboost_products_page_size || String(DEFAULT_PB_PRODUCTS_PAGE_SIZE), DEFAULT_PB_PRODUCTS_PAGE_SIZE),
    200
  ))
  const configuredStartPage = Math.max(1, parseInteger(check.values.partnerboost_products_page || '1', 1))
  const startPage = Math.max(1, parseInteger(params.startPage, configuredStartPage))
  const defaultFilter = parseInteger(check.values.partnerboost_products_default_filter || '0', 0)
  const countryCode = resolvePartnerboostCountryCode(check.values.partnerboost_products_country_code)
  const brandId = (check.values.partnerboost_products_brand_id || '').trim() || null
  const sort = check.values.partnerboost_products_sort || ''
  const relationship = parseInteger(check.values.partnerboost_products_relationship || '1', 1)
  const isOriginalCurrency = parseInteger(check.values.partnerboost_products_is_original_currency || '0', 0)
  const hasPromoCode = parseInteger(check.values.partnerboost_products_has_promo_code || '0', 0)
  const hasAcc = parseInteger(check.values.partnerboost_products_has_acc || '0', 0)
  const filterSexual = parseInteger(check.values.partnerboost_products_filter_sexual_wellness || '0', 0)
  const productLinkBatchSize = parseIntegerInRange(
    check.values.partnerboost_products_link_batch_size || String(DEFAULT_PB_PRODUCTS_LINK_BATCH_SIZE),
    DEFAULT_PB_PRODUCTS_LINK_BATCH_SIZE,
    1,
    MAX_PB_PRODUCTS_LINK_BATCH_SIZE
  )
  const asinLinkBatchSize = parseIntegerInRange(
    check.values.partnerboost_asin_link_batch_size || String(DEFAULT_PB_ASIN_LINK_BATCH_SIZE),
    DEFAULT_PB_ASIN_LINK_BATCH_SIZE,
    1,
    MAX_PB_ASIN_LINK_BATCH_SIZE
  )
  const requestDelayMs = parseIntegerInRange(
    check.values.partnerboost_request_delay_ms || String(DEFAULT_PB_REQUEST_DELAY_MS),
    DEFAULT_PB_REQUEST_DELAY_MS,
    0,
    MAX_PB_REQUEST_DELAY_MS
  )
  const rateLimitRetryOptions: PartnerboostRequestRateLimitOptions = {
    maxRetries: parseIntegerInRange(
      check.values.partnerboost_rate_limit_max_retries || String(DEFAULT_PB_RATE_LIMIT_MAX_RETRIES),
      DEFAULT_PB_RATE_LIMIT_MAX_RETRIES,
      0,
      10
    ),
    baseDelayMs: parseIntegerInRange(
      check.values.partnerboost_rate_limit_base_delay_ms || String(DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS),
      DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS,
      100,
      60000
    ),
    maxDelayMs: parseIntegerInRange(
      check.values.partnerboost_rate_limit_max_delay_ms || String(DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS),
      DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS,
      500,
      120000
    ),
  }
  const configuredAsins = parseCsvValues(check.values.partnerboost_products_asins || '')
  const allAsins = Array.from(new Set([...(params.asins || []), ...configuredAsins]))
    .map((asin) => normalizeAsin(asin))
    .filter((asin): asin is string => Boolean(asin))
  const linkCountryCode = resolvePartnerboostCountryCode(check.values.partnerboost_link_country_code, countryCode)
  const uid = check.values.partnerboost_link_uid || ''
  const returnPartnerboostLink = parseInteger(check.values.partnerboost_link_return_partnerboost_link || '1', 1)
  const isAsinTargetedSync = allAsins.length > 0
  const defaultMaxPages = isAsinTargetedSync ? 1 : null
  const maxPages = resolveSyncMaxPages(params.maxPages, defaultMaxPages, MAX_PB_SYNC_MAX_PAGES)

  const products: PartnerboostProduct[] = []
  let page = startPage
  let hasMore = true
  let fetchedPages = 0
  let emptyPageStreak = 0
  let lastFetchProgressCount = 0

  const emitFetchProgress = async (force: boolean = false): Promise<void> => {
    if (!params.onFetchProgress) return
    if (!force && products.length === lastFetchProgressCount) return
    lastFetchProgressCount = products.length
    try {
      await params.onFetchProgress(products.length)
    } catch (error: any) {
      console.warn('[partnerboost] onFetchProgress callback failed:', error?.message || error)
    }
  }

  while (hasMore && (maxPages === null || fetchedPages < maxPages)) {
    const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostProductsResponse>(
      `${baseUrl}/api/datafeed/get_fba_products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          page_size: pageSize,
          page,
          default_filter: defaultFilter,
          country_code: countryCode,
          brand_id: brandId,
          sort,
          asins: allAsins.join(','),
          relationship,
          is_original_currency: isOriginalCurrency,
          has_promo_code: hasPromoCode,
          has_acc: hasAcc,
          filter_sexual_wellness: filterSexual,
        }),
      },
      'PartnerBoost 商品拉取失败',
      rateLimitRetryOptions
    )

    const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
    if (statusCode === null) {
      throw new Error(`PartnerBoost 商品拉取失败: Invalid status code ${String(payload.status?.code)}`)
    }
    if (statusCode !== 0) {
      throw new Error(`PartnerBoost 商品拉取失败: ${payload.status?.msg || statusCode}`)
    }

    const extracted = extractPartnerboostProductsPayload(payload)
    products.push(...extracted.products)
    hasMore = extracted.hasMore
    fetchedPages += 1

    if (fetchedPages === 1 || fetchedPages % 5 === 0 || !hasMore) {
      await emitFetchProgress()
    }

    if (!isAsinTargetedSync && hasMore) {
      if (extracted.products.length === 0) {
        emptyPageStreak += 1
        if (emptyPageStreak >= MAX_PB_EMPTY_PAGE_STREAK) {
          console.warn(
            `[partnerboost] received ${emptyPageStreak} consecutive empty pages with has_more=true; stopping early to avoid infinite pagination`
          )
          hasMore = false
        }
      } else {
        emptyPageStreak = 0
      }
    } else {
      emptyPageStreak = 0
    }

    page += 1

    if (isAsinTargetedSync) {
      hasMore = false
    }

    if (hasMore && requestDelayMs > 0) {
      await sleep(requestDelayMs)
    }
  }

  if (
    !isAsinTargetedSync
    && maxPages !== null
    && hasMore
    && fetchedPages >= maxPages
    && !params.suppressMaxPagesWarning
  ) {
    console.warn(`[partnerboost] reached page limit (${maxPages}) while has_more=true; results may be truncated`)
  }

  await emitFetchProgress(true)

  if (products.length === 0) {
    return {
      items: [],
      hasMore,
      nextPage: page,
      fetchedPages,
    }
  }

  const productIds = products
    .map((item) => String(item.product_id || '').trim())
    .filter(Boolean)

  const linkMap = new Map<string, string>()
  let rateLimitedProductLinkBatchCount = 0
  let productLinkBatchProcessed = 0
  for (let index = 0; index < productIds.length; index += productLinkBatchSize) {
    const batchIds = productIds.slice(index, index + productLinkBatchSize)
    try {
      const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostLinkResponse>(
        `${baseUrl}/api/datafeed/get_fba_products_link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            product_ids: batchIds.join(','),
            uid,
          }),
        },
        'PartnerBoost 推广链接拉取失败',
        rateLimitRetryOptions
      )

      const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
      if (statusCode === null) {
        throw new Error(`PartnerBoost 推广链接拉取失败: Invalid status code ${String(payload.status?.code)}`)
      }
      if (statusCode !== 0) {
        throw new Error(`PartnerBoost 推广链接拉取失败: ${payload.status?.msg || statusCode}`)
      }

      for (const item of payload.data || []) {
        const productId = String(item.product_id || '').trim()
        const link = normalizeUrl(item.partnerboost_link || item.link)
        if (!productId || !link) continue
        linkMap.set(productId, link)
      }
    } catch (error) {
      if (!isPartnerboostRateLimitError(error)) {
        throw error
      }

      rateLimitedProductLinkBatchCount += 1
      console.warn(
        `[partnerboost] product link batch rate-limited, falling back to ASIN link for this batch (${index + 1}-${Math.min(index + productLinkBatchSize, productIds.length)}/${productIds.length})`
      )
    }

    const hasRemaining = index + productLinkBatchSize < productIds.length
    productLinkBatchProcessed += 1
    if (
      productLinkBatchProcessed % PB_LINK_HEARTBEAT_EVERY_BATCHES === 0
      || !hasRemaining
    ) {
      await emitFetchProgress(true)
    }

    if (hasRemaining && requestDelayMs > 0) {
      await sleep(requestDelayMs)
    }
  }

  const asinLinkMap = new Map<string, { link: string | null; partnerboostLink: string | null }>()
  // 优先使用 product_id 链接；仅对缺失 product_id 链接的商品补查 ASIN 链接，
  // 可显著减少 API 请求量并降低触发 429 的概率。
  const linkLookupAsins = Array.from(new Set(
    products
      .filter((item) => {
        const productId = String(item.product_id || '').trim()
        return !productId || !linkMap.has(productId)
      })
      .map((item) => normalizeAsin(item.asin))
      .filter((asin): asin is string => Boolean(asin))
  ))
  let asinLinkBatchProcessed = 0
  for (let index = 0; index < linkLookupAsins.length; index += asinLinkBatchSize) {
    const batchAsins = linkLookupAsins.slice(index, index + asinLinkBatchSize)
    try {
      const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostAsinLinkResponse>(
        `${baseUrl}/api/datafeed/get_amazon_link_by_asin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            asins: batchAsins.join(','),
            country_code: linkCountryCode,
            uid,
            return_partnerboost_link: returnPartnerboostLink,
          }),
        },
        'PartnerBoost ASIN推广链接拉取失败',
        rateLimitRetryOptions
      )

      const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
      if (statusCode === null) {
        throw new Error(`PartnerBoost ASIN推广链接拉取失败: Invalid status code ${String(payload.status?.code)}`)
      }
      if (statusCode !== 0) {
        throw new Error(`PartnerBoost ASIN推广链接拉取失败: ${payload.status?.msg || statusCode}`)
      }

      for (const item of payload.data || []) {
        const asinKey = normalizeAsin(item.asin)
        if (!asinKey) continue

        asinLinkMap.set(asinKey, {
          link: normalizeUrl(item.link),
          partnerboostLink: normalizeUrl(item.partnerboost_link),
        })
      }
    } catch (error) {
      if (!isPartnerboostRateLimitError(error)) {
        throw error
      }

      console.warn(
        `[partnerboost] asin link batch rate-limited; stop remaining ASIN enrichment (${index + 1}-${Math.min(index + asinLinkBatchSize, linkLookupAsins.length)}/${linkLookupAsins.length})`
      )
      break
    }

    const hasRemaining = index + asinLinkBatchSize < linkLookupAsins.length
    asinLinkBatchProcessed += 1
    if (
      asinLinkBatchProcessed % PB_LINK_HEARTBEAT_EVERY_BATCHES === 0
      || !hasRemaining
    ) {
      await emitFetchProgress(true)
    }

    if (hasRemaining && requestDelayMs > 0) {
      await sleep(requestDelayMs)
    }
  }

  if (rateLimitedProductLinkBatchCount > 0) {
    console.warn(
      `[partnerboost] product link batches rate-limited: ${rateLimitedProductLinkBatchCount}; used ASIN fallback for missing links`
    )
  }

  const normalized: NormalizedAffiliateProduct[] = []
  for (const item of products) {
    const mid = String(item.product_id || '').trim()
    if (!mid) continue

    const asinKey = normalizeAsin(item.asin)
    const asinLinks = asinKey ? asinLinkMap.get(asinKey) : undefined
    const resolvedLinks = resolvePartnerboostPromoLinks({
      productIdLink: linkMap.get(mid) || null,
      asinLink: asinLinks?.link || null,
      asinPartnerboostLink: asinLinks?.partnerboostLink || null,
    })

    const promoLink = resolvedLinks.promoLink
    if (!promoLink) {
      continue
    }

    const priceAmount = parsePriceAmount(item.discount_price ?? item.original_price)
    const priceCurrency = normalizeCurrencyUnit(item.currency)
    const parsedCommission = parsePartnerboostCommission(item.acc_commission ?? item.commission, priceCurrency)
    const commissionRate = parsedCommission.mode === 'percent' ? parsedCommission.rate : parsedCommission.amount
    const allowedCountries = normalizeCountries(item.country_code)
    const reviewCount = parseReviewCount(
      item.review_count
      ?? item.reviewCount
      ?? item.reviews
      ?? item.rating_count
      ?? item.ratings_total
    )

    normalized.push({
      platform: 'partnerboost',
      mid,
      asin: normalizeUrl(item.asin),
      brand: normalizeUrl(item.brand_name),
      productName: normalizeUrl(item.product_name),
      productUrl: normalizeUrl(item.url),
      promoLink,
      shortPromoLink: resolvedLinks.shortPromoLink,
      allowedCountries,
      priceAmount,
      priceCurrency,
      commissionRate,
      commissionAmount: parsedCommission.mode === 'amount'
        ? parsedCommission.amount
        : computeCommissionAmount(priceAmount, commissionRate),
      reviewCount,
      rawJson: toJsonString({
        ...item,
        commission_mode: parsedCommission.mode,
        commission_currency: parsedCommission.currency,
      }),
    })
  }

  return {
    items: normalized,
    hasMore,
    nextPage: page,
    fetchedPages,
  }
}

async function fetchPartnerboostPromotableProducts(
  params: PartnerboostPromotableFetchParams
): Promise<NormalizedAffiliateProduct[]> {
  const result = await fetchPartnerboostPromotableProductsWithMeta(params)
  return result.items
}

async function fetchYeahPromosPromotableProducts(params: {
  userId: number
  maxPages?: number
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<NormalizedAffiliateProduct[]> {
  const check = await checkAffiliatePlatformConfig(params.userId, 'yeahpromos')
  ensurePlatformConfigured(check, 'yeahpromos')

  const token = check.values.yeahpromos_token
  const siteId = check.values.yeahpromos_site_id
  const limit = Number(check.values.yeahpromos_limit || '1000') || 1000
  const requestDelayMs = parseIntegerInRange(
    check.values.yeahpromos_request_delay_ms || String(DEFAULT_YP_REQUEST_DELAY_MS),
    DEFAULT_YP_REQUEST_DELAY_MS,
    0,
    MAX_YP_REQUEST_DELAY_MS
  )
  const rateLimitRetryOptions: YeahPromosRequestRateLimitOptions = {
    maxRetries: parseIntegerInRange(
      check.values.yeahpromos_rate_limit_max_retries || String(DEFAULT_YP_RATE_LIMIT_MAX_RETRIES),
      DEFAULT_YP_RATE_LIMIT_MAX_RETRIES,
      0,
      10
    ),
    baseDelayMs: parseIntegerInRange(
      check.values.yeahpromos_rate_limit_base_delay_ms || String(DEFAULT_YP_RATE_LIMIT_BASE_DELAY_MS),
      DEFAULT_YP_RATE_LIMIT_BASE_DELAY_MS,
      100,
      60000
    ),
    maxDelayMs: parseIntegerInRange(
      check.values.yeahpromos_rate_limit_max_delay_ms || String(DEFAULT_YP_RATE_LIMIT_MAX_DELAY_MS),
      DEFAULT_YP_RATE_LIMIT_MAX_DELAY_MS,
      500,
      120000
    ),
  }
  const maxPages = resolveSyncMaxPages(params.maxPages, null, MAX_YP_SYNC_MAX_PAGES)
  const startPage = Number(check.values.yeahpromos_page || '1') || 1
  let page = startPage
  let pageTotal = page
  let emptyMerchantPageStreak = 0

  const merchants: YeahPromosMerchant[] = []
  let merchantPageCount = 0
  let lastFetchProgressCount = 0

  const emitFetchProgress = async (force: boolean = false): Promise<void> => {
    if (!params.onFetchProgress) return
    if (!force && merchants.length === lastFetchProgressCount) return
    lastFetchProgressCount = merchants.length
    try {
      await params.onFetchProgress(merchants.length)
    } catch (error: any) {
      console.warn('[yeahpromos] onFetchProgress callback failed:', error?.message || error)
    }
  }

  while (page <= pageTotal && (maxPages === null || page - startPage < maxPages)) {
    const url = new URL('https://yeahpromos.com/index/getadvert/getadvert')
    url.searchParams.set('site_id', siteId)
    url.searchParams.set('page', String(page))
    url.searchParams.set('limit', String(limit))

    const payload = await fetchYeahPromosJsonWithRateLimitRetry<YeahPromosResponse>(
      url.toString(),
      {
        method: 'GET',
        headers: {
          token,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
      'YeahPromos 商品拉取失败',
      rateLimitRetryOptions
    )

    const codeRaw = payload.Code ?? payload.code
    const code = normalizeYeahPromosResultCode(codeRaw)

    if (codeRaw !== undefined && codeRaw !== null && codeRaw !== '' && code === null) {
      throw new Error(`YeahPromos 商品拉取失败: Invalid code ${String(codeRaw)}`)
    }

    if (code !== null && code !== 100000) {
      throw new Error(`YeahPromos 商品拉取失败: ${code}`)
    }

    const extracted = extractYeahPromosPayload(payload)
    merchants.push(...extracted.merchants)
    merchantPageCount += 1

    if (merchantPageCount === 1 || merchantPageCount % 5 === 0 || page >= pageTotal) {
      await emitFetchProgress()
    }

    const nextPageTotal = Number(extracted.pageTotal ?? page) || page
    const hasMorePages = page < nextPageTotal
    if (hasMorePages && extracted.merchants.length === 0) {
      emptyMerchantPageStreak += 1
      if (emptyMerchantPageStreak >= MAX_YP_EMPTY_PAGE_STREAK) {
        console.warn(
          `[yeahpromos] received ${emptyMerchantPageStreak} consecutive empty pages while page_total indicates more data; stopping early to avoid infinite pagination`
        )
        pageTotal = page
      } else {
        pageTotal = nextPageTotal
      }
    } else {
      emptyMerchantPageStreak = 0
      pageTotal = nextPageTotal
    }

    page += 1

    if (page <= pageTotal && requestDelayMs > 0) {
      await sleep(requestDelayMs)
    }
  }

  if (maxPages !== null && page <= pageTotal && page - startPage >= maxPages) {
    console.warn(`[yeahpromos] reached page limit (${maxPages}) while page_total=${pageTotal}; product results may be truncated`)
  }

  await emitFetchProgress(true)

  const configuredStartDate = normalizeYmdDate(check.values.yeahpromos_start_date)
  const configuredEndDate = normalizeYmdDate(check.values.yeahpromos_end_date)
  const now = new Date()
  const defaultEndDate = formatYmdDate(now)
  const defaultStartDate = formatYmdDate(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000))
  const startDate = configuredStartDate || defaultStartDate
  const endDate = configuredEndDate || defaultEndDate
  const isAmazon = String(check.values.yeahpromos_is_amazon || '').trim() === '1' ? '1' : null

  const transactionMetrics = new Map<string, YeahPromosTransactionMetric>()

  try {
    let orderPage = startPage
    let orderPageTotal = orderPage
    let emptyOrderPageStreak = 0

    while (orderPage <= orderPageTotal && (maxPages === null || orderPage - startPage < maxPages)) {
      const url = new URL('https://yeahpromos.com/index/Getorder/getorder')
      url.searchParams.set('site_id', siteId)
      url.searchParams.set('startDate', startDate)
      url.searchParams.set('endDate', endDate)
      url.searchParams.set('page', String(orderPage))
      url.searchParams.set('limit', String(limit))
      if (isAmazon) {
        url.searchParams.set('is_amazon', isAmazon)
      }

      const payload = await fetchYeahPromosJsonWithRateLimitRetry<YeahPromosTransactionsResponse>(
        url.toString(),
        {
          method: 'GET',
          headers: {
            token,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        'YeahPromos 交易拉取失败',
        rateLimitRetryOptions
      )

      const codeRaw = payload.Code ?? payload.code
      const code = normalizeYeahPromosResultCode(codeRaw)

      if (codeRaw !== undefined && codeRaw !== null && codeRaw !== '' && code === null) {
        throw new Error(`YeahPromos 交易拉取失败: Invalid code ${String(codeRaw)}`)
      }

      if (code !== null && code !== 100000) {
        throw new Error(`YeahPromos 交易拉取失败: ${code}`)
      }

      const extracted = extractYeahPromosTransactionsPayload(payload)
      for (const row of extracted.transactions) {
        const mid = String(row.advert_id || '').trim()
        if (!mid) continue

        const amount = parsePriceAmount(row.amount)
        const saleCommission = parsePriceAmount(row.sale_comm)
        if (amount === null && saleCommission === null) continue

        const previous = transactionMetrics.get(mid) || {
          priceAmount: null,
          commissionAmount: null,
          commissionRate: null,
          sampleCount: 0,
        }

        const nextSampleCount = previous.sampleCount + 1
        const nextPriceAmount = amount === null
          ? previous.priceAmount
          : previous.priceAmount === null
            ? amount
            : roundTo2(((previous.priceAmount * previous.sampleCount) + amount) / nextSampleCount)

        const nextCommissionAmount = saleCommission === null
          ? previous.commissionAmount
          : previous.commissionAmount === null
            ? saleCommission
            : roundTo2(((previous.commissionAmount * previous.sampleCount) + saleCommission) / nextSampleCount)

        const inferredRate = nextPriceAmount !== null && nextPriceAmount > 0 && nextCommissionAmount !== null
          ? roundTo2((nextCommissionAmount / nextPriceAmount) * 100)
          : previous.commissionRate

        transactionMetrics.set(mid, {
          priceAmount: nextPriceAmount,
          commissionAmount: nextCommissionAmount,
          commissionRate: inferredRate,
          sampleCount: nextSampleCount,
        })
      }

      const nextOrderPageTotal = Number(extracted.pageTotal ?? orderPage) || orderPage
      const hasMoreOrderPages = orderPage < nextOrderPageTotal
      if (hasMoreOrderPages && extracted.transactions.length === 0) {
        emptyOrderPageStreak += 1
        if (emptyOrderPageStreak >= MAX_YP_EMPTY_PAGE_STREAK) {
          console.warn(
            `[yeahpromos] received ${emptyOrderPageStreak} consecutive empty order pages while page_total indicates more data; stopping order pagination early`
          )
          orderPageTotal = orderPage
        } else {
          orderPageTotal = nextOrderPageTotal
        }
      } else {
        emptyOrderPageStreak = 0
        orderPageTotal = nextOrderPageTotal
      }

      orderPage += 1

      if (orderPage <= orderPageTotal && requestDelayMs > 0) {
        await sleep(requestDelayMs)
      }
    }

    if (maxPages !== null && orderPage <= orderPageTotal && orderPage - startPage >= maxPages) {
      console.warn(`[yeahpromos] reached order page limit (${maxPages}) while page_total=${orderPageTotal}; transaction enrichment may be partial`)
    }
  } catch (error: any) {
    console.warn(`[affiliate-products] YeahPromos 交易数据补充失败，继续使用商家接口数据: ${error?.message || error}`)
  }

  const normalized: NormalizedAffiliateProduct[] = []
  for (const item of merchants) {
    const mid = String(item.mid || '').trim()
    if (!mid) continue

    const promoLink = normalizeUrl(item.tracking_url)
    if (!promoLink) continue

    const advertStatus = String(item.advert_status ?? '').trim()
    if (advertStatus && advertStatus !== '1') continue

    const parsedCommission = parseYeahPromosMerchantCommission(item.avg_payout, item.payout_unit)
    const txMetric = transactionMetrics.get(mid)
    const commissionRate = parsedCommission.rate ?? txMetric?.commissionRate ?? null
    const priceAmount = txMetric?.priceAmount ?? null
    const commissionAmount = txMetric?.commissionAmount
      ?? parsedCommission.amount
      ?? computeCommissionAmount(priceAmount, commissionRate)
    const allowedCountries = normalizeCountries(item.country)
    const reviewCount = parseReviewCount(
      item.review_count
      ?? item.reviewCount
      ?? item.reviews
      ?? item.rating_count
      ?? item.ratings_total
    )

    normalized.push({
      platform: 'yeahpromos',
      mid,
      asin: null,
      brand: normalizeUrl(item.merchant_name),
      productName: normalizeUrl(item.merchant_name),
      productUrl: normalizeUrl(item.url || item.site_url),
      promoLink,
      shortPromoLink: null,
      allowedCountries,
      priceAmount,
      priceCurrency: null,
      commissionRate,
      commissionAmount,
      reviewCount,
      rawJson: toJsonString(txMetric ? { ...item, transaction_metric: txMetric } : item),
    })
  }

  return normalized
}

function dedupeNormalizedProducts(items: NormalizedAffiliateProduct[]): NormalizedAffiliateProduct[] {
  const deduped = new Map<string, NormalizedAffiliateProduct>()
  for (const item of items) {
    if (!item.mid || !item.promoLink) continue
    const key = `${item.platform}:${item.mid}`
    if (!deduped.has(key)) {
      deduped.set(key, item)
    }
  }
  return Array.from(deduped.values())
}

async function loadExistingMidSet(userId: number, platform: AffiliatePlatform, mids: string[]): Promise<Set<string>> {
  if (mids.length === 0) return new Set<string>()
  const db = await getDatabase()
  const existing = new Set<string>()
  const dedupedMids = Array.from(new Set(
    mids
      .map((mid) => String(mid || '').trim())
      .filter(Boolean)
  ))
  if (dedupedMids.length === 0) return existing

  // 避免 PostgreSQL 参数上限（65534）与 SQLite 变量上限导致大批量同步失败。
  const batchSize = db.type === 'postgres' ? 10000 : 500
  for (let index = 0; index < dedupedMids.length; index += batchSize) {
    const batch = dedupedMids.slice(index, index + batchSize)
    if (batch.length === 0) continue

    const placeholders = batch.map(() => '?').join(', ')
    const rows = await db.query<{ mid: string }>(
      `
        SELECT mid
        FROM affiliate_products
        WHERE user_id = ?
          AND platform = ?
          AND mid IN (${placeholders})
      `,
      [userId, platform, ...batch]
    )

    for (const row of rows) {
      if (row?.mid) {
        existing.add(row.mid)
      }
    }
  }

  return existing
}

async function getPartnerboostDeltaSyncSettings(userId: number): Promise<{
  asinBatchSize: number
  activeDays: number
}> {
  const [asinBatchSetting, activeDaysSetting] = await Promise.all([
    getUserOnlySetting('system', 'affiliate_pb_delta_asin_batch_size', userId),
    getUserOnlySetting('system', 'affiliate_pb_active_days', userId),
  ])

  const asinBatchSize = parseIntegerInRange(
    asinBatchSetting?.value || String(DEFAULT_PB_DELTA_ASIN_BATCH_SIZE),
    DEFAULT_PB_DELTA_ASIN_BATCH_SIZE,
    10,
    MAX_PB_DELTA_ASIN_BATCH_SIZE
  )
  const activeDays = parseIntegerInRange(
    activeDaysSetting?.value || String(DEFAULT_PB_ACTIVE_DAYS),
    DEFAULT_PB_ACTIVE_DAYS,
    1,
    MAX_PB_ACTIVE_DAYS
  )

  return {
    asinBatchSize,
    activeDays,
  }
}

async function listActivePartnerboostAsins(userId: number, activeDays: number): Promise<string[]> {
  const db = await getDatabase()
  const isBlacklistedCondition = db.type === 'postgres'
    ? 'p.is_blacklisted = FALSE'
    : 'p.is_blacklisted = 0'
  const recentUpdatedCondition = db.type === 'postgres'
    ? `p.updated_at >= CURRENT_TIMESTAMP - INTERVAL '${Math.max(1, activeDays)} days'`
    : `p.updated_at >= datetime('now', '-${Math.max(1, activeDays)} days')`

  const rows = await db.query<{ asin: string | null }>(
    `
      SELECT DISTINCT p.asin
      FROM affiliate_products p
      WHERE p.user_id = ?
        AND p.platform = 'partnerboost'
        AND ${isBlacklistedCondition}
        AND p.asin IS NOT NULL
        AND TRIM(p.asin) <> ''
        AND (
          EXISTS (
            SELECT 1
            FROM affiliate_product_offer_links l
            WHERE l.user_id = p.user_id
              AND l.product_id = p.id
            LIMIT 1
          )
          OR ${recentUpdatedCondition}
        )
      ORDER BY p.asin
    `,
    [userId]
  )

  const asins: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const asin = normalizeAsin(row.asin)
    if (!asin || seen.has(asin)) continue
    seen.add(asin)
    asins.push(asin)
  }
  return asins
}

async function fetchPartnerboostDeltaProducts(params: {
  userId: number
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<NormalizedAffiliateProduct[]> {
  const settings = await getPartnerboostDeltaSyncSettings(params.userId)
  const asins = await listActivePartnerboostAsins(params.userId, settings.activeDays)
  if (asins.length === 0) {
    if (params.onFetchProgress) {
      await params.onFetchProgress(0)
    }
    return []
  }

  const normalizedItems: NormalizedAffiliateProduct[] = []
  const batchSize = Math.max(10, settings.asinBatchSize)

  for (let index = 0; index < asins.length; index += batchSize) {
    const batch = asins.slice(index, index + batchSize)
    const batchItems = await fetchPartnerboostPromotableProducts({
      userId: params.userId,
      asins: batch,
      maxPages: 1,
      onFetchProgress: async (fetchedCount: number) => {
        if (!params.onFetchProgress) return
        await params.onFetchProgress(normalizedItems.length + fetchedCount)
      },
    })
    normalizedItems.push(...batchItems)

    if (params.onFetchProgress) {
      await params.onFetchProgress(normalizedItems.length)
    }
  }

  return normalizedItems
}

function getAffiliateProductsUpsertBatchSize(dbType: 'sqlite' | 'postgres'): number {
  return dbType === 'postgres'
    ? DEFAULT_UPSERT_BATCH_SIZE_POSTGRES
    : DEFAULT_UPSERT_BATCH_SIZE_SQLITE
}

async function upsertAffiliateProductsChunk(params: {
  db: DatabaseAdapter
  userId: number
  platform: AffiliatePlatform
  items: NormalizedAffiliateProduct[]
  nowIso: string
}): Promise<void> {
  if (params.items.length === 0) return

  const perRowPlaceholder = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  const placeholders = new Array(params.items.length).fill(perRowPlaceholder).join(', ')

  const sql = `
    INSERT INTO affiliate_products (
      user_id,
      platform,
      mid,
      asin,
      brand,
      product_name,
      product_url,
      promo_link,
      short_promo_link,
      allowed_countries_json,
      price_amount,
      price_currency,
      commission_rate,
      commission_amount,
      review_count,
      raw_json,
      last_synced_at,
      last_seen_at,
      updated_at
    )
    VALUES ${placeholders}
    ON CONFLICT (user_id, platform, mid) DO UPDATE SET
      asin = EXCLUDED.asin,
      brand = EXCLUDED.brand,
      product_name = EXCLUDED.product_name,
      product_url = EXCLUDED.product_url,
      promo_link = EXCLUDED.promo_link,
      short_promo_link = EXCLUDED.short_promo_link,
      allowed_countries_json = EXCLUDED.allowed_countries_json,
      price_amount = EXCLUDED.price_amount,
      price_currency = EXCLUDED.price_currency,
      commission_rate = EXCLUDED.commission_rate,
      commission_amount = EXCLUDED.commission_amount,
      review_count = EXCLUDED.review_count,
      raw_json = EXCLUDED.raw_json,
      last_synced_at = EXCLUDED.last_synced_at,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = EXCLUDED.updated_at
  `

  const values: any[] = []
  for (const item of params.items) {
    values.push(
      params.userId,
      params.platform,
      item.mid,
      item.asin,
      item.brand,
      item.productName,
      item.productUrl,
      item.promoLink,
      item.shortPromoLink,
      JSON.stringify(item.allowedCountries || []),
      item.priceAmount,
      item.priceCurrency,
      item.commissionRate,
      item.commissionAmount,
      item.reviewCount,
      item.rawJson,
      params.nowIso,
      params.nowIso,
      params.nowIso
    )
  }

  await params.db.exec(sql, values)
}

export async function upsertAffiliateProducts(
  userId: number,
  platform: AffiliatePlatform,
  items: NormalizedAffiliateProduct[],
  options?: {
    progressEvery?: number
    onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  }
): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
}> {
  const db = await getDatabase()
  const deduped = dedupeNormalizedProducts(items)
  const totalFetched = deduped.length

  const emitProgress = async (progress: AffiliateProductSyncProgress): Promise<void> => {
    if (!options?.onProgress) return
    try {
      await options.onProgress(progress)
    } catch (error: any) {
      console.warn('[affiliate-products] onProgress callback failed:', error?.message || error)
    }
  }

  if (deduped.length === 0) {
    await emitProgress({
      totalFetched: 0,
      processedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      failedCount: 0,
    })
    return {
      totalFetched: 0,
      createdCount: 0,
      updatedCount: 0,
    }
  }

  let createdCount = 0
  let updatedCount = 0
  let processedCount = 0
  let lastEmittedProcessed = 0
  const nowIso = new Date().toISOString()
  const progressEvery = Math.max(1, Math.floor(Number(options?.progressEvery || 20)))
  const upsertBatchSize = Math.max(1, getAffiliateProductsUpsertBatchSize(db.type))

  await emitProgress({
    totalFetched,
    processedCount,
    createdCount,
    updatedCount,
    failedCount: 0,
  })

  for (let index = 0; index < deduped.length; index += upsertBatchSize) {
    const batch = deduped.slice(index, index + upsertBatchSize)
    const existingMidSet = await loadExistingMidSet(
      userId,
      platform,
      batch.map((item) => item.mid)
    )

    for (const item of batch) {
      if (existingMidSet.has(item.mid)) {
        updatedCount += 1
      } else {
        createdCount += 1
      }
    }

    await upsertAffiliateProductsChunk({
      db,
      userId,
      platform,
      items: batch,
      nowIso,
    })

    processedCount += batch.length
    if (
      processedCount - lastEmittedProcessed >= progressEvery
      || processedCount === totalFetched
    ) {
      lastEmittedProcessed = processedCount
      await emitProgress({
        totalFetched,
        processedCount,
        createdCount,
        updatedCount,
        failedCount: 0,
      })
    }
  }

  return {
    totalFetched,
    createdCount,
    updatedCount,
  }
}

const SORT_FIELD_SQL: Record<ProductSortField, string> = {
  serial: 'p.id',
  platform: 'p.platform',
  mid: 'p.mid',
  asin: 'p.asin',
  allowedCountries: 'p.allowed_countries_json',
  priceAmount: 'p.price_amount',
  commissionRate: 'p.commission_rate',
  commissionAmount: 'p.commission_amount',
  reviewCount: 'p.review_count',
  promoLink: 'COALESCE(p.short_promo_link, p.promo_link)',
  relatedOfferCount: 'related_offer_count',
  updatedAt: 'p.updated_at',
}

const NUMERIC_SORT_FIELDS_WITH_NULLS_LAST: Set<ProductSortField> = new Set([
  'priceAmount',
  'commissionRate',
  'commissionAmount',
  'reviewCount',
])

export function buildAffiliateProductsOrderBy(params: {
  sortBy: ProductSortField
  sortOrder: ProductSortOrder
}): string {
  const { sortBy, sortOrder } = params
  const direction = sortOrder === 'asc' ? 'ASC' : 'DESC'
  const sortSql = SORT_FIELD_SQL[sortBy] || SORT_FIELD_SQL.serial

  if (NUMERIC_SORT_FIELDS_WITH_NULLS_LAST.has(sortBy)) {
    return `(${sortSql} IS NULL) ASC, ${sortSql} ${direction}, p.id DESC`
  }

  return `${sortSql} ${direction}, p.id DESC`
}

function normalizeNumericRangeBounds(params: {
  min?: number | null
  max?: number | null
}): { min: number | null; max: number | null } {
  const min = typeof params.min === 'number' && Number.isFinite(params.min)
    ? params.min
    : null
  const max = typeof params.max === 'number' && Number.isFinite(params.max)
    ? params.max
    : null

  if (min !== null && max !== null && min > max) {
    return { min: max, max: min }
  }

  return { min, max }
}

function appendNumericRangeWhere(params: {
  whereConditions: string[]
  whereParams: any[]
  columnSql: string
  min?: number | null
  max?: number | null
}): void {
  const { min, max } = normalizeNumericRangeBounds({ min: params.min, max: params.max })

  if (min !== null) {
    params.whereConditions.push(`${params.columnSql} >= ?`)
    params.whereParams.push(min)
  }

  if (max !== null) {
    params.whereConditions.push(`${params.columnSql} <= ?`)
    params.whereParams.push(max)
  }
}

export async function listAffiliateProducts(userId: number, options: ProductListOptions = {}): Promise<ProductListResult> {
  const db = await getDatabase()
  const page = Math.max(1, options.page || 1)
  const pageSize = Math.min(100, Math.max(10, options.pageSize || 20))
  const offset = (page - 1) * pageSize
  const sortBy = options.sortBy || 'serial'
  const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc'
  const orderBySql = buildAffiliateProductsOrderBy({ sortBy, sortOrder })

  const whereConditions: string[] = ['p.user_id = ?']
  const whereParams: any[] = [userId]

  const platform = normalizePlatformValue(options.platform)
  if (platform) {
    whereConditions.push('p.platform = ?')
    whereParams.push(platform)
  }

  const search = (options.search || '').trim().toLowerCase()
  if (search) {
    const like = `%${search}%`
    whereConditions.push(`(
      LOWER(COALESCE(p.mid, '')) LIKE ?
      OR LOWER(COALESCE(p.asin, '')) LIKE ?
      OR LOWER(COALESCE(p.product_name, '')) LIKE ?
      OR LOWER(COALESCE(p.brand, '')) LIKE ?
    )`)
    whereParams.push(like, like, like, like)
  }

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.review_count',
    min: options.reviewCountMin,
    max: options.reviewCountMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.price_amount',
    min: options.priceAmountMin,
    max: options.priceAmountMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.commission_rate',
    min: options.commissionRateMin,
    max: options.commissionRateMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.commission_amount',
    min: options.commissionAmountMin,
    max: options.commissionAmountMax,
  })

  const whereSql = whereConditions.join(' AND ')

  const summaryRow = await db.queryOne<{ total: number; products_with_link_count: number }>(
    `
      SELECT
        COUNT(*) AS total,
        SUM(
          CASE
            WHEN COALESCE(NULLIF(TRIM(p.short_promo_link), ''), NULLIF(TRIM(p.promo_link), '')) IS NOT NULL THEN 1
            ELSE 0
          END
        ) AS products_with_link_count
      FROM affiliate_products p
      WHERE ${whereSql}
    `,
    whereParams
  )

  const rows = await db.query<(AffiliateProduct & { related_offer_count?: number })>(
    `
      SELECT
        p.*,
        COALESCE(link_counts.offer_count, 0) AS related_offer_count
      FROM affiliate_products p
      LEFT JOIN (
        SELECT product_id, COUNT(*) AS offer_count
        FROM affiliate_product_offer_links
        WHERE user_id = ?
        GROUP BY product_id
      ) link_counts ON link_counts.product_id = p.id
      WHERE ${whereSql}
      ORDER BY ${orderBySql}
      LIMIT ?
      OFFSET ?
    `,
    [userId, ...whereParams, pageSize, offset]
  )

  return {
    items: rows.map((row) => mapAffiliateProductRow(row)),
    total: Number(summaryRow?.total || 0),
    productsWithLinkCount: Number(summaryRow?.products_with_link_count || 0),
    page,
    pageSize,
  }
}

function mapAffiliateProductRow(row: AffiliateProduct & { related_offer_count?: number }): AffiliateProductListItem {
  const rawJson = (() => {
    if (!row.raw_json) return null
    try {
      return JSON.parse(row.raw_json)
    } catch {
      return null
    }
  })()

  const commissionUnitText = String(rawJson?.payout_unit || '').trim()
  const inferredCommissionCurrency = normalizeCurrencyUnit(commissionUnitText)
    || normalizeCurrencyUnit(rawJson?.commission_currency)
    || normalizeCurrencyUnit(rawJson?.currency)
    || normalizeCurrencyUnit(rawJson?.transaction_metric?.currency)
    || normalizeCurrencyUnit(row.price_currency)

  const inferredCommissionModeFromRaw = (() => {
    const rawMode = String(rawJson?.commission_mode || '').trim().toLowerCase()
    if (rawMode === 'amount') return 'amount' as const
    if (rawMode === 'rate' || rawMode === 'percent' || rawMode === 'percentage') return 'percent' as const
    return null
  })()

  const commissionRateMode: 'percent' | 'amount' =
    inferredCommissionModeFromRaw === 'amount'
      || Boolean(rawJson?.avg_payout && String(rawJson.avg_payout).includes('$'))
      || looksLikeCurrencyUnit(commissionUnitText)
      ? 'amount'
      : 'percent'

  const normalizedCommissionAmount = commissionRateMode === 'amount'
    ? (row.commission_amount ?? row.commission_rate)
    : row.commission_amount

  const normalizedCommissionRate = commissionRateMode === 'amount'
    ? (row.commission_amount ?? row.commission_rate)
    : row.commission_rate

  const normalizedReviewCount = row.review_count
    ?? parseReviewCount(
      rawJson?.review_count
      ?? rawJson?.reviewCount
      ?? rawJson?.reviews
      ?? rawJson?.rating_count
      ?? rawJson?.ratings_total
    )

  const isDeepLink = normalizeTriStateBool(rawJson?.is_deeplink)
  const landingPageType = detectAffiliateLandingPageType({
    asin: row.asin,
    productUrl: row.product_url,
    promoLink: row.promo_link,
    shortPromoLink: row.short_promo_link,
  })

  return {
    id: row.id,
    serial: row.id,
    platform: row.platform,
    mid: row.mid,
    asin: row.asin,
    landingPageType,
    isDeepLink,
    brand: row.brand,
    productName: row.product_name,
    productUrl: row.product_url,
    allowedCountries: parseAllowedCountries(row.allowed_countries_json),
    priceAmount: row.price_amount,
    priceCurrency: row.price_currency,
    commissionRate: normalizedCommissionRate,
    commissionRateMode,
    commissionAmount: normalizedCommissionAmount,
    commissionCurrency: inferredCommissionCurrency,
    reviewCount: normalizedReviewCount,
    promoLink: row.short_promo_link || row.promo_link,
    shortPromoLink: row.short_promo_link,
    relatedOfferCount: Number(row.related_offer_count || 0),
    isBlacklisted: toBool(row.is_blacklisted),
    lastSyncedAt: row.last_synced_at,
    updatedAt: row.updated_at,
  }
}

export const __testOnly = {
  calculateExponentialBackoffDelay,
  isPartnerboostRateLimited,
  isPartnerboostRateLimitError,
  isYeahPromosRateLimited,
  normalizeNumericRangeBounds,
  mapAffiliateProductRow,
  resolveSyncMaxPages,
}

export async function getAffiliateProductById(userId: number, productId: number): Promise<AffiliateProduct | null> {
  const db = await getDatabase()
  const row = await db.queryOne<AffiliateProduct>(
    `SELECT * FROM affiliate_products WHERE id = ? AND user_id = ? LIMIT 1`,
    [productId, userId]
  )
  return row || null
}

export async function clearAllAffiliateProducts(userId: number): Promise<{ deletedCount: number }> {
  const db = await getDatabase()

  const totalRow = await db.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM affiliate_products WHERE user_id = ?`,
    [userId]
  )

  await db.exec(
    `DELETE FROM affiliate_products WHERE user_id = ?`,
    [userId]
  )

  return {
    deletedCount: Number(totalRow?.total || 0),
  }
}

async function listActiveLinkedOfferIdsForProduct(userId: number, productId: number): Promise<number[]> {
  const db = await getDatabase()
  const offerNotDeletedCondition = db.type === 'postgres'
    ? '(o.is_deleted = false OR o.is_deleted IS NULL)'
    : '(o.is_deleted = 0 OR o.is_deleted IS NULL)'

  const rows = await db.query<{ offer_id: number }>(
    `
      SELECT DISTINCT link.offer_id
      FROM affiliate_product_offer_links link
      INNER JOIN offers o ON o.id = link.offer_id AND o.user_id = link.user_id
      WHERE link.user_id = ?
        AND link.product_id = ?
        AND ${offerNotDeletedCondition}
      ORDER BY link.offer_id ASC
    `,
    [userId, productId]
  )

  return rows
    .map((row) => Number(row.offer_id))
    .filter((value) => Number.isFinite(value) && value > 0)
}

export async function offlineAffiliateProduct(params: {
  userId: number
  productId: number
}): Promise<AffiliateProductOfflineResult> {
  const product = await getAffiliateProductById(params.userId, params.productId)
  if (!product) {
    throw new Error('商品不存在')
  }

  const linkedOfferIds = await listActiveLinkedOfferIdsForProduct(params.userId, params.productId)
  const deletedOfferIds: number[] = []
  const failedOffers: AffiliateProductOfflineFailure[] = []

  for (const offerId of linkedOfferIds) {
    try {
      const result = await deleteOffer(offerId, params.userId, true, true)
      if (!result.success) {
        throw new Error(result.message || '删除Offer失败')
      }
      deletedOfferIds.push(offerId)
    } catch (error: any) {
      failedOffers.push({
        offerId,
        error: error?.message || '删除Offer失败',
      })
    }
  }

  const offlined = failedOffers.length === 0
  const updatedProduct = offlined
    ? await setAffiliateProductBlacklist(params.userId, params.productId, true)
    : product

  return {
    productId: params.productId,
    totalLinkedOffers: linkedOfferIds.length,
    deletedOfferCount: deletedOfferIds.length,
    deletedOfferIds,
    failedOffers,
    offlined,
    product: updatedProduct,
  }
}

export async function batchOfflineAffiliateProducts(params: {
  userId: number
  productIds: number[]
}): Promise<BatchOfflineAffiliateProductsResult> {
  const dedupedProductIds = Array.from(new Set(
    params.productIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  ))

  const results: BatchOfflineAffiliateProductsResult['results'] = []
  let successCount = 0
  let failureCount = 0

  for (const productId of dedupedProductIds) {
    try {
      const result = await offlineAffiliateProduct({
        userId: params.userId,
        productId,
      })

      if (!result.offlined) {
        failureCount += 1
        results.push({
          productId,
          success: false,
          deletedOfferCount: result.deletedOfferCount,
          totalLinkedOffers: result.totalLinkedOffers,
          offlined: result.offlined,
          failedOffers: result.failedOffers,
          error: `下线失败：${result.failedOffers.length}/${result.totalLinkedOffers} 个关联Offer删除失败`,
        })
        continue
      }

      successCount += 1
      results.push({
        productId,
        success: true,
        deletedOfferCount: result.deletedOfferCount,
        totalLinkedOffers: result.totalLinkedOffers,
        offlined: result.offlined,
      })
    } catch (error: any) {
      failureCount += 1
      results.push({
        productId,
        success: false,
        error: error?.message || '下线商品失败',
      })
    }
  }

  return {
    total: dedupedProductIds.length,
    successCount,
    failureCount,
    results,
  }
}

export async function setAffiliateProductBlacklist(userId: number, productId: number, blacklisted: boolean): Promise<AffiliateProduct | null> {
  const db = await getDatabase()
  const value = db.type === 'postgres' ? blacklisted : (blacklisted ? 1 : 0)
  const nowIso = new Date().toISOString()

  await db.exec(
    `
      UPDATE affiliate_products
      SET is_blacklisted = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `,
    [value, nowIso, productId, userId]
  )

  return await getAffiliateProductById(userId, productId)
}

export async function recordAffiliateProductOfferLink(params: {
  userId: number
  productId: number
  offerId: number
  createdVia?: 'single' | 'batch'
}): Promise<void> {
  const db = await getDatabase()
  await db.exec(
    `
      INSERT INTO affiliate_product_offer_links (user_id, product_id, offer_id, created_via)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, product_id, offer_id) DO NOTHING
    `,
    [params.userId, params.productId, params.offerId, params.createdVia || 'single']
  )
}

export async function createOfferFromAffiliateProduct(params: {
  userId: number
  productId: number
  targetCountry?: string
  createdVia?: 'single' | 'batch'
}): Promise<{ product: AffiliateProduct; offerId: number; taskId: string }> {
  const db = await getDatabase()
  const product = await getAffiliateProductById(params.userId, params.productId)
  if (!product) {
    throw new Error('商品不存在')
  }

  if (toBool(product.is_blacklisted)) {
    throw new Error('商品已下线，无法创建Offer')
  }

  const offerUrl = chooseOfferUrl(product)
  if (!offerUrl) {
    throw new Error('该商品缺少可用落地页链接，无法创建Offer')
  }

  const allowedCountries = parseAllowedCountries(product.allowed_countries_json)
  const targetCountry = (params.targetCountry || allowedCountries[0] || 'US').toUpperCase()
  const brand = (product.brand || product.product_name || product.mid || 'Unknown').trim()

  const offer = await createOffer(params.userId, {
    url: offerUrl,
    brand,
    target_country: targetCountry,
    affiliate_link: product.promo_link || undefined,
    product_price: formatPriceForOffer(product),
    commission_payout: formatCommissionForOffer(product),
    page_type: 'product',
  })

  try {
    await recordAffiliateProductOfferLink({
      userId: params.userId,
      productId: product.id,
      offerId: offer.id,
      createdVia: params.createdVia || 'single',
    })

    const extractionTaskId = await createOfferExtractionTaskForExistingOffer({
      userId: params.userId,
      offerId: offer.id,
      affiliateLink: product.promo_link || offer.affiliate_link || offer.url,
      targetCountry: offer.target_country,
      productPrice: offer.product_price,
      commissionPayout: offer.commission_payout,
      brandName: offer.brand,
      pageType: offer.page_type === 'store' ? 'store' : 'product',
      priority: params.createdVia === 'single' ? 'high' : 'normal',
      skipCache: false,
      skipWarmup: false,
    })

    return {
      product,
      offerId: offer.id,
      taskId: extractionTaskId,
    }
  } catch (error) {
    await db.exec(
      `DELETE FROM affiliate_product_offer_links WHERE user_id = ? AND product_id = ? AND offer_id = ?`,
      [params.userId, product.id, offer.id]
    )
    await db.exec(
      `DELETE FROM offers WHERE id = ? AND user_id = ?`,
      [offer.id, params.userId]
    )

    throw error
  }
}

export async function batchCreateOffersFromAffiliateProducts(params: {
  userId: number
  items: Array<{ productId: number; targetCountry?: string }>
}): Promise<{
  total: number
  successCount: number
  failureCount: number
  results: Array<{ productId: number; success: boolean; offerId?: number; taskId?: string; error?: string }>
}> {
  const results: Array<{ productId: number; success: boolean; offerId?: number; taskId?: string; error?: string }> = []
  let successCount = 0
  let failureCount = 0

  for (const item of params.items) {
    try {
      const result = await createOfferFromAffiliateProduct({
        userId: params.userId,
        productId: item.productId,
        targetCountry: item.targetCountry,
        createdVia: 'batch',
      })
      successCount += 1
      results.push({
        productId: item.productId,
        success: true,
        offerId: result.offerId,
        taskId: result.taskId,
      })
    } catch (error: any) {
      failureCount += 1
      results.push({
        productId: item.productId,
        success: false,
        error: error?.message || '创建Offer失败',
      })
    }
  }

  return {
    total: params.items.length,
    successCount,
    failureCount,
    results,
  }
}

export async function createAffiliateProductSyncRun(params: {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  triggerSource?: string
  status?: 'queued' | 'running' | 'completed' | 'failed'
}): Promise<number> {
  const db = await getDatabase()
  const nowIso = new Date().toISOString()
  const result = await db.exec(
    `
      INSERT INTO affiliate_product_sync_runs
      (user_id, platform, mode, status, trigger_source, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      params.userId,
      params.platform,
      params.mode,
      params.status || 'queued',
      params.triggerSource || null,
      params.status === 'running' ? nowIso : null,
      nowIso,
      nowIso,
    ]
  )

  return getInsertedId(result, db.type)
}

export async function updateAffiliateProductSyncRun(params: {
  runId: number
  status?: 'queued' | 'running' | 'completed' | 'failed'
  totalItems?: number
  createdCount?: number
  updatedCount?: number
  failedCount?: number
  cursorPage?: number | null
  processedBatches?: number
  lastHeartbeatAt?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
}): Promise<void> {
  const db = await getDatabase()
  const updates: string[] = []
  const values: any[] = []

  if (params.status !== undefined) {
    updates.push('status = ?')
    values.push(params.status)
  }
  if (params.totalItems !== undefined) {
    updates.push('total_items = ?')
    values.push(params.totalItems)
  }
  if (params.createdCount !== undefined) {
    updates.push('created_count = ?')
    values.push(params.createdCount)
  }
  if (params.updatedCount !== undefined) {
    updates.push('updated_count = ?')
    values.push(params.updatedCount)
  }
  if (params.failedCount !== undefined) {
    updates.push('failed_count = ?')
    values.push(params.failedCount)
  }
  if (params.cursorPage !== undefined) {
    updates.push('cursor_page = ?')
    values.push(params.cursorPage === null ? 0 : params.cursorPage)
  }
  if (params.processedBatches !== undefined) {
    updates.push('processed_batches = ?')
    values.push(params.processedBatches)
  }
  if (params.lastHeartbeatAt !== undefined) {
    updates.push('last_heartbeat_at = ?')
    values.push(params.lastHeartbeatAt)
  }
  if (params.errorMessage !== undefined) {
    updates.push('error_message = ?')
    values.push(params.errorMessage)
  }
  if (params.startedAt !== undefined) {
    updates.push('started_at = ?')
    values.push(params.startedAt)
  }
  if (params.completedAt !== undefined) {
    updates.push('completed_at = ?')
    values.push(params.completedAt)
  }

  if (updates.length === 0) return

  updates.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(params.runId)

  await db.exec(
    `
      UPDATE affiliate_product_sync_runs
      SET ${updates.join(', ')}
      WHERE id = ?
    `,
    values
  )
}

export async function getAffiliateProductSyncRunById(params: {
  runId: number
  userId?: number
}): Promise<{
  id: number
  user_id: number
  platform: AffiliatePlatform
  mode: SyncMode
  status: string
  trigger_source: string | null
  total_items: number
  created_count: number
  updated_count: number
  failed_count: number
  cursor_page: number
  processed_batches: number
  last_heartbeat_at: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
} | null> {
  const db = await getDatabase()
  const whereUser = params.userId ? 'AND user_id = ?' : ''
  const values = params.userId ? [params.runId, params.userId] : [params.runId]

  const row = await db.queryOne<any>(
    `
      SELECT *
      FROM affiliate_product_sync_runs
      WHERE id = ?
      ${whereUser}
      LIMIT 1
    `,
    values
  )

  if (!row) return null

  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    platform: row.platform,
    mode: row.mode,
    status: String(row.status || ''),
    trigger_source: row.trigger_source ?? null,
    total_items: Number(row.total_items || 0),
    created_count: Number(row.created_count || 0),
    updated_count: Number(row.updated_count || 0),
    failed_count: Number(row.failed_count || 0),
    cursor_page: Number(row.cursor_page || 0),
    processed_batches: Number(row.processed_batches || 0),
    last_heartbeat_at: row.last_heartbeat_at ?? null,
    error_message: row.error_message ?? null,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function getAffiliateProductSyncRuns(userId: number, limit: number = 20): Promise<Array<{
  id: number
  platform: AffiliatePlatform
  mode: SyncMode
  status: string
  trigger_source: string | null
  total_items: number
  created_count: number
  updated_count: number
  failed_count: number
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}>> {
  const db = await getDatabase()
  const safeLimit = Math.max(1, Math.min(limit, 100))
  return await db.query(
    `
      SELECT
        id,
        platform,
        mode,
        status,
        trigger_source,
        total_items,
        created_count,
        updated_count,
        failed_count,
        error_message,
        started_at,
        completed_at,
        created_at
      FROM affiliate_product_sync_runs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [userId, safeLimit]
  )
}

export type AffiliateProductSyncCheckpoint = {
  cursorPage: number
  processedBatches: number
  totalFetched: number
  createdCount: number
  updatedCount: number
  failedCount: number
}

async function syncPartnerboostPlatformByWindow(params: {
  userId: number
  startPage?: number
  pageWindowSize?: number
  progressEvery?: number
  onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  onCheckpoint?: (checkpoint: AffiliateProductSyncCheckpoint) => Promise<void> | void
}): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
}> {
  const pageWindowSize = parseIntegerInRange(
    params.pageWindowSize ?? DEFAULT_PB_STREAM_WINDOW_PAGES,
    DEFAULT_PB_STREAM_WINDOW_PAGES,
    1,
    MAX_PB_STREAM_WINDOW_PAGES
  )

  let cursorPage = Math.max(1, parseInteger(params.startPage, 1))
  let hasMore = true
  let totalFetched = 0
  let createdCount = 0
  let updatedCount = 0
  const failedCount = 0
  let processedBatches = 0
  const seenMids = new Set<string>()

  const emitProgress = async (nextFetched: number): Promise<void> => {
    if (!params.onProgress) return
    try {
      await params.onProgress({
        totalFetched: Math.max(0, nextFetched),
        processedCount: createdCount + updatedCount + failedCount,
        createdCount,
        updatedCount,
        failedCount,
      })
    } catch (error: any) {
      console.warn('[affiliate-products] PB stream onProgress callback failed:', error?.message || error)
    }
  }

  const emitCheckpoint = async (): Promise<void> => {
    if (!params.onCheckpoint) return
    try {
      await params.onCheckpoint({
        cursorPage,
        processedBatches,
        totalFetched,
        createdCount,
        updatedCount,
        failedCount,
      })
    } catch (error: any) {
      console.warn('[affiliate-products] PB stream onCheckpoint callback failed:', error?.message || error)
    }
  }

  await emitProgress(0)
  await emitCheckpoint()

  while (hasMore) {
    const windowStartPage = cursorPage
    const fetchResult = await fetchPartnerboostPromotableProductsWithMeta({
      userId: params.userId,
      startPage: windowStartPage,
      maxPages: pageWindowSize,
      suppressMaxPagesWarning: true,
      onFetchProgress: async (fetchedCount) => {
        await emitProgress(totalFetched + Math.max(0, fetchedCount))
        await emitCheckpoint()
      },
    })

    const dedupedWindowItems: NormalizedAffiliateProduct[] = []
    for (const item of fetchResult.items) {
      const mid = String(item.mid || '').trim()
      if (!mid || seenMids.has(mid)) continue
      seenMids.add(mid)
      dedupedWindowItems.push(item)
    }

    const upserted = await upsertAffiliateProducts(
      params.userId,
      'partnerboost',
      dedupedWindowItems,
      {
        progressEvery: params.progressEvery,
      }
    )
    totalFetched += upserted.totalFetched
    createdCount += upserted.createdCount
    updatedCount += upserted.updatedCount
    processedBatches += 1

    const nextPage = fetchResult.nextPage > windowStartPage
      ? fetchResult.nextPage
      : windowStartPage + Math.max(1, fetchResult.fetchedPages)
    cursorPage = nextPage
    hasMore = fetchResult.hasMore && fetchResult.fetchedPages > 0

    await emitProgress(totalFetched)
    await emitCheckpoint()

    if (fetchResult.fetchedPages <= 0) break
  }

  return {
    totalFetched,
    createdCount,
    updatedCount,
  }
}

export async function syncAffiliateProducts(params: {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  productId?: number
  resumeFromPage?: number
  pageWindowSize?: number
  progressEvery?: number
  onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  onCheckpoint?: (checkpoint: AffiliateProductSyncCheckpoint) => Promise<void> | void
}): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
}> {
  let normalizedItems: NormalizedAffiliateProduct[] = []
  const emitFetchProgress = async (fetchedCount: number): Promise<void> => {
    if (!params.onProgress) return
    try {
      await params.onProgress({
        totalFetched: Math.max(0, fetchedCount),
        processedCount: 0,
        createdCount: 0,
        updatedCount: 0,
        failedCount: 0,
      })
    } catch (error: any) {
      console.warn('[affiliate-products] fetch stage progress callback failed:', error?.message || error)
    }
  }

  if (params.mode === 'delta') {
    if (params.platform !== 'partnerboost') {
      throw new Error('当前平台暂不支持轻量刷新')
    }

    normalizedItems = await fetchPartnerboostDeltaProducts({
      userId: params.userId,
      onFetchProgress: emitFetchProgress,
    })
  } else if (params.mode === 'single') {
    if (!params.productId) {
      throw new Error('缺少商品ID')
    }

    const existing = await getAffiliateProductById(params.userId, params.productId)
    if (!existing) {
      throw new Error('商品不存在')
    }
    if (existing.platform !== params.platform) {
      throw new Error('商品平台与同步请求不匹配')
    }

    if (params.platform === 'partnerboost') {
      if (!existing.asin) {
        throw new Error('该PB商品缺少ASIN，无法执行单商品同步')
      }
      const fetched = await fetchPartnerboostPromotableProducts({
        userId: params.userId,
        asins: [existing.asin],
        maxPages: 1,
        onFetchProgress: emitFetchProgress,
      })
      normalizedItems = fetched.filter((item) => item.mid === existing.mid)
    } else {
      const fetched = await fetchYeahPromosPromotableProducts({
        userId: params.userId,
        maxPages: 20,
        onFetchProgress: emitFetchProgress,
      })
      normalizedItems = fetched.filter((item) => item.mid === existing.mid)
    }

    if (normalizedItems.length === 0) {
      throw new Error('联盟平台未返回该商品，可能已失去推广资格')
    }
  } else {
    if (params.platform === 'partnerboost') {
      return await syncPartnerboostPlatformByWindow({
        userId: params.userId,
        startPage: params.resumeFromPage,
        pageWindowSize: params.pageWindowSize,
        progressEvery: params.progressEvery,
        onProgress: params.onProgress,
        onCheckpoint: params.onCheckpoint,
      })
    } else {
      normalizedItems = await fetchYeahPromosPromotableProducts({
        userId: params.userId,
        onFetchProgress: emitFetchProgress,
      })
    }
  }

  return await upsertAffiliateProducts(params.userId, params.platform, normalizedItems, {
    progressEvery: params.progressEvery,
    onProgress: params.onProgress,
  })
}
