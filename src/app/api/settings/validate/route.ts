import { NextRequest, NextResponse } from 'next/server'
import {
  validateGoogleAdsConfig,
  validateGeminiConfig,
  updateValidationStatus,
} from '@/lib/settings'
import { z } from 'zod'

const validateSchema = z.object({
  category: z.string(),
  config: z.record(z.string()),
})

/**
 * POST /api/settings/validate
 * 验证配置
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    const body = await request.json()

    // 验证输入
    const validationResult = validateSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { category, config } = validationResult.data

    let result: { valid: boolean; message: string }

    // 根据分类执行不同的验证逻辑
    switch (category) {
      case 'google_ads':
        result = await validateGoogleAdsConfig(
          config.client_id || '',
          config.client_secret || '',
          config.developer_token || ''
        )

        // 更新验证状态
        if (config.client_id) {
          updateValidationStatus(
            'google_ads',
            'client_id',
            result.valid ? 'valid' : 'invalid',
            result.message,
            userIdNum
          )
        }
        if (config.client_secret) {
          updateValidationStatus(
            'google_ads',
            'client_secret',
            result.valid ? 'valid' : 'invalid',
            result.message,
            userIdNum
          )
        }
        if (config.developer_token) {
          updateValidationStatus(
            'google_ads',
            'developer_token',
            result.valid ? 'valid' : 'invalid',
            result.message,
            userIdNum
          )
        }
        break

      case 'ai':
        if (config.gemini_api_key) {
          // 获取选择的模型，默认使用 gemini-2.5-pro
          const selectedModel = config.gemini_model || 'gemini-2.5-pro'
          result = await validateGeminiConfig(config.gemini_api_key, selectedModel)

          // 更新API密钥验证状态
          updateValidationStatus(
            'ai',
            'gemini_api_key',
            result.valid ? 'valid' : 'invalid',
            result.message,
            userIdNum
          )

          // 更新模型验证状态
          if (config.gemini_model) {
            updateValidationStatus(
              'ai',
              'gemini_model',
              result.valid ? 'valid' : 'invalid',
              result.valid ? `模型 ${selectedModel} 可用` : result.message,
              userIdNum
            )
          }
        } else {
          return NextResponse.json(
            {
              error: '请提供Gemini API密钥',
            },
            { status: 400 }
          )
        }
        break

      case 'proxy':
        // 代理URL格式验证
        if (config.url) {
          const proxyUrl = config.url
          const requiredParams = ['cc', 'ips', 'proxyType=http', 'responseType=txt']
          const missingParams = requiredParams.filter(param => !proxyUrl.includes(param))

          if (missingParams.length > 0) {
            result = {
              valid: false,
              message: `代理URL缺少必要参数: ${missingParams.join(', ')}`,
            }
          } else {
            // 验证URL格式
            try {
              new URL(proxyUrl)
              result = {
                valid: true,
                message: '✅ 代理URL格式正确',
              }
            } catch {
              result = {
                valid: false,
                message: '代理URL格式无效，请检查URL是否正确',
              }
            }
          }
        } else {
          result = {
            valid: true,
            message: '代理配置格式正确',
          }
        }
        break

      default:
        return NextResponse.json(
          {
            error: `不支持的配置分类: ${category}`,
          },
          { status: 400 }
        )
    }

    return NextResponse.json({
      success: true,
      valid: result.valid,
      message: result.message,
    })
  } catch (error: any) {
    console.error('配置验证失败:', error)

    return NextResponse.json(
      {
        error: error.message || '配置验证失败',
      },
      { status: 500 }
    )
  }
}
