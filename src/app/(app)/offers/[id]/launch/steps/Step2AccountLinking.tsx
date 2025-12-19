'use client'

/**
 * Step 2: Google Ads Account Linking
 * 关联Google Ads账号、OAuth授权
 *
 * 账号筛选规则：
 * 1. 状态必须是 ENABLED（启用）
 * 2. 不能是 MCC 账号（manager !== true）
 *
 * 🔓 KISS优化(2025-12-12): 移除独占约束，允许多个Offer共享同一Ads账号
 * 优先级排序：当前Offer已用 > 同品牌Offer已用 > 未使用
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
  customerId: string
  descriptiveName: string
  currencyCode: string
  timeZone: string
  manager: boolean
  testAccount: boolean
  status: string
  parentMcc?: string
  parentMccName?: string
  dbAccountId: number | null
  lastSyncAt?: string
  accountBalance?: number | null  // 账户余额（微单位，需除以1000000）
  linkedOffers?: Array<{
    id: number
    offerName: string | null
    brand: string
    targetCountry: string
    isActive: boolean
    campaignCount: number
  }>
  // 🔓 KISS优化(2025-12-12): 优先级标识
  priority?: 'current' | 'same-brand' | 'none'
  priorityScore?: number
}

// 格式化账户余额显示
const formatBalance = (balance: number | null | undefined, currency: string): string => {
  if (balance === null || balance === undefined) return '-'
  // Google Ads API 返回的金额是微单位，需要除以 1,000,000
  const amount = balance / 1000000
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)
}

export default function Step2AccountLinking({ offer, onAccountLinked, selectedAccount }: Props) {
  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(selectedAccount?.customerId || null)
  const [loading, setLoading] = useState(true)
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
        // 🔧 修复(2025-12-11): 使用 camelCase (hasCredentials)
        setHasCredentials(data.hasCredentials || false)
      }
    } catch (error) {
      console.error('Failed to check credentials:', error)
    }
  }

  const fetchAccounts = async () => {
    try {
      setLoading(true)

      // 🔓 KISS优化(2025-12-12): 传入offerId用于计算账号优先级
      const response = await fetch(`/api/google-ads/credentials/accounts?refresh=false&offerId=${offer.id}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('获取账号列表失败')
      }

      const data = await response.json()

      if (data.success && data.data?.accounts) {
        const allAccounts = data.data.accounts as GoogleAdsAccount[]

        // 🔓 KISS优化(2025-12-12): 移除独占约束，只筛选基本条件
        // 筛选可用账号：
        // 1. 状态必须是 ENABLED
        // 2. 不能是 MCC 账号
        // （已移除：未被其他Offer关联的限制）
        const availableAccounts = allAccounts.filter(account => {
          // 条件1：状态必须是 ENABLED
          if (account.status !== 'ENABLED') return false

          // 条件2：不能是 MCC 账号
          if (account.manager === true) return false

          return true
        })

        // API已按优先级排序，直接使用
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

  const handleSelectAccount = (account: GoogleAdsAccount) => {
    setSelectedId(account.customerId)

    // 🔧 修复(2025-12-11): 输出 camelCase 字段名
    const transformedAccount = {
      id: account.dbAccountId!,  // Database ID used in Step4
      customerId: account.customerId,
      accountName: account.descriptiveName,
      isActive: account.status === 'ENABLED'
    }

    onAccountLinked(transformedAccount)
    showSuccess('已选择', `账号 ${account.descriptiveName} (${account.customerId}) 已关联`)
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
              选择一个账号用于发布广告（仅显示启用状态、非MCC的账号，已按推荐优先级排序）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">选择</TableHead>
                  <TableHead>账号名称</TableHead>
                  <TableHead>账号ID</TableHead>
                  <TableHead>推荐</TableHead>
                  <TableHead>账户余额</TableHead>
                  <TableHead>已关联Offer</TableHead>
                  <TableHead>时区</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => {
                  const isSelected = selectedId === account.customerId

                  return (
                    <TableRow
                      key={account.customerId}
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
                          <span className="font-medium">{account.descriptiveName}</span>
                          {account.testAccount && (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 text-xs">
                              测试
                            </Badge>
                          )}
                        </div>
                        {account.parentMcc && (
                          <div className="text-xs text-gray-500 mt-1">
                            MCC: {account.parentMccName || account.parentMcc}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{account.customerId}</TableCell>
                      <TableCell>
                        {/* 🔓 KISS优化(2025-12-12): 优先级标识 */}
                        {account.priority === 'current' && (
                          <Badge className="bg-green-100 text-green-800 border-green-300">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            已用
                          </Badge>
                        )}
                        {account.priority === 'same-brand' && (
                          <Badge className="bg-blue-100 text-blue-800 border-blue-300">
                            同品牌
                          </Badge>
                        )}
                        {account.priority === 'none' && (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatBalance(account.accountBalance, account.currencyCode)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {account.linkedOffers && account.linkedOffers.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {account.linkedOffers.map((linkedOffer) => (
                              <Badge
                                key={linkedOffer.id}
                                variant="outline"
                                className={linkedOffer.id === offer.id ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50'}
                              >
                                #{linkedOffer.id}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{account.timeZone}</TableCell>
                      <TableCell className="text-right">
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
                    已选择账号：{accounts.find(a => a.customerId === selectedId)?.descriptiveName} ({selectedId})
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
