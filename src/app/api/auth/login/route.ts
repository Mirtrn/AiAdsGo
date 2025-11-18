import { NextRequest, NextResponse } from 'next/server'
import { loginWithPassword } from '@/lib/auth'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email('无效的邮箱格式'),
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

    const { email, password } = validationResult.data

    // 登录
    const result = await loginWithPassword(email, password)

    return NextResponse.json({
      success: true,
      token: result.token,
      user: result.user,
    })
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
