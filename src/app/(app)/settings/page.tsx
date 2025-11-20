'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { Info, ExternalLink, Shield, Zap, Globe, Settings as SettingsIcon, Plus, Trash2 } from 'lucide-react'

// 代理URL配置项接口
interface ProxyUrlConfig {
  country: string
  url: string
}

// 支持的国家列表
const SUPPORTED_COUNTRIES = [
  { code: 'US', name: '美国 (United States)' },
  { code: 'UK', name: '英国 (United Kingdom)' },
  { code: 'CA', name: '加拿大 (Canada)' },
  { code: 'DE', name: '德国 (Germany)' },
  { code: 'FR', name: '法国 (France)' },
  { code: 'JP', name: '日本 (Japan)' },
  { code: 'AU', name: '澳大利亚 (Australia)' },
  { code: 'ROW', name: '其他地区 (Rest of World)' },
]

interface Setting {
  key: string
  value: string | null
  dataType: string
  isSensitive: boolean
  isRequired: boolean
  validationStatus?: string | null
  validationMessage?: string | null
  description?: string | null
}

interface SettingsGroup {
  [key: string]: Setting[]
}

// 设置项的详细说明和配置
const SETTING_METADATA: Record<string, {
  label: string
  description: string
  placeholder?: string
  helpLink?: string
  options?: { value: string; label: string }[]
  defaultValue?: string
}> = {
  // Google Ads
  'google_ads.client_id': {
    label: 'Client ID',
    description: 'OAuth 2.0客户端ID，用于Google Ads API身份验证',
    placeholder: '输入Client ID',
    helpLink: 'https://console.cloud.google.com/apis/credentials'
  },
  'google_ads.client_secret': {
    label: 'Client Secret',
    description: 'OAuth 2.0客户端密钥，与Client ID配合使用',
    placeholder: '输入Client Secret'
  },
  'google_ads.developer_token': {
    label: 'Developer Token',
    description: 'Google Ads API开发者令牌，用于API调用授权',
    placeholder: '输入Developer Token',
    helpLink: 'https://ads.google.com/aw/apicenter'
  },

  // AI - 模式选择
  'ai.use_vertex_ai': {
    label: 'AI模式',
    description: '选择AI调用模式。Vertex AI无需代理，更稳定；Gemini API需要配置代理',
    options: [
      { value: 'false', label: 'Gemini API（需要代理）' },
      { value: 'true', label: 'Vertex AI（推荐，企业级）' }
    ],
    defaultValue: 'false'
  },

  // AI - Gemini API配置
  'ai.gemini_api_key': {
    label: 'Gemini API密钥',
    description: 'Gemini API模式：Google Gemini API密钥，用于AI创意生成',
    placeholder: '输入您的Gemini API密钥',
    helpLink: 'https://makersuite.google.com/app/apikey'
  },
  'ai.gemini_model': {
    label: 'Gemini模型',
    description: '选择用于创意生成的Gemini模型版本',
    options: [
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro（默认，最强）' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（快速）' },
      { value: 'gemini-3-pro-preview-11-2025', label: 'Gemini 3 Pro Preview（最新）' }
    ],
    defaultValue: 'gemini-2.5-pro'
  },

  // AI - Vertex AI配置
  'ai.gcp_project_id': {
    label: 'GCP项目ID',
    description: 'Vertex AI模式：Google Cloud Platform项目ID',
    placeholder: '输入GCP项目ID',
    helpLink: 'https://console.cloud.google.com'
  },
  'ai.gcp_location': {
    label: 'GCP区域',
    description: 'Vertex AI服务所在区域',
    options: [
      { value: 'us-central1', label: 'us-central1（美国中部）' },
      { value: 'us-east1', label: 'us-east1（美国东部）' },
      { value: 'us-west1', label: 'us-west1（美国西部）' },
      { value: 'europe-west1', label: 'europe-west1（欧洲西部）' },
      { value: 'asia-northeast1', label: 'asia-northeast1（日本）' },
      { value: 'asia-southeast1', label: 'asia-southeast1（新加坡）' }
    ],
    defaultValue: 'us-central1'
  },
  'ai.gcp_service_account_json': {
    label: 'Service Account JSON',
    description: 'Vertex AI认证：从GCP Console下载的Service Account密钥JSON内容',
    placeholder: '粘贴完整的JSON文件内容',
    helpLink: 'https://console.cloud.google.com/iam-admin/serviceaccounts'
  },

  // Proxy - 新的多URL配置
  'proxy.urls': {
    label: '代理URL配置',
    description: '配置不同国家的代理URL，第一个URL将作为未配置国家的默认兜底值',
    placeholder: '输入代理URL（例如：https://api.iprocket.io/api?username=...）'
  },

  // System
  'system.currency': {
    label: '默认货币',
    description: '系统中显示金额的默认货币单位',
    options: [
      { value: 'CNY', label: '人民币 (CNY)' },
      { value: 'USD', label: '美元 (USD)' },
      { value: 'EUR', label: '欧元 (EUR)' },
      { value: 'JPY', label: '日元 (JPY)' }
    ],
    defaultValue: 'CNY'
  },
  'system.language': {
    label: '系统语言',
    description: '界面显示的语言',
    options: [
      { value: 'zh-CN', label: '简体中文' },
      { value: 'en-US', label: 'English' }
    ],
    defaultValue: 'zh-CN'
  },
  'system.sync_interval_hours': {
    label: '同步间隔',
    description: '从Google Ads自动同步数据的时间间隔（小时）',
    placeholder: '例如: 6',
    defaultValue: '6'
  },
  'system.link_check_enabled': {
    label: '启用链接检查',
    description: '是否定期检查Offer链接的有效性',
    options: [
      { value: 'true', label: '是' },
      { value: 'false', label: '否' }
    ],
    defaultValue: 'true'
  },
  'system.link_check_time': {
    label: '检查时间',
    description: '每日执行链接检查的时间（24小时制）',
    placeholder: '例如: 02:00',
    defaultValue: '02:00'
  }
}

// 分类配置
const CATEGORY_CONFIG: Record<string, {
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  color: string
}> = {
  google_ads: {
    label: 'Google Ads API',
    icon: Shield,
    description: '配置Google Ads API凭证，用于广告系列管理和数据同步',
    color: 'text-blue-600'
  },
  ai: {
    label: 'AI引擎',
    icon: Zap,
    description: '配置AI模型API密钥，用于智能创意生成',
    color: 'text-purple-600'
  },
  proxy: {
    label: '代理设置',
    icon: Globe,
    description: '配置网络代理，解决API访问受限问题',
    color: 'text-green-600'
  },
  system: {
    label: '系统设置',
    icon: SettingsIcon,
    description: '系统基础配置和自动化任务设置',
    color: 'text-slate-600'
  }
}

export default function SettingsPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<SettingsGroup>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState<string | null>(null)

  // 表单状态
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({})

  // 代理URL配置状态
  const [proxyUrls, setProxyUrls] = useState<ProxyUrlConfig[]>([])

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings', {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取配置失败')
      }

      const data = await response.json()
      setSettings(data.settings)

      // 初始化表单数据，使用默认值
      const initialFormData: Record<string, Record<string, string>> = {}
      for (const [category, categorySettings] of Object.entries(data.settings)) {
        initialFormData[category] = {}
        for (const setting of categorySettings as Setting[]) {
          const metaKey = `${category}.${setting.key}`
          const metadata = SETTING_METADATA[metaKey]

          // 特殊处理代理URL配置（JSON格式）
          if (category === 'proxy' && setting.key === 'urls') {
            try {
              const urls = setting.value ? JSON.parse(setting.value) : []
              setProxyUrls(Array.isArray(urls) ? urls : [])
            } catch {
              setProxyUrls([])
            }
            initialFormData[category][setting.key] = setting.value || '[]'
          } else {
            // 使用已有值，否则使用默认值
            initialFormData[category][setting.key] = setting.value || metadata?.defaultValue || ''
          }
        }
      }
      setFormData(initialFormData)
    } catch (err: any) {
      toast.error(err.message || '获取配置失败')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (category: string, key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: value,
      },
    }))
  }

  // 代理URL操作函数
  const addProxyUrl = () => {
    setProxyUrls(prev => [...prev, { country: 'US', url: '' }])
  }

  const removeProxyUrl = (index: number) => {
    setProxyUrls(prev => prev.filter((_, i) => i !== index))
  }

  const updateProxyUrl = (index: number, field: 'country' | 'url', value: string) => {
    setProxyUrls(prev => prev.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ))
  }

  const handleSave = async (category: string) => {
    setSaving(true)

    try {
      let updates: Array<{ category: string; key: string; value: string }>

      // 特殊处理代理配置
      if (category === 'proxy') {
        // 过滤掉空URL的配置
        const validProxyUrls = proxyUrls.filter(item => item.url.trim() !== '')
        updates = [{
          category: 'proxy',
          key: 'urls',
          value: JSON.stringify(validProxyUrls),
        }]
      } else {
        updates = Object.entries(formData[category] || {}).map(([key, value]) => ({
          category,
          key,
          value,
        }))
      }

      const response = await fetch('/api/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '保存失败')
      }

      const categoryLabel = CATEGORY_CONFIG[category]?.label || category
      toast.success(`${categoryLabel} 配置保存成功`)

      // 刷新配置
      await fetchSettings()
    } catch (err: any) {
      toast.error(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleValidate = async (category: string) => {
    setValidating(category)

    try {
      const response = await fetch('/api/settings/validate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category,
          config: formData[category] || {},
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '验证失败')
      }

      if (data.valid) {
        toast.success(data.message)
      } else {
        toast.error(data.message)
      }

      // 刷新配置以获取验证状态
      await fetchSettings()
    } catch (err: any) {
      toast.error(err.message || '验证失败')
    } finally {
      setValidating(null)
    }
  }

  const getValidationIcon = (status?: string | null): string => {
    switch (status) {
      case 'valid':
        return '✅'
      case 'invalid':
        return '❌'
      case 'pending':
        return '⏳'
      default:
        return ''
    }
  }

  const renderInput = (category: string, setting: Setting) => {
    const metaKey = `${category}.${setting.key}`
    const metadata = SETTING_METADATA[metaKey]
    const value = formData[category]?.[setting.key] || ''

    // 布尔类型 - 使用Select
    if (setting.dataType === 'boolean' || metadata?.options) {
      const options = metadata?.options || [
        { value: 'true', label: '是' },
        { value: 'false', label: '否' }
      ]

      return (
        <Select
          value={value || metadata?.defaultValue || ''}
          onValueChange={(v) => handleInputChange(category, setting.key, v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    // 数字类型
    if (setting.dataType === 'number') {
      return (
        <Input
          type="number"
          value={value}
          onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
          placeholder={metadata?.placeholder}
          min={0}
        />
      )
    }

    // 时间类型（如 02:00）
    if (setting.key.includes('time')) {
      return (
        <Input
          type="time"
          value={value}
          onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
        />
      )
    }

    // text类型 - 大文本输入（如Service Account JSON）
    if (setting.dataType === 'text') {
      // 对于敏感的text类型（如Service Account JSON），使用Textarea但不显示值
      const displayValue = setting.isSensitive && value ? '***已配置***' : value

      return (
        <Textarea
          value={displayValue}
          onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
          placeholder={metadata?.placeholder}
          rows={6}
          className="font-mono text-sm"
          onFocus={(e) => {
            // 聚焦时如果是已配置状态，清空以便重新输入
            if (setting.isSensitive && value && e.target.value === '***已配置***') {
              e.target.value = ''
              handleInputChange(category, setting.key, '')
            }
          }}
        />
      )
    }

    // 敏感数据 - 密码输入
    if (setting.isSensitive) {
      return (
        <Input
          type="password"
          value={value}
          onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
          placeholder={metadata?.placeholder || ''}
        />
      )
    }

    // 默认文本输入
    return (
      <Input
        type="text"
        value={value}
        onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
        placeholder={metadata?.placeholder}
      />
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-body text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="page-title">系统配置</h1>
          <p className="page-subtitle">管理 API 密钥、代理设置和系统偏好</p>
        </div>

        {/* 配置说明 */}
        <Card className="mb-6 p-4 bg-blue-50 border-blue-200">
          <div className="flex items-start gap-2">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-body-sm text-blue-800">
              <p className="text-body-sm font-semibold mb-2">配置说明</p>
              <ul className="space-y-1 text-body-sm text-blue-700">
                <li>• 敏感数据（如API密钥、Service Account JSON）将使用AES-256-GCM加密存储</li>
                <li>• 标记为"必填"的配置项需要填写才能使用对应功能</li>
                <li>• AI引擎支持两种模式：Vertex AI（推荐，无需代理）和 Gemini API（需要代理）</li>
                <li>• 配置Google Ads API后，请前往Google Ads设置页面完成账号授权</li>
                <li>• 如遇API访问问题，可尝试启用代理设置</li>
              </ul>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          {Object.entries(settings).map(([category, categorySettings]) => {
            const config = CATEGORY_CONFIG[category] || {
              label: category,
              icon: SettingsIcon,
              description: '',
              color: 'text-slate-600'
            }
            const IconComponent = config.icon

            return (
              <Card key={category} className="p-6">
                <div className="flex items-start gap-3 mb-6">
                  <div className={`p-2 rounded-lg bg-slate-100 ${config.color}`}>
                    <IconComponent className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="card-title">
                      {config.label}
                    </h2>
                    <p className="text-body-sm text-muted-foreground mt-1">
                      {config.description}
                    </p>
                  </div>
                </div>

                {/* 特殊处理代理配置分类 */}
                {category === 'proxy' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="label-text">代理URL配置</Label>
                      <p className="helper-text flex items-start gap-1">
                        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        配置不同国家的代理URL，第一个URL将作为未配置国家的默认兜底值。只要配置了有效的代理URL即代表启用代理。
                      </p>
                    </div>

                    {proxyUrls.length === 0 ? (
                      <div className="text-center py-8 bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
                        <Globe className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                        <p className="text-body-sm text-muted-foreground mb-3">暂未配置代理URL</p>
                        <Button variant="outline" size="sm" onClick={addProxyUrl}>
                          <Plus className="w-4 h-4 mr-1" />
                          添加代理URL
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {proxyUrls.map((item, index) => (
                          <div key={index} className="flex gap-3 items-start p-3 bg-slate-50 rounded-lg">
                            <div className="flex-shrink-0 w-40">
                              <Label className="text-caption text-muted-foreground mb-1.5 block">
                                国家/地区 {index === 0 && <span className="text-amber-600">(默认)</span>}
                              </Label>
                              <Select
                                value={item.country}
                                onValueChange={(v) => updateProxyUrl(index, 'country', v)}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {SUPPORTED_COUNTRIES.map((country) => (
                                    <SelectItem key={country.code} value={country.code}>
                                      {country.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex-1">
                              <Label className="text-caption text-muted-foreground mb-1.5 block">代理URL</Label>
                              <Input
                                value={item.url}
                                onChange={(e) => updateProxyUrl(index, 'url', e.target.value)}
                                placeholder="https://api.iprocket.io/api?username=xxx&password=xxx&cc=ROW&ips=1&proxyType=http&responseType=txt"
                              />
                            </div>
                            <div className="flex-shrink-0 pt-6">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeProxyUrl(index)}
                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" onClick={addProxyUrl}>
                          <Plus className="w-4 h-4 mr-1" />
                          添加更多代理URL
                        </Button>
                      </div>
                    )}

                    {proxyUrls.length > 0 && (
                      <p className="text-caption text-amber-600 flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        提示：第一个配置的代理URL将作为默认兜底，当请求的国家没有专门配置代理时会使用它。
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* AI配置模式说明 */}
                    {category === 'ai' && (
                      <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                        <div className="flex items-start gap-2 mb-3">
                          <Info className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                          <p className="font-semibold text-body-sm text-purple-800">AI模式选择说明</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-body-sm text-purple-700">
                          <div className="bg-white/50 p-3 rounded">
                            <p className="font-medium text-purple-800 mb-2">Vertex AI（推荐）</p>
                            <ul className="space-y-1">
                              <li>• 企业级稳定性</li>
                              <li>• 无需代理访问</li>
                              <li>• 需要GCP账号</li>
                            </ul>
                          </div>
                          <div className="bg-white/50 p-3 rounded">
                            <p className="font-medium text-purple-800 mb-2">Gemini API</p>
                            <ul className="space-y-1">
                              <li>• 配置简单快速</li>
                              <li>• 需要配置代理</li>
                              <li>• 适合快速测试</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
                      {/* AI配置需要特殊排序：use_vertex_ai放在最前面 */}
                      {(category === 'ai'
                        ? [...categorySettings].sort((a, b) => {
                            if (a.key === 'use_vertex_ai') return -1
                            if (b.key === 'use_vertex_ai') return 1
                            return 0
                          })
                        : categorySettings
                      ).map((setting: Setting) => {
                        const metaKey = `${category}.${setting.key}`
                        const metadata = SETTING_METADATA[metaKey]

                        // AI配置的条件渲染逻辑
                        if (category === 'ai') {
                          const useVertexAI = formData.ai?.use_vertex_ai === 'true'

                          // 始终显示模式选择
                          if (setting.key === 'use_vertex_ai') {
                            // 继续渲染
                          }
                          // Vertex AI模式：只显示Vertex AI相关字段
                          else if (useVertexAI) {
                            if (!['gcp_project_id', 'gcp_location', 'gcp_service_account_json', 'gemini_model'].includes(setting.key)) {
                              return null // 隐藏Gemini API字段
                            }
                          }
                          // Gemini API模式：只显示Gemini API相关字段
                          else {
                            if (!['gemini_api_key', 'gemini_model'].includes(setting.key)) {
                              return null // 隐藏Vertex AI字段
                            }
                          }
                        }

                      return (
                        <div key={setting.key} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="label-text flex items-center gap-2">
                              {metadata?.label || setting.key}
                              {setting.isRequired && (
                                <span className="text-caption text-red-500">*必填</span>
                              )}
                              {setting.validationStatus && (
                                <span>{getValidationIcon(setting.validationStatus)}</span>
                              )}
                            </Label>
                            {metadata?.helpLink && (
                              <a
                                href={metadata.helpLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-caption text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                              >
                                获取密钥
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>

                          <p className="helper-text flex items-start gap-1">
                            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            {metadata?.description || setting.description || '无描述'}
                          </p>

                          {renderInput(category, setting)}

                          {setting.validationMessage && (
                            <p className={`text-caption ${setting.validationStatus === 'valid' ? 'text-green-600' : 'text-red-600'}`}>
                              {setting.validationMessage}
                            </p>
                          )}
                        </div>
                        )
                      })}
                    </div>
                  </>
                )}

                <div className="mt-6 pt-4 border-t border-slate-200 flex gap-3">
                  <Button
                    onClick={() => handleSave(category)}
                    disabled={saving}
                  >
                    {saving ? '保存中...' : '保存配置'}
                  </Button>

                  {(category === 'google_ads' || category === 'ai' || category === 'proxy') && (
                    <Button
                      variant="outline"
                      onClick={() => handleValidate(category)}
                      disabled={validating === category}
                    >
                      {validating === category ? '验证中...' : '验证配置'}
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
