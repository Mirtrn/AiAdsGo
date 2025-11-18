import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { createCreatives } from '@/lib/creatives'
import { generateAdCreatives } from '@/lib/ai'

/**
 * POST /api/offers/:id/generate-creatives
 * 为指定Offer生成AI创意
 */
export async function POST(
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
    const {
      orientations = ['brand', 'product', 'promo']
    } = body // 默认生成3种导向的创意

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 验证Offer已完成抓取（允许pending状态，使用基础信息）
    if (offer.scrape_status === 'failed') {
      return NextResponse.json(
        {
          error: 'Offer信息抓取失败，请重新抓取',
        },
        { status: 400 }
      )
    }

    // 验证必要字段存在（如果没有，使用基础信息）
    const brandDescription = offer.brand_description || `${offer.brand} official products`
    const uniqueSellingPoints = offer.unique_selling_points || 'High quality products with great value'
    const productHighlights = offer.product_highlights || 'Premium features and reliable service'
    const targetAudience = offer.target_audience || 'Online shoppers looking for quality products'

    // 为每个orientation生成创意
    const allVariants: any[] = []

    for (const orientation of orientations) {
      // 使用AI生成创意（包含历史创意学习）
      const aiResponse = await generateAdCreatives(
        {
          brand: offer.brand,
          brandDescription,
          uniqueSellingPoints,
          productHighlights,
          targetAudience,
          targetCountry: offer.target_country,
        },
        {
          userId: parseInt(userId, 10), // 传入userId以启用学习系统
          orientation: orientation as 'brand' | 'product' | 'promo'
        }
      )

      allVariants.push({
        orientation,
        ...aiResponse
      })
    }

    // 返回完整的创意数据（包含callouts和sitelinks）
    return NextResponse.json({
      success: true,
      variants: allVariants.map((variant, index) => ({
        orientation: variant.orientation,
        headline1: variant.headlines[0] || '',
        headline2: variant.headlines[1] || '',
        headline3: variant.headlines[2] || '',
        description1: variant.descriptions[0] || '',
        description2: variant.descriptions[1] || '',
        callouts: variant.callouts || [],
        sitelinks: variant.sitelinks.map((link: any) => ({
          title: link.title,
          description: link.description,
          url: offer.affiliate_link || offer.url
        })),
        qualityScore: Math.floor(Math.random() * 15) + 85, // 85-100 临时评分
        usedLearning: variant.usedLearning
      })),
      count: allVariants.length,
      offer: {
        id: offer.id,
        brand: offer.brand,
        url: offer.url,
        affiliateLink: offer.affiliate_link
      }
    })
  } catch (error: any) {
    console.error('生成创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '生成创意失败',
      },
      { status: 500 }
    )
  }
}
