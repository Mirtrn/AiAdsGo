import { NextRequest, NextResponse } from 'next/server'
import { createUser } from '@/lib/auth'
import { generateToken } from '@/lib/jwt'
import { z } from 'zod'

const registerSchema = z.object({
  email: z.string().email('无效的邮箱格式'),
  password: z.string().min(8, '密码至少8个字符'),
  displayName: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // 验证输入
    const validationResult = registerSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { email, password, displayName } = validationResult.data

    // 创建用户
    const user = await createUser({
      email,
      password,
      displayName,
    })

    // 生成JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      packageType: user.package_type,
    })

    return NextResponse.json(
      {
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
          packageType: user.package_type,
        },
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('注册失败:', error)

    return NextResponse.json(
      {
        error: error.message || '注册失败，请稍后重试',
      },
      { status: error.message === '该邮箱已被注册' ? 409 : 500 }
    )
  }
}
