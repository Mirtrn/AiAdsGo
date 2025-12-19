import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/offers/:id/campaigns/status?campaignId=:campaignId
 * 获取单个campaign的创建状态（用于轮询）
 *
 * 响应格式:
 * {
 *   "campaign": {
 *     "id": number,
 *     "offer_id": number,
 *     "creation_status": "pending" | "synced" | "failed",
 *     "creation_error": string | null,
 *     "google_campaign_id": string | null
 *   }
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const campaignId = request.nextUrl.searchParams.get('campaignId')

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    if (!campaignId) {
      return NextResponse.json(
        { error: 'campaignId 参数缺失' },
        { status: 400 }
      )
    }

    // 从数据库查询campaign状态
    const db = await getDatabase()
    const campaign = await db.queryOne(
      `SELECT
        id,
        offer_id,
        creation_status,
        creation_error,
        google_campaign_id
      FROM campaigns
      WHERE id = ? AND offer_id = ? AND user_id = ?`,
      [parseInt(campaignId), parseInt(id), parseInt(userId)]
    ) as any

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      campaign: {
        id: campaign.id,
        offer_id: campaign.offer_id,
        creation_status: campaign.creation_status,
        creation_error: campaign.creation_error,
        google_campaign_id: campaign.google_campaign_id
      }
    })
  } catch (error: any) {
    console.error('获取Campaign状态失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Campaign状态失败',
      },
      { status: 500 }
    )
  }
}
