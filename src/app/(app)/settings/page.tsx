'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { Info, ExternalLink, Shield, Zap, Globe, Settings as SettingsIcon } from 'lucide-react'

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
    placeholder: 'xxx.apps.googleusercontent.com',
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

  // AI
  'ai.gemini_api_key': {
    label: 'Gemini API密钥',
    description: 'Google Gemini API密钥，用于AI创意生成',
    placeholder: '输入Gemini API密钥',
    helpLink: 'https://makersuite.google.com/app/apikey'
  },
  'ai.gemini_model': {
    label: 'Gemini模型',
    description: '选择用于创意生成的Gemini模型版本',
    options: [
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro（推荐，最强）' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（快速）' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash（稳定）' }
    ],
    defaultValue: 'gemini-2.5-pro'
  },

  // Proxy
  'proxy.enabled': {
    label: '启用代理',
    description: '是否通过代理服务器访问外部API（适用于网络受限环境）',
    options: [
      { value: 'true', label: '是' },
      { value: 'false', label: '否' }
    ],
    defaultValue: 'false'
  },
  'proxy.url': {
    label: '代理URL',
    description: '代理服务API地址，必须包含cc、ips、proxyType=http、responseType=txt参数',
    placeholder: 'https://api.iprocket.io/api?username=xxx&password=xxx&cc=ROW&ips=1&type=-res-&proxyType=http&responseType=txt'
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
          // 使用已有值，否则使用默认值
          initialFormData[category][setting.key] = setting.value || metadata?.defaultValue || ''
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

  const handleSave = async (category: string) => {
    setSaving(true)

    try {
      const updates = Object.entries(formData[category] || {}).map(([key, value]) => ({
        category,
        key,
        value,
      }))

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

    // 敏感数据 - 密码输入
    if (setting.isSensitive) {
      return (
        <Input
          type="password"
          value={value}
          onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
          placeholder={metadata?.placeholder || '••••••••'}
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
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">系统配置</h1>
          <p className="text-slate-500 mt-2">管理 API 密钥、代理设置和系统偏好</p>
        </div>

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
                    <h2 className="text-xl font-semibold text-slate-900">
                      {config.label}
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                      {config.description}
                    </p>
                  </div>
                </div>

                <div className="space-y-5">
                  {categorySettings.map((setting: Setting) => {
                    const metaKey = `${category}.${setting.key}`
                    const metadata = SETTING_METADATA[metaKey]

                    return (
                      <div key={setting.key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="flex items-center gap-2">
                            {metadata?.label || setting.key}
                            {setting.isRequired && (
                              <span className="text-red-500 text-xs">*必填</span>
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
                              className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                            >
                              获取密钥
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>

                        <p className="text-xs text-slate-500 flex items-start gap-1">
                          <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          {metadata?.description || setting.description || '无描述'}
                        </p>

                        {renderInput(category, setting)}

                        {setting.validationMessage && (
                          <p className={`text-xs ${setting.validationStatus === 'valid' ? 'text-green-600' : 'text-red-600'}`}>
                            {setting.validationMessage}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>

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

        <Card className="mt-6 p-4 bg-blue-50 border-blue-200">
          <div className="flex items-start gap-2">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-2">配置说明</p>
              <ul className="space-y-1 text-blue-700">
                <li>• 敏感数据（如API密钥）将使用AES-256-GCM加密存储</li>
                <li>• 标记为"必填"的配置项需要填写才能使用对应功能</li>
                <li>• 配置Google Ads API后，请前往Google Ads设置页面完成账号授权</li>
                <li>• 如遇API访问问题，可尝试启用代理设置</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
