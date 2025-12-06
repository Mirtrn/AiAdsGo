import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { z } from 'zod'

/**
 * GET /api/ad-creatives?offer_id=X
 * 获取指定Offer的所有广告创意列表
 */
export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const offerId = searchParams.get('offer_id')

    if (!offerId) {
      return NextResponse.json(
        { error: 'offer_id参数不能为空' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 查询该Offer的所有广告创意
    const creatives = await db.query(
      `
      SELECT
        id, offer_id, user_id,
        headlines, descriptions, keywords, keywords_with_volume, negative_keywords,
        callouts, sitelinks, final_url, final_url_suffix,
        score, score_breakdown, ad_strength, launch_score,
        theme, ai_model, generation_round,
        ad_group_id, ad_id, creation_status, creation_error, last_sync_at,
        created_at, updated_at
      FROM ad_creatives
      WHERE offer_id = ? AND user_id = ?
      ORDER BY
        CASE
          WHEN launch_score IS NOT NULL THEN launch_score
          ELSE score
        END DESC,
        created_at DESC
    `,
      [parseInt(offerId, 10), parseInt(userId, 10)]
    )

    return NextResponse.json({
      success: true,
      creatives,
      count: creatives.length,
    })
  } catch (error: any) {
    console.error('获取广告创意列表失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取广告创意列表失败',
      },
      { status: 500 }
    )
  }
}

const createCreativeSchema = z.object({
  offer_id: z.number().int().positive(),
  headlines: z.array(z.string()).min(3).max(15),
  descriptions: z.array(z.string()).min(2).max(4),
  keywords: z.array(z.string()).optional(),
  keywords_with_volume: z.string().optional(),
  negative_keywords: z.array(z.string()).optional(),
  callouts: z.array(z.string()).optional(),
  sitelinks: z
    .array(
      z.object({
        text: z.string(),
        url: z.string().url(),
        description: z.string().optional(),
      })
    )
    .optional(),
  final_url: z.string().url(),
  final_url_suffix: z.string().optional(),
  score: z.number().min(0).max(100).optional(),
  score_breakdown: z.string().optional(),
  ad_strength: z.string().optional(),
  theme: z.string().optional(),
  ai_model: z.string().optional(),
  generation_round: z.number().int().optional(),
})

/**
 * POST /api/ad-creatives
 * 创建新的广告创意（支持手动创建或AI生成）
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
    const validationResult = createCreativeSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const data = validationResult.data

    // 验证Offer是否存在且属于该用户
    const db = await getDatabase()
    const offer = await db.queryOne(
      'SELECT id FROM offers WHERE id = ? AND user_id = ?',
      [data.offer_id, parseInt(userId, 10)]
    )

    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 插入广告创意记录
    const now = new Date().toISOString()
    const result = await db.exec(
      `
      INSERT INTO ad_creatives (
        user_id, offer_id,
        headlines, descriptions, keywords, keywords_with_volume, negative_keywords,
        callouts, sitelinks, final_url, final_url_suffix,
        score, score_breakdown, ad_strength,
        theme, ai_model, generation_round,
        creation_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `,
      [
        parseInt(userId, 10),
        data.offer_id,
        JSON.stringify(data.headlines),
        JSON.stringify(data.descriptions),
        JSON.stringify(data.keywords || []),
        data.keywords_with_volume || null,
        JSON.stringify(data.negative_keywords || []),
        JSON.stringify(data.callouts || []),
        JSON.stringify(data.sitelinks || []),
        data.final_url,
        data.final_url_suffix || null,
        data.score || null,
        data.score_breakdown || null,
        data.ad_strength || null,
        data.theme || null,
        data.ai_model || null,
        data.generation_round || null,
        now,
        now,
      ]
    )

    const creativeId = Number(result.lastInsertRowid)

    // 查询创建的记录并返回
    const creative = await db.queryOne(
      `
      SELECT
        id, offer_id, user_id,
        headlines, descriptions, keywords, keywords_with_volume, negative_keywords,
        callouts, sitelinks, final_url, final_url_suffix,
        score, score_breakdown, ad_strength, launch_score,
        theme, ai_model, generation_round,
        ad_group_id, ad_id, creation_status, creation_error, last_sync_at,
        created_at, updated_at
      FROM ad_creatives
      WHERE id = ?
    `,
      [creativeId]
    )

    return NextResponse.json({
      success: true,
      creative,
    })
  } catch (error: any) {
    console.error('创建广告创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '创建广告创意失败',
      },
      { status: 500 }
    )
  }
}
