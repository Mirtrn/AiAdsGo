import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { generateOAuthUrl } from '@/lib/google-ads-oauth'

/**
 * GET /api/google-ads/oauth/start
 * 启动Google Ads OAuth授权流程
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('client_id')

    if (!clientId) {
      return NextResponse.json(
        { error: '缺少client_id参数' },
        { status: 400 }
      )
    }

    // 生成state用于验证回调
    const state = Buffer.from(
      JSON.stringify({
        user_id: authResult.user.userId,
        timestamp: Date.now()
      })
    ).toString('base64url')

    // 构建redirect URI
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/google-ads/oauth/callback`

    // 生成授权URL
    const authUrl = generateOAuthUrl(clientId, redirectUri, state)

    console.log(`🔐 启动Google Ads OAuth流程`)
    console.log(`   用户: ${authResult.user.email}`)
    console.log(`   Client ID: ${clientId}`)

    return NextResponse.json({
      success: true,
      data: {
        auth_url: authUrl,
        redirect_uri: redirectUri
      }
    })

  } catch (error: any) {
    console.error('启动OAuth流程失败:', error)

    return NextResponse.json(
      {
        error: '启动OAuth流程失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}
