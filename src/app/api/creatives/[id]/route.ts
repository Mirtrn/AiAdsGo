import { NextRequest, NextResponse } from 'next/server'
import { findCreativeById, updateCreative, deleteCreative } from '@/lib/creatives'

/**
 * GET /api/creatives/:id
 * 获取单个创意详情
 */
export async function GET(
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

    const creative = findCreativeById(parseInt(id, 10), parseInt(userId, 10))

    if (!creative) {
      return NextResponse.json(
        {
          error: '创意不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      creative,
    })
  } catch (error: any) {
    console.error('获取创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取创意失败',
      },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/creatives/:id
 * 更新创意内容
 */
export async function PUT(
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
      headline1,
      headline2,
      headline3,
      description1,
      description2,
      finalUrl,
      path1,
      path2,
      qualityScore,
    } = body

    // 验证必填字段
    if (headline1 === undefined && description1 === undefined && finalUrl === undefined) {
      return NextResponse.json(
        {
          error: '至少需要提供一个字段进行更新',
        },
        { status: 400 }
      )
    }

    const updates: any = {}
    if (headline1 !== undefined) updates.headline1 = headline1
    if (headline2 !== undefined) updates.headline2 = headline2
    if (headline3 !== undefined) updates.headline3 = headline3
    if (description1 !== undefined) updates.description1 = description1
    if (description2 !== undefined) updates.description2 = description2
    if (finalUrl !== undefined) updates.finalUrl = finalUrl
    if (path1 !== undefined) updates.path1 = path1
    if (path2 !== undefined) updates.path2 = path2
    if (qualityScore !== undefined) updates.qualityScore = qualityScore

    const creative = updateCreative(parseInt(id, 10), parseInt(userId, 10), updates)

    if (!creative) {
      return NextResponse.json(
        {
          error: '创意不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      creative,
    })
  } catch (error: any) {
    console.error('更新创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新创意失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/creatives/:id
 * 删除创意
 */
export async function DELETE(
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

    const success = deleteCreative(parseInt(id, 10), parseInt(userId, 10))

    if (!success) {
      return NextResponse.json(
        {
          error: '创意不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: '创意已删除',
    })
  } catch (error: any) {
    console.error('删除创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '删除创意失败',
      },
      { status: 500 }
    )
  }
}
