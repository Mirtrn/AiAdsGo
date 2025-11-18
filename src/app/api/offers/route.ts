import { NextRequest, NextResponse } from 'next/server'
import { createOffer, listOffers } from '@/lib/offers'
import { z } from 'zod'
import { apiCache, generateCacheKey, invalidateOfferCache } from '@/lib/api-cache'

const createOfferSchema = z.object({
  url: z.string().url('无效的URL格式'),
  brand: z.string().min(1, '品牌名称不能为空'),
  category: z.string().optional(),
  target_country: z.string().min(2, '目标国家代码至少2个字符'),
  affiliate_link: z.string().url('无效的联盟链接格式').optional(),
  brand_description: z.string().optional(),
  unique_selling_points: z.string().optional(),
  product_highlights: z.string().optional(),
  target_audience: z.string().optional(),
  // 需求28：产品价格和佣金比例（可选）
  product_price: z.string().optional(),
  commission_payout: z.string().optional(),
})

/**
 * POST /api/offers
 * 创建新Offer
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()

    // 验证输入
    const validationResult = createOfferSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const offer = createOffer(parseInt(userId, 10), validationResult.data)

    // 使缓存失效
    invalidateOfferCache(parseInt(userId, 10))

    return NextResponse.json(
      {
        success: true,
        offer: {
          id: offer.id,
          url: offer.url,
          brand: offer.brand,
          category: offer.category,
          targetCountry: offer.target_country,
          affiliateLink: offer.affiliate_link,
          brandDescription: offer.brand_description,
          uniqueSellingPoints: offer.unique_selling_points,
          productHighlights: offer.product_highlights,
          targetAudience: offer.target_audience,
          scrape_status: offer.scrape_status,
          isActive: offer.is_active === 1,
          createdAt: offer.created_at,
          // 新增字段（需求1和需求5）
          offerName: offer.offer_name,
          targetLanguage: offer.target_language,
          // 需求28：产品价格和佣金比例
          productPrice: offer.product_price,
          commissionPayout: offer.commission_payout,
        },
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('创建Offer失败:', error)

    return NextResponse.json(
      {
        error: error.message || '创建Offer失败',
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/offers
 * GET /api/offers?limit=10&offset=0&isActive=true&targetCountry=US&search=brand
 * 获取Offer列表
 */
export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined
    const isActive = searchParams.get('isActive') === 'true' ? true : searchParams.get('isActive') === 'false' ? false : undefined
    const targetCountry = searchParams.get('targetCountry') || undefined
    const searchQuery = searchParams.get('search') || undefined

    // 缓存键
    const cacheKey = generateCacheKey('offers', parseInt(userId, 10), {
      limit,
      offset,
      isActive,
      targetCountry,
      searchQuery,
    })

    // 尝试从缓存获取
    const cached = apiCache.get<any>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const { offers, total } = listOffers(parseInt(userId, 10), {
      limit,
      offset,
      isActive,
      targetCountry,
      searchQuery,
    })

    const result = {
      success: true,
      offers: offers.map(offer => ({
        id: offer.id,
        url: offer.url,
        brand: offer.brand,
        category: offer.category,
        targetCountry: offer.target_country,
        affiliateLink: offer.affiliate_link,
        brandDescription: offer.brand_description,
        uniqueSellingPoints: offer.unique_selling_points,
        productHighlights: offer.product_highlights,
        targetAudience: offer.target_audience,
        scrape_status: offer.scrape_status,
        scrapeError: offer.scrape_error,
        scrapedAt: offer.scraped_at,
        isActive: offer.is_active === 1,
        createdAt: offer.created_at,
        updatedAt: offer.updated_at,
        // 新增字段（需求1和需求5）
        offerName: offer.offer_name,
        targetLanguage: offer.target_language,
        // 需求28：产品价格和佣金比例
        productPrice: offer.product_price,
        commissionPayout: offer.commission_payout,
      })),
      total,
      limit,
      offset,
    }

    // 缓存结果（2分钟）
    apiCache.set(cacheKey, result, 2 * 60 * 1000)

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('获取Offer列表失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Offer列表失败',
      },
      { status: 500 }
    )
  }
}
