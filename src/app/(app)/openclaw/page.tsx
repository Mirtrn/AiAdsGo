'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { parseAiModelsJson, setAiModelsSelectedModel } from '@/lib/openclaw/ai-models'

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
  userId: number
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

type GatewaySkillRow = {
  skill: any
  missingItems: string[]
  isReady: boolean
  status: {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
  }
  installHint: string
}

type WorkspaceStatusFile = {
  name: string
  path: string
  exists: boolean
  size: number | null
  updatedAt: string | null
}

type WorkspaceStatusResponse = {
  success: boolean
  source?: 'runtime-config' | 'computed'
  runtimeWorkspaceDir?: string | null
  computedWorkspaceDir?: string
  workspaceDir?: string
  memoryDir?: string
  files?: WorkspaceStatusFile[]
  missingFiles?: string[]
  dailyMemoryPath?: string
  dailyMemoryExists?: boolean
  canReloadGateway?: boolean
  error?: string
}

type WorkspaceBootstrapResponse = {
  success: boolean
  changedFiles?: string[]
  status?: WorkspaceStatusResponse
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

const AUTOADS_ONLY_SETTING_KEY = 'openclaw_strategy_enforce_autoads_only'

const AI_GLOBAL_KEYS = [
  'ai_models_json',
  'openclaw_models_mode',
  'openclaw_models_bedrock_discovery_json',
] as const

const AI_GLOBAL_KEY_SET = new Set<string>([...AI_GLOBAL_KEYS])

const AI_GLOBAL_EDIT_KEYS = [
  'ai_models_json',
] as const

const FEISHU_CHAT_MINIMAL_USER_KEYS = [
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_target',
  'feishu_accounts_json',
] as const

const FEISHU_CHAT_COMMUNICATION_USER_KEYS = [
  'feishu_domain',
  'feishu_bot_name',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
] as const

const FEISHU_BASIC_EXAMPLE_VALUES: Record<string, string> = {
  feishu_app_id: 'cli_xxx',
  feishu_app_secret: 'app_secret_xxx',
  feishu_target: 'ou_xxx',
  feishu_domain: 'feishu',
  feishu_auth_mode: 'strict',
  feishu_require_tenant_key: 'true',
  feishu_strict_auto_bind: 'true',
}

const AFFILIATE_MINIMAL_USER_KEYS = [
  'yeahpromos_token',
  'yeahpromos_site_id',
  'partnerboost_token',
] as const

const AFFILIATE_SYNC_USER_KEYS = [
  'openclaw_affiliate_sync_enabled',
  'openclaw_affiliate_sync_interval_hours',
  'openclaw_affiliate_sync_mode',
] as const

const PARTNERBOOST_USER_KEYS = [
  'partnerboost_base_url',
  'partnerboost_products_country_code',
  'partnerboost_products_link_batch_size',
  'partnerboost_asin_link_batch_size',
  'partnerboost_request_delay_ms',
  'partnerboost_rate_limit_max_retries',
  'partnerboost_rate_limit_base_delay_ms',
  'partnerboost_rate_limit_max_delay_ms',
  'partnerboost_link_country_code',
  'partnerboost_link_uid',
] as const

const STRATEGY_MINIMAL_USER_KEYS = [
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
  'openclaw_strategy_ads_account_ids',
  'openclaw_strategy_enforce_autoads_only',
] as const

const FEISHU_CHAT_USER_KEYS = [...FEISHU_CHAT_MINIMAL_USER_KEYS, ...FEISHU_CHAT_COMMUNICATION_USER_KEYS] as const
const AFFILIATE_USER_KEYS = [
  ...AFFILIATE_MINIMAL_USER_KEYS,
  'partnerboost_base_url',
  ...AFFILIATE_SYNC_USER_KEYS,
] as const
const STRATEGY_USER_KEYS = STRATEGY_MINIMAL_USER_KEYS

const USER_KEYS = new Set([
  ...AI_GLOBAL_KEYS,
  ...AFFILIATE_MINIMAL_USER_KEYS,
  ...AFFILIATE_SYNC_USER_KEYS,
  ...PARTNERBOOST_USER_KEYS,
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
  ...STRATEGY_MINIMAL_USER_KEYS,
])

const USER_DEFAULT_VALUES: Record<string, string> = {
  feishu_domain: 'feishu',
  feishu_auth_mode: 'strict',
  feishu_require_tenant_key: 'true',
  feishu_strict_auto_bind: 'true',
  partnerboost_base_url: 'https://app.partnerboost.com',
  openclaw_affiliate_sync_enabled: 'false',
  openclaw_affiliate_sync_interval_hours: '1',
  openclaw_affiliate_sync_mode: 'incremental',
  openclaw_strategy_enabled: 'false',
  openclaw_strategy_cron: '0 9 * * *',
  openclaw_strategy_ads_account_ids: '[]',
}

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

function parseFeishuCardSettingsFromAccountsJson(value?: string | null): {
  verificationToken: string
  encryptKey: string
} {
  const raw = String(value || '').trim()
  if (!raw) {
    return { verificationToken: '', encryptKey: '' }
  }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { verificationToken: '', encryptKey: '' }
    }

    const main = (parsed as Record<string, unknown>).main
    if (!main || typeof main !== 'object' || Array.isArray(main)) {
      return { verificationToken: '', encryptKey: '' }
    }

    const verificationTokenValue = (main as Record<string, unknown>).cardVerificationToken
    const encryptKeyValue = (main as Record<string, unknown>).cardEncryptKey

    const verificationToken = typeof verificationTokenValue === 'string'
      ? verificationTokenValue.trim()
      : ''

    const encryptKey = typeof encryptKeyValue === 'string'
      ? encryptKeyValue.trim()
      : ''

    return {
      verificationToken,
      encryptKey,
    }
  } catch {
    return { verificationToken: '', encryptKey: '' }
  }
}

function buildAutoFeishuAccountsJson(params: {
  existingValue?: string
  userId: number
  appBaseUrl?: string
  verificationToken: string
  encryptKey: string
}): string {
  const root: Record<string, any> = (() => {
    const raw = String(params.existingValue || '').trim()
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>
      }
      return {}
    } catch {
      return {}
    }
  })()

  const main = root.main && typeof root.main === 'object' && !Array.isArray(root.main)
    ? { ...root.main }
    : {}

  delete (main as Record<string, any>).appId
  delete (main as Record<string, any>).appSecret
  delete (main as Record<string, any>).appSecretFile

  const callbackPath = `/feishu/user-${params.userId}/card-action`
  const trimmedBaseUrl = String(params.appBaseUrl || '').trim().replace(/\/+$/, '')

  main.cardCallbackPath = callbackPath
  main.cardVerificationToken = params.verificationToken.trim()
  main.cardEncryptKey = params.encryptKey.trim()
  if (trimmedBaseUrl) {
    main.cardConfirmUrl = `${trimmedBaseUrl}/api/openclaw/commands/confirm`
  }

  if (!Number.isFinite(Number(main.cardConfirmTimeoutMs)) || Number(main.cardConfirmTimeoutMs) <= 0) {
    main.cardConfirmTimeoutMs = 10000
  }

  root.main = main
  return JSON.stringify(root, null, 2)
}

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

// minimal mode only: advanced priority ASIN helpers removed

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
  const [gatewayReloading, setGatewayReloading] = useState(false)
  const [gatewaySkillsCollapsed, setGatewaySkillsCollapsed] = useState(true)
  const [gatewayShowAvailableOnly, setGatewayShowAvailableOnly] = useState(true)
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatusResponse | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceBootstrapping, setWorkspaceBootstrapping] = useState(false)
  const workspaceAutoBootstrapTriedRef = useRef(false)
  const [asinData, setAsinData] = useState<AsinDataResponse | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [asinUploading, setAsinUploading] = useState(false)
  const [asinSource, setAsinSource] = useState('manual')
  const [asinDefaultCountry, setAsinDefaultCountry] = useState('US')
  const [strategyRunning, setStrategyRunning] = useState(false)
  const [strategyPreset, setStrategyPreset] = useState('balanced')
  const [strategyCronPreset, setStrategyCronPreset] = useState('daily_morning')
  const [strategyAccountIdsDraft, setStrategyAccountIdsDraft] = useState('')
  const [feishuTestLoading, setFeishuTestLoading] = useState(false)
  const [feishuTestResult, setFeishuTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [showFeishuAdvanced, setShowFeishuAdvanced] = useState(false)
  const [feishuCardVerificationToken, setFeishuCardVerificationToken] = useState('')
  const [feishuCardEncryptKey, setFeishuCardEncryptKey] = useState('')
  const [aiJsonError, setAiJsonError] = useState<string | null>(null)

  useEffect(() => {
    setStrategyAccountIdsDraft(formatStrategyAccountIdsForDraft(userValues.openclaw_strategy_ads_account_ids || ''))
  }, [userValues.openclaw_strategy_ads_account_ids])

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

        Object.entries(USER_DEFAULT_VALUES).forEach(([key, defaultValue]) => {
          const current = userMap[key]
          if (current === undefined || current === null || String(current).trim() === '') {
            userMap[key] = defaultValue
          }
        })

        const cardSettings = parseFeishuCardSettingsFromAccountsJson(userMap.feishu_accounts_json)
        setFeishuCardVerificationToken(cardSettings.verificationToken)
        setFeishuCardEncryptKey(cardSettings.encryptKey)

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
    loadWorkspaceStatus(false, () => active)
    return () => {
      active = false
    }
  }, [reportDate, refreshKey])

  const appBaseUrl = useMemo(() => {
    const fromEnv = (process.env.NEXT_PUBLIC_APP_URL || '').trim()
    if (fromEnv) return fromEnv.replace(/\/+$/, '')
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin.replace(/\/+$/, '')
    }
    return ''
  }, [])

  const strategySaveKeys = [...STRATEGY_USER_KEYS]

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

  const loadWorkspaceStatus = async (force = false, isActive?: () => boolean) => {
    setWorkspaceLoading(true)
    try {
      const response = await fetch(
        `/api/openclaw/workspace/status${force ? '?force=1' : ''}`,
        { credentials: 'include' }
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'SOUL 工作区状态获取失败')
      }
      if (isActive && !isActive()) return

      const missingFiles = Array.isArray(payload?.missingFiles) ? payload.missingFiles.length : 0
      const missingDailyMemory = payload?.dailyMemoryExists === false
      const needsBootstrap = payload?.success && (missingFiles > 0 || missingDailyMemory)

      if (!force && needsBootstrap && !workspaceAutoBootstrapTriedRef.current) {
        workspaceAutoBootstrapTriedRef.current = true
        setWorkspaceStatus(payload)
        await handleWorkspaceBootstrap({ silent: true })
        return
      }

      setWorkspaceStatus(payload)
    } catch (error: any) {
      if (isActive && !isActive()) return
      setWorkspaceStatus({
        success: false,
        error: error?.message || 'SOUL 工作区状态获取失败',
      })
    } finally {
      if (isActive && !isActive()) return
      setWorkspaceLoading(false)
    }
  }

  const handleWorkspaceBootstrap = async (options?: { silent?: boolean }): Promise<boolean> => {
    const silent = options?.silent === true
    setWorkspaceBootstrapping(true)
    try {
      const response = await fetch('/api/openclaw/workspace/bootstrap', {
        method: 'POST',
        credentials: 'include',
      })
      const payload = (await response.json().catch(() => null)) as WorkspaceBootstrapResponse | null
      if (!response.ok) {
        throw new Error(payload?.error || 'SOUL 工作区补齐失败')
      }

      if (payload?.status && typeof payload.status === 'object') {
        setWorkspaceStatus(payload.status)
      } else {
        await loadWorkspaceStatus(true)
      }

      const changedCount = payload?.changedFiles?.length || 0
      if (!silent) {
        toast.success(changedCount > 0 ? `工作区已补齐（${changedCount} 个文件）` : '工作区已是最新状态')
      }
      return true
    } catch (error: any) {
      if (!silent) {
        toast.error(error?.message || 'SOUL 工作区补齐失败')
      }
      return false
    } finally {
      setWorkspaceBootstrapping(false)
    }
  }

  const handleWorkspaceBootstrapAndReload = async () => {
    if (settings?.isAdmin !== true) {
      toast.error('仅管理员可执行补齐并热加载')
      return
    }

    const bootstrapSuccess = await handleWorkspaceBootstrap()
    if (!bootstrapSuccess) {
      return
    }

    await handleGatewayHotReload()
  }

  const handleGatewayHotReload = async () => {
    if (settings?.isAdmin !== true) {
      toast.error('仅管理员可执行配置热加载')
      return
    }

    setGatewayReloading(true)
    try {
      const response = await fetch('/api/openclaw/gateway/reload', {
        method: 'POST',
        credentials: 'include',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || '配置热加载失败')
      }

      const nextGatewayStatus = payload?.gatewayStatus
      if (nextGatewayStatus && typeof nextGatewayStatus === 'object') {
        setGatewayStatus(nextGatewayStatus as GatewayStatusResponse)
      } else {
        await loadGatewayStatus(true)
      }

      toast.success(payload?.message || '配置已同步并触发 Gateway 热加载')
    } catch (error: any) {
      toast.error(error?.message || '配置热加载失败')
    } finally {
      setGatewayReloading(false)
    }
  }

  const saveSettings = async (params: {
    scope: 'user' | 'global'
    keys?: string[]
    successMessage?: string
  }) => {
    const { scope, keys, successMessage } = params

    const normalizedUserValues: Record<string, string> = {
      ...userValues,
      [AUTOADS_ONLY_SETTING_KEY]: 'true',
    }

    const selectedKeySet = keys && keys.length > 0 ? new Set(keys) : null

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

      const isSavingFeishuSettings = !selectedKeySet || FEISHU_CHAT_USER_KEYS.some((key) => selectedKeySet.has(key))
      if (isSavingFeishuSettings) {
        const hasVerificationToken = hasText(feishuCardVerificationToken)
        const hasEncryptKey = hasText(feishuCardEncryptKey)

        if (!hasVerificationToken || !hasEncryptKey) {
          toast.error('飞书交互卡片参数为必填，请填写 Verification Token 和 Encrypt Key')
          return
        }

        if (!settings?.userId) {
          toast.error('无法识别当前用户ID，请刷新页面后重试')
          return
        }

        const generatedFeishuAccountsJson = buildAutoFeishuAccountsJson({
          existingValue: normalizedUserValues.feishu_accounts_json,
          userId: settings.userId,
          appBaseUrl,
          verificationToken: feishuCardVerificationToken,
          encryptKey: feishuCardEncryptKey,
        })

        normalizedUserValues.feishu_accounts_json = generatedFeishuAccountsJson
        setUserValues((prev) => ({ ...prev, feishu_accounts_json: generatedFeishuAccountsJson }))

        const hasAppSecret = hasText(normalizedUserValues.feishu_app_secret)
        if (!hasAppSecret) {
          toast.error('飞书 App Secret 为必填项')
          return
        }
      }

      const isSavingAffiliateSettings = !selectedKeySet || AFFILIATE_USER_KEYS.some((key) => selectedKeySet.has(key))
      if (isSavingAffiliateSettings) {
        const syncEnabled = isTruthy(normalizedUserValues.openclaw_affiliate_sync_enabled, false)
        normalizedUserValues.openclaw_affiliate_sync_enabled = syncEnabled ? 'true' : 'false'

        const syncIntervalRaw = String(normalizedUserValues.openclaw_affiliate_sync_interval_hours || '').trim()
        const syncIntervalParsed = Number(syncIntervalRaw || USER_DEFAULT_VALUES.openclaw_affiliate_sync_interval_hours)
        if (!Number.isFinite(syncIntervalParsed) || syncIntervalParsed <= 0) {
          toast.error('联盟成交/佣金同步间隔必须为正整数（小时）')
          return
        }
        normalizedUserValues.openclaw_affiliate_sync_interval_hours = String(Math.min(24, Math.max(1, Math.round(syncIntervalParsed))))

        const syncModeRaw = String(normalizedUserValues.openclaw_affiliate_sync_mode || '').trim().toLowerCase()
        normalizedUserValues.openclaw_affiliate_sync_mode = syncModeRaw === 'realtime' ? 'realtime' : 'incremental'
      }
    }
    const updates = Object.entries(normalizedUserValues)
      .filter(([key]) => USER_KEYS.has(key))
      .filter(([key]) => !selectedKeySet || selectedKeySet.has(key))
      .filter(([key]) => (scope === 'global' ? AI_GLOBAL_KEY_SET.has(key) : !AI_GLOBAL_KEY_SET.has(key)))
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
    const exampleValues: Record<string, string> = {
      openclaw_strategy_enabled: STRATEGY_EXAMPLE_VALUES.openclaw_strategy_enabled,
      openclaw_strategy_cron: STRATEGY_EXAMPLE_VALUES.openclaw_strategy_cron,
      openclaw_strategy_ads_account_ids: STRATEGY_EXAMPLE_VALUES.openclaw_strategy_ads_account_ids,
      openclaw_strategy_enforce_autoads_only: 'true',
    }
    setUserValues(prev => ({
      ...prev,
      ...exampleValues,
    }))
  }

  const applyStrategyPreset = (presetId: string) => {
    setStrategyPreset(presetId)
    const preset = STRATEGY_PRESET_OPTIONS.find(option => option.id === presetId)
    if (!preset) return
    const presetValues: Record<string, string> = {
      openclaw_strategy_enabled: preset.values.openclaw_strategy_enabled,
      openclaw_strategy_cron: preset.values.openclaw_strategy_cron,
      openclaw_strategy_ads_account_ids: preset.values.openclaw_strategy_ads_account_ids,
      openclaw_strategy_enforce_autoads_only: 'true',
    }
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

  const handleFeishuTestConnection = async () => {
    const appId = (userValues.feishu_app_id || '').trim()
    const appSecret = (userValues.feishu_app_secret || '').trim()
    const target = (userValues.feishu_target || '').trim()
    const cardVerificationToken = feishuCardVerificationToken.trim()
    const cardEncryptKey = feishuCardEncryptKey.trim()

    if (!appId) {
      toast.error('请先填写飞书 App ID')
      return
    }
    if (!appSecret) {
      toast.error('请先填写飞书 App Secret')
      return
    }
    if (!target) {
      toast.error('请先填写飞书推送目标')
      return
    }
    if (!cardVerificationToken || !cardEncryptKey) {
      toast.error('请先填写交互卡片参数（Verification Token / Encrypt Key）')
      return
    }

    setFeishuTestLoading(true)
    setFeishuTestResult(null)
    try {
      const response = await fetch('/api/openclaw/feishu/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          appId,
          appSecret,
          domain: userValues.feishu_domain || 'feishu',
          target,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload?.success) {
        setFeishuTestResult({ ok: true, message: payload?.message || 'Feishu 连接正常' })
      } else {
        setFeishuTestResult({ ok: false, message: payload?.error || '连接失败' })
      }
    } catch (error: any) {
      setFeishuTestResult({ ok: false, message: error?.message || '连接测试失败' })
    } finally {
      setFeishuTestLoading(false)
    }
  }

  const handleFormatAiJson = () => {
    const raw = userValues.ai_models_json || ''
    if (!raw.trim()) return
    try {
      const parsed = JSON.parse(raw)
      setUserValue('ai_models_json', JSON.stringify(parsed, null, 2))
      setAiJsonError(null)
    } catch (e: any) {
      setAiJsonError(e?.message || 'JSON 格式错误')
    }
  }

  const validateAiJson = (value: string): string | null => {
    return parseAiModelsJson(value).parseError
  }

  const aiModelsInfo = useMemo(
    () => parseAiModelsJson(userValues.ai_models_json || ''),
    [userValues.ai_models_json]
  )
  const aiModelOptions = aiModelsInfo.modelOptions
  const aiSelectedModelRef = aiModelsInfo.selectedModelRef
  const aiSelectedModelMeta = aiModelOptions.find((option) => option.modelRef === aiSelectedModelRef) || null

  const handleAiModelChange = (nextModelRef: string) => {
    const result = setAiModelsSelectedModel(userValues.ai_models_json || '', nextModelRef)
    if (result.error) {
      setAiJsonError(result.error)
      toast.error(result.error)
      return
    }

    setUserValue('ai_models_json', result.json)
    setAiJsonError(null)
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
  const totalRevenueRaw = reportRoi?.totalRevenue
  const totalRevenue = totalRevenueRaw === null || totalRevenueRaw === undefined
    ? null
    : Number(totalRevenueRaw)
  const roiRevenueAvailable = reportRoi?.revenueAvailable !== false
    && totalRevenue !== null
    && Number.isFinite(totalRevenue)
  const reportRoas = roiRevenueAvailable
    ? (reportRoi?.roas !== undefined
      ? (Number(reportRoi.roas) || 0)
      : (totalCost > 0 ? (totalRevenue || 0) / totalCost : 0))
    : null
  const roiRevenueSource = String(reportRoi.revenueSource || 'unavailable')
  const usingAffiliateCommissionRevenue = roiRevenueAvailable && roiRevenueSource === 'affiliate_commission'
  const roiUnavailableReason = String(reportRoi.unavailableReason || '')
  const affiliateRevenueBreakdown = Array.isArray(reportRoi.affiliateBreakdown)
    ? reportRoi.affiliateBreakdown as Array<{ platform?: string; totalCommission?: number; records?: number }>
    : []
  const revenueTitle = 'Commission Revenue'
  const reportRevenueValue: string | number = roiRevenueAvailable ? (totalRevenue || 0) : '—'
  const reportRoasValue = roiRevenueAvailable && reportRoas !== null ? `${reportRoas.toFixed(2)}x` : '—'
  const reportRoiValue = roiRevenueAvailable && reportRoi.roi !== null && reportRoi.roi !== undefined
    ? `${reportRoi.roi}%`
    : '—'
  const reportProfitValue: string | number = roiRevenueAvailable && reportRoi.totalProfit !== null && reportRoi.totalProfit !== undefined
    ? reportRoi.totalProfit
    : '—'
  const roiUnavailableHint = roiUnavailableReason === 'affiliate_not_configured'
    ? '未配置联盟平台参数，严格模式下不回退 AutoAds 收益。'
    : '联盟平台佣金查询失败或暂无返回，严格模式下不回退 AutoAds 收益。'
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
  const gatewaySkillsRows = useMemo<GatewaySkillRow[]>(() => {
    return gatewaySkillsList.map((skill: any) => {
      const missing = skill?.missing || {}
      const missingItems = [
        ...(missing?.bins || []),
        ...(missing?.anyBins || []),
        ...(missing?.env || []),
        ...(missing?.config || []),
        ...(missing?.os || []),
      ].filter((value): value is string => Boolean(value))
      const isReady = !skill?.disabled && !skill?.blockedByAllowlist && Boolean(skill?.eligible) && missingItems.length === 0
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

      return {
        skill,
        missingItems,
        isReady,
        status,
        installHint,
      }
    })
  }, [gatewaySkillsList])
  const gatewayVisibleSkills = gatewayShowAvailableOnly
    ? gatewaySkillsRows.filter((item) => item.isReady)
    : gatewaySkillsRows
  const workspaceFiles = Array.isArray(workspaceStatus?.files) ? workspaceStatus.files : []
  const workspaceMissingFiles = Array.isArray(workspaceStatus?.missingFiles) ? workspaceStatus.missingFiles : []
  const workspaceReady = Boolean(
    workspaceStatus?.success
    && workspaceMissingFiles.length === 0
    && workspaceStatus.dailyMemoryExists
  )
  const workspaceSourceLabel = workspaceStatus?.source === 'runtime-config'
    ? '运行时配置'
    : workspaceStatus?.source === 'computed'
      ? '计算结果'
      : '未知'
  const canReloadFromWorkspace = workspaceStatus?.canReloadGateway ?? (settings?.isAdmin === true)
  const canEditAiSettings = settings?.isAdmin === true
  const aiConfigured = Boolean((userValues.ai_models_json || '').trim())
  const aiModelLabel = aiSelectedModelMeta
    ? `${aiSelectedModelMeta.modelName}（${aiSelectedModelMeta.modelRef}）`
    : aiSelectedModelRef

  const canRunFeishuConnectionTest =
    hasText(userValues.feishu_app_id)
    && hasText(userValues.feishu_app_secret)
    && hasText(userValues.feishu_target)
    && hasText(feishuCardVerificationToken)
    && hasText(feishuCardEncryptKey)

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
      done: canEditAiSettings ? aiConfigured : true,
      note: canEditAiSettings
        ? (aiConfigured ? (aiModelLabel ? '当前：' + aiModelLabel : '已配置 Providers JSON') : '未配置')
        : '成员无需配置（管理员统一维护）',
    },
    {
      id: 'feishu_user',
      label: '飞书账号',
      done: canRunFeishuConnectionTest,
      note: canRunFeishuConnectionTest ? '可进行 Feishu 连通测试' : '缺少飞书必填参数',
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
  const strategyAccountIdsCount = (() => {
    if (!strategyAccountIdsNormalized) return 0
    try {
      const parsed = JSON.parse(strategyAccountIdsNormalized)
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  })()
  const strategyCronHasError = Boolean(strategyCronValue.trim()) && !isLikelyCronExpression(strategyCronValue)
  const strategyAccountIdsHasError = strategyAccountIdsNormalized === null
  const aiDirty = hasUserDirtyFields(AI_GLOBAL_EDIT_KEYS)
  const aiSectionDirty = canEditAiSettings && aiDirty
  const savedFeishuCardSettings = parseFeishuCardSettingsFromAccountsJson(savedUserValues.feishu_accounts_json)
  const feishuCardDirty =
    feishuCardVerificationToken !== savedFeishuCardSettings.verificationToken ||
    feishuCardEncryptKey !== savedFeishuCardSettings.encryptKey
  const feishuChatDirty = hasUserDirtyFields(FEISHU_CHAT_USER_KEYS) || feishuCardDirty
  const feishuCardPairConfigured = hasText(feishuCardVerificationToken) && hasText(feishuCardEncryptKey)
  const feishuCardPairInvalid = hasText(feishuCardVerificationToken) !== hasText(feishuCardEncryptKey)
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

      <Tabs defaultValue="config">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="config">配置中心</TabsTrigger>
          <TabsTrigger value="strategy">策略中心</TabsTrigger>
          <TabsTrigger value="report">每日报表</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-6">
          <div className="text-sm text-slate-500">完成以下配置以启用 OpenClaw 全部功能</div>

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
              <div className="flex items-center gap-2">
                {canEditAiSettings && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleGatewayHotReload}
                    disabled={gatewayLoading || gatewayReloading}
                  >
                    {gatewayReloading ? '热加载中...' : '配置热加载'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadGatewayStatus(true)}
                  disabled={gatewayLoading || gatewayReloading}
                >
                  {gatewayLoading ? '刷新中...' : '刷新'}
                </Button>
              </div>
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
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-700">技能状态</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="whitespace-nowrap">
                          可用 {gatewaySkillsSummary.ready}/{gatewaySkillsSummary.total}
                        </Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setGatewaySkillsCollapsed((prev) => !prev)}
                        >
                          {gatewaySkillsCollapsed ? '展开列表' : '收起列表'}
                        </Button>
                      </div>
                    </div>
                    {gatewaySkillsCollapsed ? (
                      <div className="text-sm text-slate-500">
                        默认仅展示“可用”技能，点击“展开列表”查看明细。
                      </div>
                    ) : gatewaySkillsList.length > 0 ? (
                      <div className="space-y-3">
                        <div className="flex justify-end">
                          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                            <span>仅看可用</span>
                            <Switch
                              checked={gatewayShowAvailableOnly}
                              onCheckedChange={setGatewayShowAvailableOnly}
                              aria-label="仅显示可用技能"
                            />
                          </label>
                        </div>
                        {gatewayVisibleSkills.length > 0 ? (
                          <Table className="table-fixed">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[34%]">技能</TableHead>
                                <TableHead className="w-[110px] whitespace-nowrap">状态</TableHead>
                                <TableHead className="w-[34%]">缺失项</TableHead>
                                <TableHead className="w-[22%]">安装建议</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {gatewayVisibleSkills.map((item) => (
                                <TableRow key={item.skill?.skillKey || item.skill?.name}>
                                  <TableCell className="align-top">
                                    <div className="font-medium">{item.skill?.name || item.skill?.skillKey}</div>
                                    <div className="text-xs text-slate-500">{item.skill?.description}</div>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap align-top">
                                    <Badge variant={item.status.variant} className="whitespace-nowrap">
                                      {item.status.label}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="align-top text-xs text-slate-500">
                                    {item.missingItems.length > 0 ? item.missingItems.join(', ') : '—'}
                                  </TableCell>
                                  <TableCell className="align-top text-xs text-slate-500">
                                    {item.installHint || '—'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <div className="text-sm text-slate-500">暂无可用技能，点击“显示全部状态”查看其他状态。</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">暂无技能数据</div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  SOUL 工作区
                  <Badge variant={workspaceReady ? 'default' : 'secondary'} className="text-[11px]">{workspaceReady ? '已就绪' : '待补齐'}</Badge>
                </CardTitle>
                <CardDescription>检查并补齐 AGENTS/SOUL/USER/MEMORY 与每日记忆文件</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {canReloadFromWorkspace && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleWorkspaceBootstrapAndReload}
                    disabled={workspaceLoading || workspaceBootstrapping || gatewayReloading}
                  >
                    {(workspaceBootstrapping || gatewayReloading) ? '处理中...' : '补齐并热加载'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadWorkspaceStatus(true)}
                  disabled={workspaceLoading || workspaceBootstrapping}
                >
                  {workspaceLoading ? '刷新中...' : '刷新'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleWorkspaceBootstrap()}
                  disabled={workspaceBootstrapping || gatewayReloading}
                >
                  {workspaceBootstrapping ? '补齐中...' : '一键补齐'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!workspaceStatus && <div className="text-sm text-slate-500">状态加载中...</div>}
              {workspaceStatus && !workspaceStatus.success && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                  {workspaceStatus.error || 'SOUL 工作区状态获取失败'}
                </div>
              )}
              {workspaceStatus?.success && (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">工作区目录</div>
                      <div className="mt-2 text-xs break-all">{workspaceStatus.workspaceDir || '未知'}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">路径来源</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant="outline">{workspaceSourceLabel}</Badge>
                        <span className="text-xs text-slate-500">{workspaceStatus.runtimeWorkspaceDir ? 'runtime 生效' : '按规则推导'}</span>
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">缺失模板文件</div>
                      <div className="mt-2 text-lg font-semibold">{workspaceMissingFiles.length}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">今日记忆文件</div>
                      <div className="mt-2">
                        <Badge variant={workspaceStatus.dailyMemoryExists ? 'default' : 'secondary'}>
                          {workspaceStatus.dailyMemoryExists ? '已生成' : '未生成'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {workspaceStatus.dailyMemoryPath && (
                    <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600 break-all">
                      每日记忆路径：{workspaceStatus.dailyMemoryPath}
                    </div>
                  )}

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[20%]">文件</TableHead>
                        <TableHead className="w-[16%]">状态</TableHead>
                        <TableHead className="w-[44%]">路径</TableHead>
                        <TableHead className="w-[20%]">更新时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workspaceFiles.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-slate-500">暂无文件状态</TableCell>
                        </TableRow>
                      )}
                      {workspaceFiles.map((file) => (
                        <TableRow key={file.path}>
                          <TableCell className="font-medium">{file.name}</TableCell>
                          <TableCell>
                            <Badge variant={file.exists ? 'default' : 'destructive'}>{file.exists ? '已存在' : '缺失'}</Badge>
                          </TableCell>
                          <TableCell className="text-xs break-all text-slate-600">{file.path}</TableCell>
                          <TableCell className="text-xs text-slate-500">{formatTimestamp(file.updatedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {workspaceMissingFiles.length > 0 && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      缺失文件：{workspaceMissingFiles.join(', ')}。点击“一键补齐”自动创建。
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                AI 引擎
                <Badge variant="secondary" className="text-[11px]">全局配置</Badge>
                <Badge variant={canEditAiSettings ? 'default' : 'outline'} className="text-[11px]">
                  {canEditAiSettings ? '管理员可编辑' : '成员只读'}
                </Badge>
                {aiSectionDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="AI 配置未保存" />}
              </CardTitle>
              <CardDescription>
                全局配置：仅管理员可修改；普通成员只读查看当前生效模型
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canEditAiSettings && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  当前账号为普通成员，仅可查看 AI 引擎配置。请联系管理员修改。
                </div>
              )}
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                JSON 格式：顶层 providers 对象，每个 provider 包含 baseUrl、apiKey、api 和 models 数组。详见配置指南。
              </div>
              <div className="grid gap-4 rounded-md border px-3 py-3 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">当前给 OpenClaw 使用的模型</div>
                  <div className="truncate text-sm font-medium" title={aiModelLabel || '未识别'}>
                    {aiModelLabel || '未识别（请检查 Providers JSON）'}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">切换模型</label>
                  <Select
                    value={aiSelectedModelRef || undefined}
                    onValueChange={handleAiModelChange}
                    disabled={!canEditAiSettings || Boolean(aiModelsInfo.parseError) || aiModelOptions.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={aiModelOptions.length > 0 ? '选择可用模型' : '暂无可用模型'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {aiModelOptions.map((option) => (
                        <SelectItem key={option.modelRef} value={option.modelRef}>
                          {option.modelName} ({option.modelRef})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {!aiModelsInfo.parseError && aiConfigured && aiModelOptions.length === 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  当前 JSON 中未解析到可用模型，请确认 models.providers.[provider].models 配置。
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Providers JSON
                  <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFormatAiJson}
                    disabled={!canEditAiSettings}
                  >
                    格式化JSON
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUserValue('ai_models_json', AI_MINIMAL_PLACEHOLDER)
                      setAiJsonError(null)
                    }}
                    disabled={!canEditAiSettings}
                  >
                    最小模板
                  </Button>
                </div>
              </div>
              {aiJsonError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  JSON 格式错误：{aiJsonError}
                </div>
              )}
              <Textarea
                value={userValues.ai_models_json || ''}
                onChange={(e) => {
                  setUserValue('ai_models_json', e.target.value)
                  setAiJsonError(validateAiJson(e.target.value))
                }}
                placeholder={AI_MINIMAL_PLACEHOLDER}
                rows={10}
                disabled={!canEditAiSettings}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => {
                    const jsonErr = validateAiJson(userValues.ai_models_json || '')
                    if (jsonErr) {
                      setAiJsonError(jsonErr)
                      toast.error('AI Providers JSON 格式错误，请修正后再保存')
                      return
                    }
                    setAiJsonError(null)
                    saveSettings({ scope: 'global', keys: [...AI_GLOBAL_KEYS], successMessage: 'AI 配置已保存（全局）' })
                  }}
                  disabled={savingUser || !canEditAiSettings}
                >
                  {savingUser ? '保存中...' : aiSectionDirty ? '保存 AI 配置 *' : '保存 AI 配置'}
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
              <CardDescription>最小必填：App ID / App Secret / 推送目标 / 交互卡片参数</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2 text-xs">
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-slate-600 space-y-1">
                  <div className="font-medium text-slate-800">聊天参数（* 为必需）</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 飞书 App ID</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 飞书 App Secret</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 飞书推送目标（open_id / union_id / chat_id）</div>
                </div>
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-slate-600 space-y-1">
                  <div className="font-medium text-slate-800">交互卡片参数（* 为必需）</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 卡片 Verification Token</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 卡片 Encrypt Key</div>
                  <div>卡片回调路径 / 确认回调 URL 自动生成。</div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-600">高级参数（通信鉴权）默认已预置，按需展开</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFeishuAdvanced((prev) => !prev)}
                >
                  {showFeishuAdvanced ? '收起高级参数' : '展开高级参数'}
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <InputWithLabel
                  label="飞书 App ID"
                  required
                  value={userValues.feishu_app_id || ''}
                  onChange={(v) => setUserValue('feishu_app_id', v)}
                  placeholder={FEISHU_BASIC_EXAMPLE_VALUES.feishu_app_id}
                />
                <InputWithLabel
                  label="飞书推送目标（open_id / union_id / chat_id）"
                  required
                  value={userValues.feishu_target || ''}
                  onChange={(v) => setUserValue('feishu_target', v)}
                  placeholder={FEISHU_BASIC_EXAMPLE_VALUES.feishu_target}
                />
                <InputWithLabel
                  label="飞书 App Secret"
                  required
                  type="password"
                  value={userValues.feishu_app_secret || ''}
                  onChange={(v) => setUserValue('feishu_app_secret', v)}
                  placeholder={FEISHU_BASIC_EXAMPLE_VALUES.feishu_app_secret}
                />
                <InputWithLabel
                  label="卡片 Verification Token"
                  required
                  value={feishuCardVerificationToken}
                  onChange={setFeishuCardVerificationToken}
                  placeholder="v1_verify_xxx"
                />
                <InputWithLabel
                  label="卡片 Encrypt Key"
                  required
                  value={feishuCardEncryptKey}
                  onChange={setFeishuCardEncryptKey}
                  placeholder="encrypt_key_xxx"
                />
              </div>

              {showFeishuAdvanced && (
                <>
                  <div className="rounded-md border px-4 py-3 space-y-4">
                    <div className="text-sm font-medium">通信与鉴权（建议配置，已预置默认值）</div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">飞书域名</label>
                        <Select
                          value={userValues.feishu_domain || 'feishu'}
                          onValueChange={(v) => setUserValue('feishu_domain', v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择域名" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="feishu">feishu</SelectItem>
                            <SelectItem value="lark">lark</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <InputWithLabel
                        label="Bot 展示名（可选）"
                        value={userValues.feishu_bot_name || ''}
                        onChange={(v) => setUserValue('feishu_bot_name', v)}
                        placeholder="OpenClaw 助手"
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">鉴权模式</label>
                        <Select
                          value={userValues.feishu_auth_mode || 'strict'}
                          onValueChange={(v) => setUserValue('feishu_auth_mode', v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择模式" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="strict">strict（推荐）</SelectItem>
                            <SelectItem value="compat">compat（兼容）</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <SwitchWithLabel
                        label="Require Tenant Key"
                        checked={isTruthy(userValues.feishu_require_tenant_key, true)}
                        onChange={(val) => setUserValue('feishu_require_tenant_key', val ? 'true' : 'false')}
                      />
                      <SwitchWithLabel
                        label="Strict Auto Bind"
                        checked={isTruthy(userValues.feishu_strict_auto_bind, true)}
                        onChange={(val) => setUserValue('feishu_strict_auto_bind', val ? 'true' : 'false')}
                      />
                    </div>

                    <p className="text-xs text-slate-500">
                      默认已自动填写：domain=feishu、authMode=strict、Require Tenant Key=true、Strict Auto Bind=true。仅在迁移历史账号时短暂使用 compat。
                    </p>
                  </div>
                </>
              )}

              <div className="grid gap-2 md:grid-cols-3 text-xs">
                <div className={hasText(userValues.feishu_app_id) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_app_id) ? '✓ App ID 已填写' : '• App ID 未填写'}
                </div>
                <div className={hasText(userValues.feishu_app_secret) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_app_secret)
                    ? '✓ Secret 已填写'
                    : '• Secret 未填写'}
                </div>
                <div className={hasText(userValues.feishu_target) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_target) ? '✓ 推送目标已填写' : '• 推送目标未填写'}
                </div>
                <div className={hasText(feishuCardVerificationToken) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(feishuCardVerificationToken) ? '✓ Verification Token 已填写' : '• Verification Token 未填写'}
                </div>
                <div className={hasText(feishuCardEncryptKey) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(feishuCardEncryptKey) ? '✓ Encrypt Key 已填写' : '• Encrypt Key 未填写'}
                </div>
                {showFeishuAdvanced && (
                  <>
                    <div className={isTruthy(userValues.feishu_require_tenant_key, true) ? 'text-emerald-600' : 'text-amber-600'}>
                      {isTruthy(userValues.feishu_require_tenant_key, true)
                        ? '✓ Tenant Key 校验已启用'
                        : '• Tenant Key 校验未启用（兼容模式）'}
                    </div>
                    <div className={isTruthy(userValues.feishu_strict_auto_bind, true) ? 'text-emerald-600' : 'text-amber-600'}>
                      {isTruthy(userValues.feishu_strict_auto_bind, true)
                        ? '✓ Strict Auto Bind 已启用'
                        : '• Strict Auto Bind 未启用'}
                    </div>
                    <div className={(userValues.feishu_auth_mode || 'strict') === 'strict' ? 'text-emerald-600' : 'text-amber-600'}>
                      {(userValues.feishu_auth_mode || 'strict') === 'strict'
                        ? '✓ 鉴权模式 strict'
                        : '• 鉴权模式 compat（迁移用）'}
                    </div>
                  </>
                )}
              </div>

              {showFeishuAdvanced && (
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-1">
                  <div>卡片回调路径（自动）: <code>{settings?.userId ? `/feishu/user-${settings.userId}/card-action` : '/feishu/card-action'}</code></div>
                  <div>确认回调 URL（自动）: <code>{appBaseUrl ? `${appBaseUrl}/api/openclaw/commands/confirm` : '/api/openclaw/commands/confirm'}</code></div>
                  <div className={feishuCardPairInvalid ? 'text-red-600' : 'text-slate-600'}>
                    {feishuCardPairInvalid
                      ? 'Verification Token 与 Encrypt Key 需同时填写或同时留空'
                      : feishuCardPairConfigured
                        ? '✅ 交互卡片参数已配置'
                        : '未配置交互卡片参数（如需卡片交互请填写）'}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFeishuTestConnection}
                    disabled={feishuTestLoading || !canRunFeishuConnectionTest}
                    title={canRunFeishuConnectionTest ? undefined : '请先填写飞书必填参数（含卡片 Verification/Encrypt Key）'}
                  >
                    {feishuTestLoading ? '测试中...' : '测试连接'}
                  </Button>
                  {feishuTestResult && (
                    <Badge variant={feishuTestResult.ok ? 'default' : 'destructive'}>
                      {feishuTestResult.ok ? '连接成功' : feishuTestResult.message}
                    </Badge>
                  )}
                </div>
                <Button
                  onClick={() => saveSettings({ scope: 'user', keys: [...FEISHU_CHAT_USER_KEYS], successMessage: '飞书配置已保存' })}
                  disabled={savingUser || !canRunFeishuConnectionTest}
                  title={canRunFeishuConnectionTest ? undefined : '请先填写飞书必填参数（含卡片 Verification/Encrypt Key）'}
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
              <CardDescription>按平台分行填写：YeahPromos 与 PartnerBoost，避免参数混填</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                只需填写你要启用的平台参数；未填写的平台不会参与本次联盟商品补全。
              </div>

              <div className="space-y-4">
                <div className="rounded-md border px-4 py-3 space-y-3">
                  <div className="text-sm font-medium">YeahPromos</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <InputWithLabel
                      label="Token"
                      type="password"
                      required={Boolean((userValues.yeahpromos_site_id || '').trim())}
                      value={userValues.yeahpromos_token || ''}
                      onChange={(v) => setUserValue('yeahpromos_token', v)}
                    />
                    <InputWithLabel
                      label="Site ID"
                      required={Boolean((userValues.yeahpromos_token || '').trim())}
                      value={userValues.yeahpromos_site_id || ''}
                      onChange={(v) => setUserValue('yeahpromos_site_id', v)}
                    />
                  </div>
                </div>

                <div className="rounded-md border px-4 py-3 space-y-3">
                  <div className="text-sm font-medium">PartnerBoost</div>
                  <p className="text-xs text-slate-500">Base URL 默认已填，可直接使用。</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <InputWithLabel
                      label="Token"
                      type="password"
                      value={userValues.partnerboost_token || ''}
                      onChange={(v) => setUserValue('partnerboost_token', v)}
                    />
                    <InputWithLabel
                      label="Base URL（可选）"
                      value={userValues.partnerboost_base_url || ''}
                      onChange={(v) => setUserValue('partnerboost_base_url', v)}
                      placeholder="https://app.partnerboost.com"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-md border px-4 py-3 space-y-3">
                <div className="text-sm font-medium">联盟成交 / 佣金数据同步</div>
                <p className="text-xs text-slate-500">
                  参考系统配置“广告数据自动同步”：按间隔刷新当日佣金快照，并支持 Feishu 查询实时拉取。
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                  <SwitchWithLabel
                    label="启用自动同步"
                    checked={isTruthy(userValues.openclaw_affiliate_sync_enabled, false)}
                    onChange={(val) => setUserValue('openclaw_affiliate_sync_enabled', val ? 'true' : 'false')}
                  />
                  <InputWithLabel
                    label="同步间隔（小时）"
                    value={userValues.openclaw_affiliate_sync_interval_hours || USER_DEFAULT_VALUES.openclaw_affiliate_sync_interval_hours}
                    onChange={(v) => setUserValue('openclaw_affiliate_sync_interval_hours', v)}
                    placeholder={USER_DEFAULT_VALUES.openclaw_affiliate_sync_interval_hours}
                  />
                  <div className="space-y-2">
                    <label className="text-sm font-medium">同步模式</label>
                    <Select
                      value={userValues.openclaw_affiliate_sync_mode || USER_DEFAULT_VALUES.openclaw_affiliate_sync_mode}
                      onValueChange={(v) => setUserValue('openclaw_affiliate_sync_mode', v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择模式" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="incremental">incremental（推荐）</SelectItem>
                        <SelectItem value="realtime">realtime（Feishu实时）</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-1">
                  <div>incremental：每小时任务按配置间隔刷新当日佣金快照。</div>
                  <div>realtime：在上述基础上，Feishu 查询日报默认强制实时拉取联盟佣金。</div>
                </div>
              </div>

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
              <CardDescription>仅保留最小参数：启用、调度、Ads账号ID</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
                建议顺序：①选预设 → ②确认调度频率 → ③填写 Ads 账号ID → ④保存策略配置
              </div>

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
                  required
                  checked={isTruthy(userValues.openclaw_strategy_enabled, false)}
                  onChange={(val) => setUserValue('openclaw_strategy_enabled', val ? 'true' : 'false')}
                />
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    调度频率
                    <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
                  </label>
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
                  required
                  checked={isTruthy(userValues.openclaw_strategy_enforce_autoads_only, true)}
                  onChange={(val) => setUserValue(AUTOADS_ONLY_SETTING_KEY, val ? 'true' : 'false')}
                  disabled
                />
              </div>
              <p className="text-xs text-slate-500">仅通过 AutoAds 接口执行 Offer创建 / 创意生成 / 广告发布，手工Campaign冲突将被阻断。</p>

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

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Ads账号ID列表
                  <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
                </label>
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
                  <label className="text-sm font-medium">上传文件</label>
                  <Input
                    type="file"
                    accept=".csv,.json,.xlsx,.xls"
                    onChange={(e) => handleAsinUpload(e.target.files?.[0] || null)}
                    disabled={asinUploading}
                  />
                  <p className="text-xs text-slate-500">支持列：asin/country_code/priority。导入后可在下方预览。</p>
                </div>
              </div>

              <div className="grid gap-3 md:auto-rows-fr md:grid-cols-4">
                <KpiCard title="输入批次" value={asinData?.stats?.inputs || 0} />
                <KpiCard title="总条目" value={asinData?.stats?.items || 0} />
                <KpiCard title="待处理" value={asinData?.stats?.pending || 0} />
                <KpiCard title="失败" value={asinData?.stats?.error || 0} />
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>ASIN</TableHead>
                    <TableHead>国家</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>优先级</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(asinData?.items || []).slice(0, 30).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.id}</TableCell>
                      <TableCell>{item.asin || '-'}</TableCell>
                      <TableCell>{item.country_code || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={item.status === 'error' ? 'destructive' : 'secondary'}>{item.status}</Badge>
                      </TableCell>
                      <TableCell>{item.priority ?? '-'}</TableCell>
                      <TableCell>{item.created_at}</TableCell>
                    </TableRow>
                  ))}
                  {(asinData?.items || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500">暂无ASIN数据</TableCell>
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
              <div className="space-y-2">
                <label className="text-sm font-medium">报表日期</label>
                <Input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  className="max-w-[200px]"
                />
              </div>
              {loading && <span className="text-sm text-slate-500">加载中...</span>}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:auto-rows-fr md:grid-cols-4">
            <KpiCard title="Offers" value={reportSummary.totalOffers ?? 0} />
            <KpiCard title="Campaigns" value={reportSummary.totalCampaigns ?? 0} />
            <KpiCard title={revenueTitle} value={reportRevenueValue} />
            <KpiCard title="ROAS" value={reportRoasValue} />
          </div>

          <div className="grid gap-4 md:auto-rows-fr md:grid-cols-4">
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
            <CardContent className="grid gap-4 md:auto-rows-fr md:grid-cols-5">
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
              <CardDescription>
                {usingAffiliateCommissionRevenue
                  ? '收益口径：联盟平台佣金（PartnerBoost / YeahPromos）'
                  : '收益口径：联盟平台佣金（严格模式，当前不可用）'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {usingAffiliateCommissionRevenue && affiliateRevenueBreakdown.length > 0 && (
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  平台拆分：
                  {affiliateRevenueBreakdown.map((item) => `${item.platform || 'unknown'} ${Number(item.totalCommission || 0).toFixed(2)}（${item.records || 0}条）`).join(' | ')}
                </div>
              )}
              {!roiRevenueAvailable && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {roiUnavailableHint}
                </div>
              )}
              <div className="grid gap-4 md:auto-rows-fr md:grid-cols-5">
                <KpiCard title="Cost" value={totalCost} />
                <KpiCard title={revenueTitle} value={reportRevenueValue} />
                <KpiCard title="Profit" value={reportProfitValue} />
                <KpiCard title="ROAS" value={reportRoasValue} />
                <KpiCard title="ROI" value={reportRoiValue} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Offer ROI Top 10</CardTitle>
              <CardDescription>该表仍基于 AutoAds ROI 接口（按 Offer 聚合），用于投放表现对比</CardDescription>
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
  required?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">
        {props.label}
        {props.required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </label>
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
  required?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2">
      <span className="text-sm">
        {props.label}
        {props.required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </span>
      <Switch checked={props.checked} onCheckedChange={props.onChange} disabled={props.disabled} />
    </div>
  )
}

function KpiCard(props: { title: string; value: string | number }) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full min-h-[96px] flex-col justify-center gap-2 py-4">
        <CardDescription className="leading-none">{props.title}</CardDescription>
        <CardTitle className="text-2xl leading-none tracking-tight tabular-nums">{props.value}</CardTitle>
      </CardContent>
    </Card>
  )
}
