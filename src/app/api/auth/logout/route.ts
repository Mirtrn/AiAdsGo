import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/auth/logout
 * 用户登出 - 清除HttpOnly Cookie
 */
export async function POST(request: NextRequest) {
  try {
    // 创建响应
    const response = NextResponse.json({
      success: true,
      message: '登出成功',
    })

    // 清除auth_token cookie
    response.cookies.set({
      name: 'auth_token',
      value: '',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0, // 立即过期
      path: '/',
    })

    return response
  } catch (error: any) {
    console.error('登出失败:', error)

    return NextResponse.json(
      {
        error: error.message || '登出失败，请稍后重试',
      },
      { status: 500 }
    )
  }
}
