import { NextRequest, NextResponse } from 'next/server'
import { approveAdCreative, unapproveAdCreative } from '@/lib/ad-creative'

/**
 * POST /api/creatives/:id/approve
 * 批准创意
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

    const creative = approveAdCreative(
      parseInt(id, 10),
      parseInt(userId, 10),
      parseInt(userId, 10) // 批准人ID也是当前用户
    )

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
      message: '创意已批准',
    })
  } catch (error: any) {
    console.error('批准创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '批准创意失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/creatives/:id/approve
 * 取消批准
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

    const creative = unapproveAdCreative(parseInt(id, 10), parseInt(userId, 10))

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
      message: '已取消批准',
    })
  } catch (error: any) {
    console.error('取消批准失败:', error)

    return NextResponse.json(
      {
        error: error.message || '取消批准失败',
      },
      { status: 500 }
    )
  }
}
