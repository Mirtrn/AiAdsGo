'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TrendChartDynamic } from '@/components/charts/dynamic'
import { toast } from 'sonner'

type SettingItem = {
  key: string
  value: string | null
  dataType: string
  description?: string | null
  isSensitive?: boolean
}

type OpenclawSettingsResponse = {
  success: boolean
  isAdmin: boolean
  user: SettingItem[]
}

type TokenRecord = {
  id: number
  name: string | null
  status: string
  created_at: string
  last_used_at: string | null
}

type DailyReport = {
  date: string
  generatedAt: string
  summary?: any
  kpis?: any
  trends?: any
  roi?: any
  campaigns?: any
  budget?: any
  performance?: any
  actions?: any[]
  strategyActions?: any[]
  strategyRun?: any
  errors?: Array<{ source: string; message: string }>
}

type StrategyStatusResponse = {
  success: boolean
  run: any | null
  actions: any[]
  asinStats?: Record<string, number>
}

type GatewayStatusResponse = {
  success: boolean
  fetchedAt?: string
  health?: any | null
  skills?: any | null
  errors?: string[]
  error?: string
}

type AsinInputRecord = {
  id: number
  source: string
  filename: string | null
  file_type: string | null
  status: string
  total_items: number
  parsed_items: number
  error_message: string | null
  created_at: string
}

type AsinItemRecord = {
  id: number
  input_id: number | null
  asin: string | null
  country_code: string | null
  status: string
  priority: number | null
  offer_id: number | null
  error_message: string | null
  created_at: string
}

type AsinDataResponse = {
  success: boolean
  inputs: AsinInputRecord[]
  items: AsinItemRecord[]
  stats: Record<string, number>
}

const AI_MINIMAL_PLACEHOLDER = `{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "YOUR_API_KEY",
      "api": "openai-responses",
      "models": [
        { "id": "gpt-5-mini", "name": "GPT-5 Mini" }
      ]
    }
  }
}`

const FEISHU_GROUPS_PLACEHOLDER = `{
  "*": { "requireMention": true },
  "oc_xxx": {
    "requireMention": false,
    "systemPrompt": "You are the AutoAds assistant.",
    "skills": ["autoads"]
  }
}`

const FEISHU_ACCOUNTS_PLACEHOLDER = `{
  "main": {
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "botName": "AutoAds",
    "cardCallbackPath": "/feishu/card-action",
    "cardVerificationToken": "your_feishu_verification_token",
    "cardEncryptKey": "your_feishu_encrypt_key",
    "cardConfirmUrl": "https://your-domain.com/api/openclaw/commands/confirm",
    "cardConfirmAuthToken": "your_openclaw_gateway_token",
    "cardConfirmTimeoutMs": 10000
  },
  "backup": { "appId": "cli_yyy", "appSecret": "yyy", "enabled": false }
}`

const STRATEGY_EXAMPLE_VALUES: Record<string, string> = {
  openclaw_strategy_enabled: 'true',
  openclaw_strategy_cron: '0 9 * * *',
  openclaw_strategy_max_offers_per_run: '3',
  openclaw_strategy_default_budget: '20',
  openclaw_strategy_max_cpc: '1.2',
  openclaw_strategy_min_cpc: '0.1',
  openclaw_strategy_daily_budget_cap: '1000',
  openclaw_strategy_daily_spend_cap: '100',
  openclaw_strategy_target_roas: '1',
  openclaw_strategy_ads_account_ids: '[]',
  openclaw_strategy_priority_asins: '[]',
  openclaw_strategy_enable_auto_publish: 'true',
  openclaw_strategy_enable_auto_pause: 'true',
  openclaw_strategy_enable_auto_adjust_cpc: 'true',
  openclaw_strategy_allow_affiliate_fetch: 'true',
  openclaw_strategy_enforce_autoads_only: 'true',
  openclaw_strategy_dry_run: 'false',
}

const STRATEGY_PRESET_OPTIONS: Array<{
  id: string
  label: string
  description: string
  values: Record<string, string>
}> = [
  {
    id: 'balanced',
    label: '平衡（推荐）',
    description: '默认自动化方案，兼顾成本与产出。',
    values: STRATEGY_EXAMPLE_VALUES,
  },
  {
    id: 'conservative',
    label: '稳健',
    description: '更低预算与出价，适合先观察数据。',
    values: {
      ...STRATEGY_EXAMPLE_VALUES,
      openclaw_strategy_max_offers_per_run: '2',
      openclaw_strategy_default_budget: '15',
      openclaw_strategy_max_cpc: '0.8',
      openclaw_strategy_daily_budget_cap: '600',
      openclaw_strategy_daily_spend_cap: '60',
      openclaw_strategy_target_roas: '1.5',
    },
  },
  {
    id: 'aggressive',
    label: '进取',
    description: '更高预算与覆盖，适合快速放量。',
    values: {
      ...STRATEGY_EXAMPLE_VALUES,
      openclaw_strategy_max_offers_per_run: '6',
      openclaw_strategy_default_budget: '40',
      openclaw_strategy_max_cpc: '1.8',
      openclaw_strategy_min_cpc: '0.2',
      openclaw_strategy_daily_budget_cap: '1000',
      openclaw_strategy_daily_spend_cap: '100',
      openclaw_strategy_target_roas: '0.8',
    },
  },
]

const STRATEGY_CRON_OPTIONS: Array<{ id: string; label: string; cron: string }> = [
  { id: 'daily_morning', label: '每天 09:00（推荐）', cron: '0 9 * * *' },
  { id: 'weekday_morning', label: '工作日 09:00', cron: '0 9 * * 1-5' },
  { id: 'every_6_hours', label: '每 6 小时', cron: '0 */6 * * *' },
  { id: 'hourly', label: '每小时', cron: '0 * * * *' },
  { id: 'custom', label: '自定义 Cron', cron: '' },
]

const FEISHU_DOC_EXAMPLE_VALUES: Record<string, string> = {
  feishu_doc_title_prefix: 'OpenClaw 每日报表',
  feishu_bitable_table_name: 'OpenClaw Daily Report',
}

const FEISHU_BASIC_EXAMPLE_VALUES: Record<string, string> = {
  feishu_domain: 'feishu',
  feishu_bot_name: 'AutoAds 助手',
}

const AUTOADS_ONLY_SETTING_KEY = 'openclaw_strategy_enforce_autoads_only'

const AI_USER_KEYS = [
  'ai_models_json',
] as const

const FEISHU_CHAT_USER_KEYS = [
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
  'feishu_app_secret_file',
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
] as const

const AFFILIATE_USER_KEYS = [
  'yeahpromos_token',
  'yeahpromos_site_id',
  'yeahpromos_page',
  'yeahpromos_limit',
  'partnerboost_base_url',
  'partnerboost_token',
  'partnerboost_products_country_code',
  'partnerboost_link_country_code',
  'partnerboost_link_uid',
] as const

const STRATEGY_USER_KEYS = [
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
] as const

const USER_KEYS = new Set([
  ...AI_USER_KEYS,
  ...AFFILIATE_USER_KEYS,
  'partnerboost_products_page_size',
  'partnerboost_products_page',
  'partnerboost_products_default_filter',
  'partnerboost_products_brand_id',
  'partnerboost_products_sort',
  'partnerboost_products_asins',
  'partnerboost_products_relationship',
  'partnerboost_products_is_original_currency',
  'partnerboost_products_has_promo_code',
  'partnerboost_products_has_acc',
  'partnerboost_products_filter_sexual_wellness',
  'partnerboost_link_return_partnerboost_link',
  ...FEISHU_CHAT_USER_KEYS,
  ...STRATEGY_USER_KEYS,
])

const parseLocalDate = (value?: string | null) => {
  if (value) return value
  const now = new Date()
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return iso
}

const isTruthy = (value?: string | null, fallback: boolean = false) => {
  if (value === null || value === undefined || value === '') return fallback
  const normalized = value.toLowerCase()
  return normalized === 'true' || normalized === '1'
}

const hasText = (value?: string | null) => Boolean(value && value.trim())

const normalizeStrategyAccountId = (value: unknown): number | string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^-?\d+$/.test(trimmed)) {
    const parsed = Number(trimmed)
    return Number.isSafeInteger(parsed) ? parsed : trimmed
  }
  return trimmed
}

const formatStrategyAccountIdsForDraft = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return value
    return parsed
      .map((item) => normalizeStrategyAccountId(item))
      .filter((item): item is number | string => item !== null)
      .map((item) => String(item))
      .join('\n')
  } catch {
    return value
  }
}

const normalizeStrategyAccountIdsForStorage = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return '[]'

  if (/^[\[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) return null
      const normalized = parsed
        .map((item) => normalizeStrategyAccountId(item))
        .filter((item): item is number | string => item !== null)
      return JSON.stringify(normalized)
    } catch {
      return null
    }
  }

  const normalized = trimmed
    .split(/[\n,，]/)
    .map((item) => normalizeStrategyAccountId(item))
    .filter((item): item is number | string => item !== null)

  return JSON.stringify(normalized)
}

const normalizeStrategyPriorityAsin = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim().toUpperCase()
  if (!normalized) return null
  return /^[A-Z0-9_-]{4,20}$/.test(normalized) ? normalized : null
}

const formatStrategyPriorityAsinsForDraft = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return value
    return parsed
      .map((item) => normalizeStrategyPriorityAsin(item))
      .filter((item): item is string => item !== null)
      .join('\n')
  } catch {
    return value
  }
}

const normalizeStrategyPriorityAsinsForStorage = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return '[]'

  if (/^[\[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) return null
      const normalized = Array.from(new Set(
        parsed
          .map((item) => normalizeStrategyPriorityAsin(item))
          .filter((item): item is string => item !== null)
      ))
      return JSON.stringify(normalized)
    } catch {
      return null
    }
  }

  const normalized = Array.from(new Set(
    trimmed
      .split(/[\n,，\s]+/)
      .map((item) => normalizeStrategyPriorityAsin(item))
      .filter((item): item is string => item !== null)
  ))

  return JSON.stringify(normalized)
}

const resolveStrategyCronPreset = (cron: string) => {
  const normalized = cron.trim().replace(/\s+/g, ' ')
  const matched = STRATEGY_CRON_OPTIONS.find((option) => option.id !== 'custom' && option.cron === normalized)
  return matched?.id || 'custom'
}

const isLikelyCronExpression = (value: string) => {
  const parts = value.trim().split(/\s+/)
  return parts.length === 5 && parts.every(Boolean)
}

const formatTimestamp = (value?: number | string | null) => {
  if (!value) return '未知'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const formatDuration = (ms?: number | null) => {
  if (!Number.isFinite(ms)) return '未知'
  if (ms === null || ms === undefined) return '未知'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return `${hours}h`
}

const renderTriState = (value?: boolean | null) => {
  if (value === true) return '是'
  if (value === false) return '否'
  return '未知'
}

export default function OpenClawPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<OpenclawSettingsResponse | null>(null)
  const [userValues, setUserValues] = useState<Record<string, string>>({})
  const [savedUserValues, setSavedUserValues] = useState<Record<string, string>>({})
  const [tokens, setTokens] = useState<TokenRecord[]>([])
  const [newToken, setNewToken] = useState<string | null>(null)
  const [reportDate, setReportDate] = useState<string>(parseLocalDate())
  const [report, setReport] = useState<DailyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingUser, setSavingUser] = useState(false)
  const [strategyStatus, setStrategyStatus] = useState<StrategyStatusResponse | null>(null)
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusResponse | null>(null)
  const [gatewayLoading, setGatewayLoading] = useState(false)
  const [asinData, setAsinData] = useState<AsinDataResponse | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [asinUploading, setAsinUploading] = useState(false)
  const [asinSource, setAsinSource] = useState('manual')
  const [asinDefaultCountry, setAsinDefaultCountry] = useState('US')
  const [strategyRunning, setStrategyRunning] = useState(false)
  const [simpleMode, setSimpleMode] = useState(true)
  const [strategyPreset, setStrategyPreset] = useState('balanced')
  const [strategyCronPreset, setStrategyCronPreset] = useState('daily_morning')
  const [strategyAccountIdsDraft, setStrategyAccountIdsDraft] = useState('')
  const [strategyPriorityAsinsDraft, setStrategyPriorityAsinsDraft] = useState('')
  const [showAdvancedFeishu, setShowAdvancedFeishu] = useState(false)
  const [showAdvancedStrategy, setShowAdvancedStrategy] = useState(false)

  useEffect(() => {
    if (!simpleMode) return
    setShowAdvancedFeishu(false)
    setShowAdvancedStrategy(false)
  }, [simpleMode])

  useEffect(() => {
    setStrategyAccountIdsDraft(formatStrategyAccountIdsForDraft(userValues.openclaw_strategy_ads_account_ids || ''))
  }, [userValues.openclaw_strategy_ads_account_ids])

  useEffect(() => {
    setStrategyPriorityAsinsDraft(formatStrategyPriorityAsinsForDraft(userValues.openclaw_strategy_priority_asins || ''))
  }, [userValues.openclaw_strategy_priority_asins])

  useEffect(() => {
    setStrategyCronPreset(resolveStrategyCronPreset(userValues.openclaw_strategy_cron || ''))
  }, [userValues.openclaw_strategy_cron])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      try {
        const [settingsRes, tokensRes, reportRes, strategyRes, asinRes] = await Promise.all([
          fetch('/api/openclaw/settings', { credentials: 'include' }),
          fetch('/api/openclaw/tokens', { credentials: 'include' }),
          fetch(`/api/openclaw/reports/daily?date=${reportDate}`, { credentials: 'include' }),
          fetch('/api/openclaw/strategy/status', { credentials: 'include' }),
          fetch('/api/openclaw/asin-items', { credentials: 'include' }),
        ])

        if (settingsRes.status === 403) {
          toast.error('当前账号未开启 OpenClaw 功能')
          router.replace('/dashboard')
          return
        }

        if (!settingsRes.ok) {
          throw new Error('配置加载失败')
        }

        const settingsJson = await settingsRes.json() as OpenclawSettingsResponse
        const tokensJson = tokensRes.ok ? await tokensRes.json() : { tokens: [] }
        const reportJson = reportRes.ok ? await reportRes.json() : { report: null }
        const strategyJson = strategyRes.ok ? await strategyRes.json() : null
        const asinJson = asinRes.ok ? await asinRes.json() : null

        if (!active) return

        setSettings(settingsJson)
        setTokens(tokensJson.tokens || [])
        setReport(reportJson.report || null)
        setStrategyStatus(strategyJson || null)
        setAsinData(asinJson || null)

        const userMap: Record<string, string> = {}
        settingsJson.user.forEach(item => {
          userMap[item.key] = item.value ?? ''
        })
        userMap[AUTOADS_ONLY_SETTING_KEY] = 'true'
        setUserValues(userMap)
        setSavedUserValues(userMap)
      } catch (error: any) {
        if (!active) return
        toast.error(error?.message || 'OpenClaw 配置加载失败')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    loadGatewayStatus(false, () => active)
    return () => {
      active = false
    }
  }, [reportDate, refreshKey])

  const supportsStrategyPriorityAsins = settings?.user.some(
    (item) => item.key === 'openclaw_strategy_priority_asins'
  ) ?? false
  const strategySaveKeys = supportsStrategyPriorityAsins
    ? [...STRATEGY_USER_KEYS]
    : STRATEGY_USER_KEYS.filter((key) => key !== 'openclaw_strategy_priority_asins')

  const applyStrategyValueSupport = (values: Record<string, string>): Record<string, string> => {
    if (supportsStrategyPriorityAsins) return values
    const { openclaw_strategy_priority_asins: _unused, ...rest } = values
    return rest
  }

  const setUserValue = (key: string, value: string) => {
    if (key === AUTOADS_ONLY_SETTING_KEY) {
      setUserValues(prev => ({ ...prev, [AUTOADS_ONLY_SETTING_KEY]: 'true' }))
      return
    }
    setUserValues(prev => ({ ...prev, [key]: value }))
  }

  const validateJsonArrayField = (value: string, label: string) => {
    if (!value.trim()) return true
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) {
        toast.error(`${label} 必须为JSON数组`)
        return false
      }
      return true
    } catch (error) {
      toast.error(`${label} JSON格式错误`)
      return false
    }
  }

  const hasUserDirtyFields = (keys: readonly string[]) => {
    const current = userValues
    const saved = savedUserValues
    return keys.some((key) => (current[key] ?? '') !== (saved[key] ?? ''))
  }

  const loadGatewayStatus = async (force = false, isActive?: () => boolean) => {
    setGatewayLoading(true)
    try {
      const response = await fetch(
        `/api/openclaw/gateway/status${force ? '?force=1' : ''}`,
        { credentials: 'include' }
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Gateway 状态获取失败')
      }
      if (isActive && !isActive()) return
      setGatewayStatus(payload)
    } catch (error: any) {
      if (isActive && !isActive()) return
      setGatewayStatus({
        success: false,
        error: error?.message || 'Gateway 状态获取失败',
      })
    } finally {
      if (isActive && !isActive()) return
      setGatewayLoading(false)
    }
  }

  const saveSettings = async (params: {
    scope: 'user'
    keys?: string[]
    successMessage?: string
  }) => {
    const { scope, keys, successMessage } = params

    const normalizedUserValues: Record<string, string> = {
      ...userValues,
      [AUTOADS_ONLY_SETTING_KEY]: 'true',
    }

    if (scope === 'user') {
      const needsStrategyAccountNormalization = !keys || keys.length === 0 || keys.includes('openclaw_strategy_ads_account_ids')
      if (needsStrategyAccountNormalization) {
        const normalizedAccountIds = normalizeStrategyAccountIdsForStorage(strategyAccountIdsDraft)
        if (normalizedAccountIds === null) {
          toast.error('Ads账号ID格式错误，请输入逗号/换行分隔的ID，或合法JSON数组')
          return
        }

        if (!validateJsonArrayField(normalizedAccountIds, 'Ads账号ID列表')) return
        normalizedUserValues.openclaw_strategy_ads_account_ids = normalizedAccountIds
        setUserValues(prev => ({ ...prev, openclaw_strategy_ads_account_ids: normalizedAccountIds }))
      }

      const needsStrategyPriorityNormalization = !keys || keys.length === 0 || keys.includes('openclaw_strategy_priority_asins')
      if (supportsStrategyPriorityAsins && needsStrategyPriorityNormalization) {
        const normalizedPriorityAsins = normalizeStrategyPriorityAsinsForStorage(strategyPriorityAsinsDraft)
        if (normalizedPriorityAsins === null) {
          toast.error('优先ASIN格式错误，请输入逗号/换行分隔的ASIN，或合法JSON数组')
          return
        }

        if (!validateJsonArrayField(normalizedPriorityAsins, '优先ASIN列表')) return
        normalizedUserValues.openclaw_strategy_priority_asins = normalizedPriorityAsins
        setUserValues(prev => ({ ...prev, openclaw_strategy_priority_asins: normalizedPriorityAsins }))
      }
    }

    const selectedKeySet = keys && keys.length > 0 ? new Set(keys) : null
    const updates = Object.entries(normalizedUserValues)
      .filter(([key]) => USER_KEYS.has(key))
      .filter(([key]) => !selectedKeySet || selectedKeySet.has(key))
      .map(([key, value]) => ({ key, value: value ?? '' }))
    const updateKeys = updates.map((item) => item.key)

    if (updates.length === 0) {
      toast.message('当前分区没有可保存的配置项')
      return
    }

    setSavingUser(true)
    try {
      const response = await fetch('/api/openclaw/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scope, updates }),
      })

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        throw new Error(errorJson.error || '保存失败')
      }

      setSavedUserValues((prev) => {
        const next = { ...prev }
        updateKeys.forEach((key) => {
          next[key] = normalizedUserValues[key] ?? ''
        })
        return next
      })

      toast.success(successMessage || '用户配置已保存')
    } catch (error: any) {
      toast.error(error?.message || '保存失败')
    } finally {
      setSavingUser(false)
    }
  }

  const handleCreateToken = async () => {
    try {
      const response = await fetch('/api/openclaw/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: 'OpenClaw Access' }),
      })

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        throw new Error(errorJson.error || '生成失败')
      }

      const result = await response.json()
      setTokens(prev => [result.record, ...prev])
      setNewToken(result.token)
      toast.success('OpenClaw Token 已生成')
    } catch (error: any) {
      toast.error(error?.message || '生成失败')
    }
  }

  const handleRevokeToken = async (id: number) => {
    try {
      const response = await fetch(`/api/openclaw/tokens/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        throw new Error(errorJson.error || '撤销失败')
      }

      setTokens(prev => prev.filter(token => token.id !== id))
      toast.success('Token 已撤销')
    } catch (error: any) {
      toast.error(error?.message || '撤销失败')
    }
  }

  const applyStrategyExample = () => {
    setStrategyPreset('balanced')
    const exampleValues = applyStrategyValueSupport(STRATEGY_EXAMPLE_VALUES)
    setUserValues(prev => ({
      ...prev,
      ...exampleValues,
    }))
  }

  const applyStrategyPreset = (presetId: string) => {
    setStrategyPreset(presetId)
    const preset = STRATEGY_PRESET_OPTIONS.find(option => option.id === presetId)
    if (!preset) return
    const presetValues = applyStrategyValueSupport(preset.values)
    setUserValues(prev => ({
      ...prev,
      ...presetValues,
    }))
  }

  const handleStrategyCronPresetChange = (presetId: string) => {
    setStrategyCronPreset(presetId)
    const preset = STRATEGY_CRON_OPTIONS.find(option => option.id === presetId)
    if (!preset) return
    if (preset.id !== 'custom') {
      setUserValue('openclaw_strategy_cron', preset.cron)
    }
  }

  const handleStrategyCronInputChange = (value: string) => {
    setUserValue('openclaw_strategy_cron', value)
    if (!value.trim()) {
      setStrategyCronPreset('daily_morning')
      return
    }
    setStrategyCronPreset(resolveStrategyCronPreset(value))
  }

  const handleStrategyAccountIdsDraftChange = (value: string) => {
    setStrategyAccountIdsDraft(value)
    const normalized = normalizeStrategyAccountIdsForStorage(value)
    if (normalized !== null) {
      setUserValue('openclaw_strategy_ads_account_ids', normalized)
    }
  }

  const handleStrategyPriorityAsinsDraftChange = (value: string) => {
    if (!supportsStrategyPriorityAsins) return
    setStrategyPriorityAsinsDraft(value)
    const normalized = normalizeStrategyPriorityAsinsForStorage(value)
    if (normalized !== null) {
      setUserValue('openclaw_strategy_priority_asins', normalized)
    }
  }

  const applyFeishuDocExample = () => {
    setUserValues(prev => ({
      ...prev,
      ...FEISHU_DOC_EXAMPLE_VALUES,
    }))
  }

  const applyFeishuBasicExample = () => {
    setUserValues(prev => ({
      ...prev,
      ...FEISHU_BASIC_EXAMPLE_VALUES,
    }))
  }

  const handleRunStrategy = async () => {
    setStrategyRunning(true)
    try {
      const response = await fetch('/api/openclaw/strategy/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: 'manual' }),
      })
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        throw new Error(errorJson.error || '策略执行失败')
      }
      toast.success('策略已触发，任务正在后台运行')
      setRefreshKey(prev => prev + 1)
    } catch (error: any) {
      toast.error(error?.message || '策略执行失败')
    } finally {
      setStrategyRunning(false)
    }
  }

  const handleAsinUpload = async (file: File | null) => {
    if (!file) return
    setAsinUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('source', asinSource)
      formData.append('defaultCountry', asinDefaultCountry)

      const response = await fetch('/api/openclaw/asin-import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        throw new Error(errorJson.error || 'ASIN导入失败')
      }

      toast.success('ASIN导入完成')
      setRefreshKey(prev => prev + 1)
    } catch (error: any) {
      toast.error(error?.message || 'ASIN导入失败')
    } finally {
      setAsinUploading(false)
    }
  }

  const reportSummary = report?.summary?.kpis || {}
  const reportKpis = report?.kpis?.data || {}
  const reportRoi = report?.roi?.data?.overall || {}
  const totalCost = Number(reportRoi.totalCost) || 0
  const totalRevenue = Number(reportRoi.totalRevenue) || 0
  const reportRoas = totalCost > 0 ? totalRevenue / totalCost : 0
  const offerRows = report?.roi?.data?.byOffer || []
  const trendData = report?.trends?.data?.trends || []
  const budgetOverall = report?.budget?.data?.overall || {}
  const performanceCampaigns = report?.performance?.campaigns || []
  const strategyActions = report?.strategyActions || []
  const reportStrategyRun = report?.strategyRun || null
  const strategyRunLatest = strategyStatus?.run || reportStrategyRun
  const topCampaigns = [...performanceCampaigns]
    .sort((a, b) => (b.performance?.costUsd || 0) - (a.performance?.costUsd || 0))
    .slice(0, 5)
  const strategyStats = (() => {
    if (!strategyRunLatest?.stats_json) return null
    try {
      return JSON.parse(strategyRunLatest.stats_json)
    } catch {
      return null
    }
  })()
  const gatewayHealth = gatewayStatus?.health || null
  const gatewaySkillsReport = gatewayStatus?.skills || null
  const gatewaySkillsList = Array.isArray(gatewaySkillsReport?.skills) ? gatewaySkillsReport.skills : []
  const gatewaySkillsSummary = gatewaySkillsList.reduce(
    (acc: { total: number; ready: number; missing: number; disabled: number; blocked: number }, item: any) => {
      const missing = item?.missing || {}
      const missingCount =
        (missing?.bins?.length || 0) +
        (missing?.anyBins?.length || 0) +
        (missing?.env?.length || 0) +
        (missing?.config?.length || 0) +
        (missing?.os?.length || 0)
      acc.total += 1
      if (item?.disabled) acc.disabled += 1
      if (item?.blockedByAllowlist) acc.blocked += 1
      if (missingCount > 0) acc.missing += 1
      if (!item?.disabled && !item?.blockedByAllowlist && item?.eligible && missingCount === 0) {
        acc.ready += 1
      }
      return acc
    },
    { total: 0, ready: 0, missing: 0, disabled: 0, blocked: 0 }
  )
  const showFeishuAdvanced = !simpleMode || showAdvancedFeishu
  const showStrategyAdvanced = !simpleMode || showAdvancedStrategy
  const aiConfigured = Boolean((userValues.ai_models_json || '').trim())
  const feishuDomain = (userValues.feishu_domain || '').trim().toLowerCase()
  const feishuDomainValid =
    !feishuDomain ||
    feishuDomain === 'feishu' ||
    feishuDomain === 'lark' ||
    feishuDomain.startsWith('http://') ||
    feishuDomain.startsWith('https://')

  const setupCards = [
    {
      id: 'gateway',
      label: 'Gateway',
      done: Boolean(gatewayStatus?.success && gatewayHealth?.ok),
      note: gatewayStatus?.success
        ? (gatewayHealth?.ok ? '在线' : '离线')
        : (gatewayStatus?.error || '待检测'),
    },
    {
      id: 'ai',
      label: 'AI引擎',
      done: aiConfigured,
      note: aiConfigured ? '已配置 Providers JSON' : '未配置',
    },
    {
      id: 'feishu_user',
      label: '飞书账号',
      done: hasText(userValues.feishu_app_id) && hasText(userValues.feishu_app_secret) && hasText(userValues.feishu_target),
      note: hasText(userValues.feishu_target) ? '推送目标已设置' : '缺少推送目标',
    },
    {
      id: 'strategy',
      label: '策略',
      done: isTruthy(userValues.openclaw_strategy_enabled, false),
      note: isTruthy(userValues.openclaw_strategy_enabled, false) ? '已启用' : '未启用',
    },
  ] as const
  const setupCompletedCount = setupCards.filter(item => item.done).length
  const setupProgressPercent = Math.round((setupCompletedCount / setupCards.length) * 100)
  const strategyCronValue = userValues.openclaw_strategy_cron || ''
  const strategyAccountIdsNormalized = normalizeStrategyAccountIdsForStorage(strategyAccountIdsDraft)
  const strategyPriorityAsinsNormalized = supportsStrategyPriorityAsins
    ? normalizeStrategyPriorityAsinsForStorage(strategyPriorityAsinsDraft)
    : '[]'
  const strategyAccountIdsCount = (() => {
    if (!strategyAccountIdsNormalized) return 0
    try {
      const parsed = JSON.parse(strategyAccountIdsNormalized)
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  })()
  const strategyPriorityAsinsCount = (() => {
    if (!strategyPriorityAsinsNormalized) return 0
    try {
      const parsed = JSON.parse(strategyPriorityAsinsNormalized)
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  })()
  const strategyCronHasError = Boolean(strategyCronValue.trim()) && !isLikelyCronExpression(strategyCronValue)
  const strategyAccountIdsHasError = strategyAccountIdsNormalized === null
  const strategyPriorityAsinsHasError = supportsStrategyPriorityAsins && strategyPriorityAsinsNormalized === null
  const aiDirty = hasUserDirtyFields(AI_USER_KEYS)
  const feishuChatDirty = hasUserDirtyFields(FEISHU_CHAT_USER_KEYS)
  const affiliateDirty = hasUserDirtyFields(AFFILIATE_USER_KEYS)
  const strategyDirty = hasUserDirtyFields(STRATEGY_USER_KEYS)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">OpenClaw</h1>
          <p className="text-slate-500 text-sm mt-1">飞书协作 + AutoAds 自动化控制台</p>
        </div>
        <Link
          href="/help/openclaw-config"
          className={`${buttonVariants({ variant: 'outline', size: 'sm' })} gap-2`}
        >
          配置指南
        </Link>
      </div>

      <div className="flex items-center justify-between rounded-md border bg-slate-50 px-4 py-3">
        <div>
          <div className="text-sm font-medium">简化模式</div>
          <div className="text-xs text-slate-500">仅显示必填项，其余使用默认值或隐藏</div>
        </div>
        <Switch checked={simpleMode} onCheckedChange={setSimpleMode} />
      </div>

      <Tabs defaultValue="config">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="config">配置中心</TabsTrigger>
          <TabsTrigger value="strategy">策略中心</TabsTrigger>
          <TabsTrigger value="report">每日报表</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>配置向导</CardTitle>
              <CardDescription>按步骤完成核心参数，降低首次配置复杂度</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border bg-slate-50 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span>完成度</span>
                  <span className="font-medium">{setupCompletedCount}/{setupCards.length}（{setupProgressPercent}%）</span>
                </div>
                <div className="mt-2 h-2 rounded bg-slate-200">
                  <div className="h-2 rounded bg-slate-900 transition-all" style={{ width: `${setupProgressPercent}%` }} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                {setupCards.map(card => (
                  <div key={card.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{card.label}</span>
                      <Badge variant={card.done ? 'default' : 'secondary'}>{card.done ? '已完成' : '待配置'}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{card.note}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-slate-500">
                建议顺序：Gateway → AI引擎 → 飞书聊天 → 策略中心。
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Gateway / 技能状态</CardTitle>
                <CardDescription>实时查看 OpenClaw Gateway 健康度与技能依赖</CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => loadGatewayStatus(true)}
                disabled={gatewayLoading}
              >
                {gatewayLoading ? '刷新中...' : '刷新'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              {!gatewayStatus && <div className="text-sm text-slate-500">状态加载中...</div>}
              {gatewayStatus && !gatewayStatus.success && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                  {gatewayStatus.error || 'Gateway 状态获取失败'}
                </div>
              )}
              {gatewayStatus?.success && (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">Gateway</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant={gatewayHealth?.ok ? 'default' : 'destructive'}>
                          {gatewayHealth?.ok ? '在线' : '离线'}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {gatewayStatus?.fetchedAt ? formatTimestamp(gatewayStatus.fetchedAt) : '未知'}
                        </span>
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">Channels</div>
                      <div className="mt-2 text-lg font-semibold">
                        {gatewayHealth?.channelOrder?.length ?? 0}
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">Sessions</div>
                      <div className="mt-2 text-lg font-semibold">
                        {gatewayHealth?.sessions?.count ?? 0}
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">技能可用/总数</div>
                      <div className="mt-2 text-lg font-semibold">
                        {gatewaySkillsSummary.ready}/{gatewaySkillsSummary.total}
                      </div>
                    </div>
                  </div>

                  {gatewayStatus?.errors && gatewayStatus.errors.length > 0 && (
                    <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-3">
                      {gatewayStatus.errors.join(' / ')}
                    </div>
                  )}

                  <div>
                    <div className="text-sm font-semibold text-slate-700 mb-2">Gateway 健康检查</div>
                    {gatewayHealth ? (
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-slate-500">耗时</div>
                          <div className="mt-2 text-sm font-medium">
                            {formatDuration(gatewayHealth?.durationMs)}
                          </div>
                        </div>
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-slate-500">默认Agent</div>
                          <div className="mt-2 text-sm font-medium">
                            {gatewayHealth?.defaultAgentId || '未知'}
                          </div>
                        </div>
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-slate-500">最近会话数</div>
                          <div className="mt-2 text-sm font-medium">
                            {gatewayHealth?.sessions?.recent?.length ?? 0}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">暂无健康检查数据</div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-slate-700 mb-2">Channel 状态</div>
                    {gatewayHealth?.channelOrder?.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Channel</TableHead>
                            <TableHead>配置</TableHead>
                            <TableHead>绑定</TableHead>
                            <TableHead>探测</TableHead>
                            <TableHead>上次探测</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gatewayHealth.channelOrder.map((channelKey: string) => {
                            const channel = gatewayHealth.channels?.[channelKey] || {}
                            const label =
                              gatewayHealth.channelLabels?.[channelKey] || channelKey
                            const probeOk = channel?.probe?.ok
                            return (
                              <TableRow key={channelKey}>
                                <TableCell className="font-medium">{label}</TableCell>
                                <TableCell>{renderTriState(channel?.configured)}</TableCell>
                                <TableCell>{renderTriState(channel?.linked)}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      probeOk === true
                                        ? 'default'
                                        : probeOk === false
                                          ? 'destructive'
                                          : 'secondary'
                                    }
                                  >
                                    {probeOk === true ? 'OK' : probeOk === false ? 'Fail' : '未知'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {formatTimestamp(channel?.lastProbeAt || channel?.lastProbeAtMs)}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-sm text-slate-500">暂无 Channel 数据</div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-slate-700 mb-2">技能状态</div>
                    {gatewaySkillsList.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>技能</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead>缺失项</TableHead>
                            <TableHead>安装建议</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gatewaySkillsList.map((skill: any) => {
                            const missing = skill?.missing || {}
                            const missingItems = [
                              ...(missing?.bins || []),
                              ...(missing?.anyBins || []),
                              ...(missing?.env || []),
                              ...(missing?.config || []),
                              ...(missing?.os || []),
                            ].filter(Boolean)
                            const status = skill?.disabled
                              ? { label: '已禁用', variant: 'secondary' as const }
                              : skill?.blockedByAllowlist
                                ? { label: '被阻止', variant: 'outline' as const }
                                : missingItems.length > 0
                                  ? { label: '缺少依赖', variant: 'destructive' as const }
                                  : skill?.eligible
                                    ? { label: '可用', variant: 'default' as const }
                                    : { label: '未知', variant: 'secondary' as const }
                            const installHint = Array.isArray(skill?.install)
                              ? skill.install.map((item: any) => item?.label).filter(Boolean).join('; ')
                              : ''
                            return (
                              <TableRow key={skill?.skillKey || skill?.name}>
                                <TableCell>
                                  <div className="font-medium">{skill?.name || skill?.skillKey}</div>
                                  <div className="text-xs text-slate-500">{skill?.description}</div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={status.variant}>{status.label}</Badge>
                                </TableCell>
                                <TableCell className="text-xs text-slate-500">
                                  {missingItems.length > 0 ? missingItems.join(', ') : '—'}
                                </TableCell>
                                <TableCell className="text-xs text-slate-500">
                                  {installHint || '—'}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-sm text-slate-500">暂无技能数据</div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                AI 引擎
                {aiDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="AI 配置未保存" />}
              </CardTitle>
              <CardDescription>用户级配置：最小仅需 Providers JSON</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Providers JSON</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setUserValue('ai_models_json', AI_MINIMAL_PLACEHOLDER)}
                >
                  最小模板
                </Button>
              </div>
              <Textarea
                value={userValues.ai_models_json || ''}
                onChange={(e) => setUserValue('ai_models_json', e.target.value)}
                placeholder={AI_MINIMAL_PLACEHOLDER}
                rows={10}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => saveSettings({ scope: 'user', keys: [...AI_USER_KEYS], successMessage: 'AI 配置已保存' })}
                  disabled={savingUser}
                >
                  {savingUser ? '保存中...' : aiDirty ? '保存 AI 配置 *' : '保存 AI 配置'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                飞书聊天
                {feishuChatDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="飞书配置未保存" />}
              </CardTitle>
              <CardDescription>用户级配置：最小仅需 App ID / App Secret / 推送目标</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {simpleMode && (
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>仅显示必要字段，其余采用默认或可选配置</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAdvancedFeishu((prev) => !prev)}
                  >
                    {showFeishuAdvanced ? '收起高级' : '高级设置'}
                  </Button>
                </div>
              )}

              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                快速起步：填写 App ID、App Secret、推送目标即可联通；如需高风险动作卡片确认，请在「飞书多账号 JSON」中补充 card* 字段。
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <InputWithLabel
                  label="飞书 App ID"
                  value={userValues.feishu_app_id || ''}
                  onChange={(v) => setUserValue('feishu_app_id', v)}
                />
                <InputWithLabel
                  label="飞书 App Secret"
                  type="password"
                  value={userValues.feishu_app_secret || ''}
                  onChange={(v) => setUserValue('feishu_app_secret', v)}
                />
                <InputWithLabel
                  label="飞书推送目标 (open_id / union_id / chat_id)"
                  value={userValues.feishu_target || ''}
                  onChange={(v) => setUserValue('feishu_target', v)}
                />
              </div>

              {showFeishuAdvanced && (
                <div className="grid gap-4 md:grid-cols-3">
                  <InputWithLabel
                    label="飞书 Bot Name"
                    value={userValues.feishu_bot_name || ''}
                    onChange={(v) => setUserValue('feishu_bot_name', v)}
                  />
                  <InputWithLabel
                    label="Domain"
                    value={userValues.feishu_domain || ''}
                    onChange={(v) => setUserValue('feishu_domain', v)}
                    placeholder="feishu / lark / https://..."
                  />
                  <InputWithLabel
                    label="飞书文档目录 Token"
                    value={userValues.feishu_doc_folder_token || ''}
                    onChange={(v) => setUserValue('feishu_doc_folder_token', v)}
                    placeholder="fldc_xxx"
                  />
                  <InputWithLabel
                    label="文档标题前缀"
                    value={userValues.feishu_doc_title_prefix || ''}
                    onChange={(v) => setUserValue('feishu_doc_title_prefix', v)}
                    placeholder="OpenClaw 每日报表"
                  />
                  <InputWithLabel
                    label="Bitable App Token"
                    value={userValues.feishu_bitable_app_token || ''}
                    onChange={(v) => setUserValue('feishu_bitable_app_token', v)}
                    placeholder="basc_xxx"
                  />
                  <InputWithLabel
                    label="Bitable Table ID"
                    value={userValues.feishu_bitable_table_id || ''}
                    onChange={(v) => setUserValue('feishu_bitable_table_id', v)}
                    placeholder="tbl_xxx (可留空自动创建)"
                  />
                  <InputWithLabel
                    label="Bitable Table Name"
                    value={userValues.feishu_bitable_table_name || ''}
                    onChange={(v) => setUserValue('feishu_bitable_table_name', v)}
                    placeholder="OpenClaw Daily Report"
                  />
                </div>
              )}


              {showFeishuAdvanced && (
                <>
                  <div className="grid gap-4 md:grid-cols-3">
                    <InputWithLabel label="App Secret File" value={userValues.feishu_app_secret_file || ''} onChange={(v) => setUserValue('feishu_app_secret_file', v)} placeholder="/path/to/secret" />
                    <InputWithLabel label="DM Policy" value={userValues.feishu_dm_policy || ''} onChange={(v) => setUserValue('feishu_dm_policy', v)} placeholder="pairing / allowlist / open / disabled" />
                    <InputWithLabel label="Group Policy" value={userValues.feishu_group_policy || ''} onChange={(v) => setUserValue('feishu_group_policy', v)} placeholder="open / allowlist / disabled" />
                    <InputWithLabel label="DM Allowlist" value={userValues.feishu_allow_from || ''} onChange={(v) => setUserValue('feishu_allow_from', v)} placeholder='["open_id"]' />
                    <InputWithLabel label="Group Allowlist" value={userValues.feishu_group_allow_from || ''} onChange={(v) => setUserValue('feishu_group_allow_from', v)} placeholder='["open_id"]' />
                    <SwitchWithLabel label="Require Mention (group)" checked={(userValues.feishu_require_mention || 'true') !== 'false'} onChange={(val) => setUserValue('feishu_require_mention', val ? 'true' : 'false')} />
                    <InputWithLabel label="History Limit" value={userValues.feishu_history_limit || ''} onChange={(v) => setUserValue('feishu_history_limit', v)} />
                    <InputWithLabel label="DM History Limit" value={userValues.feishu_dm_history_limit || ''} onChange={(v) => setUserValue('feishu_dm_history_limit', v)} />
                    <SwitchWithLabel label="Streaming" checked={(userValues.feishu_streaming || 'true') !== 'false'} onChange={(val) => setUserValue('feishu_streaming', val ? 'true' : 'false')} />
                    <SwitchWithLabel label="Block Streaming" checked={(userValues.feishu_block_streaming || 'false') === 'true'} onChange={(val) => setUserValue('feishu_block_streaming', val ? 'true' : 'false')} />
                    <SwitchWithLabel label="Config Writes" checked={(userValues.feishu_config_writes || 'true') !== 'false'} onChange={(val) => setUserValue('feishu_config_writes', val ? 'true' : 'false')} />
                    <InputWithLabel label="Text Chunk Limit" value={userValues.feishu_text_chunk_limit || ''} onChange={(v) => setUserValue('feishu_text_chunk_limit', v)} />
                    <InputWithLabel label="Chunk Mode" value={userValues.feishu_chunk_mode || ''} onChange={(v) => setUserValue('feishu_chunk_mode', v)} placeholder="length / newline" />
                    <InputWithLabel label="Markdown Tables" value={userValues.feishu_markdown_tables || ''} onChange={(v) => setUserValue('feishu_markdown_tables', v)} placeholder="off / bullets / code" />
                    <InputWithLabel label="Media Max MB" value={userValues.feishu_media_max_mb || ''} onChange={(v) => setUserValue('feishu_media_max_mb', v)} />
                    <InputWithLabel label="Response Prefix" value={userValues.feishu_response_prefix || ''} onChange={(v) => setUserValue('feishu_response_prefix', v)} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Groups JSON (高级)</label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setUserValue('feishu_groups_json', FEISHU_GROUPS_PLACEHOLDER)}
                        >
                          填充示例
                        </Button>
                      </div>
                      <Textarea
                        value={userValues.feishu_groups_json || ''}
                        onChange={(e) => setUserValue('feishu_groups_json', e.target.value)}
                        placeholder={FEISHU_GROUPS_PLACEHOLDER}
                        rows={6}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Accounts JSON (高级)</label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setUserValue('feishu_accounts_json', FEISHU_ACCOUNTS_PLACEHOLDER)}
                        >
                          填充示例
                        </Button>
                      </div>
                      <Textarea
                        value={userValues.feishu_accounts_json || ''}
                        onChange={(e) => setUserValue('feishu_accounts_json', e.target.value)}
                        placeholder={FEISHU_ACCOUNTS_PLACEHOLDER}
                        rows={6}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="grid gap-2 md:grid-cols-3 text-xs">
                <div className={hasText(userValues.feishu_app_id) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_app_id) ? '✓ App ID 已填写' : '• App ID 未填写'}
                </div>
                <div className={hasText(userValues.feishu_app_secret) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_app_secret) ? '✓ App Secret 已填写' : '• App Secret 未填写'}
                </div>
                <div className={hasText(userValues.feishu_target) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_target) ? '✓ 推送目标已填写' : '• 推送目标未填写'}
                </div>
              </div>
              <p className={`text-xs ${feishuDomainValid ? 'text-slate-500' : 'text-red-600'}`}>
                {feishuDomainValid
                  ? 'Domain 可填写 feishu / lark，或完整 https:// 地址。'
                  : 'Domain 格式无效，请填写 feishu、lark 或 http(s) 地址。'}
              </p>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={applyFeishuBasicExample}>
                    填充基础项
                  </Button>
                  <Button variant="outline" size="sm" onClick={applyFeishuDocExample}>
                    文档示例
                  </Button>
                </div>
                <Button
                  onClick={() => saveSettings({ scope: 'user', keys: [...FEISHU_CHAT_USER_KEYS], successMessage: '飞书配置已保存' })}
                  disabled={savingUser}
                >
                  {savingUser ? '保存中...' : feishuChatDirty ? '保存飞书配置 *' : '保存飞书配置'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                联盟平台
                {affiliateDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="联盟平台配置未保存" />}
              </CardTitle>
              <CardDescription>用户级可选配置：未填写时走平台默认参数</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {simpleMode && (
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  推荐仅填写必要鉴权：YP Token + Site ID 或 PB Token，其余参数留空使用默认值。
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-3">
                <InputWithLabel
                  label="YP Token"
                  type="password"
                  value={userValues.yeahpromos_token || ''}
                  onChange={(v) => setUserValue('yeahpromos_token', v)}
                  placeholder="YeahPromos API Token"
                />
                <InputWithLabel
                  label="YP Site ID"
                  value={userValues.yeahpromos_site_id || ''}
                  onChange={(v) => setUserValue('yeahpromos_site_id', v)}
                />
                <InputWithLabel
                  label="PB Token"
                  type="password"
                  value={userValues.partnerboost_token || ''}
                  onChange={(v) => setUserValue('partnerboost_token', v)}
                />
              </div>

              {!simpleMode && (
                <div className="grid gap-4 md:grid-cols-3">
                  <InputWithLabel
                    label="YP Page"
                    value={userValues.yeahpromos_page || ''}
                    onChange={(v) => setUserValue('yeahpromos_page', v)}
                    placeholder="默认 1"
                  />
                  <InputWithLabel
                    label="YP Limit"
                    value={userValues.yeahpromos_limit || ''}
                    onChange={(v) => setUserValue('yeahpromos_limit', v)}
                    placeholder="默认 1000"
                  />
                  <InputWithLabel
                    label="PB Base URL"
                    value={userValues.partnerboost_base_url || ''}
                    onChange={(v) => setUserValue('partnerboost_base_url', v)}
                    placeholder="https://app.partnerboost.com"
                  />
                  <InputWithLabel
                    label="PB country_code"
                    value={userValues.partnerboost_products_country_code || ''}
                    onChange={(v) => setUserValue('partnerboost_products_country_code', v)}
                    placeholder="US"
                  />
                  <InputWithLabel
                    label="PB link country"
                    value={userValues.partnerboost_link_country_code || ''}
                    onChange={(v) => setUserValue('partnerboost_link_country_code', v)}
                    placeholder="US"
                  />
                  <InputWithLabel
                    label="PB link uid"
                    value={userValues.partnerboost_link_uid || ''}
                    onChange={(v) => setUserValue('partnerboost_link_uid', v)}
                  />
                </div>
              )}


              <div className="flex justify-end">
                <Button
                  onClick={() => saveSettings({ scope: 'user', keys: [...AFFILIATE_USER_KEYS], successMessage: '联盟平台配置已保存' })}
                  disabled={savingUser}
                >
                  {savingUser ? '保存中...' : affiliateDirty ? '保存联盟平台配置 *' : '保存联盟平台配置'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>OpenClaw Access Tokens</CardTitle>
              <CardDescription>用于 OpenClaw 调用 AutoAds API（用户级隔离）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {newToken && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 text-sm">
                  新Token：<span className="font-mono break-all">{newToken}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <Button onClick={handleCreateToken}>生成新Token</Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>最后使用</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500">
                        暂无Token
                      </TableCell>
                    </TableRow>
                  )}
                  {tokens.map(token => (
                    <TableRow key={token.id}>
                      <TableCell>{token.name || 'OpenClaw Token'}</TableCell>
                      <TableCell>
                        <Badge variant={token.status === 'active' ? 'default' : 'secondary'}>
                          {token.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{token.created_at}</TableCell>
                      <TableCell>{token.last_used_at || '-'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" onClick={() => handleRevokeToken(token.id)}>
                          撤销
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="strategy" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                策略配置
                {strategyDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="策略配置未保存" />}
              </CardTitle>
              <CardDescription>OpenClaw 自我进化策略参数（用户级配置）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {simpleMode && (
                <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  建议顺序：①选预设 → ②确认调度频率 → ③填写 Ads 账号ID → ④保存策略配置
                </div>
              )}

              {!simpleMode && (
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  高级参数（预算/CPC/自动化开关）均有默认值，通常只需启用策略 + 调度 + Ads账号ID。
                </div>
              )}

              {simpleMode && (
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>仅显示关键参数，其余使用默认值</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAdvancedStrategy((prev) => !prev)}
                  >
                    {showStrategyAdvanced ? '收起高级' : '更多参数'}
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">策略预设</label>
                <div className="grid gap-3 md:grid-cols-3">
                  {STRATEGY_PRESET_OPTIONS.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => applyStrategyPreset(option.id)}
                      className={`rounded-md border px-3 py-2 text-left transition-colors ${
                        strategyPreset === option.id
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white hover:border-slate-400'
                      }`}
                    >
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className={`mt-1 text-xs ${strategyPreset === option.id ? 'text-slate-200' : 'text-slate-500'}`}>
                        {option.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <SwitchWithLabel
                  label="启用策略"
                  checked={isTruthy(userValues.openclaw_strategy_enabled, false)}
                  onChange={(val) => setUserValue('openclaw_strategy_enabled', val ? 'true' : 'false')}
                />
                <div className="space-y-2">
                  <label className="text-sm font-medium">调度频率</label>
                  <Select value={strategyCronPreset} onValueChange={handleStrategyCronPresetChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择执行频率" />
                    </SelectTrigger>
                    <SelectContent>
                      {STRATEGY_CRON_OPTIONS.map(option => (
                        <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <SwitchWithLabel
                  label="仅AutoAds链路（锁定）"
                  checked={isTruthy(userValues.openclaw_strategy_enforce_autoads_only, true)}
                  onChange={(val) => setUserValue(AUTOADS_ONLY_SETTING_KEY, val ? 'true' : 'false')}
                  disabled
                />
              </div>
              <p className="text-xs text-slate-500">仅通过 AutoAds 接口执行 Offer创建 / 创意生成 / 广告发布，手工Campaign冲突将被阻断。</p>

              {(showStrategyAdvanced || strategyCronPreset === 'custom') && (
                <div className="space-y-2">
                  <InputWithLabel
                    label="Cron 表达式"
                    value={strategyCronValue}
                    onChange={handleStrategyCronInputChange}
                    placeholder="0 9 * * *"
                  />
                  <p className={`text-xs ${strategyCronHasError ? 'text-red-600' : 'text-slate-500'}`}>
                    {strategyCronHasError ? 'Cron 格式建议为 5 段，例如：0 9 * * *' : '格式：分 时 日 月 周（例如：0 9 * * *）'}
                  </p>
                </div>
              )}

              {showStrategyAdvanced && !simpleMode && (
                <div className="grid gap-4 md:grid-cols-3">
                  <InputWithLabel
                    label="每次最大Offer数"
                    value={userValues.openclaw_strategy_max_offers_per_run || ''}
                    onChange={(v) => setUserValue('openclaw_strategy_max_offers_per_run', v)}
                  />
                  <InputWithLabel
                    label="默认日预算"
                    value={userValues.openclaw_strategy_default_budget || ''}
                    onChange={(v) => setUserValue('openclaw_strategy_default_budget', v)}
                  />
                  <InputWithLabel
                    label="最大CPC"
                    value={userValues.openclaw_strategy_max_cpc || ''}
                    onChange={(v) => setUserValue('openclaw_strategy_max_cpc', v)}
                  />
                  <InputWithLabel
                    label="最小CPC"
                    value={userValues.openclaw_strategy_min_cpc || ''}
                    onChange={(v) => setUserValue('openclaw_strategy_min_cpc', v)}
                  />
                  <InputWithLabel
                    label="每日预算上限"
                    value={userValues.openclaw_strategy_daily_budget_cap || ''}
                    onChange={(v) => setUserValue('openclaw_strategy_daily_budget_cap', v)}
                  />
                  <InputWithLabel
                    label="每日花费上限"
                    value={userValues.openclaw_strategy_daily_spend_cap || ''}
                    onChange={(v) => setUserValue('openclaw_strategy_daily_spend_cap', v)}
                  />
                  <InputWithLabel
                    label="目标ROAS"
                    value={userValues.openclaw_strategy_target_roas || ''}
                    onChange={(v) => setUserValue('openclaw_strategy_target_roas', v)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Ads账号ID列表</label>
                <Textarea
                  value={strategyAccountIdsDraft}
                  onChange={(e) => handleStrategyAccountIdsDraftChange(e.target.value)}
                  placeholder={'123456789\n987654321 或 123456789,987654321'}
                  rows={3}
                />
                <div className="flex items-center justify-between text-xs">
                  <span className={strategyAccountIdsHasError ? 'text-red-600' : 'text-slate-500'}>
                    {strategyAccountIdsHasError
                      ? '账号ID格式错误，请用逗号/换行分隔，或输入JSON数组'
                      : '支持逗号、换行或 JSON 数组输入，保存时自动标准化'}
                  </span>
                  <span className="text-slate-500">已识别 {strategyAccountIdsCount} 个账号</span>
                </div>
              </div>

              {showStrategyAdvanced && !simpleMode && supportsStrategyPriorityAsins && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">优先ASIN列表（可选）</label>
                  <Textarea
                    value={strategyPriorityAsinsDraft}
                    onChange={(e) => handleStrategyPriorityAsinsDraftChange(e.target.value)}
                    placeholder={'B0ABC12345\nB0XYZ67890 或 B0ABC12345,B0XYZ67890'}
                    rows={3}
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className={strategyPriorityAsinsHasError ? 'text-red-600' : 'text-slate-500'}>
                      {strategyPriorityAsinsHasError
                        ? '优先ASIN格式错误，请用逗号/换行分隔，或输入JSON数组'
                        : '支持逗号、换行或 JSON 数组输入，保存时自动标准化'}
                    </span>
                    <span className="text-slate-500">已识别 {strategyPriorityAsinsCount} 个ASIN</span>
                  </div>
                </div>
              )}

              {showStrategyAdvanced && !simpleMode && (
                <div className="grid gap-4 md:grid-cols-3">
                  <SwitchWithLabel
                    label="自动发布"
                    checked={isTruthy(userValues.openclaw_strategy_enable_auto_publish, true)}
                    onChange={(val) => setUserValue('openclaw_strategy_enable_auto_publish', val ? 'true' : 'false')}
                  />
                  <SwitchWithLabel
                    label="自动暂停冲突Campaign"
                    checked={isTruthy(userValues.openclaw_strategy_enable_auto_pause, true)}
                    onChange={(val) => setUserValue('openclaw_strategy_enable_auto_pause', val ? 'true' : 'false')}
                  />
                  <SwitchWithLabel
                    label="自动调整CPC"
                    checked={isTruthy(userValues.openclaw_strategy_enable_auto_adjust_cpc, true)}
                    onChange={(val) => setUserValue('openclaw_strategy_enable_auto_adjust_cpc', val ? 'true' : 'false')}
                  />
                  <SwitchWithLabel
                    label="允许联盟平台补全"
                    checked={isTruthy(userValues.openclaw_strategy_allow_affiliate_fetch, true)}
                    onChange={(val) => setUserValue('openclaw_strategy_allow_affiliate_fetch', val ? 'true' : 'false')}
                  />
                  <SwitchWithLabel
                    label="Dry Run"
                    checked={isTruthy(userValues.openclaw_strategy_dry_run, false)}
                    onChange={(val) => setUserValue('openclaw_strategy_dry_run', val ? 'true' : 'false')}
                  />
                </div>
              )}

              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={applyStrategyExample}>
                  快速示例
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={handleRunStrategy} disabled={strategyRunning}>
                    {strategyRunning ? '执行中...' : '立即执行'}
                  </Button>
                  <Button
                    onClick={() => saveSettings({ scope: 'user', keys: strategySaveKeys, successMessage: '策略配置已保存' })}
                    disabled={savingUser}
                  >
                    {savingUser ? '保存中...' : strategyDirty ? '保存策略配置 *' : '保存策略配置'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ASIN 导入</CardTitle>
              <CardDescription>支持 CSV / JSON / XLSX 文件，优先使用你上传的ASIN</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">来源</label>
                  <Select value={asinSource} onValueChange={setAsinSource}>
                    <SelectTrigger>
                      <SelectValue placeholder="manual" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">手动上传</SelectItem>
                      <SelectItem value="feishu">飞书附件</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <InputWithLabel
                  label="默认国家"
                  value={asinDefaultCountry}
                  onChange={setAsinDefaultCountry}
                  placeholder="US"
                />
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">文件上传</label>
                  <Input
                    type="file"
                    accept=".csv,.json,.xlsx,.xls"
                    disabled={asinUploading}
                    onChange={(e) => handleAsinUpload(e.target.files?.[0] || null)}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card className="border-slate-200">
                  <CardHeader>
                    <CardTitle className="text-base">导入记录</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>文件</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>解析</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(asinData?.inputs || []).map((input) => (
                          <TableRow key={input.id}>
                            <TableCell>{input.filename || input.source}</TableCell>
                            <TableCell>{input.status}</TableCell>
                            <TableCell>{input.parsed_items}/{input.total_items}</TableCell>
                          </TableRow>
                        ))}
                        {(asinData?.inputs || []).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-slate-500">
                              暂无导入记录
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card className="border-slate-200">
                  <CardHeader>
                    <CardTitle className="text-base">最近ASIN</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ASIN</TableHead>
                          <TableHead>国家</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>Offer</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(asinData?.items || []).map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>{item.asin || '-'}</TableCell>
                            <TableCell>{item.country_code || '-'}</TableCell>
                            <TableCell>{item.status}</TableCell>
                            <TableCell>{item.offer_id || '-'}</TableCell>
                          </TableRow>
                        ))}
                        {(asinData?.items || []).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-slate-500">
                              暂无ASIN数据
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>策略执行概览</CardTitle>
              <CardDescription>最近一次策略运行状态</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              {strategyRunLatest ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs text-slate-500">状态</div>
                    <div className="font-medium">{strategyRunLatest.status}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">运行日期</div>
                    <div className="font-medium">{strategyRunLatest.run_date}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">完成时间</div>
                    <div className="font-medium">{strategyRunLatest.completed_at || '-'}</div>
                  </div>
                </div>
              ) : (
                <div className="text-slate-500">暂无策略运行记录</div>
              )}

              {strategyStats && (
                <div className="grid gap-3 md:grid-cols-4">
                  <KpiCard title="Offers" value={strategyStats.offersConsidered ?? 0} />
                  <KpiCard title="Creatives" value={strategyStats.creativesGenerated ?? 0} />
                  <KpiCard title="Published" value={strategyStats.campaignsPublished ?? 0} />
                  <KpiCard title="Paused" value={strategyStats.campaignsPaused ?? 0} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>策略动作记录</CardTitle>
              <CardDescription>OpenClaw 策略执行产生的动作</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>动作</TableHead>
                    <TableHead>目标</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(strategyStatus?.actions || []).map((action) => (
                    <TableRow key={action.id}>
                      <TableCell>{action.created_at}</TableCell>
                      <TableCell>{action.action_type}</TableCell>
                      <TableCell>{action.target_type} {action.target_id}</TableCell>
                      <TableCell>
                        <Badge variant={action.status === 'success' ? 'default' : 'secondary'}>
                          {action.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(strategyStatus?.actions || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        暂无策略动作
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="report" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>每日报表</CardTitle>
              <CardDescription>统计数据 + 操作记录</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-4">
              <Input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="max-w-[200px]"
              />
              {loading && <span className="text-sm text-slate-500">加载中...</span>}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-4">
            <KpiCard title="Offers" value={reportSummary.totalOffers ?? 0} />
            <KpiCard title="Campaigns" value={reportSummary.totalCampaigns ?? 0} />
            <KpiCard title="Revenue" value={totalRevenue} />
            <KpiCard title="ROAS" value={`${reportRoas.toFixed(2)}x`} />
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <KpiCard title="Impressions" value={reportKpis.current?.impressions ?? 0} />
            <KpiCard title="Clicks" value={reportKpis.current?.clicks ?? 0} />
            <KpiCard title="Conversions" value={reportKpis.current?.conversions ?? 0} />
            <KpiCard title="Cost" value={reportKpis.current?.cost ?? totalCost} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>预算与消耗</CardTitle>
              <CardDescription>基于当日预算统计</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-5">
              <KpiCard title="Total Budget" value={budgetOverall.totalBudget ?? 0} />
              <KpiCard title="Total Spent" value={budgetOverall.totalSpent ?? 0} />
              <KpiCard title="Remaining" value={budgetOverall.remaining ?? 0} />
              <KpiCard title="Utilization" value={`${budgetOverall.utilizationRate ?? 0}%`} />
              <KpiCard title="Active Campaigns" value={budgetOverall.activeCampaigns ?? 0} />
            </CardContent>
          </Card>

          <TrendChartDynamic
            data={trendData}
            metrics={[
              { key: 'impressions', label: 'Impressions', color: '#2563eb' },
              { key: 'clicks', label: 'Clicks', color: '#16a34a' },
              { key: 'cost', label: 'Cost', color: '#f97316', yAxisId: 'right' },
            ]}
            title="广告表现趋势"
            description="近30天趋势"
            dualYAxis
            hideTimeRangeSelector
          />

          <Card>
            <CardHeader>
              <CardTitle>ROI / ROAS 分析</CardTitle>
              <CardDescription>基于当日报表币种计算</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-5">
              <KpiCard title="Cost" value={totalCost} />
              <KpiCard title="Revenue" value={totalRevenue} />
              <KpiCard title="Profit" value={reportRoi.totalProfit ?? 0} />
              <KpiCard title="ROAS" value={`${reportRoas.toFixed(2)}x`} />
              <KpiCard title="ROI" value={`${reportRoi.roi ?? 0}%`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Offer ROI Top 10</CardTitle>
              <CardDescription>按收入排序的Offer表现</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Offer</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Campaigns</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>ROI</TableHead>
                    <TableHead>ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offerRows.map((offer: any) => {
                    const cost = Number(offer.cost) || 0
                    const revenue = Number(offer.revenue) || 0
                    const roas = cost > 0 ? revenue / cost : 0
                    const offerLabel = offer.offerName || `Offer #${offer.offerId}`
                    return (
                      <TableRow key={offer.offerId}>
                        <TableCell>{offerLabel}</TableCell>
                        <TableCell>{offer.brand || '-'}</TableCell>
                        <TableCell>{offer.campaignCount ?? 0}</TableCell>
                        <TableCell>{revenue}</TableCell>
                        <TableCell>{cost}</TableCell>
                        <TableCell>{offer.roi ?? 0}%</TableCell>
                        <TableCell>{roas.toFixed(2)}x</TableCell>
                      </TableRow>
                    )
                  })}
                  {offerRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500">
                        暂无Offer数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Campaign Top 5</CardTitle>
              <CardDescription>近7天花费最高的广告系列</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>点击</TableHead>
                    <TableHead>花费</TableHead>
                    <TableHead>转化</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCampaigns.map((campaign: any) => (
                    <TableRow key={campaign.id}>
                      <TableCell>{campaign.campaignName}</TableCell>
                      <TableCell>{campaign.status}</TableCell>
                      <TableCell>{campaign.performance?.clicks ?? 0}</TableCell>
                      <TableCell>{campaign.performance?.costUsd ?? 0}</TableCell>
                      <TableCell>{campaign.performance?.conversions ?? 0}</TableCell>
                    </TableRow>
                  ))}
                  {topCampaigns.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500">
                        暂无数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>操作记录</CardTitle>
              <CardDescription>OpenClaw 调用 AutoAds 的操作日志</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>动作</TableHead>
                    <TableHead>目标</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(report?.actions || []).map((action: any) => (
                    <TableRow key={action.id}>
                      <TableCell>{action.created_at}</TableCell>
                      <TableCell>{action.action}</TableCell>
                      <TableCell>{action.target_type} {action.target_id}</TableCell>
                      <TableCell>
                        <Badge variant={action.status === 'success' ? 'default' : 'destructive'}>
                          {action.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!report?.actions || report.actions.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        暂无操作记录
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>策略动作</CardTitle>
              <CardDescription>OpenClaw 策略执行动作记录</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>动作</TableHead>
                    <TableHead>目标</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {strategyActions.map((action: any) => (
                    <TableRow key={`strategy-${action.id}`}>
                      <TableCell>{action.created_at}</TableCell>
                      <TableCell>{action.action_type}</TableCell>
                      <TableCell>{action.target_type} {action.target_id}</TableCell>
                      <TableCell>
                        <Badge variant={action.status === 'success' ? 'default' : 'secondary'}>
                          {action.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {strategyActions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        暂无策略动作
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function InputWithLabel(props: {
  label: string
  value: string
  placeholder?: string
  type?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{props.label}</label>
      <Input
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
    </div>
  )
}

function SwitchWithLabel(props: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2">
      <span className="text-sm">{props.label}</span>
      <Switch checked={props.checked} onCheckedChange={props.onChange} disabled={props.disabled} />
    </div>
  )
}

function KpiCard(props: { title: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{props.title}</CardDescription>
        <CardTitle className="text-2xl">{props.value}</CardTitle>
      </CardHeader>
    </Card>
  )
}
