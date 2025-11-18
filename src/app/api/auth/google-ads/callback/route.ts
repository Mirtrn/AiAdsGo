import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/google-ads-api'
import { createGoogleAdsAccount, findGoogleAdsAccountByCustomerId } from '@/lib/google-ads-accounts'

/**
 * GET /api/auth/google-ads/callback
 * Google Ads OAuth回调处理
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // 检查是否有错误
    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent(error)}`
      )
    }

    // 验证必填参数
    if (!code) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=missing_code`
      )
    }

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/login?error=unauthorized`
      )
    }

    // 交换authorization code获取tokens
    const tokens = await exchangeCodeForTokens(code)

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=missing_refresh_token`
      )
    }

    // 解析state参数（如果包含customer_id）
    let customerId: string | null = null
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'))
        customerId = stateData.customerId
      } catch (e) {
        // state解析失败，忽略
      }
    }

    // 如果没有customer_id，需要用户手动输入
    if (!customerId) {
      // 将tokens临时存储在session或cookie中，让用户输入customer_id
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/google-ads/complete-setup?tokens=${encodeURIComponent(
          JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_in: tokens.expires_in,
          })
        )}`
      )
    }

    // 计算token过期时间
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // 检查账号是否已存在
    const existingAccount = findGoogleAdsAccountByCustomerId(customerId, parseInt(userId, 10))

    if (existingAccount) {
      // 更新现有账号的tokens
      const { updateGoogleAdsAccount } = await import('@/lib/google-ads-accounts')
      updateGoogleAdsAccount(existingAccount.id, parseInt(userId, 10), {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
      })
    } else {
      // 创建新账号
      createGoogleAdsAccount({
        userId: parseInt(userId, 10),
        customerId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
      })
    }

    // 重定向到设置页面，显示成功消息
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?success=google_ads_connected`
    )
  } catch (error: any) {
    console.error('Google Ads OAuth callback error:', error)

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent(
        error.message || 'oauth_failed'
      )}`
    )
  }
}
