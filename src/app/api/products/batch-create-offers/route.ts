import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { batchCreateOffersFromAffiliateProducts } from '@/lib/affiliate-products'
import { invalidateOfferCache } from '@/lib/api-cache'
import { invalidateProductListCache } from '@/lib/products-cache'
import { isOpenclawEnabledForUser } from '@/lib/openclaw/request-auth'

const itemSchema = z.object({
  productId: z.number().int().positive(),
  targetCountry: z.string().min(2).max(8).optional(),
})

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(200),
})

export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message || '参数错误' }, { status: 400 })
    }

    const result = await batchCreateOffersFromAffiliateProducts({
      userId,
      items: parsed.data.items,
    })

    invalidateOfferCache(userId)
    await invalidateProductListCache(userId)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[POST /api/products/batch-create-offers] failed:', error)
    return NextResponse.json(
      { error: error?.message || '批量创建Offer失败' },
      { status: 500 }
    )
  }
}
