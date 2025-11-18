import { NextRequest, NextResponse } from 'next/server'
import { createOffer } from '@/lib/offers'
import { z } from 'zod'

const batchOfferSchema = z.object({
  url: z.string().url('无效的URL格式'),
  brand: z.string().min(1, '品牌名称不能为空'),
  category: z.string().optional(),
  target_country: z.string().min(2, '目标国家代码至少2个字符'),
  affiliate_link: z.string().url('无效的联盟链接格式').optional().or(z.literal('')),
  product_price: z.string().optional().or(z.literal('')),
  commission_payout: z.string().optional().or(z.literal('')),
  product_currency: z.string().optional().or(z.literal('')),
  brand_description: z.string().optional().or(z.literal('')),
  unique_selling_points: z.string().optional().or(z.literal('')),
  product_highlights: z.string().optional().or(z.literal('')),
  target_audience: z.string().optional().or(z.literal('')),
})

/**
 * POST /api/offers/batch
 * 批量创建Offers
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { offers } = body

    if (!Array.isArray(offers) || offers.length === 0) {
      return NextResponse.json(
        { error: 'offers必须是非空数组' },
        { status: 400 }
      )
    }

    if (offers.length > 100) {
      return NextResponse.json(
        { error: '单次最多上传100条Offer' },
        { status: 400 }
      )
    }

    const results: {
      success: boolean
      row: number
      offer?: any
      error?: string
    }[] = []

    // 逐条验证和创建
    for (let i = 0; i < offers.length; i++) {
      const offerData = offers[i]

      try {
        // 验证数据
        const validationResult = batchOfferSchema.safeParse(offerData)

        if (!validationResult.success) {
          results.push({
            success: false,
            row: i + 1,
            error: validationResult.error.errors[0].message,
          })
          continue
        }

        // 创建Offer
        const offer = createOffer(parseInt(userId, 10), {
          url: validationResult.data.url,
          brand: validationResult.data.brand,
          category: validationResult.data.category || undefined,
          target_country: validationResult.data.target_country,
          affiliate_link: validationResult.data.affiliate_link || undefined,
          brand_description: validationResult.data.brand_description || undefined,
          unique_selling_points: validationResult.data.unique_selling_points || undefined,
          product_highlights: validationResult.data.product_highlights || undefined,
          target_audience: validationResult.data.target_audience || undefined,
        })

        results.push({
          success: true,
          row: i + 1,
          offer: {
            id: offer.id,
            brand: offer.brand,
            url: offer.url,
          },
        })
      } catch (error: any) {
        results.push({
          success: false,
          row: i + 1,
          error: error.message || '创建失败',
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length

    return NextResponse.json({
      success: true,
      summary: {
        total: offers.length,
        success: successCount,
        failed: failureCount,
      },
      results,
    })
  } catch (error: any) {
    console.error('批量创建Offer失败:', error)

    return NextResponse.json(
      {
        error: error.message || '批量创建Offer失败',
      },
      { status: 500 }
    )
  }
}
