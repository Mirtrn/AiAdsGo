import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, saveGoogleAdsCredentials } from '@/lib/google-ads-oauth'

/**
 * GET /api/google-ads/oauth/callback
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
      console.error('OAuth授权失败:', error)
      return NextResponse.redirect(
        new URL(`/settings?error=${encodeURIComponent(error)}`, request.url)
      )
    }

    if (!code) {
      return NextResponse.redirect(
        new URL('/settings?error=missing_code', request.url)
      )
    }

    if (!state) {
      return NextResponse.redirect(
        new URL('/settings?error=missing_state', request.url)
      )
    }

    // 验证state
    let stateData: { user_id: number; timestamp: number }
    try {
      stateData = JSON.parse(
        Buffer.from(state, 'base64url').toString()
      )
    } catch {
      return NextResponse.redirect(
        new URL('/settings?error=invalid_state', request.url)
      )
    }

    // 检查state时间戳（10分钟内有效）
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return NextResponse.redirect(
        new URL('/settings?error=state_expired', request.url)
      )
    }

    // 从数据库获取用户已保存的 Google Ads 配置
    const { getSetting } = await import('@/lib/settings')

    const clientId = getSetting('google_ads', 'client_id', stateData.user_id)?.value
    const clientSecret = getSetting('google_ads', 'client_secret', stateData.user_id)?.value
    const developerToken = getSetting('google_ads', 'developer_token', stateData.user_id)?.value
    const loginCustomerId = getSetting('google_ads', 'login_customer_id', stateData.user_id)?.value

    if (!clientId || !clientSecret || !developerToken) {
      return NextResponse.redirect(
        new URL('/settings?error=missing_google_ads_config&category=google_ads', request.url)
      )
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/google-ads/oauth/callback`

    console.log(`📥 处理OAuth回调`)
    console.log(`   用户: ${stateData.user_id}`)
    console.log(`   Authorization Code: ${code.substring(0, 10)}...`)

    // 交换authorization code获取tokens
    const tokens = await exchangeCodeForTokens(
      code,
      clientId,
      clientSecret,
      redirectUri
    )

    console.log(`✅ OAuth成功获取tokens`)
    console.log(`   Access Token: ${tokens.access_token.substring(0, 10)}...`)
    console.log(`   Refresh Token: ${tokens.refresh_token.substring(0, 10)}...`)

    // 计算 access token 过期时间
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // 保存完整的 Google Ads 凭证到数据库
    const savedCredentials = saveGoogleAdsCredentials(stateData.user_id, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      developer_token: developerToken,
      login_customer_id: loginCustomerId || null,
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
    })

    console.log(`💾 已保存Google Ads凭证到数据库`)
    console.log(`   Credentials ID: ${savedCredentials.id}`)

    // 重定向回 Google Ads 账号管理页面，显示成功提示
    const successUrl = new URL('/google-ads', request.url)
    successUrl.searchParams.set('oauth_success', 'true')

    return NextResponse.redirect(successUrl)

  } catch (error: any) {
    console.error('OAuth回调处理失败:', error)

    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(error.message)}`, request.url)
    )
  }
}
