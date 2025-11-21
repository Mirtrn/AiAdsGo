'use client'

/**
 * Step 3: Google Ads Account Linking
 * 关联Google Ads账号、OAuth授权
 */

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Link2, CheckCircle2, AlertCircle, Plus, RefreshCw, ExternalLink, Loader2 } from 'lucide-react'
import { showError, showSuccess } from '@/lib/toast-utils'

interface Props {
  offer: any
  onAccountLinked: (account: any) => void
  selectedAccount: any | null
}

interface GoogleAdsAccount {
  id: number
  customer_id: string
  account_name?: string
  is_active: boolean
  last_verified_at?: string
}

export default function Step3AccountLinking({ offer, onAccountLinked, selectedAccount }: Props) {
  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(selectedAccount?.id || null)
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState<number | null>(null)
  const [hasCredentials, setHasCredentials] = useState(false)

  useEffect(() => {
    checkCredentials()
    fetchAccounts()
  }, [])

  const checkCredentials = async () => {
    try {
      const response = await fetch('/api/google-ads/credentials', {
        credentials: 'include'
      })

      if (response.ok) {
        const data = await response.json()
        setHasCredentials(data.has_credentials || false)
      }
    } catch (error) {
      console.error('Failed to check credentials:', error)
    }
  }

  const fetchAccounts = async () => {
    try {
      setLoading(true)
      // Note: This API endpoint needs to be implemented to list Google Ads accounts
      // For now, we'll use a mock implementation based on credentials
      const response = await fetch('/api/google-ads/credentials', {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('获取账号列表失败')
      }

      const data = await response.json()

      // Mock account data - in real implementation, this should list all accessible customer accounts
      if (data.has_credentials) {
        setAccounts([
          {
            id: 1,
            customer_id: data.login_customer_id || 'XXXXXXXXXX',
            account_name: '主广告账号',
            is_active: true,
            last_verified_at: data.last_verified_at
          }
        ])
      } else {
        setAccounts([])
      }
    } catch (error: any) {
      showError('加载失败', error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleConnectNewAccount = async () => {
    try {
      // Get client_id from settings or environment
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_ADS_CLIENT_ID || ''

      if (!clientId) {
        showError('配置错误', 'Google Ads Client ID 未配置，请联系管理员')
        return
      }

      const response = await fetch(`/api/google-ads/oauth/start?client_id=${clientId}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('启动OAuth失败')
      }

      const data = await response.json()

      // Open OAuth URL in new window
      const width = 600
      const height = 700
      const left = window.screen.width / 2 - width / 2
      const top = window.screen.height / 2 - height / 2

      const authWindow = window.open(
        data.auth_url,
        'Google Ads OAuth',
        `width=${width},height=${height},left=${left},top=${top}`
      )

      // Poll for OAuth completion
      const checkAuth = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(checkAuth)
          // Refresh accounts after OAuth
          setTimeout(() => {
            checkCredentials()
            fetchAccounts()
          }, 1000)
        }
      }, 500)
    } catch (error: any) {
      showError('连接失败', error.message)
    }
  }

  const handleVerifyAccount = async (accountId: number) => {
    try {
      setVerifying(accountId)

      const response = await fetch('/api/google-ads/credentials/verify', {
        method: 'POST',
        credentials: 'include'
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '验证失败')
      }

      const data = await response.json()

      if (data.valid) {
        showSuccess('验证成功', '账号凭证有效')
        fetchAccounts()
      } else {
        showError('验证失败', data.error || '账号凭证无效')
      }
    } catch (error: any) {
      showError('验证失败', error.message)
    } finally {
      setVerifying(null)
    }
  }

  const handleSelectAccount = (account: GoogleAdsAccount) => {
    setSelectedId(account.id)
    onAccountLinked(account)
    showSuccess('已选择', `账号 ${account.customer_id} 已关联`)
  }

  const getAccountStatusBadge = (account: GoogleAdsAccount) => {
    if (!account.last_verified_at) {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
          <AlertCircle className="w-3 h-3 mr-1" />
          未验证
        </Badge>
      )
    }

    const lastVerified = new Date(account.last_verified_at)
    const hoursSinceVerified = (Date.now() - lastVerified.getTime()) / (1000 * 60 * 60)

    if (hoursSinceVerified > 24) {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
          <AlertCircle className="w-3 h-3 mr-1" />
          需要重新验证
        </Badge>
      )
    }

    return (
      <Badge variant="default" className="bg-green-600">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        已验证
      </Badge>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">加载账号列表...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-green-600" />
            关联Google Ads账号
          </CardTitle>
          <CardDescription>
            选择或连接Google Ads账号，用于发布广告系列
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleConnectNewAccount} variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            连接新账号
          </Button>
        </CardContent>
      </Card>

      {/* No Credentials Warning */}
      {!hasCredentials && accounts.length === 0 && (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-900">
            <strong>尚未连接Google Ads账号</strong>
            <p className="mt-2">
              您需要先连接Google Ads账号才能发布广告。点击上方"连接新账号"按钮开始OAuth授权流程。
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Accounts List */}
      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Link2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">暂无已连接的Google Ads账号</p>
            <p className="text-sm text-gray-400 mt-2">
              点击"连接新账号"开始授权流程
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((account) => {
            const isSelected = selectedId === account.id

            return (
              <Card
                key={account.id}
                className={`relative cursor-pointer transition-all ${
                  isSelected ? 'ring-2 ring-primary shadow-lg' : 'hover:shadow-md'
                }`}
                onClick={() => !isSelected && handleSelectAccount(account)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg flex items-center gap-2">
                        {account.account_name || '广告账号'}
                        {isSelected && (
                          <Badge variant="default" className="bg-green-600">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            已选择
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="font-mono mt-1">
                        ID: {account.customer_id}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Status */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">账号状态:</span>
                    {getAccountStatusBadge(account)}
                  </div>

                  {/* Last Verified */}
                  {account.last_verified_at && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">最后验证:</span>
                      <span className="text-gray-900">
                        {new Date(account.last_verified_at).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleVerifyAccount(account.id)
                      }}
                      disabled={verifying === account.id}
                      className="flex-1"
                    >
                      {verifying === account.id ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          验证中...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3 h-3 mr-1" />
                          验证凭证
                        </>
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        window.open('https://ads.google.com', '_blank')
                      }}
                    >
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* Select Button */}
                  {!isSelected && (
                    <Button
                      className="w-full"
                      size="sm"
                      onClick={() => handleSelectAccount(account)}
                    >
                      选择此账号
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Info Alert */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>账号权限说明</strong>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>需要具有创建和管理广告系列的权限</li>
            <li>建议使用管理员或标准访问权限的账号</li>
            <li>确保账号已完成计费设置</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  )
}
