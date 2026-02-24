import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import cron from 'node-cron'
import { getSettingsByCategory, getUserOnlySettingsByCategory, updateSettings } from '@/lib/settings'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

const GLOBAL_AI_KEYS = new Set([
  'ai_models_json',
  'openclaw_models_mode',
  'openclaw_models_bedrock_discovery_json',
])

const USER_SCOPED_KEYS = new Set([
  'yeahpromos_token',
  'yeahpromos_site_id',
  'yeahpromos_page',
  'yeahpromos_limit',
  'yeahpromos_request_delay_ms',
  'yeahpromos_rate_limit_max_retries',
  'yeahpromos_rate_limit_base_delay_ms',
  'yeahpromos_rate_limit_max_delay_ms',
  'partnerboost_base_url',
  'partnerboost_token',
  'partnerboost_products_page_size',
  'partnerboost_products_page',
  'partnerboost_products_default_filter',
  'partnerboost_products_country_code',
  'partnerboost_products_brand_id',
  'partnerboost_products_sort',
  'partnerboost_products_asins',
  'partnerboost_products_relationship',
  'partnerboost_products_is_original_currency',
  'partnerboost_products_has_promo_code',
  'partnerboost_products_has_acc',
  'partnerboost_products_filter_sexual_wellness',
  'partnerboost_products_link_batch_size',
  'partnerboost_asin_link_batch_size',
  'partnerboost_request_delay_ms',
  'partnerboost_rate_limit_max_retries',
  'partnerboost_rate_limit_base_delay_ms',
  'partnerboost_rate_limit_max_delay_ms',
  'partnerboost_link_country_code',
  'partnerboost_link_uid',
  'partnerboost_link_return_partnerboost_link',
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_bot_name',
  'feishu_app_secret_file',
  'feishu_domain',
  'feishu_dm_policy',
  'feishu_group_policy',
  'feishu_allow_from',
  'feishu_group_allow_from',
  'feishu_require_mention',
  'feishu_history_limit',
  'feishu_dm_history_limit',
  'feishu_streaming',
  'feishu_block_streaming',
  'feishu_config_writes',
  'feishu_text_chunk_limit',
  'feishu_chunk_mode',
  'feishu_markdown_tables',
  'feishu_media_max_mb',
  'feishu_response_prefix',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
  'feishu_groups_json',
  'feishu_accounts_json',
  'feishu_target',
  'feishu_doc_folder_token',
  'feishu_doc_title_prefix',
  'feishu_bitable_app_token',
  'feishu_bitable_table_id',
  'feishu_bitable_table_name',
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
  'openclaw_strategy_max_offers_per_run',
  'openclaw_strategy_default_budget',
  'openclaw_strategy_max_cpc',
  'openclaw_strategy_min_cpc',
  'openclaw_strategy_daily_budget_cap',
  'openclaw_strategy_daily_spend_cap',
  'openclaw_strategy_target_roas',
  'openclaw_strategy_ads_account_ids',
  'openclaw_strategy_priority_asins',
  'openclaw_strategy_enable_auto_publish',
  'openclaw_strategy_enable_auto_pause',
  'openclaw_strategy_enable_auto_adjust_cpc',
  'openclaw_strategy_allow_affiliate_fetch',
  'openclaw_strategy_enforce_autoads_only',
  'openclaw_strategy_dry_run',
  'openclaw_affiliate_sync_enabled',
  'openclaw_affiliate_sync_interval_hours',
  'openclaw_affiliate_sync_mode',
  'gateway_auth_rate_limit_json',
  'gateway_tools_json',
])

const GLOBAL_SYNC_KEYS = new Set([
  'ai_models_json',
  'openclaw_models_mode',
  'openclaw_models_bedrock_discovery_json',
])

const USER_SYNC_KEYS = new Set([
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_bot_name',
  'feishu_app_secret_file',
  'feishu_domain',
  'feishu_dm_policy',
  'feishu_group_policy',
  'feishu_allow_from',
  'feishu_group_allow_from',
  'feishu_require_mention',
  'feishu_history_limit',
  'feishu_dm_history_limit',
  'feishu_streaming',
  'feishu_block_streaming',
  'feishu_config_writes',
  'feishu_text_chunk_limit',
  'feishu_chunk_mode',
  'feishu_markdown_tables',
  'feishu_media_max_mb',
  'feishu_response_prefix',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
  'feishu_groups_json',
  'feishu_accounts_json',
  'gateway_auth_rate_limit_json',
  'gateway_tools_json',
])

const ALL_ALLOWED_KEYS = new Set([
  ...Array.from(USER_SCOPED_KEYS),
  ...Array.from(GLOBAL_AI_KEYS),
])

const STRATEGY_KEYS = new Set([
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
  'openclaw_strategy_max_offers_per_run',
  'openclaw_strategy_default_budget',
  'openclaw_strategy_max_cpc',
  'openclaw_strategy_min_cpc',
  'openclaw_strategy_daily_budget_cap',
  'openclaw_strategy_daily_spend_cap',
  'openclaw_strategy_target_roas',
  'openclaw_strategy_ads_account_ids',
  'openclaw_strategy_priority_asins',
  'openclaw_strategy_enable_auto_publish',
  'openclaw_strategy_enable_auto_pause',
  'openclaw_strategy_enable_auto_adjust_cpc',
  'openclaw_strategy_allow_affiliate_fetch',
  'openclaw_strategy_enforce_autoads_only',
  'openclaw_strategy_dry_run',
])

type StrategyNumericRule = {
  key: string
  min: number
  max: number
}

const STRATEGY_NUMERIC_RULES: StrategyNumericRule[] = [
  { key: 'openclaw_strategy_max_offers_per_run', min: 1, max: 50 },
  { key: 'openclaw_strategy_default_budget', min: 0.01, max: 1000 },
  { key: 'openclaw_strategy_max_cpc', min: 0.01, max: 20 },
  { key: 'openclaw_strategy_min_cpc', min: 0.01, max: 20 },
  { key: 'openclaw_strategy_daily_budget_cap', min: 1, max: 1000 },
  { key: 'openclaw_strategy_daily_spend_cap', min: 1, max: 100 },
  { key: 'openclaw_strategy_target_roas', min: 0.1, max: 20 },
]

const updateSchema = z.object({
  scope: z.enum(['user', 'global']).default('user'),
  updates: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
})

function parseBooleanSetting(value: string | null | undefined, fallback = false): boolean {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return fallback
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on'
}

function parseStrictPositiveIntegerList(value: string | null | undefined): number[] | null {
  const trimmed = String(value || '').trim()
  if (!trimmed) return []

  let rawEntries: unknown[] = []
  if (/^[\[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) return null
      rawEntries = parsed
    } catch {
      return null
    }
  } else {
    rawEntries = trimmed
      .split(/[\n,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const deduped = new Set<number>()
  for (const entry of rawEntries) {
    const normalized = typeof entry === 'number'
      ? entry
      : (typeof entry === 'string' ? Number(entry.trim()) : Number.NaN)
    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
      return null
    }
    deduped.add(normalized)
  }

  return Array.from(deduped)
}

function parsePriorityAsinList(value: string | null | undefined): string[] | null {
  const trimmed = String(value || '').trim()
  if (!trimmed) return []

  let rawEntries: unknown[] = []
  if (/^[\[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) return null
      rawEntries = parsed
    } catch {
      return null
    }
  } else {
    rawEntries = trimmed
      .split(/[\n,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const deduped = new Set<string>()
  for (const entry of rawEntries) {
    const normalized = String(entry || '').trim().toUpperCase()
    if (!normalized) continue
    if (!/^[A-Z0-9_-]{4,20}$/.test(normalized)) {
      return null
    }
    deduped.add(normalized)
  }
  return Array.from(deduped)
}

function validateMergedStrategySettings(settingMap: Record<string, string>): string | null {
  const cronExpr = String(settingMap.openclaw_strategy_cron || '0 9 * * *').trim() || '0 9 * * *'
  if (!cron.validate(cronExpr)) {
    return '策略 Cron 表达式无效，请使用标准 5 段 Cron'
  }

  const accountIds = parseStrictPositiveIntegerList(settingMap.openclaw_strategy_ads_account_ids)
  if (!accountIds) {
    return 'Ads账号ID格式错误，仅支持正整数（逗号/换行或JSON数组）'
  }

  const enabled = parseBooleanSetting(settingMap.openclaw_strategy_enabled, false)
  if (enabled && accountIds.length === 0) {
    return '启用策略时至少需要配置一个 Ads 账号ID'
  }

  if (!parseBooleanSetting(settingMap.openclaw_strategy_enforce_autoads_only, true)) {
    return 'openclaw_strategy_enforce_autoads_only 必须保持为 true'
  }

  for (const rule of STRATEGY_NUMERIC_RULES) {
    const fallback = rule.key === 'openclaw_strategy_max_offers_per_run'
      ? '3'
      : rule.key === 'openclaw_strategy_default_budget'
        ? '20'
        : rule.key === 'openclaw_strategy_max_cpc'
          ? '1.2'
          : rule.key === 'openclaw_strategy_min_cpc'
            ? '0.1'
            : rule.key === 'openclaw_strategy_daily_budget_cap'
              ? '1000'
              : rule.key === 'openclaw_strategy_daily_spend_cap'
                ? '100'
                : '1'
    const numeric = Number(String(settingMap[rule.key] || fallback).trim())
    if (!Number.isFinite(numeric) || numeric < rule.min || numeric > rule.max) {
      return `${rule.key} 超出可接受范围（${rule.min} ~ ${rule.max}）`
    }
  }

  const minCpc = Number(String(settingMap.openclaw_strategy_min_cpc || '0.1').trim())
  const maxCpc = Number(String(settingMap.openclaw_strategy_max_cpc || '1.2').trim())
  if (minCpc > maxCpc) {
    return 'openclaw_strategy_min_cpc 不能大于 openclaw_strategy_max_cpc'
  }

  const defaultBudget = Number(String(settingMap.openclaw_strategy_default_budget || '20').trim())
  const dailyBudgetCap = Number(String(settingMap.openclaw_strategy_daily_budget_cap || '1000').trim())
  const dailySpendCap = Number(String(settingMap.openclaw_strategy_daily_spend_cap || '100').trim())
  if (defaultBudget > Math.min(dailyBudgetCap, dailySpendCap)) {
    return 'openclaw_strategy_default_budget 不能超过日预算上限和日花费上限'
  }

  const priorityAsins = parsePriorityAsinList(settingMap.openclaw_strategy_priority_asins)
  if (priorityAsins === null) {
    return 'openclaw_strategy_priority_asins 格式错误，仅支持 ASIN 字符串数组'
  }

  return null
}

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const userSettings = (await getUserOnlySettingsByCategory('openclaw', auth.user.userId))
    .filter(setting => USER_SCOPED_KEYS.has(setting.key))
  const globalAiSettings = (await getSettingsByCategory('openclaw'))
    .filter(setting => GLOBAL_AI_KEYS.has(setting.key))

  return NextResponse.json({
    success: true,
    isAdmin: auth.user.role === 'admin',
    userId: auth.user.userId,
    user: [...userSettings, ...globalAiSettings],
  })
}

export async function PUT(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = updateSchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  const { updates, scope } = parsed.data

  const invalidKey = updates.find(item => !ALL_ALLOWED_KEYS.has(item.key))
  if (invalidKey) {
    return NextResponse.json({ error: `不允许修改配置: ${invalidKey.key}` }, { status: 400 })
  }

  const globalUpdates = updates.filter(item => GLOBAL_AI_KEYS.has(item.key))
  const userUpdates = updates.filter(item => USER_SCOPED_KEYS.has(item.key))

  if (scope === 'global' && userUpdates.length > 0) {
    return NextResponse.json({ error: '全局保存仅允许 AI 引擎配置' }, { status: 400 })
  }

  if (scope === 'user' && globalUpdates.length > 0) {
    return NextResponse.json({ error: '用户保存不允许包含全局 AI 配置' }, { status: 400 })
  }

  if (globalUpdates.length > 0 && auth.user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可修改全局 AI 配置' }, { status: 403 })
  }

  if (scope === 'user') {
    const strategyUpdates = userUpdates.filter(item => STRATEGY_KEYS.has(item.key))
    if (strategyUpdates.length > 0) {
      const existingUserSettings = await getUserOnlySettingsByCategory('openclaw', auth.user.userId)
      const mergedStrategyMap = existingUserSettings.reduce<Record<string, string>>((acc, item) => {
        acc[item.key] = item.value || ''
        return acc
      }, {})
      for (const item of strategyUpdates) {
        mergedStrategyMap[item.key] = item.value
      }
      const strategyError = validateMergedStrategySettings(mergedStrategyMap)
      if (strategyError) {
        return NextResponse.json({ error: strategyError }, { status: 400 })
      }
    }
  }

  const templateSettings = await getSettingsByCategory('openclaw')
  const templateKeySet = new Set(templateSettings.map((setting) => setting.key))
  const filteredGlobalUpdates = globalUpdates.filter(item => templateKeySet.has(item.key))
  const filteredUserUpdates = userUpdates.filter(item => templateKeySet.has(item.key))
  const skippedKeys = Array.from(new Set(
    updates
      .filter(item => !templateKeySet.has(item.key))
      .map(item => item.key)
  ))

  if (skippedKeys.length > 0) {
    console.warn('⚠️ OpenClaw配置模板缺失，已跳过保存键:', skippedKeys)
  }

  if (filteredGlobalUpdates.length > 0) {
    await updateSettings(
      filteredGlobalUpdates.map(item => ({ category: 'openclaw', key: item.key, value: item.value }))
    )
  }

  if (filteredUserUpdates.length > 0) {
    await updateSettings(
      filteredUserUpdates.map(item => ({ category: 'openclaw', key: item.key, value: item.value })),
      auth.user.userId
    )
  }

  const appliedUpdates = [...filteredGlobalUpdates, ...filteredUserUpdates]
  if (appliedUpdates.length > 0) {
    try {
      const { syncOpenclawConfig } = await import('@/lib/openclaw/config')
      const hasGlobalSync = appliedUpdates.some(item => GLOBAL_SYNC_KEYS.has(item.key))
      const hasUserSync = appliedUpdates.some(item => USER_SYNC_KEYS.has(item.key))
      const reason = hasGlobalSync
        ? 'openclaw-global-ai-settings'
        : hasUserSync
          ? 'openclaw-user-settings'
          : 'openclaw-user-settings-nonsync'

      await syncOpenclawConfig(
        hasGlobalSync
          ? { reason }
          : { reason, actorUserId: auth.user.userId }
      )
    } catch (error) {
      console.error('❌ OpenClaw配置同步失败:', error)
    }
  }

  return NextResponse.json({
    success: true,
    skippedKeys,
  })
}
