import { NextRequest, NextResponse } from 'next/server'
import { findOfferById, updateOffer, deleteOffer } from '@/lib/offers'
import { invalidateOfferCache } from '@/lib/api-cache'
import { z } from 'zod'

/**
 * GET /api/offers/:id
 * 获取单个Offer
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const offer = await findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      offer: {
        id: offer.id,
        url: offer.url,
        brand: offer.brand,
        offerName: offer.offer_name, // 🔧 添加offer_name字段映射
        category: offer.category,
        targetCountry: offer.target_country,
        affiliateLink: offer.affiliate_link,
        brandDescription: offer.brand_description,
        uniqueSellingPoints: offer.unique_selling_points,
        productHighlights: offer.product_highlights,
        targetAudience: offer.target_audience,
        // Final URL字段（从推广链接解析后的最终落地页）
        finalUrl: offer.final_url,
        finalUrlSuffix: offer.final_url_suffix,
        scrape_status: offer.scrape_status,
        scrapeError: offer.scrape_error,
        scrapedAt: offer.scraped_at,
        isActive: offer.is_active === 1,
        createdAt: offer.created_at,
        updatedAt: offer.updated_at,
        // AI分析结果字段（仅返回评论分析和竞品分析）
        reviewAnalysis: offer.review_analysis,
        competitorAnalysis: offer.competitor_analysis,
      },
    })
  } catch (error: any) {
    console.error('获取Offer失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Offer失败',
      },
      { status: 500 }
    )
  }
}

const updateOfferSchema = z.object({
  url: z.string().url('无效的URL格式').optional(),
  brand: z.string().min(1, '品牌名称不能为空').optional(),
  category: z.string().optional(),
  target_country: z.string().min(2, '目标国家代码至少2个字符').optional(),
  affiliate_link: z.string().url('无效的联盟链接格式').optional(),
  brand_description: z.string().optional(),
  unique_selling_points: z.string().optional(),
  product_highlights: z.string().optional(),
  target_audience: z.string().optional(),
  is_active: z.boolean().optional(),
})

/**
 * PUT /api/offers/:id
 * 更新Offer
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()

    // 验证输入
    const validationResult = updateOfferSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const offer = await updateOffer(parseInt(id, 10), parseInt(userId, 10), {
      url: validationResult.data.url,
      brand: validationResult.data.brand,
      category: validationResult.data.category,
      target_country: validationResult.data.target_country,
      affiliate_link: validationResult.data.affiliate_link,
      brand_description: validationResult.data.brand_description,
      unique_selling_points: validationResult.data.unique_selling_points,
      product_highlights: validationResult.data.product_highlights,
      target_audience: validationResult.data.target_audience,
      is_active: validationResult.data.is_active,
    })

    // 使缓存失效
    invalidateOfferCache(parseInt(userId, 10), parseInt(id, 10))

    return NextResponse.json({
      success: true,
      offer: {
        id: offer.id,
        url: offer.url,
        brand: offer.brand,
        offerName: offer.offer_name, // 🔧 添加offer_name字段映射
        category: offer.category,
        targetCountry: offer.target_country,
        affiliateLink: offer.affiliate_link,
        brandDescription: offer.brand_description,
        uniqueSellingPoints: offer.unique_selling_points,
        productHighlights: offer.product_highlights,
        targetAudience: offer.target_audience,
        // Final URL字段（从推广链接解析后的最终落地页）
        finalUrl: offer.final_url,
        finalUrlSuffix: offer.final_url_suffix,
        scrape_status: offer.scrape_status,
        isActive: offer.is_active === 1,
        createdAt: offer.created_at,
        updatedAt: offer.updated_at,
      },
    })
  } catch (error: any) {
    console.error('更新Offer失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新Offer失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/offers/:id
 * 删除Offer
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    await deleteOffer(parseInt(id, 10), parseInt(userId, 10))

    // 使缓存失效
    invalidateOfferCache(parseInt(userId, 10), parseInt(id, 10))

    return NextResponse.json({
      success: true,
      message: 'Offer删除成功',
    })
  } catch (error: any) {
    console.error('删除Offer失败:', error)

    // 区分不同类型的错误，返回合适的HTTP状态码
    const errorMessage = error.message || '删除Offer失败'

    // 业务逻辑验证错误：Offer有关联的Campaigns
    if (errorMessage.includes('无法删除Offer：该Offer关联了')) {
      return NextResponse.json(
        {
          error: errorMessage,
        },
        { status: 409 } // 409 Conflict: 资源冲突，无法删除
      )
    }

    // 资源不存在或权限错误
    if (errorMessage.includes('Offer不存在或无权访问')) {
      return NextResponse.json(
        {
          error: errorMessage,
        },
        { status: 404 } // 404 Not Found
      )
    }

    // 其他未知错误，视为服务器内部错误
    return NextResponse.json(
      {
        error: errorMessage,
      },
      { status: 500 }
    )
  }
}
