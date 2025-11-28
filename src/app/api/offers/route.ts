import { NextRequest, NextResponse } from 'next/server'
import { createOffer, listOffers, updateOfferScrapeStatus } from '@/lib/offers'
import { z } from 'zod'
import { apiCache, generateCacheKey, invalidateOfferCache } from '@/lib/api-cache'
import { triggerOfferScraping } from '@/lib/offer-scraping'

const createOfferSchema = z.object({
  url: z.string().url('无效的URL格式'),
  brand: z.string().min(1, '品牌名称不能为空').optional(), // 可选，抓取时自动提取
  category: z.string().optional(),
  target_country: z.string().min(2, '目标国家代码至少2个字符'),
  target_language: z.string().optional(), // 目标语言（如English, Spanish等）
  affiliate_link: z.string().url('无效的联盟链接格式').optional().or(z.literal('')), // 允许空字符串
  brand_description: z.string().optional(),
  unique_selling_points: z.string().optional(),
  product_highlights: z.string().optional(),
  target_audience: z.string().optional(),
  // Final URL字段：存储解析后的最终落地页URL
  final_url: z.string().url('无效的Final URL格式').optional(),
  final_url_suffix: z.string().optional(),
  // 需求28：产品价格和佣金比例（可选）
  product_price: z.string().optional(),
  commission_payout: z.string().optional(),
  // AI分析结果字段（JSON字符串格式）
  review_analysis: z.string().optional(),
  competitor_analysis: z.string().optional(),
  extracted_keywords: z.string().optional(),
  extracted_headlines: z.string().optional(),
  extracted_descriptions: z.string().optional(),
  extraction_metadata: z.string().optional(),
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

    // ⚠️ 智能抓取逻辑：避免重复抓取
    // 判断依据：
    // 1. 如果final_url已存在 → SSE流程已完成基础提取，无需再次抓取
    // 2. 如果final_url为空 → 手动创建场景，需要触发抓取
    if (offer.scrape_status === 'pending') {
      if (offer.final_url) {
        // SSE已完成基础提取（品牌、Final URL），直接标记为completed
        // 即使AI分析失败，基础信息已足够使用
        console.log(`✅ Offer ${offer.id} 已通过SSE完成基础提取，标记为completed`)
        updateOfferScrapeStatus(offer.id, parseInt(userId, 10), 'completed')
      } else {
        // 手动创建场景：final_url为空，需要触发完整抓取
        console.log(`🚀 Offer ${offer.id} 缺少final_url，触发后台抓取`)
        setImmediate(() => {
          triggerOfferScraping(
            offer.id,
            parseInt(userId, 10),
            offer.url,
            offer.brand
          )
        })
      }
    }

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
          // Final URL字段
          finalUrl: offer.final_url,
          finalUrlSuffix: offer.final_url_suffix,
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
        // Final URL字段
        finalUrl: offer.final_url,
        finalUrlSuffix: offer.final_url_suffix,
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
        // P1-11: 关联的Google Ads账号信息
        linkedAccounts: offer.linked_accounts,
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
