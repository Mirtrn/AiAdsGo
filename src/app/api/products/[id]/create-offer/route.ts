import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createOfferFromAffiliateProduct } from '@/lib/affiliate-products'
import { invalidateOfferCache } from '@/lib/api-cache'
import { invalidateProductListCache } from '@/lib/products-cache'
import { isOpenclawEnabledForUser } from '@/lib/openclaw/request-auth'

const bodySchema = z.object({
  targetCountry: z.string().min(2).max(8).optional(),
})

type RouteParams = {
  id: string
}

export async function POST(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
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

    const { id } = await params
    const productId = Number(id)
    if (!Number.isFinite(productId) || productId <= 0) {
      return NextResponse.json({ error: '无效的商品ID' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message || '参数错误' }, { status: 400 })
    }

    const result = await createOfferFromAffiliateProduct({
      userId,
      productId,
      targetCountry: parsed.data.targetCountry,
      createdVia: 'single',
    })

    invalidateOfferCache(userId)
    await invalidateProductListCache(userId)

    return NextResponse.json({
      success: true,
      offerId: result.offerId,
      productId,
      message: 'Offer创建成功',
    })
  } catch (error: any) {
    console.error('[POST /api/products/:id/create-offer] failed:', error)
    return NextResponse.json(
      { error: error?.message || '创建Offer失败' },
      { status: 500 }
    )
  }
}
