import { NextRequest, NextResponse } from 'next/server'
import { getAllSettings, getSettingsByCategory, updateSettings } from '@/lib/settings'
import { z } from 'zod'

/**
 * GET /api/settings
 * GET /api/settings?category=google_ads
 * 获取系统配置
 */
export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const category = searchParams.get('category')

    // 根据category参数决定返回全部还是指定分类
    const settings = category
      ? getSettingsByCategory(category, userIdNum)
      : getAllSettings(userIdNum)

    // 按分类分组配置
    const groupedSettings: Record<string, any[]> = {}
    for (const setting of settings) {
      if (!groupedSettings[setting.category]) {
        groupedSettings[setting.category] = []
      }
      groupedSettings[setting.category].push({
        key: setting.key,
        value: setting.value,
        dataType: setting.dataType,
        isSensitive: setting.isSensitive,
        isRequired: setting.isRequired,
        validationStatus: setting.validationStatus,
        validationMessage: setting.validationMessage,
        lastValidatedAt: setting.lastValidatedAt,
        description: setting.description,
      })
    }

    return NextResponse.json({
      success: true,
      settings: groupedSettings,
    })
  } catch (error: any) {
    console.error('获取配置失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取配置失败',
      },
      { status: 500 }
    )
  }
}

const updateSettingsSchema = z.object({
  updates: z.array(
    z.object({
      category: z.string(),
      key: z.string(),
      value: z.string(),
    })
  ),
})

/**
 * PUT /api/settings
 * 批量更新配置
 */
export async function PUT(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    const body = await request.json()

    // 验证输入
    const validationResult = updateSettingsSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { updates } = validationResult.data

    // 更新配置
    updateSettings(updates, userIdNum)

    return NextResponse.json({
      success: true,
      message: `成功更新 ${updates.length} 个配置项`,
    })
  } catch (error: any) {
    console.error('更新配置失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新配置失败',
      },
      { status: 500 }
    )
  }
}
