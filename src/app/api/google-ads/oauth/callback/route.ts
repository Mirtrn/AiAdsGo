import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, saveGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getSetting } from '@/lib/settings'

/**
 * GET /api/google-ads/oauth/callback
 * Google Ads OAuth回调处理
 *
 * 混合模式支持：
 * - 如果use_own_config=true，使用用户自己的OAuth凭证
 * - 如果use_own_config=false，使用autoads用户的OAuth凭证
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

    // 验证state（包含use_own_config标记）
    let stateData: { user_id: number; timestamp: number; use_own_config?: boolean }
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

    const userId = stateData.user_id
    const useOwnConfig = stateData.use_own_config ?? false
    const autoadsUserId = 1

    // 根据use_own_config决定使用哪套OAuth凭证
    let clientId: string = ''
    let clientSecret: string = ''
    let developerToken: string = ''

    // getSetting已自动解密敏感字段，直接使用.value即可
    if (useOwnConfig) {
      // 用户使用自己的OAuth凭证
      clientId = (await getSetting('google_ads', 'client_id', userId))?.value || ''
      clientSecret = (await getSetting('google_ads', 'client_secret', userId))?.value || ''
      developerToken = (await getSetting('google_ads', 'developer_token', userId))?.value || ''
      console.log(`🔐 OAuth回调: 用户 ${userId} 使用自己的OAuth配置`)
    } else {
      // 使用平台共享的OAuth凭证（autoads用户的配置）
      clientId = (await getSetting('google_ads', 'client_id', autoadsUserId))?.value || process.env.GOOGLE_ADS_CLIENT_ID || ''
      clientSecret = (await getSetting('google_ads', 'client_secret', autoadsUserId))?.value || process.env.GOOGLE_ADS_CLIENT_SECRET || ''
      developerToken = (await getSetting('google_ads', 'developer_token', autoadsUserId))?.value || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''
      console.log(`🔐 OAuth回调: 用户 ${userId} 使用平台共享OAuth配置`)
    }

    // 获取用户的login_customer_id（始终使用用户自己的）
    const loginCustomerId = (await getSetting('google_ads', 'login_customer_id', userId))?.value || ''

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        new URL('/settings?error=missing_google_ads_config&category=google_ads', request.url)
      )
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/google-ads/oauth/callback`

    console.log(`📥 处理OAuth回调`)
    console.log(`   用户: ${userId}`)
    console.log(`   使用配置: ${useOwnConfig ? '用户自己的' : '平台共享'}`)
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

    // 保存凭证到当前用户的记录（无论使用哪套OAuth配置，refresh_token都保存到用户自己的记录）
    const savedCredentials = await saveGoogleAdsCredentials(userId, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      developer_token: developerToken,
      login_customer_id: loginCustomerId,
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
    })

    console.log(`💾 已保存Google Ads凭证到数据库`)
    console.log(`   Credentials ID: ${savedCredentials.id}`)
    console.log(`   用户ID: ${userId}`)

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
