'use client'

/**
 * Step 3: Google Ads Account Linking
 * 关联Google Ads账号、OAuth授权
 *
 * 账号筛选规则：
 * 1. 状态必须是 ENABLED（启用）
 * 2. 不能是 MCC 账号（manager !== true）
 * 3. 未被任何其他 Offer 关联
 */

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Link2, CheckCircle2, AlertCircle, Plus, RefreshCw, ExternalLink, Loader2, Info } from 'lucide-react'
import { showError, showSuccess } from '@/lib/toast-utils'
import Link from 'next/link'

interface Props {
  offer: any
  onAccountLinked: (account: any) => void
  selectedAccount: any | null
}

interface GoogleAdsAccount {
  customer_id: string
  descriptive_name: string
  currency_code: string
  time_zone: string
  manager: boolean
  test_account: boolean
  status: string
  parent_mcc?: string
  parent_mcc_name?: string
  db_account_id: number | null
  db_account_name: string | null
  last_sync_at?: string
  linked_offers?: Array<{
    id: number
    offer_name: string | null
    brand: string
    target_country: string
    is_active: number
    campaign_count: number
  }>
}

export default function Step3AccountLinking({ offer, onAccountLinked, selectedAccount }: Props) {
  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(selectedAccount?.customer_id || null)
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [hasCredentials, setHasCredentials] = useState(false)
  const [showGuideDialog, setShowGuideDialog] = useState(false)

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

      // 调用真实 API 获取账号列表
      const response = await fetch('/api/google-ads/credentials/accounts?refresh=false', {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('获取账号列表失败')
      }

      const data = await response.json()

      if (data.success && data.data?.accounts) {
        const allAccounts = data.data.accounts as GoogleAdsAccount[]

        // 筛选可用账号：
        // 1. 状态必须是 ENABLED
        // 2. 不能是 MCC 账号
        // 3. 未被任何其他 Offer 关联（当前 Offer 除外）
        const availableAccounts = allAccounts.filter(account => {
          // 条件1：状态必须是 ENABLED
          if (account.status !== 'ENABLED') return false

          // 条件2：不能是 MCC 账号
          if (account.manager === true) return false

          // 条件3：未被任何其他 Offer 关联
          const linkedOffers = account.linked_offers || []
          // 如果有关联的 Offers，且不全是当前 Offer，则排除
          const hasOtherOfferLinks = linkedOffers.some(
            (linkedOffer: any) => linkedOffer.id !== offer.id
          )
          if (hasOtherOfferLinks) return false

          return true
        })

        setAccounts(availableAccounts)
      } else {
        setAccounts([])
      }
    } catch (error: any) {
      console.error('获取账号列表失败:', error)
      showError('加载失败', error.message || '获取账号列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleConnectNewAccount = () => {
    // 显示操作指南弹窗，引导用户添加新账号
    setShowGuideDialog(true)
  }

  const handleVerifyAccount = async (customerId: string) => {
    try {
      setVerifying(customerId)

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
    setSelectedId(account.customer_id)

    // 🔧 BUG FIX: Transform account object to match parent component's expected interface
    // The API returns `db_account_id` but Step4 expects `id`
    const transformedAccount = {
      id: account.db_account_id!,  // Database ID used in Step4
      customer_id: account.customer_id,
      account_name: account.descriptive_name,
      is_active: account.status === 'ENABLED'
    }

    onAccountLinked(transformedAccount)
    showSuccess('已选择', `账号 ${account.descriptive_name} (${account.customer_id}) 已关联`)
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
            <strong>尚未配置Google Ads凭证</strong>
            <p className="mt-2">
              您需要先在<Link href="/settings" className="text-blue-600 hover:underline">设置页面</Link>配置Google Ads OAuth凭证（Client ID、Client Secret、Developer Token、MCC账号），然后在<Link href="/google-ads" className="text-blue-600 hover:underline">Google Ads管理页面</Link>刷新账户列表。
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Accounts List */}
      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Link2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">暂无可用的Google Ads账号</p>
            <p className="text-sm text-gray-400 mt-2">
              点击"连接新账号"查看添加账号的操作指南
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">可用账号列表</CardTitle>
            <CardDescription>
              选择一个账号用于发布广告（仅显示启用状态、非MCC、未被其他Offer关联的账号）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">选择</TableHead>
                  <TableHead>账号名称</TableHead>
                  <TableHead>账号ID</TableHead>
                  <TableHead>货币</TableHead>
                  <TableHead>时区</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => {
                  const isSelected = selectedId === account.customer_id

                  return (
                    <TableRow
                      key={account.customer_id}
                      className={`cursor-pointer ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                      onClick={() => handleSelectAccount(account)}
                    >
                      <TableCell>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          isSelected ? 'border-green-600 bg-green-600' : 'border-gray-300'
                        }`}>
                          {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{account.descriptive_name}</span>
                          {account.test_account && (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 text-xs">
                              测试
                            </Badge>
                          )}
                        </div>
                        {account.parent_mcc && (
                          <div className="text-xs text-gray-500 mt-1">
                            MCC: {account.parent_mcc_name || account.parent_mcc}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{account.customer_id}</TableCell>
                      <TableCell>{account.currency_code}</TableCell>
                      <TableCell className="text-sm">{account.time_zone}</TableCell>
                      <TableCell>
                        <Badge variant="default" className="bg-green-600">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          启用
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleVerifyAccount(account.customer_id)
                            }}
                            disabled={verifying === account.customer_id}
                            title="验证凭证"
                          >
                            {verifying === account.customer_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open('https://ads.google.com', '_blank')
                            }}
                            title="在Google Ads中查看"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* Selected Account Info */}
            {selectedId && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-green-800">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="font-medium">
                    已选择账号：{accounts.find(a => a.customer_id === selectedId)?.descriptive_name} ({selectedId})
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
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

      {/* Add New Account Guide Dialog */}
      <Dialog open={showGuideDialog} onOpenChange={setShowGuideDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-600" />
              如何添加新的Google Ads账号
            </DialogTitle>
            <DialogDescription>
              请按照以下步骤操作，完成后返回此页面选择账号
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Step 1 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold">
                1
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-gray-900 mb-1">在MCC账号中添加新的Ads账号</h4>
                <p className="text-sm text-gray-600 mb-2">
                  登录您的Google Ads MCC账号，将新的Ads账号关联到MCC下进行统一管理
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://ads.google.com', '_blank')}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  打开Google Ads MCC
                </Button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold">
                2
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-gray-900 mb-1">在系统中刷新账户列表</h4>
                <p className="text-sm text-gray-600 mb-2">
                  前往"Google Ads账号管理"页面，点击"刷新账户列表"按钮同步最新的账号信息
                </p>
                <Link href="/google-ads" target="_blank">
                  <Button variant="outline" size="sm">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    打开Google Ads管理页面
                  </Button>
                </Link>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold">
                3
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-gray-900 mb-1">返回此页面选择账号</h4>
                <p className="text-sm text-gray-600">
                  账号刷新完成后，返回此页面即可在列表中看到新添加的账号
                </p>
              </div>
            </div>

            {/* Important Notes */}
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                <strong>重要提示</strong>
                <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                  <li>新账号必须在MCC账号下才能被系统识别</li>
                  <li>账号状态必须为"启用"</li>
                  <li>不支持MCC账号，仅支持普通Ads账号</li>
                  <li>账号刷新可能需要1-2分钟时间</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGuideDialog(false)}>
              我知道了
            </Button>
            <Link href="/google-ads" target="_blank">
              <Button onClick={() => setShowGuideDialog(false)}>
                <RefreshCw className="w-4 h-4 mr-2" />
                前往刷新账号列表
              </Button>
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
