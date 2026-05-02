import { NextRequest, NextResponse } from 'next/server'
import { clearUserSettings, getAllSettings, getSettingsByCategory, updateSettings } from '@/lib/settings'
import { invalidateProxyPoolCache } from '@/lib/offer-utils'
import { getDatabase } from '@/lib/db'
import { z } from 'zod'
import { ProxyProviderRegistry } from '@/lib/proxy/providers/provider-registry'
import { getFixedAffiliateSyncSettingValue } from '@/lib/affiliate-sync-config'

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

    if (groupedSettings['affiliate_sync']) {
      groupedSettings['affiliate_sync'] = groupedSettings['affiliate_sync'].map((setting) => {
        const fixedValue = getFixedAffiliateSyncSettingValue(setting.key)
        if (fixedValue === undefined) return setting
        return {
          ...setting,
          value: fixedValue,
        }
      })
    }


    // 确保所有核心分类都存在（即使没有配置值）
    const coreCategories = ['google_ads', 'ai', 'proxy', 'system', 'affiliate_sync']
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

    for (const update of updates) {
      if (update.category !== 'affiliate_sync') continue
      const fixedValue = getFixedAffiliateSyncSettingValue(update.key)
      if (fixedValue !== undefined) {
        update.value = fixedValue
      }
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
  target: z.enum(['litellm']),
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
        case 'litellm':
          return ['litellm_api_key']
      }
    })()

    const result = await clearUserSettings('ai', keysToClear, userIdNum)

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
