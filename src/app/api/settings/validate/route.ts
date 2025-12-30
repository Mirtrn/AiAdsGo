import { NextRequest, NextResponse } from 'next/server'
import {
  validateGoogleAdsConfig,
  validateGeminiConfig,
  validateVertexAIConfig,
  updateValidationStatus,
} from '@/lib/settings'
import { z } from 'zod'
import { ProxyProviderRegistry } from '@/lib/proxy/providers/provider-registry'
import { getCountryName } from '@/lib/proxy/validate-url'

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
        // 🔧 修复(2025-12-24): 优先使用前端传来的AI模式配置
        // 如果前端没有传，才从数据库读取
        if (!userIdNum) {
          return NextResponse.json(
            { error: '验证AI配置需要登录' },
            { status: 401 }
          )
        }

        const { getUserOnlySetting } = await import('@/lib/settings')

        // 🔧 关键修复: 优先使用前端传来的use_vertex_ai值（用户当前选择）
        // 而不是总是从数据库读取（可能是旧值）
        let useVertexAI: boolean
        if (config.use_vertex_ai !== undefined) {
          useVertexAI = config.use_vertex_ai === 'true'
        } else {
          const useVertexAISetting = await getUserOnlySetting('ai', 'use_vertex_ai', userIdNum)
          useVertexAI = useVertexAISetting?.value === 'true'
        }

        if (useVertexAI) {
          // 验证Vertex AI配置
          // 🔧 修复(2025-12-24): 优先使用前端传来的配置，如果前端没传则从数据库读取
          let gcpProjectId: string
          let gcpLocation: string
          let gcpServiceAccountJson: string

          if (config.gcp_project_id && config.gcp_project_id !== '············') {
            gcpProjectId = config.gcp_project_id
          } else {
            const gcpProjectIdSetting = await getUserOnlySetting('ai', 'gcp_project_id', userIdNum)
            if (!gcpProjectIdSetting?.value) {
              return NextResponse.json(
                { error: '请先保存 Vertex AI 配置（GCP项目ID）' },
                { status: 400 }
              )
            }
            gcpProjectId = gcpProjectIdSetting.value
          }

          if (config.gcp_location) {
            gcpLocation = config.gcp_location
          } else {
            const gcpLocationSetting = await getUserOnlySetting('ai', 'gcp_location', userIdNum)
            gcpLocation = gcpLocationSetting?.value || 'us-central1'
          }

          if (config.gcp_service_account_json && config.gcp_service_account_json !== '***已配置***') {
            gcpServiceAccountJson = config.gcp_service_account_json
          } else {
            const gcpServiceAccountJsonSetting = await getUserOnlySetting('ai', 'gcp_service_account_json', userIdNum)
            if (!gcpServiceAccountJsonSetting?.value) {
              return NextResponse.json(
                { error: '请先保存 Vertex AI 配置（Service Account JSON）' },
                { status: 400 }
              )
            }
            gcpServiceAccountJson = gcpServiceAccountJsonSetting.value
          }

          result = await validateVertexAIConfig(
            gcpProjectId,
            gcpLocation,
            gcpServiceAccountJson
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

          updateValidationStatus(
            'ai',
            'gcp_location',
            result.valid ? 'valid' : 'invalid',
            result.valid ? `区域 ${gcpLocation} 可用` : result.message,
            userIdNum
          )
        } else {
          // 验证Gemini直接API配置
          // 🔧 修复(2025-12-30): 根据 gemini_provider 选择验证哪个 API Key
          let geminiApiKey: string
          let geminiRelayApiKey: string
          let selectedModel: string
          let geminiProvider: string

          // 获取用户选择的服务商
          if (config.gemini_provider) {
            geminiProvider = config.gemini_provider
          } else {
            const providerSetting = await getUserOnlySetting('ai', 'gemini_provider', userIdNum)
            geminiProvider = providerSetting?.value || 'official'
          }

          console.log(`🔍 验证AI配置: 服务商=${geminiProvider}`)

          // 根据服务商获取对应的 API Key
          if (geminiProvider === 'relay') {
            // 第三方中转：验证 gemini_relay_api_key
            if (config.gemini_relay_api_key && config.gemini_relay_api_key !== '············') {
              geminiRelayApiKey = config.gemini_relay_api_key
            } else {
              const relayApiKeySetting = await getUserOnlySetting('ai', 'gemini_relay_api_key', userIdNum)
              if (!relayApiKeySetting?.value) {
                return NextResponse.json(
                  { error: '请先保存第三方中转 API Key 配置' },
                  { status: 400 }
                )
              }
              geminiRelayApiKey = relayApiKeySetting.value
            }
            console.log(`🔍 使用中转服务商的 API Key 验证`)
          } else {
            // 官方：验证 gemini_api_key
            if (config.gemini_api_key && config.gemini_api_key !== '············') {
              geminiApiKey = config.gemini_api_key
            } else {
              const apiKeySetting = await getUserOnlySetting('ai', 'gemini_api_key', userIdNum)
              if (!apiKeySetting?.value) {
                return NextResponse.json(
                  { error: '请先保存 Gemini 官方 API Key 配置' },
                  { status: 400 }
                )
              }
              geminiApiKey = apiKeySetting.value
            }
            console.log(`🔍 使用官方服务商的 API Key 验证`)
          }

          // 优先使用前端传来的模型配置
          if (config.gemini_model) {
            selectedModel = config.gemini_model
          } else {
            const geminiModelSetting = await getUserOnlySetting('ai', 'gemini_model', userIdNum)
            if (!geminiModelSetting?.value) {
              return NextResponse.json(
                { error: '请先在AI配置中选择要使用的模型' },
                { status: 400 }
              )
            }
            selectedModel = geminiModelSetting.value
          }

          console.log(`🔍 验证AI配置: 使用模型配置 ${selectedModel}`)

          // 根据服务商选择验证哪个 API Key
          const apiKeyToValidate = geminiProvider === 'relay' ? geminiRelayApiKey! : geminiApiKey!
          const keyFieldToUpdate = geminiProvider === 'relay' ? 'gemini_relay_api_key' : 'gemini_api_key'

          result = await validateGeminiConfig(apiKeyToValidate, selectedModel, userIdNum)

          // 更新对应 API Key 的验证状态
          updateValidationStatus(
            'ai',
            keyFieldToUpdate,
            result.valid ? 'valid' : 'invalid',
            result.message,
            userIdNum
          )

          // 更新模型验证状态
          updateValidationStatus(
            'ai',
            'gemini_model',
            result.valid ? 'valid' : 'invalid',
            result.valid ? `模型 ${selectedModel} 可用` : result.message,
            userIdNum
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

            for (let i = 0; i < proxyUrls.length; i++) {
              const item = proxyUrls[i]
              if (!item.url || !item.country) {
                errors.push(`第${i + 1}个配置缺少必要字段`)
                continue
              }

              // 🔧 调试：记录原始URL
              console.log(`🔍 验证代理 #${i + 1}:`, {
                country: item.country,
                url: item.url,
                urlType: typeof item.url,
                urlLength: item.url.length,
                trimmedUrl: item.url.trim()
              })

              // 🔥 使用新的Provider系统验证URL
              try {
                const trimmedUrl = item.url.trim()
                const provider = ProxyProviderRegistry.getProvider(trimmedUrl)
                const validation = provider.validate(trimmedUrl)

                if (!validation.isValid) {
                  errors.push(`第${i + 1}个URL (${item.country}) 格式错误: ${validation.errors.join(', ')}`)
                } else {
                  console.log(`✅ 第${i + 1}个URL验证通过: ${provider.name} Provider`)
                }
              } catch (error) {
                console.error(`❌ 第${i + 1}个URL验证失败:`, error)
                errors.push(`第${i + 1}个URL (${item.country}) 验证失败:${error instanceof Error ? error.message : String(error)}`)
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
