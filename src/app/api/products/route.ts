import { NextRequest, NextResponse } from 'next/server'
import {
  listAffiliateProducts,
  normalizeAffiliatePlatform,
  type ProductSortField,
  type ProductSortOrder,
} from '@/lib/affiliate-products'
import {
  buildProductListCacheHash,
  getCachedProductList,
  setCachedProductList,
} from '@/lib/products-cache'
import { isOpenclawEnabledForUser } from '@/lib/openclaw/request-auth'

const ALLOWED_SORT_FIELDS: Set<ProductSortField> = new Set([
  'serial',
  'platform',
  'mid',
  'asin',
  'allowedCountries',
  'priceAmount',
  'commissionRate',
  'commissionAmount',
  'promoLink',
  'relatedOfferCount',
  'updatedAt',
])

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

    const openclawEnabled = await isOpenclawEnabledForUser(userId)
    if (!openclawEnabled) {
      return NextResponse.json({ error: 'OpenClaw 功能未开启' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const pageSize = Math.min(100, Math.max(10, Number(searchParams.get('pageSize') || 20)))
    const search = (searchParams.get('search') || '').trim()
    const sortByRaw = (searchParams.get('sortBy') || 'serial') as ProductSortField
    const sortBy = ALLOWED_SORT_FIELDS.has(sortByRaw) ? sortByRaw : 'serial'
    const sortOrder = (searchParams.get('sortOrder') || 'desc').toLowerCase() === 'asc'
      ? 'asc'
      : 'desc' as ProductSortOrder
    const platform = normalizeAffiliatePlatform(searchParams.get('platform')) || 'all'
    const noCache = (searchParams.get('noCache') || '').toLowerCase() === 'true'

    const cachePayload = {
      page,
      pageSize,
      search,
      sortBy,
      sortOrder,
      platform,
    }
    const cacheHash = buildProductListCacheHash(cachePayload)

    if (!noCache) {
      const cached = await getCachedProductList<{
        success: true
        items: any[]
        total: number
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
      sortBy,
      sortOrder,
      platform,
    })

    const responsePayload = {
      success: true as const,
      items: result.items,
      total: result.total,
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
