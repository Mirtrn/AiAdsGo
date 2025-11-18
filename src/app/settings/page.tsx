'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

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

export default function SettingsPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<SettingsGroup>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // 表单状态
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({})

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch('/api/settings', {
        headers: {
},
      })

      if (!response.ok) {
        throw new Error('获取配置失败')
      }

      const data = await response.json()
      setSettings(data.settings)

      // 初始化表单数据
      const initialFormData: Record<string, Record<string, string>> = {}
      for (const [category, categorySettings] of Object.entries(data.settings)) {
        initialFormData[category] = {}
        for (const setting of categorySettings as Setting[]) {
          initialFormData[category][setting.key] = setting.value || ''
        }
      }
      setFormData(initialFormData)
    } catch (err: any) {
      setError(err.message || '获取配置失败')
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
    setError('')
    setSuccess('')

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const updates = Object.entries(formData[category] || {}).map(([key, value]) => ({
        category,
        key,
        value,
      }))

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
},
        body: JSON.stringify({ updates }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '保存失败')
      }

      setSuccess(`${getCategoryLabel(category)} 配置保存成功`)
      setTimeout(() => setSuccess(''), 3000)

      // 刷新配置
      await fetchSettings()
    } catch (err: any) {
      setError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleValidate = async (category: string) => {
    setValidating(category)
    setError('')
    setSuccess('')

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch('/api/settings/validate', {
        method: 'POST',
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
        setSuccess(data.message)
      } else {
        setError(data.message)
      }

      // 刷新配置以获取验证状态
      await fetchSettings()
    } catch (err: any) {
      setError(err.message || '验证失败')
    } finally {
      setValidating(null)
    }
  }

  const getCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      google_ads: 'Google Ads API',
      ai: 'AI引擎',
      proxy: '代理设置',
      system: '系统设置',
    }
    return labels[category] || category
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
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <a href="/dashboard" className="text-indigo-600 hover:text-indigo-500 mr-4">
                ← 返回Dashboard
              </a>
              <h1 className="text-xl font-bold text-gray-900">系统配置</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded">
              {success}
            </div>
          )}

          <div className="space-y-6">
            {Object.entries(settings).map(([category, categorySettings]) => (
              <div key={category} className="bg-white shadow rounded-lg p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">
                  {getCategoryLabel(category)}
                </h2>

                <div className="space-y-4">
                  {categorySettings.map((setting: Setting) => (
                    <div key={setting.key} className="flex items-start">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700">
                          {setting.description || setting.key}
                          {setting.isRequired && <span className="text-red-500 ml-1">*</span>}
                          {setting.validationStatus && (
                            <span className="ml-2">{getValidationIcon(setting.validationStatus)}</span>
                          )}
                        </label>
                        <input
                          type={setting.isSensitive ? 'password' : 'text'}
                          value={formData[category]?.[setting.key] || ''}
                          onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                          placeholder={setting.isSensitive ? '••••••••' : ''}
                        />
                        {setting.validationMessage && (
                          <p className={`mt-1 text-sm ${setting.validationStatus === 'valid' ? 'text-green-600' : 'text-red-600'}`}>
                            {setting.validationMessage}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex space-x-3">
                  <button
                    onClick={() => handleSave(category)}
                    disabled={saving}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? '保存中...' : '保存配置'}
                  </button>

                  {(category === 'google_ads' || category === 'ai') && (
                    <button
                      onClick={() => handleValidate(category)}
                      disabled={validating === category}
                      className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {validating === category ? '验证中...' : '验证配置'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 bg-blue-50 border border-blue-400 text-blue-700 px-4 py-3 rounded">
            <p className="font-semibold">💡 配置说明：</p>
            <ul className="mt-2 text-sm space-y-1">
              <li>• <strong>Google Ads API</strong>: 访问 <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="underline">Google Cloud Console</a> 创建OAuth客户端</li>
              <li>• <strong>Google Ads Developer Token</strong>: 访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" rel="noopener noreferrer" className="underline">Google Ads API Center</a> 获取</li>
              <li>• <strong>Gemini API</strong>: 访问 <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline">Google AI Studio</a> 获取密钥</li>
              <li>• <strong>Claude API</strong>: 访问 <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="underline">Anthropic Console</a> 获取密钥</li>
              <li>• 敏感数据将使用AES-256-GCM加密存储</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  )
}
