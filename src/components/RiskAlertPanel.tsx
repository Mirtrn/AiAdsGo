/**
 * 风险提示面板组件
 *
 * 功能：
 * - 显示风险提示列表
 * - 按严重程度分类
 * - 确认/解决提示
 * - 手动触发链接检查
 */

'use client'

import { useState, useEffect } from 'react'
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
  X
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

interface RiskAlert {
  id: number
  alertType: string
  severity: 'critical' | 'warning' | 'info'
  resourceType: string | null
  resourceId: number | null
  title: string
  message: string
  details: string | null
  status: 'active' | 'acknowledged' | 'resolved'
  createdAt: string
}

interface Statistics {
  total: number
  active: number
  critical: number
  warning: number
  info: number
  byType: Record<string, number>
}

export default function RiskAlertPanel() {
  const [alerts, setAlerts] = useState<RiskAlert[]>([])
  const [statistics, setStatistics] = useState<Statistics | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [expandedAlert, setExpandedAlert] = useState<number | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')

  // 加载风险提示
  const loadAlerts = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/risk-alerts?status=active')
      if (!response.ok) throw new Error('Failed to load alerts')

      const data = await response.json()
      setAlerts(data.alerts)
      setStatistics(data.statistics)
    } catch (error) {
      console.error('Load alerts error:', error)
    } finally {
      setLoading(false)
    }
  }

  // 手动检查链接
  const checkLinks = async () => {
    setChecking(true)
    try {
      const response = await fetch('/api/risk-alerts', {
        method: 'POST'
      })

      if (!response.ok) throw new Error('Failed to check links')

      const data = await response.json()
      await loadAlerts()

      const result = data.result
      alert(
        `链接检查完成\n` +
        `总计检查: ${result.totalChecked}\n` +
        `可访问: ${result.accessible}\n` +
        `失效: ${result.broken}\n` +
        `重定向: ${result.redirected}\n` +
        `新提示: ${result.newAlerts}`
      )
    } catch (error) {
      console.error('Check links error:', error)
      alert('链接检查失败')
    } finally {
      setChecking(false)
    }
  }

  // 更新提示状态
  const updateAlertStatus = async (
    alertId: number,
    status: 'acknowledged' | 'resolved',
    note?: string
  ) => {
    try {
      const response = await fetch(`/api/risk-alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note })
      })

      if (!response.ok) throw new Error('Failed to update alert')

      await loadAlerts()
      setExpandedAlert(null)
      setResolutionNote('')
    } catch (error) {
      console.error('Update alert error:', error)
      alert('更新提示失败')
    }
  }

  useEffect(() => {
    loadAlerts()
  }, [])

  // 严重程度配置
  const severityConfig = {
    critical: {
      color: 'bg-red-100 text-red-800 border-red-300',
      icon: AlertTriangle,
      label: '严重',
      bgColor: 'bg-red-50'
    },
    warning: {
      color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      icon: AlertCircle,
      label: '警告',
      bgColor: 'bg-yellow-50'
    },
    info: {
      color: 'bg-blue-100 text-blue-800 border-blue-300',
      icon: Info,
      label: '信息',
      bgColor: 'bg-blue-50'
    }
  }

  // 提示类型标签
  const alertTypeLabels: Record<string, string> = {
    link_broken: '链接失效',
    link_redirect: '链接重定向',
    link_timeout: '链接超时',
    account_suspended: '账号暂停',
    campaign_paused: 'Campaign暂停',
    budget_exhausted: '预算耗尽',
    low_quality_score: '质量分过低'
  }

  // 按严重程度分组
  const groupedAlerts = {
    critical: alerts.filter(a => a.severity === 'critical'),
    warning: alerts.filter(a => a.severity === 'warning'),
    info: alerts.filter(a => a.severity === 'info')
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-sm text-gray-500">加载风险提示...</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      {statistics && statistics.active > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="border-red-300 bg-red-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <div className="text-2xl font-bold text-red-600">{statistics.critical}</div>
              </div>
              <p className="text-xs text-red-700">严重风险</p>
            </CardContent>
          </Card>
          <Card className="border-yellow-300 bg-yellow-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                <div className="text-2xl font-bold text-yellow-600">{statistics.warning}</div>
              </div>
              <p className="text-xs text-yellow-700">警告</p>
            </CardContent>
          </Card>
          <Card className="border-blue-300 bg-blue-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-blue-600" />
                <div className="text-2xl font-bold text-blue-600">{statistics.info}</div>
              </div>
              <p className="text-xs text-blue-700">信息提示</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{statistics.active}</div>
              <p className="text-xs text-gray-500">活跃提示总数</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 头部操作 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">风险提示</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadAlerts}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Button onClick={checkLinks} disabled={checking}>
            {checking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                检查中...
              </>
            ) : (
              '检查所有链接'
            )}
          </Button>
        </div>
      </div>

      {/* 风险提示列表 */}
      {Object.entries(groupedAlerts).map(([severity, severityAlerts]) => {
        if (severityAlerts.length === 0) return null

        const config = severityConfig[severity as 'critical' | 'warning' | 'info']
        const Icon = config.icon

        return (
          <Card key={severity} className={`border-2 ${config.bgColor}`}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5" />
                <CardTitle>{config.label}</CardTitle>
                <Badge variant="secondary">{severityAlerts.length}</Badge>
              </div>
              <CardDescription>
                {severity === 'critical' && '需要立即处理的严重问题'}
                {severity === 'warning' && '需要关注的潜在风险'}
                {severity === 'info' && '建议查看的信息'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {severityAlerts.map((alert) => {
                  const details = alert.details ? JSON.parse(alert.details) : null

                  return (
                    <div key={alert.id} className={`rounded-lg border p-4 ${config.color}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-semibold">{alert.title}</span>
                            <Badge variant="outline" className="text-xs">
                              {alertTypeLabels[alert.alertType] || alert.alertType}
                            </Badge>
                            {alert.resourceType && (
                              <Badge variant="outline" className="text-xs">
                                {alert.resourceType} #{alert.resourceId}
                              </Badge>
                            )}
                          </div>

                          <p className="text-sm mb-2">{alert.message}</p>

                          <p className="text-xs text-gray-600">
                            {new Date(alert.createdAt).toLocaleString('zh-CN')}
                          </p>

                          {expandedAlert === alert.id && (
                            <div className="mt-3 space-y-2 border-t pt-2">
                              {details && (
                                <div className="text-sm space-y-1">
                                  {details.url && (
                                    <p className="flex items-center gap-1">
                                      <ExternalLink className="h-3 w-3" />
                                      <a
                                        href={details.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline"
                                      >
                                        {details.url}
                                      </a>
                                    </p>
                                  )}
                                  {details.statusCode && (
                                    <p>状态码: {details.statusCode}</p>
                                  )}
                                  {details.errorMessage && (
                                    <p>错误: {details.errorMessage}</p>
                                  )}
                                  {details.finalUrl && details.finalUrl !== details.url && (
                                    <p>
                                      重定向至: <a href={details.finalUrl} target="_blank" className="underline">{details.finalUrl}</a>
                                    </p>
                                  )}
                                </div>
                              )}

                              <div className="mt-3 space-y-2">
                                <Textarea
                                  placeholder="添加备注（可选）..."
                                  value={resolutionNote}
                                  onChange={(e) => setResolutionNote(e.target.value)}
                                  rows={2}
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updateAlertStatus(alert.id, 'acknowledged', resolutionNote)}
                                  >
                                    <CheckCircle className="mr-1 h-3 w-3" />
                                    已确认
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => updateAlertStatus(alert.id, 'resolved', resolutionNote)}
                                  >
                                    <X className="mr-1 h-3 w-3" />
                                    已解决
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
                        >
                          {expandedAlert === alert.id ? '收起' : '详情'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* 空状态 */}
      {alerts.length === 0 && (
        <Alert>
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertTitle>一切正常</AlertTitle>
          <AlertDescription>
            当前没有活跃的风险提示。系统会每日自动检查链接并监控Campaign状态。
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
