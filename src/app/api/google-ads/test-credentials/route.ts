import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { deleteGoogleAdsTestCredentials, getGoogleAdsTestCredentialStatus } from '@/lib/google-ads-test-credentials'

/**
 * GET /api/google-ads/test-credentials
 * 获取 Google Ads 测试OAuth凭证状态（不影响现有 OAuth 用户授权）
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const status = await getGoogleAdsTestCredentialStatus(authResult.user.userId)
    return NextResponse.json({ success: true, data: status })
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取测试凭证状态失败', message: error.message || '未知错误' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/google-ads/test-credentials
 * 清除（禁用）Google Ads 测试OAuth凭证
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    await deleteGoogleAdsTestCredentials(authResult.user.userId)
    return NextResponse.json({ success: true, message: '测试OAuth凭证已清除' })
  } catch (error: any) {
    return NextResponse.json(
      { error: '清除测试凭证失败', message: error.message || '未知错误' },
      { status: 500 }
    )
  }
}

