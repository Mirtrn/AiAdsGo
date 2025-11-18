/**
 * GET /api/risk-alerts - 获取风险提示列表
 * POST /api/risk-alerts/check-links - 手动检查链接
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  getUserRiskAlerts,
  getRiskStatistics,
  checkAllUserLinks
} from '@/lib/risk-alerts'

/**
 * GET - 获取风险提示列表
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') as any

    // 验证status参数
    if (status && !['active', 'acknowledged', 'resolved'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status parameter' },
        { status: 400 }
      )
    }

    // 获取提示列表
    const alerts = getUserRiskAlerts(auth.user!.userId, status)

    // 获取统计信息
    const statistics = getRiskStatistics(auth.user!.userId)

    return NextResponse.json({
      alerts,
      statistics
    })

  } catch (error) {
    console.error('Get risk alerts error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST - 手动检查所有链接
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 检查所有链接
    const result = await checkAllUserLinks(auth.user!.userId)

    return NextResponse.json({
      success: true,
      result
    })

  } catch (error) {
    console.error('Check links error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
