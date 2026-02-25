'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { showError, showSuccess } from '@/lib/toast-utils'
import { Loader2, FlaskConical, RefreshCw, PlayCircle, XCircle } from 'lucide-react'

type StrategyRecommendationType =
  | 'adjust_cpc'
  | 'adjust_budget'
  | 'offline_campaign'
  | 'expand_keywords'
  | 'add_negative_keywords'
  | 'optimize_match_type'

type StrategyRecommendationStatus =
  | 'pending'
  | 'executed'
  | 'failed'
  | 'dismissed'
  | 'stale'

const STRATEGY_SETTING_KEYS = [
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_target',
  'feishu_accounts_json',
  'feishu_domain',
  'feishu_bot_name',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
] as const

type StrategySettingKey = (typeof STRATEGY_SETTING_KEYS)[number]

type SettingItem = {
  key: string
  value: string | null
  dataType: string
  description?: string | null
  isSensitive?: boolean
}

type StrategySettingsResponse = {
  success: boolean
  settings?: SettingItem[]
  error?: string
}

type StrategyRecommendation = {
  id: string
  reportDate?: string
  campaignId: number
  recommendationType: StrategyRecommendationType
  title: string
  summary?: string | null
  reason?: string | null
  priorityScore: number
  status: StrategyRecommendationStatus
  data?: {
    campaignName?: string
    currency?: string | null
    cost?: number
    roas?: number | null
    currentCpc?: number | null
    recommendedCpc?: number | null
    currentBudget?: number | null
    recommendedBudget?: number | null
    estimatedNetImpact?: number
  }
}

type StrategyRecommendationsResponse = {
  success: boolean
  reportDate?: string
  serverDate?: string
  historicalReadOnly?: boolean
  recommendations?: StrategyRecommendation[]
  message?: string
  error?: string
  code?: string
}

type FeishuTestResponse = {
  success?: boolean
  ok?: boolean
  message?: string
  error?: string
}

const STRATEGY_SETTING_DEFAULTS: Record<StrategySettingKey, string> = {
  openclaw_strategy_enabled: 'false',
  openclaw_strategy_cron: '0 9 * * *',
  feishu_app_id: '',
  feishu_app_secret: '',
  feishu_target: '',
  feishu_accounts_json: '[]',
  feishu_domain: 'feishu',
  feishu_bot_name: '',
  feishu_auth_mode: 'strict',
  feishu_require_tenant_key: 'true',
  feishu_strict_auto_bind: 'true',
}

const SETTING_LABELS: Record<StrategySettingKey, string> = {
  openclaw_strategy_enabled: '启用自动分析',
  openclaw_strategy_cron: '分析频率 Cron',
  feishu_app_id: '飞书 App ID',
  feishu_app_secret: '飞书 App Secret',
  feishu_target: '飞书目标（open_id/union_id/chat_id）',
  feishu_accounts_json: '飞书账号映射（JSON）',
  feishu_domain: '飞书域名',
  feishu_bot_name: 'Bot 名称（可选）',
  feishu_auth_mode: '飞书鉴权模式',
  feishu_require_tenant_key: '要求 tenant_key',
  feishu_strict_auto_bind: '严格自动绑定',
}

function normalizeSettingMap(settings?: SettingItem[]): Record<StrategySettingKey, string> {
  const values: Record<StrategySettingKey, string> = { ...STRATEGY_SETTING_DEFAULTS }
  for (const item of settings || []) {
    if (!STRATEGY_SETTING_KEYS.includes(item.key as StrategySettingKey)) continue
    const key = item.key as StrategySettingKey
    values[key] = item.value ?? STRATEGY_SETTING_DEFAULTS[key]
  }
  return values
}

function parseLocalDate(value?: string | null): string {
  if (value) return value
  const now = new Date()
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function resolveRecommendationTypeLabel(type: StrategyRecommendationType): string {
  if (type === 'adjust_cpc') return 'CPC 调整'
  if (type === 'adjust_budget') return '预算调整'
  if (type === 'offline_campaign') return '下线 Campaign'
  if (type === 'expand_keywords') return '扩量关键词'
  if (type === 'add_negative_keywords') return '新增否词'
  return '匹配类型优化'
}

function resolveRecommendationStatusVariant(status: StrategyRecommendationStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'executed') return 'default'
  if (status === 'failed') return 'destructive'
  if (status === 'dismissed') return 'secondary'
  return 'outline'
}

function formatMoney(value: unknown, currency?: string | null): string {
  if (value === null || value === undefined) return '--'
  const num = Number(value)
  if (!Number.isFinite(num)) return '--'
  const code = String(currency || 'USD').trim().toUpperCase() || 'USD'
  return `${num.toFixed(2)} ${code}`
}

export default function StrategyCenterPage() {
  const router = useRouter()

  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsValues, setSettingsValues] = useState<Record<StrategySettingKey, string>>({ ...STRATEGY_SETTING_DEFAULTS })
  const [settingsInitialValues, setSettingsInitialValues] = useState<Record<StrategySettingKey, string>>({ ...STRATEGY_SETTING_DEFAULTS })

  const [reportDate, setReportDate] = useState<string>(parseLocalDate())
  const [serverDate, setServerDate] = useState<string>(parseLocalDate())
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [manualAnalyzing, setManualAnalyzing] = useState(false)
  const [recommendations, setRecommendations] = useState<StrategyRecommendation[]>([])

  const [executingId, setExecutingId] = useState<string | null>(null)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [testingFeishu, setTestingFeishu] = useState(false)

  const settingsDirty = useMemo(
    () => STRATEGY_SETTING_KEYS.some((key) => settingsValues[key] !== settingsInitialValues[key]),
    [settingsValues, settingsInitialValues]
  )

  const loadSettings = async () => {
    setSettingsLoading(true)
    try {
      const response = await fetch('/api/strategy-center/settings', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (response.status === 401) {
        router.push('/login')
        return
      }

      const data = await response.json().catch(() => ({})) as StrategySettingsResponse
      if (!response.ok || !data.success) {
        throw new Error(data.error || '加载策略中心配置失败')
      }

      const nextValues = normalizeSettingMap(data.settings)
      setSettingsValues(nextValues)
      setSettingsInitialValues(nextValues)
    } catch (error: any) {
      showError('加载失败', error?.message || '加载策略中心配置失败')
    } finally {
      setSettingsLoading(false)
    }
  }

  const loadRecommendations = async (nextDate: string) => {
    setRecommendationsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('date', nextDate)
      const response = await fetch(`/api/strategy-center/recommendations?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (response.status === 401) {
        router.push('/login')
        return
      }

      const data = await response.json().catch(() => ({})) as StrategyRecommendationsResponse
      if (!response.ok || !data.success) {
        throw new Error(data.error || '加载策略建议失败')
      }

      setRecommendations(data.recommendations || [])
      setReportDate(data.reportDate || nextDate)
      setServerDate(data.serverDate || parseLocalDate())
    } catch (error: any) {
      showError('加载失败', error?.message || '加载策略建议失败')
    } finally {
      setRecommendationsLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
    loadRecommendations(reportDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSaveSettings = async () => {
    if (settingsSaving) return
    setSettingsSaving(true)

    try {
      const updates = STRATEGY_SETTING_KEYS.map((key) => ({
        key,
        value: settingsValues[key] || '',
      }))
      const response = await fetch('/api/strategy-center/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ updates }),
      })
      if (response.status === 401) {
        router.push('/login')
        return
      }

      const data = await response.json().catch(() => ({})) as StrategySettingsResponse
      if (!response.ok || !data.success) {
        throw new Error(data.error || '保存策略中心配置失败')
      }

      setSettingsInitialValues({ ...settingsValues })
      showSuccess('保存成功', '策略中心配置已更新')
    } catch (error: any) {
      showError('保存失败', error?.message || '保存策略中心配置失败')
    } finally {
      setSettingsSaving(false)
    }
  }

  const handleManualAnalyze = async () => {
    if (manualAnalyzing) return
    setManualAnalyzing(true)
    try {
      const response = await fetch('/api/strategy-center/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ date: reportDate }),
      })
      if (response.status === 401) {
        router.push('/login')
        return
      }
      const data = await response.json().catch(() => ({})) as StrategyRecommendationsResponse
      if (!response.ok || !data.success) {
        throw new Error(data.error || '手动触发分析失败')
      }

      setRecommendations(data.recommendations || [])
      setReportDate(data.reportDate || reportDate)
      setServerDate(data.serverDate || parseLocalDate())
      showSuccess('触发成功', '策略分析任务已完成刷新')
    } catch (error: any) {
      showError('触发失败', error?.message || '手动触发分析失败')
    } finally {
      setManualAnalyzing(false)
    }
  }

  const handleExecuteRecommendation = async (item: StrategyRecommendation) => {
    if (executingId) return
    setExecutingId(item.id)
    try {
      const response = await fetch(`/api/strategy-center/recommendations/${item.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirm: true }),
      })

      const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string }
      if (!response.ok || !data.success) {
        throw new Error(data.error || '执行建议失败')
      }

      showSuccess('已提交', `建议「${item.title}」已入队执行`)
      await loadRecommendations(reportDate)
    } catch (error: any) {
      showError('执行失败', error?.message || '执行建议失败')
    } finally {
      setExecutingId(null)
    }
  }

  const handleDismissRecommendation = async (item: StrategyRecommendation) => {
    if (dismissingId) return
    setDismissingId(item.id)
    try {
      const response = await fetch(`/api/strategy-center/recommendations/${item.id}/dismiss`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string }
      if (!response.ok || !data.success) {
        throw new Error(data.error || '设置暂不执行失败')
      }

      showSuccess('已更新', `建议「${item.title}」已标记为暂不执行`)
      await loadRecommendations(reportDate)
    } catch (error: any) {
      showError('操作失败', error?.message || '设置暂不执行失败')
    } finally {
      setDismissingId(null)
    }
  }

  const handleTestFeishu = async () => {
    if (testingFeishu) return
    setTestingFeishu(true)
    try {
      const response = await fetch('/api/strategy-center/feishu/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })
      const data = await response.json().catch(() => ({})) as FeishuTestResponse
      if (!response.ok || data.ok !== true) {
        throw new Error(data.error || '飞书连通性测试失败')
      }
      showSuccess('测试通过', data.message || '飞书连通性正常')
    } catch (error: any) {
      showError('测试失败', error?.message || '飞书连通性测试失败')
    } finally {
      setTestingFeishu(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>策略中心</CardTitle>
            <CardDescription>已从 OpenClaw 拆分，权限与数据均按用户隔离。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value || parseLocalDate())}
                className="w-[180px]"
              />
              <Button
                variant="outline"
                onClick={() => loadRecommendations(reportDate)}
                disabled={recommendationsLoading || manualAnalyzing}
              >
                {recommendationsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                加载建议
              </Button>
              <Button onClick={handleManualAnalyze} disabled={manualAnalyzing || recommendationsLoading}>
                {manualAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                手动分析
              </Button>
              <Badge variant="outline">服务器日期 {serverDate}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">策略与飞书配置</CardTitle>
                <CardDescription>配置仅保存到当前用户，不会跨用户共享。</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {settingsDirty && <Badge variant="outline">未保存</Badge>}
                <Button
                  variant="outline"
                  onClick={handleTestFeishu}
                  disabled={settingsLoading || testingFeishu}
                >
                  {testingFeishu ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
                  测试飞书连接
                </Button>
                <Button onClick={handleSaveSettings} disabled={settingsLoading || settingsSaving || !settingsDirty}>
                  {settingsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  保存配置
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {settingsLoading ? (
              <div className="flex h-24 items-center justify-center rounded-md border text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                配置加载中...
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {STRATEGY_SETTING_KEYS.map((key) => {
                  const value = settingsValues[key] ?? ''
                  if (key === 'openclaw_strategy_enabled' || key === 'feishu_require_tenant_key' || key === 'feishu_strict_auto_bind') {
                    return (
                      <div key={key} className="space-y-1.5 rounded-md border p-3">
                        <div className="text-sm font-medium">{SETTING_LABELS[key]}</div>
                        <Select
                          value={value || 'false'}
                          onValueChange={(nextValue) => setSettingsValues((prev) => ({ ...prev, [key]: nextValue }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">true</SelectItem>
                            <SelectItem value="false">false</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  }

                  if (key === 'feishu_auth_mode') {
                    return (
                      <div key={key} className="space-y-1.5 rounded-md border p-3">
                        <div className="text-sm font-medium">{SETTING_LABELS[key]}</div>
                        <Select
                          value={value || 'strict'}
                          onValueChange={(nextValue) => setSettingsValues((prev) => ({ ...prev, [key]: nextValue }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="strict">strict</SelectItem>
                            <SelectItem value="compat">compat</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  }

                  if (key === 'feishu_accounts_json') {
                    return (
                      <div key={key} className="space-y-1.5 rounded-md border p-3 md:col-span-2">
                        <div className="text-sm font-medium">{SETTING_LABELS[key]}</div>
                        <Textarea
                          value={value}
                          onChange={(event) => setSettingsValues((prev) => ({ ...prev, [key]: event.target.value }))}
                          placeholder="[]"
                          rows={5}
                        />
                      </div>
                    )
                  }

                  return (
                    <div key={key} className="space-y-1.5 rounded-md border p-3">
                      <div className="text-sm font-medium">{SETTING_LABELS[key]}</div>
                      <Input
                        type={key === 'feishu_app_secret' ? 'password' : 'text'}
                        value={value}
                        onChange={(event) => setSettingsValues((prev) => ({ ...prev, [key]: event.target.value }))}
                        autoComplete="off"
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">优化建议</CardTitle>
            <CardDescription>共 {recommendations.length} 条（报告日期：{reportDate}）</CardDescription>
          </CardHeader>
          <CardContent>
            {recommendationsLoading ? (
              <div className="flex h-24 items-center justify-center rounded-md border text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                建议加载中...
              </div>
            ) : recommendations.length === 0 ? (
              <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">暂无策略建议</div>
            ) : (
              <div className="space-y-3">
                {recommendations.map((item) => {
                  const isExecuting = executingId === item.id
                  const isDismissing = dismissingId === item.id
                  return (
                    <div key={item.id} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={resolveRecommendationStatusVariant(item.status)}>{item.status}</Badge>
                            <Badge variant="outline">{resolveRecommendationTypeLabel(item.recommendationType)}</Badge>
                            <Badge variant="secondary">优先级 {item.priorityScore}</Badge>
                          </div>
                          <div className="font-medium">{item.title}</div>
                          <div className="text-xs text-muted-foreground">
                            Campaign: {item.data?.campaignName || `#${item.campaignId}`}
                          </div>
                          {item.summary ? (
                            <div className="text-sm text-muted-foreground">{item.summary}</div>
                          ) : null}
                          {item.reason ? (
                            <div className="text-xs text-muted-foreground">原因：{item.reason}</div>
                          ) : null}
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>成本：{formatMoney(item.data?.cost, item.data?.currency)}</span>
                            <span>ROAS：{item.data?.roas ?? '--'}</span>
                            <span>净影响：{formatMoney(item.data?.estimatedNetImpact, item.data?.currency)}</span>
                            <span>当前 CPC：{item.data?.currentCpc ?? '--'}</span>
                            <span>建议 CPC：{item.data?.recommendedCpc ?? '--'}</span>
                            <span>当前预算：{item.data?.currentBudget ?? '--'}</span>
                            <span>建议预算：{item.data?.recommendedBudget ?? '--'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleExecuteRecommendation(item)}
                            disabled={isExecuting || isDismissing || item.status !== 'pending'}
                          >
                            {isExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                            执行
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDismissRecommendation(item)}
                            disabled={isExecuting || isDismissing || item.status !== 'pending'}
                          >
                            {isDismissing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                            暂不执行
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
