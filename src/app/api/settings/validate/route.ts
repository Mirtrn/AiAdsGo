import { NextRequest, NextResponse } from 'next/server'
import {
  validateGoogleAdsConfig,
} from '@/lib/settings'
import { z } from 'zod'
import { ProxyProviderRegistry } from '@/lib/proxy/providers/provider-registry'
import { getAffiliateSyncSettingsMap } from '@/lib/openclaw/settings'
import { validateAffiliateSyncConfig } from '@/lib/affiliate-sync-validation'

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
        break

      case 'ai': {
        if (!userIdNum) {
          return NextResponse.json(
            { error: '验证AI配置需要登录' },
            { status: 401 }
          )
        }

        const { getUserOnlySetting } = await import('@/lib/settings')

        // ─── OpenLLM（LiteLLM）验证 ───────────────────────────
        let litellmApiKey: string
        if (config.litellm_api_key && config.litellm_api_key !== '············') {
          litellmApiKey = config.litellm_api_key
        } else {
          const saved = await getUserOnlySetting('ai', 'litellm_api_key', userIdNum)
          if (!saved?.value) {
            return NextResponse.json({ error: '请先保存 OpenLLM API Key 配置' }, { status: 400 })
          }
          litellmApiKey = saved.value
        }
        const litellmModelRaw = config.litellm_model
          || (await getUserOnlySetting('ai', 'litellm_model', userIdNum))?.value
          || undefined
        const { normalizeLiteLLMModel } = await import('@/lib/gemini-models')
        const litellmModel = normalizeLiteLLMModel(litellmModelRaw)
        const { checkLiteLLMConnection } = await import('@/lib/litellm')
        const ok = await checkLiteLLMConnection(userIdNum, litellmApiKey, undefined, litellmModel)
        result = ok
          ? { valid: true, message: 'OpenLLM 连接验证成功 ✅' }
          : { valid: false, message: `OpenLLM 连接失败：模型 ${litellmModel} 不可用，请换用其他模型或检查 API Key` }
        break
      }

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

      case 'affiliate_sync': {
        if (!userIdNum) {
          return NextResponse.json(
            { error: '验证联盟同步配置需要登录' },
            { status: 401 }
          )
        }

        const savedSettings = await getAffiliateSyncSettingsMap(userIdNum)
        result = await validateAffiliateSyncConfig({
          partnerboostToken: config.partnerboost_token || savedSettings.partnerboost_token,
          partnerboostBaseUrl: config.partnerboost_base_url || savedSettings.partnerboost_base_url,
          yeahpromosToken: config.yeahpromos_token || savedSettings.yeahpromos_token,
          yeahpromosSiteId: config.yeahpromos_site_id || savedSettings.yeahpromos_site_id,
        })
        break
      }

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
