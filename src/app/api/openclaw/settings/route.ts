import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAuth } from '@/lib/auth'
import { getSettingsByCategory, updateSettings } from '@/lib/settings'
import { isOpenclawEnabledForUser } from '@/lib/openclaw/request-auth'

const USER_SCOPED_KEYS = new Set([
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_bot_name',
  'feishu_domain',
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
  'openclaw_strategy_dry_run',
])

const USER_SYNC_KEYS = new Set([
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_bot_name',
  'feishu_domain',
])

const updateSchema = z.object({
  scope: z.enum(['global', 'user']),
  updates: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
})

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: auth.error || '未授权' }, { status: 401 })
  }

  const openclawEnabled = await isOpenclawEnabledForUser(auth.user.userId)
  if (!openclawEnabled) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启' }, { status: 403 })
  }

  const isAdmin = auth.user.role === 'admin'
  const globalSettingsRaw = await getSettingsByCategory('openclaw')
  const globalSettings = isAdmin
    ? globalSettingsRaw
    : globalSettingsRaw.map(setting => (
      setting.isSensitive ? { ...setting, value: null } : setting
    ))
  const userSettings = (await getSettingsByCategory('openclaw', auth.user.userId))
    .filter(setting => USER_SCOPED_KEYS.has(setting.key))

  return NextResponse.json({
    success: true,
    isAdmin,
    global: globalSettings,
    user: userSettings,
  })
}

export async function PUT(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: auth.error || '未授权' }, { status: 401 })
  }

  const openclawEnabled = await isOpenclawEnabledForUser(auth.user.userId)
  if (!openclawEnabled) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = updateSchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  const { scope, updates } = parsed.data

  if (scope === 'global') {
    if (auth.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    await updateSettings(
      updates.map(item => ({ category: 'openclaw', key: item.key, value: item.value })),
      undefined
    )

    try {
      const { syncOpenclawConfig } = await import('@/lib/openclaw/config')
      await syncOpenclawConfig({ reason: 'openclaw-global-settings', actorUserId: auth.user.userId })
    } catch (error) {
      console.error('❌ OpenClaw配置同步失败:', error)
    }
  } else {
    const invalidKey = updates.find(item => !USER_SCOPED_KEYS.has(item.key))
    if (invalidKey) {
      return NextResponse.json({ error: `不允许修改配置: ${invalidKey.key}` }, { status: 400 })
    }

    await updateSettings(
      updates.map(item => ({ category: 'openclaw', key: item.key, value: item.value })),
      auth.user.userId
    )

    if (updates.some(item => USER_SYNC_KEYS.has(item.key))) {
      try {
        const { syncOpenclawConfig } = await import('@/lib/openclaw/config')
        await syncOpenclawConfig({ reason: 'openclaw-user-settings', actorUserId: auth.user.userId })
      } catch (error) {
        console.error('❌ OpenClaw配置同步失败:', error)
      }
    }
  }

  return NextResponse.json({ success: true })
}
