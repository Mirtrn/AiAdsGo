import { NextRequest, NextResponse } from 'next/server'
import { getGoogleUserInfo } from '@/lib/google-oauth'
import { loginWithGoogle } from '@/lib/auth'

/**
 * GET /api/auth/google/callback
 * Google OAuth回调处理
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const error = searchParams.get('error')

    // 检查是否有错误
    if (error) {
      console.error('Google OAuth错误:', error)
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent('Google登录失败')}`, request.url)
      )
    }

    // 检查是否有授权码
    if (!code) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('缺少授权码'), request.url)
      )
    }

    // 获取Google用户信息
    const googleUser = await getGoogleUserInfo(code)

    // 登录或注册用户
    const result = await loginWithGoogle(googleUser)

    // 重定向到dashboard，携带token
    const dashboardUrl = new URL('/dashboard', request.url)
    dashboardUrl.searchParams.set('token', result.token)

    return NextResponse.redirect(dashboardUrl)
  } catch (error: any) {
    console.error('Google OAuth回调错误:', error)

    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(error.message || 'Google登录失败')}`,
        request.url
      )
    )
  }
}
