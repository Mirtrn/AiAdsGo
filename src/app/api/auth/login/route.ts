import { NextRequest, NextResponse } from 'next/server'
import { loginWithPassword } from '@/lib/auth'
import { z } from 'zod'

const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // 验证输入
    const validationResult = loginSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { username, password } = validationResult.data

    // 登录 (支持用户名或邮箱)
    const result = await loginWithPassword(username, password)

    // 创建响应（需求20：包含must_change_password标识）
    const response = NextResponse.json({
      success: true,
      user: {
        ...result.user,
        mustChangePassword: result.mustChangePassword || false,
      },
    })

    // 设置HttpOnly Cookie（安全的token存储方式）
    response.cookies.set({
      name: 'auth_token',
      value: result.token,
      httpOnly: true, // 防止JavaScript访问，防XSS攻击
      secure: process.env.NODE_ENV === 'production', // 生产环境强制HTTPS
      sameSite: 'lax', // CSRF保护
      maxAge: 60 * 60 * 24 * 7, // 7天过期
      path: '/', // 全站可用
    })

    return response
  } catch (error: any) {
    console.error('登录失败:', error)

    // 根据错误类型返回不同的状态码
    const status =
      error.message === '用户不存在' || error.message === '密码错误'
        ? 401
        : error.message === '账户已被禁用'
        ? 403
        : 500

    return NextResponse.json(
      {
        error: error.message || '登录失败，请稍后重试',
      },
      { status }
    )
  }
}
