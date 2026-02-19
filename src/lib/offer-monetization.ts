import { parsePrice } from '@/lib/pricing-utils'

export const COUNTRY_CURRENCY_MAP: Readonly<Record<string, string>> = {
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  UK: 'GBP',
  AU: 'AUD',
  NZ: 'NZD',
  SG: 'SGD',
  JP: 'JPY',
  KR: 'KRW',
  IN: 'INR',
  CN: 'CNY',
  HK: 'HKD',
  TW: 'TWD',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  IE: 'EUR',
  AT: 'EUR',
  FI: 'EUR',
  PT: 'EUR',
  LU: 'EUR',
  GR: 'EUR',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  BR: 'BRL',
  MX: 'MXN',
  TH: 'THB',
  VN: 'VND',
  ID: 'IDR',
  PH: 'PHP',
  MY: 'MYR',
  RU: 'RUB',
  TR: 'TRY',
  SA: 'SAR',
  AE: 'AED',
  IL: 'ILS',
  ZA: 'ZAR',
}

export const CURRENCY_SYMBOL_MAP: Readonly<Record<string, string>> = {
  USD: '$',
  CAD: 'C$',
  GBP: '£',
  AUD: 'A$',
  NZD: 'NZ$',
  SGD: 'S$',
  JPY: '¥',
  CNY: '¥',
  KRW: '₩',
  INR: '₹',
  EUR: '€',
  HKD: 'HK$',
  TWD: 'NT$',
  CHF: 'CHF',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  PLN: 'zł',
  CZK: 'Kč',
  HUF: 'Ft',
  RON: 'lei',
  BRL: 'R$',
  MXN: 'MX$',
  THB: '฿',
  VND: '₫',
  IDR: 'Rp',
  PHP: '₱',
  MYR: 'RM',
  RUB: '₽',
  TRY: '₺',
  SAR: 'ر.س',
  AED: 'د.إ',
  ILS: '₪',
  ZAR: 'R',
}

const CURRENCY_CODES = Object.keys(CURRENCY_SYMBOL_MAP).sort((a, b) => b.length - a.length)

const SYMBOL_TO_CODE_ENTRIES: Array<[string, string]> = [
  ['HK$', 'HKD'],
  ['NT$', 'TWD'],
  ['NZ$', 'NZD'],
  ['MX$', 'MXN'],
  ['C$', 'CAD'],
  ['A$', 'AUD'],
  ['S$', 'SGD'],
  ['R$', 'BRL'],
  ['CHF', 'CHF'],
  ['RM', 'MYR'],
  ['Rp', 'IDR'],
  ['zł', 'PLN'],
  ['Kč', 'CZK'],
  ['Ft', 'HUF'],
  ['lei', 'RON'],
  ['₱', 'PHP'],
  ['₫', 'VND'],
  ['₩', 'KRW'],
  ['₽', 'RUB'],
  ['₺', 'TRY'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['₹', 'INR'],
  ['¥', 'JPY'],
  ['$', 'USD'],
  ['฿', 'THB'],
  ['₪', 'ILS'],
]

function normalizeCountryCode(country?: string | null): string {
  const normalized = String(country || '').trim().toUpperCase()
  return normalized || 'US'
}

function normalizeCurrencyCode(code?: string | null): string {
  const normalized = String(code || '').trim().toUpperCase()
  return normalized || 'USD'
}

function formatCompactNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100
  if (Number.isInteger(rounded)) {
    return String(rounded)
  }
  return rounded.toFixed(2).replace(/\.?0+$/, '')
}

function parseNumberish(value: string): number | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const withoutCurrency = raw
    .replace(/[A-Za-z¥€£$₹₩฿₫₱₽₺₪]/g, '')
    .replace(/[HKNTMXCASNZRMRp]/gi, '')
    .replace(/\s+/g, '')

  if (!withoutCurrency) return null

  const lastComma = withoutCurrency.lastIndexOf(',')
  const lastDot = withoutCurrency.lastIndexOf('.')

  let normalized = withoutCurrency
  if (lastComma > lastDot) {
    normalized = withoutCurrency.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    normalized = withoutCurrency.replace(/,/g, '')
  } else if (lastComma !== -1) {
    const decimals = withoutCurrency.length - lastComma - 1
    if (decimals >= 1 && decimals <= 2) {
      normalized = withoutCurrency.slice(0, lastComma).replace(/,/g, '') + '.' + withoutCurrency.slice(lastComma + 1)
    } else {
      normalized = withoutCurrency.replace(/,/g, '')
    }
  }

  normalized = normalized.replace(/[^0-9.]/g, '')
  if (!normalized) return null

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function resolveSymbolCurrencyCode(symbol: string, targetCountry?: string | null): string {
  if (symbol === '$') {
    const byCountry = getCurrencyCodeByCountry(targetCountry)
    if (['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'TWD'].includes(byCountry)) {
      return byCountry
    }
    return 'USD'
  }

  if (symbol === '¥') {
    const byCountry = getCurrencyCodeByCountry(targetCountry)
    if (byCountry === 'CNY') return 'CNY'
    return 'JPY'
  }

  const found = SYMBOL_TO_CODE_ENTRIES.find(([candidate]) => candidate.toLowerCase() === symbol.toLowerCase())
  return found ? found[1] : 'USD'
}

function detectCurrencyCodeFromText(value: string, targetCountry?: string | null): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const upper = raw.toUpperCase()
  for (const code of CURRENCY_CODES) {
    const pattern = new RegExp(`\\b${code}\\b`)
    if (pattern.test(upper)) {
      return code
    }
  }

  for (const [symbol] of SYMBOL_TO_CODE_ENTRIES) {
    if (raw.includes(symbol)) {
      return resolveSymbolCurrencyCode(symbol, targetCountry)
    }
  }

  return null
}

function hasExplicitCurrencyMarker(value: string): boolean {
  const raw = String(value || '').trim()
  if (!raw) return false
  return detectCurrencyCodeFromText(raw) !== null
}

function normalizeSpacing(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function getCurrencyCodeByCountry(country?: string | null): string {
  const code = normalizeCountryCode(country)
  return COUNTRY_CURRENCY_MAP[code] || 'USD'
}

export function getCurrencySymbolByCode(currencyCode?: string | null): string {
  const code = normalizeCurrencyCode(currencyCode)
  return CURRENCY_SYMBOL_MAP[code] || '$'
}

export function getCurrencySymbolByCountry(country?: string | null): string {
  const code = getCurrencyCodeByCountry(country)
  return getCurrencySymbolByCode(code)
}

export type ParsedMoneyValue = {
  amount: number
  currency: string
  explicitCurrency: boolean
}

export function parseMoneyValue(
  value: string | null | undefined,
  options?: {
    targetCountry?: string | null
    defaultCurrency?: string | null
  }
): ParsedMoneyValue | null {
  const raw = normalizeSpacing(String(value || ''))
  if (!raw) return null

  const amount = parseNumberish(raw)
  if (amount === null) return null

  const explicitCurrencyCode = detectCurrencyCodeFromText(raw, options?.targetCountry)
  const fallbackCurrency = normalizeCurrencyCode(options?.defaultCurrency || getCurrencyCodeByCountry(options?.targetCountry))

  return {
    amount,
    currency: explicitCurrencyCode || fallbackCurrency,
    explicitCurrency: Boolean(explicitCurrencyCode),
  }
}

export function normalizeOfferProductPriceInput(
  value: string | null | undefined,
  targetCountry?: string | null
): string | undefined {
  const raw = normalizeSpacing(String(value || ''))
  if (!raw) return undefined

  if (hasExplicitCurrencyMarker(raw)) {
    return raw
  }

  const parsedAmount = parseNumberish(raw)
  if (parsedAmount === null) {
    return raw
  }

  return `${getCurrencySymbolByCountry(targetCountry)}${formatCompactNumber(parsedAmount)}`
}

export function normalizeOfferCommissionPayoutInput(
  value: string | null | undefined,
  targetCountry?: string | null,
  options?: {
    numericMode?: 'amount' | 'percent'
  }
): string | undefined {
  const raw = normalizeSpacing(String(value || ''))
  if (!raw) return undefined

  if (raw.includes('%')) {
    const parsedAmount = parseNumberish(raw)
    return parsedAmount === null ? raw : `${formatCompactNumber(parsedAmount)}%`
  }

  if (hasExplicitCurrencyMarker(raw)) {
    return raw
  }

  const parsedAmount = parseNumberish(raw)
  if (parsedAmount === null) {
    return raw
  }

  if (options?.numericMode === 'percent') {
    return `${formatCompactNumber(parsedAmount)}%`
  }

  return `${getCurrencySymbolByCountry(targetCountry)}${formatCompactNumber(parsedAmount)}`
}

export type ParsedCommissionPayout =
  | {
    mode: 'percent'
    rate: number
    displayRate: number
  }
  | {
    mode: 'amount'
    amount: number
    currency: string
    explicitCurrency: boolean
  }

export function parseCommissionPayoutValue(
  value: string | null | undefined,
  options?: {
    targetCountry?: string | null
    fallbackCurrency?: string | null
  }
): ParsedCommissionPayout | null {
  const raw = normalizeSpacing(String(value || ''))
  if (!raw) return null

  if (raw.includes('%')) {
    const parsedAmount = parseNumberish(raw)
    if (parsedAmount === null || parsedAmount <= 0) return null
    return {
      mode: 'percent',
      rate: parsedAmount / 100,
      displayRate: parsedAmount,
    }
  }

  const parsedMoney = parseMoneyValue(raw, {
    targetCountry: options?.targetCountry,
    defaultCurrency: options?.fallbackCurrency,
  })
  if (!parsedMoney || parsedMoney.amount <= 0) return null

  return {
    mode: 'amount',
    amount: parsedMoney.amount,
    currency: parsedMoney.currency,
    explicitCurrency: parsedMoney.explicitCurrency,
  }
}

export function getCommissionPerConversion(
  params: {
    productPrice: string | null | undefined
    commissionPayout: string | null | undefined
    targetCountry?: string | null
  }
): { amount: number; currency: string; mode: 'percent' | 'amount'; rate?: number } | null {
  const product = parseMoneyValue(params.productPrice, {
    targetCountry: params.targetCountry,
  })

  const commission = parseCommissionPayoutValue(params.commissionPayout, {
    targetCountry: params.targetCountry,
    fallbackCurrency: product?.currency,
  })

  if (!commission) return null

  if (commission.mode === 'amount') {
    return {
      amount: commission.amount,
      currency: commission.currency,
      mode: 'amount',
    }
  }

  if (!product || product.amount <= 0) return null

  return {
    amount: product.amount * commission.rate,
    currency: product.currency,
    mode: 'percent',
    rate: commission.rate,
  }
}

export function parseProductPriceMoney(
  productPrice: string | null | undefined,
  options?: { targetCountry?: string | null; fallbackCurrency?: string | null }
): { amount: number; currency: string } | null {
  const text = String(productPrice || '').trim()
  if (!text) return null

  const parsed = parseMoneyValue(text, {
    targetCountry: options?.targetCountry,
    defaultCurrency: options?.fallbackCurrency,
  })
  if (!parsed) return null

  const strictAmount = parsePrice(text)
  const amount = strictAmount !== null && strictAmount >= 0 ? strictAmount : parsed.amount
  if (amount <= 0) return null

  return {
    amount,
    currency: parsed.currency,
  }
}
