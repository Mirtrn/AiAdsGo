import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSettingsByCategory, getUserOnlySettingsByCategory, updateSettings } from '@/lib/settings'
import { verifyProductManagementSessionAuth } from '@/lib/openclaw/request-auth'

const PRODUCT_CONFIG_KEYS = new Set([
  'yeahpromos_token',
  'yeahpromos_site_id',
  'partnerboost_token',
  'partnerboost_base_url',
  'openclaw_affiliate_sync_enabled',
  'openclaw_affiliate_sync_interval_hours',
  'openclaw_affiliate_sync_mode',
])

const updateSchema = z.object({
  updates: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
})

export async function GET(request: NextRequest) {
  const auth = await verifyProductManagementSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const userSettings = await getUserOnlySettingsByCategory('openclaw', auth.user.userId)
  const settings = userSettings.filter(setting => PRODUCT_CONFIG_KEYS.has(setting.key))

  return NextResponse.json({
    success: true,
    userId: auth.user.userId,
    settings,
  })
}

export async function PUT(request: NextRequest) {
  const auth = await verifyProductManagementSessionAuth(request)
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
  const invalidKey = updates.find(item => !PRODUCT_CONFIG_KEYS.has(item.key))
  if (invalidKey) {
    return NextResponse.json({ error: `不允许修改配置: ${invalidKey.key}` }, { status: 400 })
  }

  const templateSettings = await getSettingsByCategory('openclaw')
  const templateKeySet = new Set(templateSettings.map((setting) => setting.key))
  const payload = updates
    .filter(item => templateKeySet.has(item.key))
    .map(item => ({
    category: 'openclaw',
    key: item.key,
    value: item.value,
    }))
  const skippedKeys = updates
    .filter(item => !templateKeySet.has(item.key))
    .map(item => item.key)

  if (payload.length > 0) {
    await updateSettings(payload, auth.user.userId)
  }

  return NextResponse.json({
    success: true,
    skippedKeys,
  })
}
