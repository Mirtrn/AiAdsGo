import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * POST /api/ab-tests/[id]/declare-winner
 * 宣布A/B测试的获胜变体
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const testId = parseInt(params.id)
    const body = await request.json()
    const { winner_variant_id, statistical_confidence } = body

    if (!winner_variant_id) {
      return NextResponse.json(
        { error: '缺少必需参数：winner_variant_id' },
        { status: 400 }
      )
    }

    const db = getDatabase()

    // 验证测试所有权
    const test = db.prepare(
      'SELECT * FROM ab_tests WHERE id = ? AND user_id = ?'
    ).get(testId, authResult.user.userId)

    if (!test) {
      return NextResponse.json(
        { error: 'A/B测试不存在或无权访问' },
        { status: 404 }
      )
    }

    // 验证变体属于该测试
    const variant = db.prepare(
      'SELECT * FROM ab_test_variants WHERE id = ? AND ab_test_id = ?'
    ).get(winner_variant_id, testId) as any

    if (!variant) {
      return NextResponse.json(
        { error: '变体不存在或不属于该测试' },
        { status: 404 }
      )
    }

    // 更新测试状态
    db.prepare(`
      UPDATE ab_tests
      SET
        winner_variant_id = ?,
        statistical_confidence = ?,
        status = 'completed',
        end_date = COALESCE(end_date, datetime('now')),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(winner_variant_id, statistical_confidence || null, testId)

    console.log(
      `✅ 宣布A/B测试获胜变体: 测试 ${testId}, 获胜变体 ${winner_variant_id} (${variant.variant_name})`
    )

    // 获取更新后的测试信息
    const updatedTest = db.prepare(`
      SELECT
        at.*,
        atv.variant_name as winner_variant_name,
        atv.variant_label as winner_variant_label
      FROM ab_tests at
      LEFT JOIN ab_test_variants atv ON at.winner_variant_id = atv.id
      WHERE at.id = ?
    `).get(testId)

    return NextResponse.json({
      success: true,
      message: `已宣布变体 ${variant.variant_name} 为获胜变体`,
      test: updatedTest,
    })
  } catch (error: any) {
    console.error('宣布获胜变体失败:', error)
    return NextResponse.json(
      { error: '宣布获胜变体失败', message: error.message },
      { status: 500 }
    )
  }
}
