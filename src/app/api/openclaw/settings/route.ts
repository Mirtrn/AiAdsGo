import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSettingsByCategory, updateSettings } from '@/lib/settings'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

const USER_SCOPED_KEYS = new Set([
  'ai_models_json',
  'openclaw_models_mode',
  'openclaw_models_bedrock_discovery_json',
  'yeahpromos_token',
  'yeahpromos_site_id',
  'yeahpromos_page',
  'yeahpromos_limit',
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
])

const USER_SYNC_KEYS = new Set([
  'ai_models_json',
  'openclaw_models_mode',
  'openclaw_models_bedrock_discovery_json',
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
  'feishu_groups_json',
  'feishu_accounts_json',
])

const updateSchema = z.object({
  scope: z.literal('user'),
  updates: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
})

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const userSettings = (await getSettingsByCategory('openclaw', auth.user.userId))
    .filter(setting => USER_SCOPED_KEYS.has(setting.key))

  return NextResponse.json({
    success: true,
    isAdmin: auth.user.role === 'admin',
    user: userSettings,
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

  const { updates } = parsed.data

  const invalidKey = updates.find(item => !USER_SCOPED_KEYS.has(item.key))
  if (invalidKey) {
    return NextResponse.json({ error: `不允许修改配置: ${invalidKey.key}` }, { status: 400 })
  }

  await updateSettings(
    updates.map(item => ({ category: 'openclaw', key: item.key, value: item.value })),
    auth.user.userId
  )

  try {
    const { syncOpenclawConfig } = await import('@/lib/openclaw/config')
    const reason = updates.some(item => USER_SYNC_KEYS.has(item.key))
      ? 'openclaw-user-settings'
      : 'openclaw-user-settings-nonsync'
    await syncOpenclawConfig({ reason, actorUserId: auth.user.userId })
  } catch (error) {
    console.error('❌ OpenClaw配置同步失败:', error)
  }

  return NextResponse.json({ success: true })
}
