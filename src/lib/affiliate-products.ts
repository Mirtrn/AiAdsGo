import { createOffer, deleteOffer } from '@/lib/offers'
import { getDatabase } from '@/lib/db'
import { generateUpsertSql, getInsertedId, toBool } from '@/lib/db-helpers'
import { getUserOnlySetting } from '@/lib/settings'
import { createOfferExtractionTaskForExistingOffer } from '@/lib/offer-extraction-task'

export type AffiliatePlatform = 'yeahpromos' | 'partnerboost'
export type SyncMode = 'platform' | 'single'
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
const DEFAULT_PB_SYNC_MAX_PAGES = 500
const MAX_PB_SYNC_MAX_PAGES = 1000
const DEFAULT_YP_SYNC_MAX_PAGES = 500
const MAX_YP_SYNC_MAX_PAGES = 1000

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

async function fetchPartnerboostPromotableProducts(params: {
  userId: number
  asins?: string[]
  maxPages?: number
}): Promise<NormalizedAffiliateProduct[]> {
  const check = await checkAffiliatePlatformConfig(params.userId, 'partnerboost')
  ensurePlatformConfigured(check, 'partnerboost')

  const token = check.values.partnerboost_token
  const baseUrl = (check.values.partnerboost_base_url || DEFAULT_PB_BASE_URL).replace(/\/+$/, '')
  const pageSize = Math.max(1, Math.min(
    parseInteger(check.values.partnerboost_products_page_size || String(DEFAULT_PB_PRODUCTS_PAGE_SIZE), DEFAULT_PB_PRODUCTS_PAGE_SIZE),
    200
  ))
  const startPage = Math.max(1, parseInteger(check.values.partnerboost_products_page || '1', 1))
  const defaultFilter = parseInteger(check.values.partnerboost_products_default_filter || '0', 0)
  const countryCode = resolvePartnerboostCountryCode(check.values.partnerboost_products_country_code)
  const brandId = (check.values.partnerboost_products_brand_id || '').trim() || null
  const sort = check.values.partnerboost_products_sort || ''
  const relationship = parseInteger(check.values.partnerboost_products_relationship || '1', 1)
  const isOriginalCurrency = parseInteger(check.values.partnerboost_products_is_original_currency || '0', 0)
  const hasPromoCode = parseInteger(check.values.partnerboost_products_has_promo_code || '0', 0)
  const hasAcc = parseInteger(check.values.partnerboost_products_has_acc || '0', 0)
  const filterSexual = parseInteger(check.values.partnerboost_products_filter_sexual_wellness || '0', 0)
  const configuredAsins = parseCsvValues(check.values.partnerboost_products_asins || '')
  const allAsins = Array.from(new Set([...(params.asins || []), ...configuredAsins]))
    .map((asin) => normalizeAsin(asin))
    .filter((asin): asin is string => Boolean(asin))
  const linkCountryCode = resolvePartnerboostCountryCode(check.values.partnerboost_link_country_code, countryCode)
  const uid = check.values.partnerboost_link_uid || ''
  const returnPartnerboostLink = parseInteger(check.values.partnerboost_link_return_partnerboost_link || '1', 1)
  const isAsinTargetedSync = allAsins.length > 0
  const defaultMaxPages = isAsinTargetedSync ? 1 : DEFAULT_PB_SYNC_MAX_PAGES
  const maxPages = Math.max(1, Math.min(params.maxPages || defaultMaxPages, MAX_PB_SYNC_MAX_PAGES))

  const products: PartnerboostProduct[] = []
  let page = startPage
  let hasMore = true
  let fetchedPages = 0

  while (hasMore && fetchedPages < maxPages) {
    const payload = await fetchJsonOrThrow<PartnerboostProductsResponse>(
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
      'PartnerBoost 商品拉取失败'
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
    page += 1

    if (isAsinTargetedSync) {
      hasMore = false
    }
  }

  if (!isAsinTargetedSync && hasMore && fetchedPages >= maxPages) {
    console.warn(`[partnerboost] reached page limit (${maxPages}) while has_more=true; results may be truncated`)
  }

  if (products.length === 0) return []

  const productIds = products
    .map((item) => String(item.product_id || '').trim())
    .filter(Boolean)

  const linkMap = new Map<string, string>()
  const batchSize = 50
  for (let index = 0; index < productIds.length; index += batchSize) {
    const batchIds = productIds.slice(index, index + batchSize)
    const payload = await fetchJsonOrThrow<PartnerboostLinkResponse>(
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
      'PartnerBoost 推广链接拉取失败'
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
  }

  const asinLinkMap = new Map<string, { link: string | null; partnerboostLink: string | null }>()
  const linkLookupAsins = Array.from(new Set(
    products
      .map((item) => normalizeAsin(item.asin))
      .filter((asin): asin is string => Boolean(asin))
  ))

  for (let index = 0; index < linkLookupAsins.length; index += batchSize) {
    const batchAsins = linkLookupAsins.slice(index, index + batchSize)
    const payload = await fetchJsonOrThrow<PartnerboostAsinLinkResponse>(
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
      'PartnerBoost ASIN推广链接拉取失败'
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

  return normalized
}

async function fetchYeahPromosPromotableProducts(params: {
  userId: number
  maxPages?: number
}): Promise<NormalizedAffiliateProduct[]> {
  const check = await checkAffiliatePlatformConfig(params.userId, 'yeahpromos')
  ensurePlatformConfigured(check, 'yeahpromos')

  const token = check.values.yeahpromos_token
  const siteId = check.values.yeahpromos_site_id
  const limit = Number(check.values.yeahpromos_limit || '1000') || 1000
  const maxPages = Math.max(1, Math.min(params.maxPages || DEFAULT_YP_SYNC_MAX_PAGES, MAX_YP_SYNC_MAX_PAGES))
  const startPage = Number(check.values.yeahpromos_page || '1') || 1
  let page = startPage
  let pageTotal = page

  const merchants: YeahPromosMerchant[] = []

  while (page <= pageTotal && page - startPage < maxPages) {
    const url = new URL('https://yeahpromos.com/index/getadvert/getadvert')
    url.searchParams.set('site_id', siteId)
    url.searchParams.set('page', String(page))
    url.searchParams.set('limit', String(limit))

    const payload = await fetchJsonOrThrow<YeahPromosResponse>(
      url.toString(),
      {
        method: 'GET',
        headers: {
          token,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
      'YeahPromos 商品拉取失败'
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

    pageTotal = Number(extracted.pageTotal ?? page) || page
    page += 1
  }

  if (page <= pageTotal && page - startPage >= maxPages) {
    console.warn(`[yeahpromos] reached page limit (${maxPages}) while page_total=${pageTotal}; product results may be truncated`)
  }

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

    while (orderPage <= orderPageTotal && orderPage - startPage < maxPages) {
      const url = new URL('https://yeahpromos.com/index/Getorder/getorder')
      url.searchParams.set('site_id', siteId)
      url.searchParams.set('startDate', startDate)
      url.searchParams.set('endDate', endDate)
      url.searchParams.set('page', String(orderPage))
      url.searchParams.set('limit', String(limit))
      if (isAmazon) {
        url.searchParams.set('is_amazon', isAmazon)
      }

      const payload = await fetchJsonOrThrow<YeahPromosTransactionsResponse>(
        url.toString(),
        {
          method: 'GET',
          headers: {
            token,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        'YeahPromos 交易拉取失败'
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

      orderPageTotal = Number(extracted.pageTotal ?? orderPage) || orderPage
      orderPage += 1
    }

    if (orderPage <= orderPageTotal && orderPage - startPage >= maxPages) {
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
  const placeholders = mids.map(() => '?').join(', ')
  const rows = await db.query<{ mid: string }>(
    `
      SELECT mid
      FROM affiliate_products
      WHERE user_id = ?
        AND platform = ?
        AND mid IN (${placeholders})
    `,
    [userId, platform, ...mids]
  )
  return new Set(rows.map((row) => row.mid))
}

export async function upsertAffiliateProducts(userId: number, platform: AffiliatePlatform, items: NormalizedAffiliateProduct[]): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
}> {
  const db = await getDatabase()
  const deduped = dedupeNormalizedProducts(items)
  if (deduped.length === 0) {
    return {
      totalFetched: 0,
      createdCount: 0,
      updatedCount: 0,
    }
  }

  const mids = deduped.map((item) => item.mid)
  const existingMidSet = await loadExistingMidSet(userId, platform, mids)

  const upsertSql = generateUpsertSql(
    'affiliate_products',
    ['user_id', 'platform', 'mid'],
    [
      'user_id',
      'platform',
      'mid',
      'asin',
      'brand',
      'product_name',
      'product_url',
      'promo_link',
      'short_promo_link',
      'allowed_countries_json',
      'price_amount',
      'price_currency',
      'commission_rate',
      'commission_amount',
      'review_count',
      'raw_json',
      'last_synced_at',
      'last_seen_at',
      'updated_at',
    ],
    [
      'asin',
      'brand',
      'product_name',
      'product_url',
      'promo_link',
      'short_promo_link',
      'allowed_countries_json',
      'price_amount',
      'price_currency',
      'commission_rate',
      'commission_amount',
      'review_count',
      'raw_json',
      'last_synced_at',
      'last_seen_at',
      'updated_at',
    ],
    db.type
  )

  let createdCount = 0
  let updatedCount = 0
  const nowIso = new Date().toISOString()

  for (const item of deduped) {
    const existed = existingMidSet.has(item.mid)
    if (existed) {
      updatedCount += 1
    } else {
      createdCount += 1
    }

    await db.exec(upsertSql, [
      userId,
      platform,
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
      nowIso,
      nowIso,
      nowIso,
    ])
  }

  return {
    totalFetched: deduped.length,
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
  mapAffiliateProductRow,
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

export async function syncAffiliateProducts(params: {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  productId?: number
}): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
}> {
  let normalizedItems: NormalizedAffiliateProduct[] = []

  if (params.mode === 'single') {
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
      })
      normalizedItems = fetched.filter((item) => item.mid === existing.mid)
    } else {
      const fetched = await fetchYeahPromosPromotableProducts({ userId: params.userId, maxPages: 20 })
      normalizedItems = fetched.filter((item) => item.mid === existing.mid)
    }

    if (normalizedItems.length === 0) {
      throw new Error('联盟平台未返回该商品，可能已失去推广资格')
    }
  } else {
    if (params.platform === 'partnerboost') {
      normalizedItems = await fetchPartnerboostPromotableProducts({ userId: params.userId })
    } else {
      normalizedItems = await fetchYeahPromosPromotableProducts({ userId: params.userId })
    }
  }

  return await upsertAffiliateProducts(params.userId, params.platform, normalizedItems)
}
