import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  saveGoogleAdsCredentials,
  getGoogleAdsCredentials,
  deleteGoogleAdsCredentials,
  verifyGoogleAdsCredentials
} from '@/lib/google-ads-oauth'
import { getUserOnlySetting } from '@/lib/settings'

/**
 * POST /api/google-ads/credentials
 * 保存Google Ads凭证
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    // 解析请求参数
    const body = await request.json()
    const {
      client_id,
      client_secret,
      refresh_token,
      developer_token,
      login_customer_id,
      access_token,
      access_token_expires_at
    } = body

    // 验证必需参数
    if (!client_id || !client_secret || !refresh_token || !developer_token) {
      return NextResponse.json(
        { error: '缺少必需参数' },
        { status: 400 }
      )
    }

    console.log(`💾 保存Google Ads凭证`)
    console.log(`   用户: ${authResult.user.email}`)
    console.log(`   Developer Token: ${developer_token.substring(0, 10)}...`)

    // 保存凭证
    const credentials = await saveGoogleAdsCredentials(authResult.user.userId, {
      client_id,
      client_secret,
      refresh_token,
      developer_token,
      login_customer_id,
      access_token,
      access_token_expires_at
    })

    console.log(`✅ Google Ads凭证已保存`)

    return NextResponse.json({
      success: true,
      message: 'Google Ads凭证已保存',
      data: {
        id: credentials.id,
        hasCredentials: true
      }
    })

  } catch (error: any) {
    console.error('保存Google Ads凭证失败:', error)

    return NextResponse.json(
      {
        error: '保存Google Ads凭证失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/google-ads/credentials
 * 获取Google Ads凭证状态
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

    const credentials = await getGoogleAdsCredentials(authResult.user.userId)

    // 🔧 修复(2025-12-11): 当用户没有 google_ads_credentials 记录时，
    // 也要检查用户是否在 system_settings 中配置了 login_customer_id，
    // 以及管理员是否有完整的共享配置
    if (!credentials) {
      // 检查用户是否在 system_settings 中配置了 login_customer_id
      const userLoginCustomerId = await getUserOnlySetting('google_ads', 'login_customer_id', authResult.user.userId)

      if (userLoginCustomerId?.value) {
        // 用户配置了 login_customer_id，检查管理员是否有完整的共享配置
        const adminCredentials = await getGoogleAdsCredentials(1) // 1 = autoads管理员
        if (adminCredentials && adminCredentials.refresh_token) {
          // 管理员有 refresh_token，用户可以使用共享配置
          console.log(`✅ 用户 ${authResult.user.userId} 未完成OAuth授权，但配置了 login_customer_id，将使用共享管理员配置`)
          return NextResponse.json({
            success: true,
            data: {
              hasCredentials: true,
              clientId: '', // 用户没有自己的配置
              developerToken: '',
              loginCustomerId: userLoginCustomerId.value,
              hasRefreshToken: true, // 可以使用管理员的 refresh_token
              isActive: true,
              usingSharedConfig: true // 标记使用共享配置
            }
          })
        }
      }

      // 用户没有配置 login_customer_id，或管理员没有共享配置
      return NextResponse.json({
        success: true,
        data: {
          hasCredentials: false
        }
      })
    }

    // 🔧 修复(2025-12-11): 检查是否可以使用共享管理员配置
    // 业务逻辑：
    // 1. 如果用户有自己的 refresh_token，使用用户自己的配置
    // 2. 如果用户没有 refresh_token，但有 login_customer_id，检查管理员（user_id=1）是否有配置
    // 3. 如果管理员有完整配置，则用户可以使用共享配置
    let hasRefreshToken = !!credentials.refresh_token

    if (!hasRefreshToken && credentials.login_customer_id) {
      // 用户没有自己的 refresh_token，但配置了 login_customer_id
      // 检查管理员（user_id=1, autoads）是否有配置
      const adminCredentials = await getGoogleAdsCredentials(1) // 1 = autoads管理员
      if (adminCredentials && adminCredentials.refresh_token) {
        // 管理员有 refresh_token，用户可以使用共享配置
        hasRefreshToken = true
        console.log(`✅ 用户 ${authResult.user.userId} 将使用共享管理员配置`)
      }
    }

    // 返回凭证状态（不返回完整的敏感信息）
    return NextResponse.json({
      success: true,
      data: {
        hasCredentials: true,
        clientId: credentials.client_id,
        developerToken: credentials.developer_token,
        loginCustomerId: credentials.login_customer_id,
        hasRefreshToken: hasRefreshToken, // 🔧 修复：考虑共享管理员配置
        lastVerifiedAt: credentials.last_verified_at,
        isActive: credentials.is_active === 1,
        createdAt: credentials.created_at,
        updatedAt: credentials.updated_at
      }
    })

  } catch (error: any) {
    console.error('获取Google Ads凭证失败:', error)

    return NextResponse.json(
      {
        error: '获取Google Ads凭证失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/google-ads/credentials
 * 删除Google Ads凭证
 */
export async function DELETE(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    deleteGoogleAdsCredentials(authResult.user.userId)

    console.log(`🗑️  已删除Google Ads凭证`)
    console.log(`   用户: ${authResult.user.email}`)

    return NextResponse.json({
      success: true,
      message: 'Google Ads凭证已删除'
    })

  } catch (error: any) {
    console.error('删除Google Ads凭证失败:', error)

    return NextResponse.json(
      {
        error: '删除Google Ads凭证失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}
