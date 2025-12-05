import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { generateOAuthUrl } from '@/lib/google-ads-oauth'
import { getSetting, getUserOnlySetting } from '@/lib/settings'

/**
 * GET /api/google-ads/oauth/start
 * 启动Google Ads OAuth授权流程
 *
 * 混合模式支持：
 * - 如果用户配置了完整OAuth凭证，使用用户自己的client_id
 * - 如果用户没有配置，使用autoads用户（平台共享）的client_id
 * - login_customer_id 必须由用户自己配置（必填项）
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

    const userId = authResult.user.userId
    const autoadsUserId = 1

    console.log(`🔐 [OAuth Start] 用户ID: ${userId}`)

    // 校验: login_customer_id 必须由用户自己配置（不使用 getSetting，避免回退到全局配置）
    const loginCustomerIdSetting = await getUserOnlySetting('google_ads', 'login_customer_id', userId)
    console.log(`🔐 [OAuth Start] login_customer_id 查询结果:`, JSON.stringify(loginCustomerIdSetting))

    const userLoginCustomerId = loginCustomerIdSetting?.value || ''
    if (!userLoginCustomerId) {
      console.log(`🔐 [OAuth Start] 用户 ${userId} 未配置 login_customer_id`)
      return NextResponse.json(
        { error: '请先在设置页面配置 Login Customer ID (MCC账户ID)，这是使用 Google Ads API 的必填项' },
        { status: 400 }
      )
    }

    // 获取用户的OAuth配置（getSetting已自动解密敏感字段）
    const userClientIdSetting = await getSetting('google_ads', 'client_id', userId)
    const userClientSecretSetting = await getSetting('google_ads', 'client_secret', userId)
    const userDeveloperTokenSetting = await getSetting('google_ads', 'developer_token', userId)

    console.log(`🔐 [OAuth Start] client_id 查询结果:`, JSON.stringify(userClientIdSetting))
    console.log(`🔐 [OAuth Start] client_secret 查询结果:`, JSON.stringify(userClientSecretSetting))
    console.log(`🔐 [OAuth Start] developer_token 查询结果:`, JSON.stringify(userDeveloperTokenSetting))

    const userClientId = userClientIdSetting?.value || ''
    const userClientSecret = userClientSecretSetting?.value || ''
    const userDeveloperToken = userDeveloperTokenSetting?.value || ''

    // 检查用户是否有完整的OAuth配置
    const hasFullOAuthConfig = !!(userClientId && userClientSecret && userDeveloperToken)

    let clientId: string
    let useOwnConfig: boolean

    if (hasFullOAuthConfig) {
      // 用户配置了完整OAuth凭证，使用用户自己的配置
      clientId = userClientId
      useOwnConfig = true
      console.log(`🔐 用户 ${userId} 使用自己的OAuth配置`)
    } else {
      // 用户没有配置完整凭证，使用平台共享配置
      clientId = (await getSetting('google_ads', 'client_id', autoadsUserId))?.value || process.env.GOOGLE_ADS_CLIENT_ID || ''
      useOwnConfig = false
      console.log(`🔐 用户 ${userId} 使用平台共享OAuth配置`)
    }

    if (!clientId) {
      return NextResponse.json(
        { error: '缺少Client ID配置，请先在设置页面配置OAuth凭证或联系管理员' },
        { status: 400 }
      )
    }

    // 生成state用于验证回调，包含是否使用自己配置的标记
    const state = Buffer.from(
      JSON.stringify({
        user_id: userId,
        timestamp: Date.now(),
        use_own_config: useOwnConfig
      })
    ).toString('base64url')

    // 构建redirect URI
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/google-ads/oauth/callback`

    // 生成授权URL
    const authUrl = generateOAuthUrl(clientId, redirectUri, state)

    console.log(`🔐 启动Google Ads OAuth流程`)
    console.log(`   用户: ${authResult.user.email} (ID: ${userId})`)
    console.log(`   使用配置: ${useOwnConfig ? '用户自己的' : '平台共享'}`)
    console.log(`   Client ID: ${clientId.substring(0, 20)}...`)
    console.log(`   Login Customer ID: ${userLoginCustomerId}`)

    return NextResponse.json({
      success: true,
      data: {
        auth_url: authUrl,
        redirect_uri: redirectUri,
        use_own_config: useOwnConfig
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
