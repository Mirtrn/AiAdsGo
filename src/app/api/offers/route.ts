import { NextRequest, NextResponse } from 'next/server'
import { createOffer, listOffers, updateOfferScrapeStatus } from '@/lib/offers'
import { getDatabase } from '@/lib/db'
import { boolCondition } from '@/lib/db-helpers'
import { toNumber } from '@/lib/utils'
import { z } from 'zod'
import { apiCache, generateCacheKey, invalidateOfferCache } from '@/lib/api-cache'
import { triggerOfferScraping, OfferScrapingPriority } from '@/lib/offer-scraping'
import { withPerformanceMonitoring } from '@/lib/api-performance'

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
  // 🔥 页面类型标识（店铺/单品）
  page_type: z.enum(['store', 'product']).optional(),
  // 店铺模式：最多3个单品推广链接
  store_product_links: z.array(z.string().url('无效的URL格式')).max(3).optional(),
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
async function post(request: NextRequest) {
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

    const pageType = validationResult.data.page_type || 'product'
    let storeProductLinks: string[] | undefined = undefined
    if (pageType === 'store') {
      storeProductLinks = (validationResult.data.store_product_links || [])
        .map((link) => link.trim())
        .filter((link) => Boolean(link))
      storeProductLinks = Array.from(new Set(storeProductLinks)).slice(0, 3)
    }

    const offer = await createOffer(parseInt(userId, 10), {
      ...validationResult.data,
      page_type: pageType,
      store_product_links: storeProductLinks && storeProductLinks.length > 0
        ? JSON.stringify(storeProductLinks)
        : undefined,
    })

    // 使缓存失效
    invalidateOfferCache(parseInt(userId, 10))

    // ⚠️ 智能抓取逻辑：SSE已保存完整数据，避免重复抓取
    // 判断依据：
    // 1. 如果final_url已存在 且 scraped_data有实际内容 → SSE流程已完成，无需再次抓取
    // 2. 如果final_url为空 或 scraped_data为空 → 需要触发抓取
    if (offer.scrape_status === 'pending') {
      const hasScrapedData = offer.scraped_data &&
        typeof offer.scraped_data === 'string' &&
        offer.scraped_data.length > 100 &&
        !offer.scraped_data.includes('"reviews":null')

      if (offer.final_url && hasScrapedData) {
        // ✅ SSE已完成完整分析，所有数据已保存
        // 🎯 智能优化：避免重复抓取，提升用户体验
        // 数据包括：AI产品分析、评论分析、竞品分析、广告元素提取
        console.log(`✅ Offer ${offer.id} SSE已完成完整分析，标记为completed`)
        await updateOfferScrapeStatus(offer.id, parseInt(userId, 10), 'completed')
      } else {
        // 需要触发抓取的场景：
        // 1. final_url为空（手动创建）
        // 2. scraped_data为空或无效（SSE失败）
        // 🎯 优化: 使用URGENT优先级，确保用户手动创建的Offer优先处理
        const reason = !offer.final_url ? '缺少final_url' : '缺少有效scraped_data'
        console.log(`🚀 Offer ${offer.id} ${reason}，触发后台抓取（URGENT优先级）`)
        // 🔥 新队列系统：异步调用，不阻塞API响应
        triggerOfferScraping(
          offer.id,
          parseInt(userId, 10),
          offer.url,
          offer.brand,
          offer.target_country,
          OfferScrapingPriority.URGENT
        ).catch(error => {
          console.error(`[CreateOffer] 触发抓取失败 Offer #${offer.id}:`, error.message)
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
          scrapeStatus: offer.scrape_status,
          // 🔥 修复：兼容PostgreSQL(BOOLEAN)和SQLite(INTEGER)
          isActive: offer.is_active === true || offer.is_active === 1,
          createdAt: offer.created_at,
          // 新增字段（需求1和需求5）
          offerName: offer.offer_name,
          targetLanguage: offer.target_language,
        // 需求28：产品价格和佣金比例
        productPrice: offer.product_price,
        commissionPayout: offer.commission_payout,
        pageType: offer.page_type,
        storeProductLinks: offer.store_product_links,
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
async function get(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const idsParam = searchParams.get('ids') // 批量查询特定ID的Offers
    const summary = searchParams.get('summary') === 'true' // Dashboard等轻量场景仅需概要统计
    const noCache = searchParams.get('noCache') === 'true' || searchParams.get('refresh') === 'true'
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined
    const isActive = searchParams.get('isActive') === 'true' ? true : searchParams.get('isActive') === 'false' ? false : undefined
    const targetCountry = searchParams.get('targetCountry') || undefined
    const searchQuery = searchParams.get('search') || undefined

    // 如果提供了ids参数，直接查询特定的Offers（用于批量上传进度显示）
    if (idsParam) {
      const ids = idsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id))

      if (ids.length === 0) {
        return NextResponse.json({ error: '无效的IDs参数' }, { status: 400 })
      }

      // 批量查询不使用缓存，确保获取最新状态
      const { offers } = await listOffers(parseInt(userId, 10), {
        ids, // 传递IDs参数
        limit: ids.length, // 限制返回数量
      })

      return NextResponse.json({
        success: true,
        offers: offers.map(offer => ({
          id: offer.id,
          brand: offer.brand,
          scrapeStatus: offer.scrape_status,
          scrapeError: offer.scrape_error,
          affiliateLink: offer.affiliate_link,
          targetCountry: offer.target_country,
        })),
        total: offers.length,
      })
    }

    // Dashboard等场景：只需要概要统计，避免拉取完整Offer列表
    if (summary) {
      const db = await getDatabase()
      const userIdNum = parseInt(userId, 10)
      const notDeletedCondition = db.type === 'postgres'
        ? '(is_deleted = false OR is_deleted IS NULL)'
        : '(is_deleted = 0 OR is_deleted IS NULL)'
      const isActiveCondition = boolCondition('is_active', true, db.type)

      const row = await db.queryOne<{
        total: number
        active: number
        pendingScrape: number
      }>(
        `
          SELECT
            COUNT(*) as total,
            COALESCE(SUM(CASE WHEN ${isActiveCondition} THEN 1 ELSE 0 END), 0) as active,
            COALESCE(SUM(CASE WHEN scrape_status = 'pending' THEN 1 ELSE 0 END), 0) as pendingScrape
          FROM offers
          WHERE user_id = ?
            AND ${notDeletedCondition}
        `,
        [userIdNum]
      )

      return NextResponse.json({
        success: true,
        summary: {
          total: toNumber(row?.total),
          active: toNumber(row?.active),
          pendingScrape: toNumber(row?.pendingScrape),
        },
      })
    }

    // 缓存键
    const cacheKey = generateCacheKey('offers', parseInt(userId, 10), {
      limit,
      offset,
      isActive,
      targetCountry,
      searchQuery,
    })

    if (!noCache) {
      // 尝试从缓存获取
      const cached = apiCache.get<any>(cacheKey)
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const { offers, total } = await listOffers(parseInt(userId, 10), {
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
        scrapeStatus: offer.scrape_status,
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
        // P1-11: 关联的Google Ads账号
        linkedAccounts: offer.linked_accounts || [],
        // 🔥 黑名单标记
        isBlacklisted: offer.is_blacklisted || false,
      })),
      total,
      limit,
      offset,
    }

    // 缓存结果（2分钟）
    if (!noCache) {
      apiCache.set(cacheKey, result, 2 * 60 * 1000)
    }

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

export const POST = withPerformanceMonitoring<any>(post, { path: '/api/offers' })
export const GET = withPerformanceMonitoring<any>(get, { path: '/api/offers' })
