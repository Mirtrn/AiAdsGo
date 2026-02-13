import { NextRequest, NextResponse } from 'next/server'
import { clearUserSettings, getAllSettings, getSettingsByCategory, updateSettings } from '@/lib/settings'
import { invalidateProxyPoolCache } from '@/lib/offer-utils'
import { GEMINI_PROVIDERS, getGeminiEndpoint, getGeminiApiKeyUrl, type GeminiProvider } from '@/lib/gemini-config'
import { GEMINI_ACTIVE_MODEL, isDeprecatedGeminiModel, normalizeModelForProvider } from '@/lib/gemini-models'
import { getDatabase } from '@/lib/db'
import { z } from 'zod'
import { ProxyProviderRegistry } from '@/lib/proxy/providers/provider-registry'

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
      ? await getSettingsByCategory(category, userIdNum)
      : await getAllSettings(userIdNum)

    // 自动迁移：将用户历史配置中的 Gemini 2.5 Pro / Flash 统一迁移到 Gemini 3 Flash Preview
    if (userIdNum) {
      const db = await getDatabase()
      const rawGeminiModelSetting = await db.queryOne(
        'SELECT value FROM system_settings WHERE user_id = ? AND category = ? AND key = ? LIMIT 1',
        [userIdNum, 'ai', 'gemini_model']
      ) as { value: string | null } | undefined

      if (isDeprecatedGeminiModel(rawGeminiModelSetting?.value)) {
        await updateSettings([
          {
            category: 'ai',
            key: 'gemini_model',
            value: GEMINI_ACTIVE_MODEL,
          },
        ], userIdNum)
      }
    }

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

    // 🔧 2025-12-29: 为 AI 分类添加动态计算字段
    if (groupedSettings['ai']) {
      // 获取 gemini_provider 值
      const providerSetting = groupedSettings['ai'].find(s => s.key === 'gemini_provider')
      const provider = (providerSetting?.value || 'official') as GeminiProvider
      const modelSetting = groupedSettings['ai'].find(s => s.key === 'gemini_model')
      const normalizedModel = normalizeModelForProvider(modelSetting?.value || GEMINI_ACTIVE_MODEL, provider)

      // 添加计算字段：gemini_endpoint
      groupedSettings['ai'].push({
        key: 'gemini_endpoint',
        value: getGeminiEndpoint(provider, normalizedModel),
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: 'Gemini API 端点（系统自动计算，只读）',
      })

      // 添加计算字段：gemini_api_key_url
      groupedSettings['ai'].push({
        key: 'gemini_api_key_url',
        value: getGeminiApiKeyUrl(provider),
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: 'Gemini API Key 获取地址（系统自动计算，只读）',
      })
    }

    // 确保所有核心分类都存在（即使没有配置值）
    const coreCategories = ['google_ads', 'ai', 'proxy', 'system']
    for (const category of coreCategories) {
      if (!groupedSettings[category]) {
        groupedSettings[category] = []
      }
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

    // 🔧 同步更新：AI配置变更时，按“服务商 + 模型”自动填充 gemini_endpoint
    const hasAIUpdate = updates.some(u => u.category === 'ai')
    if (hasAIUpdate) {
      const currentAISettings = userIdNum
        ? await getSettingsByCategory('ai', userIdNum)
        : []
      const aiSettingsMap = new Map(
        currentAISettings.map(setting => [setting.key, setting.value || ''])
      )

      const geminiProviderUpdate = updates.find(u => u.category === 'ai' && u.key === 'gemini_provider')
      const geminiModelUpdate = updates.find(u => u.category === 'ai' && u.key === 'gemini_model')

      const provider = (
        geminiProviderUpdate?.value ||
        aiSettingsMap.get('gemini_provider') ||
        'official'
      ) as GeminiProvider

      const rawModel = geminiModelUpdate?.value ||
        aiSettingsMap.get('gemini_model') ||
        GEMINI_ACTIVE_MODEL
      const normalizedModel = normalizeModelForProvider(rawModel, provider)

      // 强制保持模型与服务商兼容
      if (geminiModelUpdate) {
        geminiModelUpdate.value = normalizedModel
      } else if (normalizedModel !== rawModel) {
        updates.push({
          category: 'ai',
          key: 'gemini_model',
          value: normalizedModel,
        })
      }

      const endpoint = getGeminiEndpoint(provider, normalizedModel)
      const existingEndpointUpdate = updates.find(u => u.category === 'ai' && u.key === 'gemini_endpoint')
      if (existingEndpointUpdate) {
        existingEndpointUpdate.value = endpoint
      } else {
        updates.push({
          category: 'ai',
          key: 'gemini_endpoint',
          value: endpoint,
        })
      }

      console.log(`🔄 根据服务商(${provider})+模型(${normalizedModel})自动更新 gemini_endpoint → ${endpoint}`)
    }

    // 🔥 2026-01-06: 保存前强制校验代理URL（避免客户端校验遗漏导致运行时失败）
    const proxyUrlsUpdate = updates.find(u => u.category === 'proxy' && u.key === 'urls')
    if (proxyUrlsUpdate) {
      let proxyUrls: Array<{ country?: string; url?: string }>
      try {
        proxyUrls = JSON.parse(proxyUrlsUpdate.value)
      } catch (error) {
        return NextResponse.json(
          { error: '代理配置JSON格式错误' },
          { status: 400 }
        )
      }

      if (!Array.isArray(proxyUrls)) {
        return NextResponse.json(
          { error: '代理配置格式错误，应为数组格式' },
          { status: 400 }
        )
      }

      const errors: string[] = []
      for (let i = 0; i < proxyUrls.length; i++) {
        const item = proxyUrls[i]
        const country = (item?.country || '').trim()
        const url = (item?.url || '').trim()

        // 允许用户保存空数组来禁用代理；但数组项必须完整
        if (!country || !url) {
          errors.push(`第${i + 1}个代理配置缺少 country 或 url`)
          continue
        }

        try {
          const provider = ProxyProviderRegistry.getProvider(url)
          const validation = provider.validate(url)
          if (!validation.isValid) {
            errors.push(`第${i + 1}个URL (${country}) 格式错误: ${validation.errors.join(', ')}`)
          }
        } catch (error: any) {
          errors.push(`第${i + 1}个URL (${country}) 不支持: ${error?.message || '未知错误'}`)
        }
      }

      if (errors.length > 0) {
        return NextResponse.json(
          { error: errors.join('；') },
          { status: 400 }
        )
      }
    }

    // 更新配置
    await updateSettings(updates, userIdNum)

    // 🔥 修复（2025-12-11）：如果更新了代理配置，清除代理池缓存
    const hasProxyUpdate = updates.some(u => u.category === 'proxy')
    if (hasProxyUpdate) {
      console.log('🔄 检测到代理配置更新，清除代理池缓存')
      invalidateProxyPoolCache(userIdNum)
    }

    // 🔥 新增：如果更新了Google Ads配置，清除相关缓存
    const hasGoogleAdsUpdate = updates.some(u => u.category === 'google_ads')
    if (hasGoogleAdsUpdate && userIdNum) {
      console.log('🔄 检测到Google Ads配置更新，清除API缓存')
      const { gadsApiCache } = await import('@/lib/cache')
      // 清除该用户的所有Google Ads API缓存
      gadsApiCache.clear()
    }

    // 🔥 新增：如果更新了AI配置，重置Vertex AI客户端
    if (hasAIUpdate) {
      console.log('🔄 检测到AI配置更新，重置Vertex AI客户端')
      const { resetVertexAIClient } = await import('@/lib/gemini-vertex')
      resetVertexAIClient()
    }

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

const deleteAIConfigSchema = z.object({
  category: z.literal('ai'),
  target: z.enum(['vertex', 'gemini-official', 'gemini-relay']),
})

/**
 * DELETE /api/settings
 * 删除（清空）指定类型的用户级配置
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined
    if (!userIdNum) {
      return NextResponse.json({ error: '删除配置需要登录' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = deleteAIConfigSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message, details: parsed.error.errors },
        { status: 400 }
      )
    }

    const { target } = parsed.data

    const keysToClear = (() => {
      switch (target) {
        case 'vertex':
          return ['gcp_project_id', 'gcp_location', 'gcp_service_account_json']
        case 'gemini-official':
          return ['gemini_api_key']
        case 'gemini-relay':
          return ['gemini_relay_api_key']
      }
    })()

    const result = await clearUserSettings('ai', keysToClear, userIdNum)

    // 删除AI配置后，重置Vertex AI客户端（避免继续使用旧环境变量/缓存）
    const { resetVertexAIClient } = await import('@/lib/gemini-vertex')
    resetVertexAIClient()

    return NextResponse.json({
      success: true,
      message: '配置已删除',
      cleared: result.cleared,
      target,
      keys: keysToClear,
    })
  } catch (error: any) {
    console.error('删除配置失败:', error)
    return NextResponse.json(
      { error: error.message || '删除配置失败' },
      { status: 500 }
    )
  }
}
