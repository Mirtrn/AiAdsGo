import { NextRequest, NextResponse } from 'next/server'
import { unlinkOfferFromAccount } from '@/lib/offers'

/**
 * POST /api/offers/:id/unlink
 * 手动解除Offer与Ads账号的关联
 * 需求25: 增加Offer手动解除与已关联的Ads账号解除关联的功能
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

    // 从请求体获取要解除关联的Ads账号ID
    const body = await request.json()
    const { accountId } = body

    if (!accountId) {
      return NextResponse.json({ error: '缺少accountId参数' }, { status: 400 })
    }

    // 执行解除关联
    const result = unlinkOfferFromAccount(
      parseInt(id, 10),
      parseInt(accountId, 10),
      parseInt(userId, 10)
    )

    return NextResponse.json({
      success: true,
      message: '成功解除关联',
      data: {
        offerId: parseInt(id, 10),
        accountId: parseInt(accountId, 10),
        unlinkedCampaigns: result.unlinkedCount,
      },
    })
  } catch (error: any) {
    console.error('解除关联失败:', error)

    return NextResponse.json(
      {
        error: error.message || '解除关联失败',
      },
      { status: 500 }
    )
  }
}
