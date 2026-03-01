import { NextRequest, NextResponse } from 'next/server'
import {
  listAffiliateProducts,
  normalizeAffiliatePlatform,
  normalizeAffiliateProductStatusFilter,
  type PlatformProductStats,
  type ProductSortField,
  type ProductSortOrder,
} from '@/lib/affiliate-products'
import {
  buildProductListCacheHash,
  getCachedProductList,
  setLatestProductListQuery,
  setCachedProductList,
} from '@/lib/products-cache'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

const ALLOWED_SORT_FIELDS: Set<ProductSortField> = new Set([
  'serial',
  'platform',
  'mid',
  'asin',
  'createdAt',
  'allowedCountries',
  'priceAmount',
  'commissionRate',
  'commissionAmount',
  'reviewCount',
  'promoLink',
  'relatedOfferCount',
  'updatedAt',
])

function parseNumericFilter(searchParams: URLSearchParams, key: string): number | null {
  const raw = (searchParams.get(key) || '').trim()
  if (!raw) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function parseDateFilter(searchParams: URLSearchParams, key: string): string | null {
  const raw = (searchParams.get(key) || '').trim()
  if (!raw) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null

  const parsed = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.toISOString().slice(0, 10) !== raw) return null
  return raw
}

export async function GET(request: NextRequest) {
  try {
    const userIdRaw = request.headers.get('x-user-id')
    if (!userIdRaw) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    const userId = Number(userIdRaw)
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const pageSize = Math.min(100, Math.max(10, Number(searchParams.get('pageSize') || 20)))
    const search = (searchParams.get('search') || '').trim()
    const mid = (searchParams.get('mid') || '').trim()
    const sortByRaw = (searchParams.get('sortBy') || 'serial') as ProductSortField
    const sortBy = ALLOWED_SORT_FIELDS.has(sortByRaw) ? sortByRaw : 'serial'
    const sortOrder = (searchParams.get('sortOrder') || 'desc').toLowerCase() === 'asc'
      ? 'asc'
      : 'desc' as ProductSortOrder
    const platform = normalizeAffiliatePlatform(searchParams.get('platform')) || 'all'
    const status = normalizeAffiliateProductStatusFilter(searchParams.get('status'))

    const reviewCountMin = parseNumericFilter(searchParams, 'reviewCountMin')
    const reviewCountMax = parseNumericFilter(searchParams, 'reviewCountMax')
    const priceAmountMin = parseNumericFilter(searchParams, 'priceAmountMin')
    const priceAmountMax = parseNumericFilter(searchParams, 'priceAmountMax')
    const commissionRateMin = parseNumericFilter(searchParams, 'commissionRateMin')
    const commissionRateMax = parseNumericFilter(searchParams, 'commissionRateMax')
    const commissionAmountMin = parseNumericFilter(searchParams, 'commissionAmountMin')
    const commissionAmountMax = parseNumericFilter(searchParams, 'commissionAmountMax')
    const createdAtFrom = parseDateFilter(searchParams, 'createdAtFrom')
    const createdAtTo = parseDateFilter(searchParams, 'createdAtTo')

    const noCache = (searchParams.get('noCache') || '').toLowerCase() === 'true'

    const cachePayload = {
      page,
      pageSize,
      search,
      mid,
      sortBy,
      sortOrder,
      platform,
      status,
      reviewCountMin,
      reviewCountMax,
      priceAmountMin,
      priceAmountMax,
      commissionRateMin,
      commissionRateMax,
      commissionAmountMin,
      commissionAmountMax,
      createdAtFrom,
      createdAtTo,
    }
    const cacheHash = buildProductListCacheHash(cachePayload)
    await setLatestProductListQuery(userId, cachePayload)

    if (!noCache) {
      const cached = await getCachedProductList<{
        success: true
        items: any[]
        total: number
        activeProductsCount: number
        invalidProductsCount: number
        syncMissingProductsCount: number
        unknownProductsCount: number
        blacklistedCount: number
        productsWithLinkCount: number
        platformStats: {
          yeahpromos: PlatformProductStats
          partnerboost: PlatformProductStats
        }
        page: number
        pageSize: number
      }>(userId, cacheHash)
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const result = await listAffiliateProducts(userId, {
      page,
      pageSize,
      search,
      mid,
      sortBy,
      sortOrder,
      platform,
      status,
      reviewCountMin: reviewCountMin ?? undefined,
      reviewCountMax: reviewCountMax ?? undefined,
      priceAmountMin: priceAmountMin ?? undefined,
      priceAmountMax: priceAmountMax ?? undefined,
      commissionRateMin: commissionRateMin ?? undefined,
      commissionRateMax: commissionRateMax ?? undefined,
      commissionAmountMin: commissionAmountMin ?? undefined,
      commissionAmountMax: commissionAmountMax ?? undefined,
      createdAtFrom: createdAtFrom ?? undefined,
      createdAtTo: createdAtTo ?? undefined,
      // 列表接口优先保证首屏速度；invalid 汇总由 /api/products/summary 完整计算。
      skipInvalidSummary: true,
      // summary 缓存未命中时，仅计算总数，避免列表接口被重统计阻塞。
      fastSummary: true,
    })

    const responsePayload = {
      success: true as const,
      items: result.items,
      total: result.total,
      productsWithLinkCount: result.productsWithLinkCount,
      activeProductsCount: result.activeProductsCount,
      invalidProductsCount: result.invalidProductsCount,
      syncMissingProductsCount: result.syncMissingProductsCount,
      unknownProductsCount: result.unknownProductsCount,
      blacklistedCount: result.blacklistedCount,
      platformStats: result.platformStats,
      page: result.page,
      pageSize: result.pageSize,
    }

    if (!noCache) {
      await setCachedProductList(userId, cacheHash, responsePayload)
    }

    return NextResponse.json(responsePayload)
  } catch (error: any) {
    console.error('[GET /api/products] failed:', error)
    return NextResponse.json(
      { error: error?.message || '获取商品列表失败' },
      { status: 500 }
    )
  }
}
