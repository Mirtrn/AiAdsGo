import { NextRequest, NextResponse } from 'next/server'
import {
  validateGoogleAdsConfig,
  validateGeminiConfig,
  validateVertexAIConfig,
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
        // 检查是否验证Vertex AI配置
        if (config.gcp_project_id && config.gcp_service_account_json) {
          // 验证Vertex AI配置
          const gcpLocation = config.gcp_location || 'us-central1'
          result = await validateVertexAIConfig(
            config.gcp_project_id,
            gcpLocation,
            config.gcp_service_account_json
          )

          // 更新Vertex AI验证状态
          updateValidationStatus(
            'ai',
            'gcp_project_id',
            result.valid ? 'valid' : 'invalid',
            result.message,
            userIdNum
          )

          updateValidationStatus(
            'ai',
            'gcp_service_account_json',
            result.valid ? 'valid' : 'invalid',
            result.message,
            userIdNum
          )

          if (config.gcp_location) {
            updateValidationStatus(
              'ai',
              'gcp_location',
              result.valid ? 'valid' : 'invalid',
              result.valid ? `区域 ${gcpLocation} 可用` : result.message,
              userIdNum
            )
          }
        } else if (config.gemini_api_key) {
          // 验证Gemini直接API配置
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
              error: '请提供 Gemini API密钥 或 Vertex AI配置',
            },
            { status: 400 }
          )
        }
        break

      case 'proxy':
        // 代理URL列表验证（JSON格式）
        if (config.urls) {
          try {
            const proxyUrls = JSON.parse(config.urls)

            if (!Array.isArray(proxyUrls)) {
              result = {
                valid: false,
                message: '代理配置格式错误，应为数组格式',
              }
              break
            }

            if (proxyUrls.length === 0) {
              result = {
                valid: true,
                message: '未配置代理URL，代理功能已禁用',
              }
              break
            }

            const errors: string[] = []
            const requiredParams = ['cc', 'ips', 'proxyType=http', 'responseType=txt']

            for (let i = 0; i < proxyUrls.length; i++) {
              const item = proxyUrls[i]
              if (!item.url || !item.country) {
                errors.push(`第${i + 1}个配置缺少必要字段`)
                continue
              }

              const missingParams = requiredParams.filter(param => !item.url.includes(param))
              if (missingParams.length > 0) {
                errors.push(`第${i + 1}个URL (${item.country}) 缺少参数: ${missingParams.join(', ')}`)
              }

              try {
                new URL(item.url)
              } catch {
                errors.push(`第${i + 1}个URL (${item.country}) 格式无效`)
              }
            }

            if (errors.length > 0) {
              result = {
                valid: false,
                message: errors.join('；'),
              }
            } else {
              result = {
                valid: true,
                message: `✅ 已配置 ${proxyUrls.length} 个代理URL，格式验证通过`,
              }
            }
          } catch {
            result = {
              valid: false,
              message: '代理配置JSON解析失败',
            }
          }
        } else {
          result = {
            valid: true,
            message: '未配置代理URL，代理功能已禁用',
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
