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
import { Info, ExternalLink, Shield, Zap, Globe, Settings as SettingsIcon, Plus, Trash2, Key, RefreshCw, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, BookOpen } from 'lucide-react'
import { getCountryOptionsForUI } from '@/lib/language-country-codes'
import { ServiceAccountPermissionError } from '@/components/ServiceAccountPermissionError'

// 代理URL配置项接口
interface ProxyUrlConfig {
  country: string
  url: string
}

// Google Ads账户接口
interface GoogleAdsAccount {
  customerId: string
  descriptiveName: string
  currencyCode: string
  timeZone: string
  manager: boolean
  testAccount: boolean
  status?: string
}

// Google Ads凭证状态接口
interface GoogleAdsCredentialStatus {
  hasCredentials: boolean
  loginCustomerId?: string
  lastVerifiedAt?: string
  isActive?: boolean
}

// 代理配置支持的国家列表（使用全局映射 + ROW其他地区选项）
const SUPPORTED_COUNTRIES = [
  ...getCountryOptionsForUI(),
  { code: 'ROW', name: '其他地区 (ROW)' },  // 代理配置专用的"其他地区"选项
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
  // Google Ads - 所有参数必填
  'google_ads.login_customer_id': {
    label: 'Login Customer ID (MCC账户ID)',
    description: '您的MCC管理账户ID，用于访问您管理的广告账户。格式：10位数字（不含连字符）',
    placeholder: '例如: 1234567890',
    helpLink: '/help/google-ads-setup?tab=oauth'
  },
  'google_ads.client_id': {
    label: 'OAuth Client ID',
    description: 'Google Cloud Console 中创建的 OAuth 2.0 客户端 ID',
    placeholder: '例如: 123456789-xxx.apps.googleusercontent.com',
    helpLink: '/help/google-ads-setup?tab=oauth#oauth-client-id'
  },
  'google_ads.client_secret': {
    label: 'OAuth Client Secret',
    description: 'OAuth 2.0 客户端密钥，与 Client ID 配对使用',
    placeholder: '输入 Client Secret'
  },
  'google_ads.developer_token': {
    label: 'Developer Token',
    description: 'Google Ads API 开发者令牌，在 Google Ads 账户的 API 中心获取',
    placeholder: '输入 Developer Token',
    helpLink: '/help/google-ads-setup?tab=oauth#oauth-developer-token'
  },

  // AI - 模式选择
  'ai.use_vertex_ai': {
    label: 'AI模式',
    description: '选择AI调用模式。Vertex AI企业级稳定；Gemini API配置简单快速',
    options: [
      { value: 'false', label: 'Gemini API（直连访问）' },
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
    label: 'Gemini模型（Pro级别）',
    description: '用于复杂任务的Pro模型。简单任务将自动使用Flash模型以节省成本',
    options: [
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro（默认，稳定版）' },
      { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview（最新，高效版）' }
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
    description: '是否每日自动检查Offer链接的有效性',
    options: [
      { value: 'true', label: '启用' },
      { value: 'false', label: '禁用' }
    ],
    defaultValue: 'true'
  },
  'system.link_check_time': {
    label: '链接检查时间',
    description: '每日链接检查的执行时间（24小时制）',
    placeholder: '例如: 02:00',
    defaultValue: '02:00'
  },
}

// 定义每个分类包含的字段及其属性
// 这确保即使数据库中没有数据，前端仍能显示所有配置字段
const CATEGORY_FIELDS: Record<string, {
  key: string
  dataType: string
  isSensitive: boolean
  isRequired: boolean
}[]> = {
  google_ads: [
    // 🔧 修复(2025-12-12): 所有 Google Ads 参数都是必填的（独立账号模式）
    { key: 'login_customer_id', dataType: 'string', isSensitive: false, isRequired: true },
    { key: 'client_id', dataType: 'string', isSensitive: true, isRequired: true },
    { key: 'client_secret', dataType: 'string', isSensitive: true, isRequired: true },
    { key: 'developer_token', dataType: 'string', isSensitive: true, isRequired: true },
  ],
  ai: [
    { key: 'use_vertex_ai', dataType: 'boolean', isSensitive: false, isRequired: false },
    { key: 'gemini_api_key', dataType: 'string', isSensitive: true, isRequired: false },
    { key: 'gemini_model', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'gcp_project_id', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'gcp_location', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'gcp_service_account_json', dataType: 'text', isSensitive: true, isRequired: false },
  ],
  proxy: [
    { key: 'urls', dataType: 'json', isSensitive: false, isRequired: false },
  ],
  system: [
    { key: 'currency', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'language', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'sync_interval_hours', dataType: 'number', isSensitive: false, isRequired: false },
    { key: 'link_check_enabled', dataType: 'boolean', isSensitive: false, isRequired: false },
    { key: 'link_check_time', dataType: 'string', isSensitive: false, isRequired: false },
  ],
}

// 合并后端数据和前端定义的字段，确保所有字段都能显示
const getMergedCategorySettings = (category: string, backendSettings: Setting[]): Setting[] => {
  const definedFields = CATEGORY_FIELDS[category] || []
  const backendMap = new Map(backendSettings.map(s => [s.key, s]))

  return definedFields.map(field => {
    const backendSetting = backendMap.get(field.key)
    return {
      key: field.key,
      value: backendSetting?.value || null,
      dataType: field.dataType,
      isSensitive: field.isSensitive,
      isRequired: field.isRequired,
      validationStatus: backendSetting?.validationStatus || null,
      validationMessage: backendSetting?.validationMessage || null,
      description: backendSetting?.description || null,
    }
  })
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

  // 正在编辑的敏感字段（用于控制显示真实值还是固定占位符）
  const [editingField, setEditingField] = useState<string | null>(null)

  // 代理URL配置状态
  const [proxyUrls, setProxyUrls] = useState<ProxyUrlConfig[]>([])

  // Google Ads 凭证和账户状态
  const [googleAdsCredentialStatus, setGoogleAdsCredentialStatus] = useState<GoogleAdsCredentialStatus | null>(null)
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<GoogleAdsAccount[]>([])
  const [loadingGoogleAdsAccounts, setLoadingGoogleAdsAccounts] = useState(false)
  const [showGoogleAdsAccounts, setShowGoogleAdsAccounts] = useState(false)
  const [verifyingGoogleAds, setVerifyingGoogleAds] = useState(false)
  const [startingOAuth, setStartingOAuth] = useState(false)
  const [googleAdsAuthMethod, setGoogleAdsAuthMethod] = useState<'oauth' | 'service_account'>('oauth')
  const [serviceAccountForm, setServiceAccountForm] = useState({
    name: '',
    mccCustomerId: '',
    developerToken: '',
    serviceAccountJson: ''
  })
  const [savingServiceAccount, setSavingServiceAccount] = useState(false)
  const [serviceAccounts, setServiceAccounts] = useState<any[]>([])
  const [loadingServiceAccounts, setLoadingServiceAccounts] = useState(false)
  const [deletingServiceAccountId, setDeletingServiceAccountId] = useState<string | null>(null)
  const [permissionError, setPermissionError] = useState<any | null>(null)

  useEffect(() => {
    fetchSettings()
  }, [])

  // 检查 OAuth 回调结果
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const oauthSuccess = urlParams.get('oauth_success')
    const errorParam = urlParams.get('error')

    if (oauthSuccess === 'true') {
      toast.success('✅ OAuth 授权成功！Refresh Token 已保存')
      // 清除 URL 参数
      window.history.replaceState({}, '', '/settings?category=google_ads')
    } else if (errorParam) {
      const errorMessages: Record<string, string> = {
        'missing_code': 'OAuth 授权失败：缺少授权码',
        'missing_state': 'OAuth 授权失败：缺少状态参数',
        'invalid_state': 'OAuth 授权失败：无效的状态参数',
        'state_expired': 'OAuth 授权失败：状态参数已过期',
        'missing_google_ads_config': 'OAuth 授权失败：请先保存 Client ID、Client Secret 和 Developer Token',
      }
      toast.error(errorMessages[errorParam] || `OAuth 授权失败：${errorParam}`)
      // 清除 URL 参数
      window.history.replaceState({}, '', '/settings?category=google_ads')
    }
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

      // 初始化表单数据，基于CATEGORY_FIELDS定义，确保所有字段都能显示
      const initialFormData: Record<string, Record<string, string>> = {}

      // 遍历所有分类
      for (const category of ['google_ads', 'ai', 'proxy', 'system']) {
        initialFormData[category] = {}
        const backendSettings = (data.settings[category] as Setting[]) || []
        const backendMap = new Map<string, Setting>(backendSettings.map((s: Setting) => [s.key, s]))

        // 遍历该分类定义的所有字段
        const definedFields = CATEGORY_FIELDS[category] || []
        for (const field of definedFields) {
          const metaKey = `${category}.${field.key}`
          const metadata = SETTING_METADATA[metaKey]
          const backendSetting = backendMap.get(field.key)

          // 特殊处理代理URL配置（JSON格式）
          if (category === 'proxy' && field.key === 'urls') {
            try {
              const urls = backendSetting?.value ? JSON.parse(backendSetting.value) : []
              setProxyUrls(Array.isArray(urls) ? urls : [])
            } catch {
              setProxyUrls([])
            }
            initialFormData[category][field.key] = backendSetting?.value || '[]'
          } else {
            // 使用后端值，否则使用默认值
            initialFormData[category][field.key] = backendSetting?.value || metadata?.defaultValue || ''
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
    // 🔥 检查是否所有支持的国家都已配置
    const usedCountries = new Set(proxyUrls.map(p => p.country))
    const availableCountries = SUPPORTED_COUNTRIES.filter(c => !usedCountries.has(c.code))

    if (availableCountries.length === 0) {
      toast.error('所有支持的国家都已配置代理URL，无法添加更多')
      return
    }

    // 使用第一个未配置的国家
    setProxyUrls(prev => [...prev, { country: availableCountries[0].code, url: '' }])
  }

  const removeProxyUrl = (index: number) => {
    setProxyUrls(prev => prev.filter((_, i) => i !== index))
  }

  const updateProxyUrl = (index: number, field: 'country' | 'url', value: string) => {
    // 🔥 如果是修改国家，检查该国家是否已被其他配置使用
    if (field === 'country') {
      const isDuplicate = proxyUrls.some((item, i) => i !== index && item.country === value)
      if (isDuplicate) {
        toast.error(`国家 ${value} 已经配置过代理URL，一个国家只能配置一个代理`)
        return
      }
    }

    setProxyUrls(prev => prev.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ))
  }

  // Google Ads 凭证状态获取
  const fetchGoogleAdsCredentialStatus = async () => {
    try {
      const response = await fetch('/api/google-ads/credentials', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        setGoogleAdsCredentialStatus(data.data)
      }
    } catch (err) {
      console.error('Failed to fetch Google Ads credential status:', err)
    }
  }

  // Google Ads OAuth 授权
  const handleStartGoogleAdsOAuth = async () => {
    const clientId = formData.google_ads?.client_id

    if (!clientId?.trim()) {
      toast.error('请先填写并保存 Client ID')
      return
    }

    try {
      setStartingOAuth(true)
      const response = await fetch(
        `/api/google-ads/oauth/start?client_id=${encodeURIComponent(clientId)}`,
        { credentials: 'include' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '启动OAuth失败')
      }

      const data = await response.json()
      window.location.href = data.data.auth_url
    } catch (err: any) {
      toast.error(err.message || 'OAuth启动失败')
      setStartingOAuth(false)
    }
  }

  // 验证 Google Ads 凭证
  const handleVerifyGoogleAdsCredentials = async () => {
    try {
      setVerifyingGoogleAds(true)

      const response = await fetch('/api/google-ads/credentials/verify', {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (data.success && data.data.valid) {
        // 🔧 修复(2025-12-11): snake_case → camelCase
        toast.success(`凭证有效${data.data.customerId ? ` - Customer ID: ${data.data.customerId}` : ''}`)
        await fetchGoogleAdsCredentialStatus()
      } else {
        toast.error(data.data.error || '凭证无效')
      }
    } catch (err: any) {
      toast.error(err.message || '验证失败')
    } finally {
      setVerifyingGoogleAds(false)
    }
  }

  // 获取可访问的 Google Ads 账户
  const handleFetchGoogleAdsAccounts = async () => {
    try {
      setLoadingGoogleAdsAccounts(true)
      setShowGoogleAdsAccounts(true)

      // 构建URL参数
      let url = '/api/google-ads/credentials/accounts?refresh=true'
      if (googleAdsAuthMethod === 'service_account' && serviceAccounts.length > 0) {
        // 如果有已配置的服务账号，使用第一个服务账号
        url += `&auth_type=service_account&service_account_id=${serviceAccounts[0].id}`
      }

      const response = await fetch(url, {
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json()

        // 🆕 检测服务账号权限错误
        if (data.code === 'SERVICE_ACCOUNT_PERMISSION_DENIED' && data.details) {
          setPermissionError(data.details)
          setShowGoogleAdsAccounts(true)  // 显示区域以展示错误信息
          return
        }

        throw new Error(data.error || '获取账户列表失败')
      }

      const data = await response.json()
      setPermissionError(null)  // 清除之前的权限错误
      setGoogleAdsAccounts(data.data.accounts || [])
      toast.success(`找到${data.data.total}个可访问的 Google Ads 账户`)
    } catch (err: any) {
      toast.error(err.message || '获取失败')
      setShowGoogleAdsAccounts(false)
    } finally {
      setLoadingGoogleAdsAccounts(false)
    }
  }

  // 初始化时获取 Google Ads 凭证状态
  useEffect(() => {
    fetchGoogleAdsCredentialStatus()
  }, [])

  const handleSave = async (category: string) => {
    setSaving(true)

    try {
      // 🔧 修复(2025-12-12): Google Ads 所有参数必填验证
      if (category === 'google_ads') {
        const loginCustomerId = formData.google_ads?.['login_customer_id']
        const clientId = formData.google_ads?.['client_id']
        const clientSecret = formData.google_ads?.['client_secret']
        const developerToken = formData.google_ads?.['developer_token']

        const isValidValue = (v: string | undefined) => v && v.trim() !== '' && v !== '············'

        if (!isValidValue(loginCustomerId)) {
          toast.error('Login Customer ID (MCC账户ID) 是必填项')
          setSaving(false)
          return
        }
        if (!isValidValue(clientId)) {
          toast.error('OAuth Client ID 是必填项')
          setSaving(false)
          return
        }
        if (!isValidValue(clientSecret)) {
          toast.error('OAuth Client Secret 是必填项')
          setSaving(false)
          return
        }
        if (!isValidValue(developerToken)) {
          toast.error('Developer Token 是必填项')
          setSaving(false)
          return
        }
      }

      // AI配置验证
      if (category === 'ai') {
        const aiMode = formData.ai?.['use_vertex_ai'] || 'false'

        // 1. AI模式必填
        if (!aiMode) {
          toast.error('请选择AI模式')
          setSaving(false)
          return
        }

        // 2. Gemini API模式验证
        if (aiMode === 'false') {
          const geminiApiKey = formData.ai?.['gemini_api_key']
          if (!geminiApiKey || geminiApiKey.trim() === '' || geminiApiKey === '············') {
            toast.error('使用Gemini API模式时，必须填写Gemini API密钥')
            setSaving(false)
            return
          }
        }

        // 3. Vertex AI模式验证
        if (aiMode === 'true') {
          const gcpRegion = formData.ai?.['gcp_location']
          const gcpProjectId = formData.ai?.['gcp_project_id']
          const serviceAccountJson = formData.ai?.['gcp_service_account_json']

          if (!gcpRegion || gcpRegion.trim() === '') {
            toast.error('使用Vertex AI模式时，必须选择GCP区域')
            setSaving(false)
            return
          }

          if (!gcpProjectId || gcpProjectId.trim() === '' || gcpProjectId === '············') {
            toast.error('使用Vertex AI模式时，必须填写GCP项目ID')
            setSaving(false)
            return
          }

          if (!serviceAccountJson || serviceAccountJson.trim() === '' || serviceAccountJson === '············') {
            toast.error('使用Vertex AI模式时，必须填写Service Account JSON')
            setSaving(false)
            return
          }
        }
      }

      // 代理配置验证
      if (category === 'proxy') {
        const validProxyUrls = proxyUrls.filter(item =>
          item &&
          typeof item.url === 'string' &&
          typeof item.country === 'string' &&
          item.url.trim() !== '' &&
          item.country.trim() !== ''
        )

        if (validProxyUrls.length === 0) {
          toast.error('代理设置至少需要配置一个代理URL')
          setSaving(false)
          return
        }
      }

      let updates: Array<{ category: string; key: string; value: string }>

      // 特殊处理代理配置
      if (category === 'proxy') {
        // 过滤掉空URL或空国家的配置，添加安全检查避免undefined
        const validProxyUrls = proxyUrls.filter(item =>
          item &&
          typeof item.url === 'string' &&
          typeof item.country === 'string' &&
          item.url.trim() !== '' &&
          item.country.trim() !== ''
        )
        updates = [{
          category: 'proxy',
          key: 'urls',
          value: JSON.stringify(validProxyUrls),
        }]
      } else {
        // 过滤掉空值字段，避免提交未填写的配置项
        // 但需要保留占位符（············）的字段，因为这些是已配置的敏感字段
        updates = Object.entries(formData[category] || {})
          .filter(([_, value]) => {
            if (value === undefined || value === null || value.trim() === '') {
              return false
            }
            // 如果是占位符（············），说明用户没有修改，不需要提交
            if (value === '············') {
              return false
            }
            return true
          })
          .map(([key, value]) => ({
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

      // 刷新配置（会重新获取解密后的值）
      await fetchSettings()

      // 🔥 重要：刷新后清除编辑状态，让敏感字段重新显示为占位符
      setEditingField(null)
    } catch (err: any) {
      toast.error(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleValidate = async (category: string) => {
    setValidating(category)

    try {
      let config = formData[category] || {}

      // 代理分类需要从 proxyUrls 状态获取数据
      if (category === 'proxy') {
        // 过滤掉空URL或空国家的配置，添加安全检查避免undefined
        const validProxyUrls = proxyUrls.filter(item =>
          item &&
          typeof item.url === 'string' &&
          typeof item.country === 'string' &&
          item.url.trim() !== '' &&
          item.country.trim() !== ''
        )

        if (validProxyUrls.length === 0 && proxyUrls.length > 0) {
          toast.error('请填写完整的代理URL和国家后再验证')
          setValidating(null)
          return
        }

        config = {
          urls: JSON.stringify(validProxyUrls)
        }
      }

      const response = await fetch('/api/settings/validate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category,
          config,
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

      // 🔧 修复(2025-12-24): 验证后不刷新整个配置，避免覆盖用户未保存的修改
      // 只需要显示验证成功的toast即可，验证状态会在下次保存后自动更新
      // await fetchSettings()
    } catch (err: any) {
      toast.error(err.message || '验证失败')
    } finally {
      setValidating(null)
    }
  }

  const handleSaveServiceAccount = async () => {
    if (!serviceAccountForm.name || !serviceAccountForm.mccCustomerId || !serviceAccountForm.developerToken || !serviceAccountForm.serviceAccountJson) {
      toast.error('请填写所有必填字段')
      return
    }

    setSavingServiceAccount(true)
    try {
      const response = await fetch('/api/google-ads/service-account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceAccountForm)
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '保存失败')

      toast.success('服务账号配置已保存')
      setServiceAccountForm({ name: '', mccCustomerId: '', developerToken: '', serviceAccountJson: '' })
      fetchServiceAccounts()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSavingServiceAccount(false)
    }
  }

  const fetchServiceAccounts = async () => {
    setLoadingServiceAccounts(true)
    try {
      const response = await fetch('/api/google-ads/service-account', {
        credentials: 'include'
      })
      const data = await response.json()
      if (response.ok) {
        setServiceAccounts(data.accounts || [])
      }
    } catch (err: any) {
      console.error('Failed to fetch service accounts:', err)
    } finally {
      setLoadingServiceAccounts(false)
    }
  }

  const handleDeleteServiceAccount = async (id: string) => {
    if (!confirm('确定要删除此服务账号配置吗？')) return

    setDeletingServiceAccountId(id)
    try {
      const response = await fetch(`/api/google-ads/service-account?id=${id}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '删除失败')

      toast.success('服务账号配置已删除')
      fetchServiceAccounts()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeletingServiceAccountId(null)
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
      const fieldKey = `${category}.${setting.key}`
      const isEditing = editingField === fieldKey
      const hasValue = value && value.trim() !== ''

      // 如果正在编辑，显示实际值；否则显示固定长度的占位符（12个点），避免泄露实际长度
      const displayValue = isEditing ? value : (hasValue ? '············' : '')

      return (
        <div className="space-y-1">
          <Input
            type="password"
            value={displayValue}
            onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
            placeholder={metadata?.placeholder || ''}
            className={hasValue ? 'border-green-300' : ''}
            onFocus={() => {
              // 聚焦时标记为正在编辑，并清空占位符
              setEditingField(fieldKey)
              if (hasValue && !isEditing) {
                // 清空占位符，让用户输入新值
                handleInputChange(category, setting.key, '')
              }
            }}
            onBlur={() => {
              // 失焦时取消编辑状态
              setEditingField(null)
            }}
          />
          {hasValue && !isEditing && (
            <p className="text-caption text-green-600 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              已配置（点击输入框可修改）
            </p>
          )}
        </div>
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
                <li>• 敏感数据（如 API 密钥、服务账号 JSON）使用 AES-256-GCM 加密存储</li>
                <li>• 标记为"必填"的配置项需要填写完整才能使用对应功能</li>
                <li>• <strong>Google Ads</strong>：支持 OAuth 用户授权和服务账号认证两种方式，配置完成后可使用广告管理功能</li>
                <li>• <strong>AI 引擎</strong>：支持 Vertex AI（企业级）和 Gemini API（快速上手）两种模式</li>
                <li>• 如遇 API 访问问题，可尝试启用代理设置或检查配置是否正确</li>
              </ul>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          {/* 定义分类显示顺序：Google Ads → AI引擎 → 代理设置 → 系统设置 */}
          {['google_ads', 'ai', 'proxy', 'system'].map((category) => {
            // 使用getMergedCategorySettings合并后端数据和前端定义的字段
            // 即使数据库中没有数据，也能显示所有配置字段
            const backendSettings = settings[category] || []
            const categorySettings = getMergedCategorySettings(category, backendSettings)
            if (!categorySettings || categorySettings.length === 0) return null

            const config = CATEGORY_CONFIG[category] || {
              label: category,
              icon: SettingsIcon,
              description: '',
              color: 'text-slate-600'
            }
            const IconComponent = config.icon

            return (
              <Card key={category} className="p-6">
                <div className="flex items-start justify-between gap-3 mb-6">
                  <div className="flex items-start gap-3">
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
                  {category === 'google_ads' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push('/help/google-ads-setup')}
                    >
                      <BookOpen className="w-4 h-4 mr-2" />
                      配置指南
                    </Button>
                  )}
                </div>

                {/* 特殊处理 Google Ads 配置分类 */}
                {category === 'google_ads' ? (
                  <div className="space-y-6">
                    {/* Google Ads 凭证状态 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {googleAdsCredentialStatus?.hasCredentials ? (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                            <span className="font-semibold text-green-700">已完成配置和授权</span>
                          </div>
                          {googleAdsCredentialStatus.loginCustomerId && (
                            <p className="text-sm text-green-700">
                              MCC ID: <span className="font-mono">{googleAdsCredentialStatus.loginCustomerId}</span>
                            </p>
                          )}
                          {googleAdsCredentialStatus.lastVerifiedAt && (
                            <p className="text-sm text-green-700">
                              验证: {new Date(googleAdsCredentialStatus.lastVerifiedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertCircle className="w-5 h-5 text-amber-600" />
                            <span className="font-semibold text-amber-700">待完成配置</span>
                          </div>
                          <p className="text-sm text-amber-700">
                            请填写所有必填参数并完成 OAuth 授权后才能使用 Google Ads 功能
                          </p>
                        </div>
                      )}
                    </div>

                    {/* 认证方式选择 */}
                    <div className="border-t pt-6">
                      <Label className="label-text mb-3 block">认证方式</Label>
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          type="button"
                          onClick={() => setGoogleAdsAuthMethod('oauth')}
                          className={`p-4 border-2 rounded-lg text-left transition-all ${
                            googleAdsAuthMethod === 'oauth'
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="font-semibold mb-1">OAuth 用户授权</div>
                          <div className="text-sm text-gray-600">适合管理自己的 Google Ads 账号</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setGoogleAdsAuthMethod('service_account')
                            fetchServiceAccounts()
                          }}
                          className={`p-4 border-2 rounded-lg text-left transition-all ${
                            googleAdsAuthMethod === 'service_account'
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="font-semibold mb-1">服务账号认证</div>
                          <div className="text-sm text-gray-600">适合 MCC 账号管理多个子账号</div>
                        </button>
                      </div>
                    </div>

                    {/* 基础配置字段 - 2列布局 */}
                    {googleAdsAuthMethod === 'oauth' && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
                        {categorySettings.map((setting: Setting) => {
                          const metaKey = `${category}.${setting.key}`
                          const metadata = SETTING_METADATA[metaKey]

                          return (
                            <div key={setting.key}>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="label-text flex items-center gap-2">
                                    {metadata?.label || setting.key}
                                    {setting.isRequired && (
                                      <span className="text-caption text-red-500">*必填</span>
                                    )}
                                  </Label>
                                  {metadata?.helpLink && (
                                    <a
                                      href={metadata.helpLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-caption text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                                    >
                                      获取方式
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </div>
                                <p className="helper-text flex items-start gap-1">
                                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                  {metadata?.description || setting.description || '无描述'}
                                </p>
                                {renderInput(category, setting)}
                              </div>

                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 服务账号配置表单 */}
                    {googleAdsAuthMethod === 'service_account' && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
                        <div>
                          <Label className="label-text flex items-center gap-2">
                            配置名称
                            <span className="text-caption text-red-500">*必填</span>
                          </Label>
                          <p className="helper-text flex items-start gap-1 mt-1">
                            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            用于标识此服务账号配置，方便管理多个配置
                          </p>
                          <Input
                            value={serviceAccountForm.name}
                            onChange={(e) => setServiceAccountForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="例如: 生产环境MCC"
                            className="mt-2"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <Label className="label-text flex items-center gap-2">
                              MCC Customer ID
                              <span className="text-caption text-red-500">*必填</span>
                            </Label>
                            <a
                              href="/help/google-ads-setup?tab=service-account#mcc-customer-id"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-caption text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                            >
                              获取方式
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <p className="helper-text flex items-start gap-1 mt-1">
                            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            MCC管理账户ID，格式：10位数字（不含连字符）
                          </p>
                          <Input
                            value={serviceAccountForm.mccCustomerId}
                            onChange={(e) => setServiceAccountForm(prev => ({ ...prev, mccCustomerId: e.target.value }))}
                            placeholder="例如: 1234567890"
                            className="mt-2"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <Label className="label-text flex items-center gap-2">
                              Developer Token
                              <span className="text-caption text-red-500">*必填</span>
                            </Label>
                            <a
                              href="/help/google-ads-setup?tab=service-account#developer-token"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-caption text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                            >
                              获取方式
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <p className="helper-text flex items-start gap-1 mt-1">
                            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            需要Explorer级别或更高，在MCC账户的API中心获取
                          </p>
                          <Input
                            value={serviceAccountForm.developerToken}
                            onChange={(e) => setServiceAccountForm(prev => ({ ...prev, developerToken: e.target.value }))}
                            placeholder="输入 Developer Token"
                            type="password"
                            className="mt-2"
                          />
                        </div>

                        <div className="lg:col-span-2">
                          <div className="flex items-center justify-between">
                            <Label className="label-text flex items-center gap-2">
                              服务账号 JSON
                              <span className="text-caption text-red-500">*必填</span>
                            </Label>
                            <a
                              href="/help/google-ads-setup?tab=service-account#service-account-json"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-caption text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                            >
                              获取方式
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <p className="helper-text flex items-start gap-1 mt-1">
                            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            从Google Cloud Console下载的服务账号密钥文件内容
                          </p>
                          <Textarea
                            value={serviceAccountForm.serviceAccountJson}
                            onChange={(e) => setServiceAccountForm(prev => ({ ...prev, serviceAccountJson: e.target.value }))}
                            placeholder='粘贴JSON内容，例如: {"type":"service_account","project_id":"...","private_key":"..."}'
                            rows={6}
                            className="mt-2 font-mono text-xs"
                          />
                        </div>
                      </div>
                    )}

                    {/* 已配置的服务账号列表 */}
                    {googleAdsAuthMethod === 'service_account' && serviceAccounts.length > 0 && (
                      <div className="border-t pt-6">
                        <h3 className="font-semibold mb-4">已配置的服务账号</h3>
                        <div className="space-y-3">
                          {serviceAccounts.map((account) => (
                            <div key={account.id} className="p-4 border rounded-lg hover:bg-gray-50">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="font-semibold text-gray-900">{account.name}</div>
                                  <div className="text-sm text-gray-600 mt-1 space-y-1">
                                    <div>MCC ID: <span className="font-mono">{account.mcc_customer_id}</span></div>
                                    <div>服务账号: <span className="font-mono text-xs">{account.service_account_email}</span></div>
                                    <div className="text-xs text-gray-500">
                                      创建时间: {new Date(account.created_at).toLocaleString('zh-CN')}
                                    </div>
                                  </div>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteServiceAccount(account.id)}
                                  disabled={deletingServiceAccountId === account.id}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 可访问的账户列表 */}
                    {googleAdsCredentialStatus?.hasCredentials && (
                      <div className="border-t pt-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold text-lg">Google Ads 账户</h3>
                          <Button
                            onClick={() => {
                              if (!showGoogleAdsAccounts && googleAdsAccounts.length === 0) {
                                handleFetchGoogleAdsAccounts()
                              } else {
                                setShowGoogleAdsAccounts(!showGoogleAdsAccounts)
                              }
                            }}
                            disabled={loadingGoogleAdsAccounts}
                            variant="outline"
                            size="sm"
                          >
                            {loadingGoogleAdsAccounts ? (
                              '加载中...'
                            ) : showGoogleAdsAccounts ? (
                              <>
                                <ChevronUp className="w-4 h-4 mr-1" />
                                收起账户列表
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-4 h-4 mr-1" />
                                查看可访问账户
                              </>
                            )}
                          </Button>
                        </div>

                        {showGoogleAdsAccounts && (
                          <div className="space-y-3">
                            {/* 🆕 显示权限错误信息 */}
                            {permissionError && permissionError.solution && (
                              <ServiceAccountPermissionError
                                serviceAccountEmail={permissionError.serviceAccountEmail}
                                mccCustomerId={permissionError.mccCustomerId}
                                steps={permissionError.solution.steps}
                                docsUrl={permissionError.solution.docsUrl}
                                onDismiss={() => {
                                  setPermissionError(null)
                                  setShowGoogleAdsAccounts(false)
                                }}
                              />
                            )}

                            {loadingGoogleAdsAccounts ? (
                              <div className="text-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                                <p className="mt-2 text-sm text-gray-600">加载账户列表...</p>
                              </div>
                            ) : permissionError ? (
                              // 有权限错误时不显示"未找到账户"提示
                              null
                            ) : googleAdsAccounts.length === 0 ? (
                              <div className="text-center py-8 bg-gray-50 rounded-lg">
                                <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                                <p className="text-gray-600">未找到可访问的账户</p>
                              </div>
                            ) : (
                              <>
                                <div className="text-sm text-gray-600 mb-2">
                                  共 {googleAdsAccounts.length} 个账户
                                </div>
                                {googleAdsAccounts.map((account) => (
                                  <div
                                    key={account.customerId}
                                    className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                                  >
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="font-semibold text-gray-900">
                                        {account.descriptiveName}
                                      </span>
                                      <div className="flex gap-2">
                                        {account.manager && (
                                          <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                                            Manager
                                          </span>
                                        )}
                                        {account.testAccount && (
                                          <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                                            测试账户
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-sm text-gray-600">
                                      <div>
                                        <span className="font-medium">ID:</span>{' '}
                                        <span className="font-mono">{account.customerId}</span>
                                      </div>
                                      <div>
                                        <span className="font-medium">货币:</span> {account.currencyCode}
                                      </div>
                                      <div>
                                        <span className="font-medium">时区:</span> {account.timeZone}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : category === 'proxy' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="label-text flex items-center gap-2">
                        代理URL配置
                        <span className="text-caption text-red-500">*必填</span>
                      </Label>
                      <p className="helper-text flex items-start gap-1">
                        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        配置不同国家的代理URL，第一个URL将作为未配置国家的默认兜底值。必须至少配置一个有效的代理URL。
                      </p>
                      <p className="text-xs text-blue-600 flex items-center gap-1">
                        <Info className="w-3 h-3 flex-shrink-0" />
                        当前已支持IPRocket、Oxylabs、Abcproxy和通用代理
                      </p>

                      {/* 代理URL格式说明 */}
                      <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                        <p className="text-caption font-semibold text-slate-700 mb-3 flex items-center gap-1">
                          <Info className="w-4 h-4" />
                          代理URL格式说明
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          {/* IPRocket格式 */}
                          <div className="bg-white p-3 rounded border border-blue-200">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">IPRocket</span>
                              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">推荐</span>
                              <span className="text-slate-600">API格式 - 需调用API获取代理IP</span>
                            </div>
                            <div className="font-mono text-xs text-slate-700 bg-slate-100 p-2 rounded break-all">
                              https://api.iprocket.io/api?username=...&password=...&cc=...&ips=1&proxyType=...
                            </div>
                          </div>

                          {/* Oxylabs格式 */}
                          <div className="bg-white p-3 rounded border border-green-200">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">Oxylabs</span>
                              <span className="text-slate-600">直接格式 - 直接代理服务器地址</span>
                            </div>
                            <div className="font-mono text-xs text-slate-700 bg-slate-100 p-2 rounded break-all">
                              https://用户名:密码@pr.oxylabs.io:端口
                            </div>
                          </div>

                          {/* Abcproxy格式 */}
                          <div className="bg-white p-3 rounded border border-orange-200">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded">Abcproxy</span>
                              <span className="text-slate-600">直接格式 - 仅支持HTTP/HTTPS</span>
                            </div>
                            <div className="font-mono text-xs text-slate-700 bg-slate-100 p-2 rounded break-all">
                              host:port:username:password
                            </div>
                          </div>

                          {/* 通用其他格式 */}
                          <div className="bg-white p-3 rounded border border-purple-200">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded">其他通用代理</span>
                              <span className="text-slate-600">直接格式 - 仅支持HTTP/HTTPS</span>
                            </div>
                            <div className="font-mono text-xs text-slate-700 bg-slate-100 p-2 rounded break-all">
                              host:port:username:password
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 pt-3 border-t border-slate-200">
                          <p className="text-xs text-amber-700 flex items-start gap-1">
                            <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>
                              <strong>处理策略：</strong>
                              <br />• IPRocket：先调用API获取代理IP，再使用代理IP访问
                              <br />• Oxylabs/Abcproxy/其他通用代理：直接从URL提取参数，使用代理发起12次访问进行预热
                            </span>
                          </p>
                        </div>
                      </div>
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
                              <li>• 需要GCP账号</li>
                              <li>• Service Account配置</li>
                            </ul>
                          </div>
                          <div className="bg-white/50 p-3 rounded">
                            <p className="font-medium text-purple-800 mb-2">Gemini API</p>
                            <ul className="space-y-1">
                              <li>• 配置简单快速</li>
                              <li>• 直连访问</li>
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

                      // 动态必填逻辑
                      const isRequired = (() => {
                        if (category === 'ai') {
                          const useVertexAI = formData.ai?.use_vertex_ai === 'true'
                          // AI模式始终必填
                          if (setting.key === 'use_vertex_ai') return true
                          // Gemini API模式：gemini_api_key必填
                          if (!useVertexAI && setting.key === 'gemini_api_key') return true
                          // Vertex AI模式：gcp_location, gcp_project_id, gcp_service_account_json必填
                          if (useVertexAI && ['gcp_location', 'gcp_project_id', 'gcp_service_account_json'].includes(setting.key)) return true
                        }
                        return setting.isRequired
                      })()

                      return (
                        <div key={setting.key} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="label-text flex items-center gap-2">
                              {metadata?.label || setting.key}
                              {isRequired && (
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
                                获取方式
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

                <div className="mt-6 pt-4 border-t border-slate-200 flex gap-3 flex-wrap">
                  <Button
                    onClick={() => {
                      if (category === 'google_ads' && googleAdsAuthMethod === 'service_account') {
                        handleSaveServiceAccount()
                      } else {
                        handleSave(category)
                      }
                    }}
                    disabled={saving || savingServiceAccount}
                  >
                    {(saving || savingServiceAccount) ? '保存中...' : '保存配置'}
                  </Button>

                  {category === 'google_ads' && googleAdsAuthMethod === 'oauth' && (
                    <Button
                      onClick={handleStartGoogleAdsOAuth}
                      disabled={startingOAuth}
                      variant="outline"
                    >
                      <Key className="w-4 h-4 mr-2" />
                      {startingOAuth ? '启动中...' : '启动 OAuth 授权'}
                    </Button>
                  )}

                  {(category === 'ai' || category === 'proxy') && (
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
