import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  saveGoogleAdsCredentials,
  getGoogleAdsCredentials,
  deleteGoogleAdsCredentials,
  verifyGoogleAdsCredentials,
  getUserAuthType
} from '@/lib/google-ads-oauth'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { getDatabase } from '@/lib/db'

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
 * 获取Google Ads凭证状态（包括OAuth和服务账号）
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

    // 1. 检查 OAuth 凭证
    const credentials = await getGoogleAdsCredentials(userId)

    // 2. 检查是否有已激活的服务账号配置
    let hasServiceAccount = false
    let serviceAccountId: string | null = null
    let serviceAccountName: string | null = null
    try {
      const db = await getDatabase()
      const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
      const serviceAccount = await db.queryOne(`
        SELECT id, name FROM google_ads_service_accounts
        WHERE user_id = ? AND ${isActiveCondition}
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId]) as { id: string; name: string } | undefined

      if (serviceAccount) {
        hasServiceAccount = true
        serviceAccountId = serviceAccount.id
        serviceAccountName = serviceAccount.name
      }
    } catch (err) {
      console.error('检查服务账号配置失败:', err)
    }

    // 如果没有 OAuth 凭证且没有服务账号，返回未配置状态
    if (!credentials && !hasServiceAccount) {
      return NextResponse.json({
        success: true,
        data: {
          hasCredentials: false,
          hasRefreshToken: false,
          hasServiceAccount: false,
        }
      })
    }

    const auth = await getUserAuthType(userId)

    // 返回凭证状态（不返回完整的敏感信息）
    return NextResponse.json({
      success: true,
      data: {
        hasCredentials: true,
        clientId: credentials?.client_id,
        developerToken: credentials?.developer_token,
        loginCustomerId: credentials?.login_customer_id,
        hasRefreshToken: !!credentials?.refresh_token,
        hasServiceAccount,
        serviceAccountId,
        serviceAccountName,
        authType: auth.authType,
        lastVerifiedAt: credentials?.last_verified_at,
        isActive: credentials?.is_active === 1,
        createdAt: credentials?.created_at,
        updatedAt: credentials?.updated_at
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
