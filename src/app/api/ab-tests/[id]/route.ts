import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/ab-tests/[id]
 * 获取A/B测试详情
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const testId = parseInt(params.id)
    const db = getDatabase()

    // 获取测试基本信息
    const test = db.prepare(`
      SELECT
        at.*,
        o.brand as offer_brand,
        o.product_name as offer_product_name,
        o.affiliate_link as offer_link
      FROM ab_tests at
      LEFT JOIN offers o ON at.offer_id = o.id
      WHERE at.id = ? AND at.user_id = ?
    `).get(testId, authResult.user.userId)

    if (!test) {
      return NextResponse.json(
        { error: 'A/B测试不存在或无权访问' },
        { status: 404 }
      )
    }

    // 获取所有变体及其创意信息
    const variants = db.prepare(`
      SELECT
        atv.*,
        ac.headline_1,
        ac.headline_2,
        ac.headline_3,
        ac.description_1,
        ac.description_2,
        ac.final_url,
        ac.image_url
      FROM ab_test_variants atv
      LEFT JOIN ad_creatives ac ON atv.ad_creative_id = ac.id
      WHERE atv.ab_test_id = ?
      ORDER BY atv.is_control DESC, atv.variant_name ASC
    `).all(testId)

    return NextResponse.json({
      success: true,
      test: {
        ...test,
        variants,
      },
    })
  } catch (error: any) {
    console.error('获取A/B测试详情失败:', error)
    return NextResponse.json(
      { error: '获取A/B测试详情失败', message: error.message },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/ab-tests/[id]
 * 更新A/B测试
 */
export async function PUT(
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
    const {
      test_name,
      test_description,
      status,
      start_date,
      end_date,
      min_sample_size,
      confidence_level,
    } = body

    const db = getDatabase()

    // 验证测试所有权
    const test = db.prepare(
      'SELECT * FROM ab_tests WHERE id = ? AND user_id = ?'
    ).get(testId, authResult.user.userId) as any

    if (!test) {
      return NextResponse.json(
        { error: 'A/B测试不存在或无权访问' },
        { status: 404 }
      )
    }

    // 构建更新语句
    const updates: string[] = []
    const values: any[] = []

    if (test_name !== undefined) {
      updates.push('test_name = ?')
      values.push(test_name)
    }

    if (test_description !== undefined) {
      updates.push('test_description = ?')
      values.push(test_description)
    }

    if (status !== undefined) {
      // 验证状态转换
      const validStatuses = ['draft', 'running', 'paused', 'completed', 'cancelled']
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: `无效的状态: ${status}` },
          { status: 400 }
        )
      }

      updates.push('status = ?')
      values.push(status)

      // 如果启动测试，设置开始时间
      if (status === 'running' && !test.start_date) {
        updates.push('start_date = ?')
        values.push(new Date().toISOString())
      }

      // 如果完成测试，设置结束时间
      if (status === 'completed' && !test.end_date) {
        updates.push('end_date = ?')
        values.push(new Date().toISOString())
      }
    }

    if (start_date !== undefined) {
      updates.push('start_date = ?')
      values.push(start_date)
    }

    if (end_date !== undefined) {
      updates.push('end_date = ?')
      values.push(end_date)
    }

    if (min_sample_size !== undefined) {
      updates.push('min_sample_size = ?')
      values.push(min_sample_size)
    }

    if (confidence_level !== undefined) {
      updates.push('confidence_level = ?')
      values.push(confidence_level)
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: '没有需要更新的字段' },
        { status: 400 }
      )
    }

    updates.push('updated_at = datetime(\'now\')')
    values.push(testId)

    const updateQuery = `
      UPDATE ab_tests
      SET ${updates.join(', ')}
      WHERE id = ?
    `

    db.prepare(updateQuery).run(...values)

    // 获取更新后的测试信息
    const updatedTest = db.prepare(`
      SELECT
        at.*,
        o.brand as offer_brand,
        o.product_name as offer_product_name
      FROM ab_tests at
      LEFT JOIN offers o ON at.offer_id = o.id
      WHERE at.id = ?
    `).get(testId) as any

    console.log(`✅ 更新A/B测试成功: ${updatedTest.test_name} (ID: ${testId})`)

    return NextResponse.json({
      success: true,
      message: 'A/B测试更新成功',
      test: updatedTest,
    })
  } catch (error: any) {
    console.error('更新A/B测试失败:', error)
    return NextResponse.json(
      { error: '更新A/B测试失败', message: error.message },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/ab-tests/[id]
 * 删除A/B测试
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const testId = parseInt(params.id)
    const db = getDatabase()

    // 验证测试所有权
    const test = db.prepare(
      'SELECT * FROM ab_tests WHERE id = ? AND user_id = ?'
    ).get(testId, authResult.user.userId) as any

    if (!test) {
      return NextResponse.json(
        { error: 'A/B测试不存在或无权访问' },
        { status: 404 }
      )
    }

    // 不允许删除正在运行的测试
    if (test.status === 'running') {
      return NextResponse.json(
        { error: '无法删除正在运行的测试，请先暂停或完成测试' },
        { status: 400 }
      )
    }

    // 删除测试（级联删除变体）
    db.prepare('DELETE FROM ab_tests WHERE id = ?').run(testId)

    console.log(`✅ 删除A/B测试成功: ${test.test_name} (ID: ${testId})`)

    return NextResponse.json({
      success: true,
      message: 'A/B测试删除成功',
    })
  } catch (error: any) {
    console.error('删除A/B测试失败:', error)
    return NextResponse.json(
      { error: '删除A/B测试失败', message: error.message },
      { status: 500 }
    )
  }
}
