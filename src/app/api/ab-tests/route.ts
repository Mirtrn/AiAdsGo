import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/ab-tests
 * 获取用户的A/B测试列表
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const offerId = searchParams.get('offer_id')
    const status = searchParams.get('status')

    const db = getDatabase()
    let query = `
      SELECT
        at.*,
        o.brand as offer_brand,
        o.brand as offer_product_name,
        COUNT(atv.id) as variant_count
      FROM ab_tests at
      LEFT JOIN offers o ON at.offer_id = o.id
      LEFT JOIN ab_test_variants atv ON at.id = atv.ab_test_id
      WHERE at.user_id = ?
    `

    const params: any[] = [authResult.user.userId]

    if (offerId) {
      query += ' AND at.offer_id = ?'
      params.push(parseInt(offerId))
    }

    if (status) {
      query += ' AND at.status = ?'
      params.push(status)
    }

    query += ' GROUP BY at.id ORDER BY at.created_at DESC'

    const tests = db.prepare(query).all(...params)

    return NextResponse.json({
      success: true,
      tests,
    })
  } catch (error: any) {
    console.error('获取A/B测试列表失败:', error)
    return NextResponse.json(
      { error: '获取A/B测试列表失败', message: error.message },
      { status: 500 }
    )
  }
}

/**
 * POST /api/ab-tests
 * 创建新的A/B测试
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const body = await request.json()
    const {
      offer_id,
      test_name,
      test_description,
      test_type,
      min_sample_size = 100,
      confidence_level = 0.95,
      variants, // Array of { variant_name, ad_creative_id, traffic_allocation, is_control }
    } = body

    // 验证必需参数
    if (!offer_id || !test_name || !test_type) {
      return NextResponse.json(
        { error: '缺少必需参数：offer_id, test_name, test_type' },
        { status: 400 }
      )
    }

    if (!variants || !Array.isArray(variants) || variants.length < 2) {
      return NextResponse.json(
        { error: 'A/B测试至少需要2个变体' },
        { status: 400 }
      )
    }

    // 验证流量分配总和为1
    const totalAllocation = variants.reduce((sum, v) => sum + (v.traffic_allocation || 0), 0)
    if (Math.abs(totalAllocation - 1.0) > 0.01) {
      return NextResponse.json(
        { error: `流量分配总和必须为100% (当前: ${(totalAllocation * 100).toFixed(1)}%)` },
        { status: 400 }
      )
    }

    const db = getDatabase()

    // 开启事务
    db.exec('BEGIN TRANSACTION')

    try {
      // 1. 创建A/B测试
      const insertTest = db.prepare(`
        INSERT INTO ab_tests (
          user_id, offer_id, test_name, test_description,
          test_type, min_sample_size, confidence_level, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
      `)

      const testResult = insertTest.run(
        authResult.user.userId,
        offer_id,
        test_name,
        test_description || null,
        test_type,
        min_sample_size,
        confidence_level
      )

      const testId = testResult.lastInsertRowid

      // 2. 创建测试变体
      const insertVariant = db.prepare(`
        INSERT INTO ab_test_variants (
          ab_test_id, variant_name, variant_label,
          ad_creative_id, traffic_allocation, is_control
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)

      for (const variant of variants) {
        insertVariant.run(
          testId,
          variant.variant_name,
          variant.variant_label || variant.variant_name,
          variant.ad_creative_id,
          variant.traffic_allocation,
          variant.is_control ? 1 : 0
        )
      }

      // 提交事务
      db.exec('COMMIT')

      // 获取完整的测试信息
      const test = db.prepare(`
        SELECT
          at.*,
          o.brand as offer_brand,
          o.brand as offer_product_name
        FROM ab_tests at
        LEFT JOIN offers o ON at.offer_id = o.id
        WHERE at.id = ?
      `).get(testId) as any

      const testVariants = db.prepare(`
        SELECT * FROM ab_test_variants WHERE ab_test_id = ?
      `).all(testId) as any[]

      console.log(`✅ 创建A/B测试成功: ${test_name} (ID: ${testId})`)

      return NextResponse.json({
        success: true,
        message: 'A/B测试创建成功',
        test: {
          ...test,
          variants: testVariants,
        },
      })
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } catch (error: any) {
    console.error('创建A/B测试失败:', error)
    return NextResponse.json(
      { error: '创建A/B测试失败', message: error.message },
      { status: 500 }
    )
  }
}
