'use client'

import { useState, useEffect } from 'react'
import { Activity, Users, Clock, CheckCircle, XCircle, RefreshCw, Settings, Save, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { fetchWithRetry } from '@/lib/api-error-handler'

interface QueueStats {
  global: {
    running: number
    queued: number
    completed: number
    failed: number
  }
  perUser: Array<{
    userId: number
    username: string
    email?: string
    running: number
    queued: number
    completed: number
    failed: number
  }>
  config: {
    globalConcurrency: number
    perUserConcurrency: number
    perTypeConcurrency?: PerTypeConcurrency  // 新增：类型并发配置
    maxQueueSize: number
    taskTimeout: number
    enablePriority: boolean
  }
  // 新增字段 (New Unified Queue Feature)
  byType?: Record<string, number>
}

// 任务类型并发配置
interface PerTypeConcurrency {
  scrape: number
  'ai-analysis': number
  sync: number
  backup: number
  email: number
  export: number
  'link-check': number
  cleanup: number
  'offer-extraction': number
  'batch-offer-creation': number
  'ad-creative': number
  'campaign-publish': number  // 🆕 广告系列发布
  [key: string]: number  // 允许其他自定义类型
}

// 任务类型中文名称映射
const TASK_TYPE_LABELS: Record<string, string> = {
  'scrape': '网页抓取',
  'ai-analysis': 'AI分析',
  'sync': '数据同步',
  'backup': '数据备份',
  'email': '邮件发送',
  'export': '数据导出',
  'link-check': '链接检查',
  'cleanup': '清理任务',
  'offer-extraction': 'Offer提取',
  'batch-offer-creation': '批量创建',
  'ad-creative': '广告创意生成',
  'campaign-publish': '广告系列发布',  // 🆕 Campaign发布
}

interface QueueConfig {
  globalConcurrency: number
  perUserConcurrency: number
  perTypeConcurrency: PerTypeConcurrency  // 新增：类型并发配置
  maxQueueSize: number
  taskTimeout: number
  enablePriority: boolean
  // 新增字段 (New Unified Queue Feature)
  defaultMaxRetries?: number
  retryDelay?: number
  storageType?: 'redis' | 'memory'
}

export default function QueueManagementPage() {
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'monitor' | 'config'>('monitor')

  // 配置表单状态
  const [config, setConfig] = useState<QueueConfig>(() => {
    // 根据服务器配置动态设置默认值
    const cpuCores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4 // 默认4核
    const optimalGlobalConcurrency = Math.min(cpuCores * 2, 16) // CPU核数 × 2，限制最大16
    const optimalPerUserConcurrency = Math.max(2, Math.floor(optimalGlobalConcurrency / 4)) // 全局并发/4，最少2

    return {
      globalConcurrency: optimalGlobalConcurrency,
      perUserConcurrency: optimalPerUserConcurrency,
      perTypeConcurrency: {
        scrape: 3,
        'ai-analysis': 2,
        sync: 1,
        backup: 1,
        email: 3,
        export: 2,
        'link-check': 2,
        cleanup: 1,
        'offer-extraction': 2,
        'batch-offer-creation': 1,
        'ad-creative': 3,
        'campaign-publish': 2  // 🆕 广告系列发布（Google Ads API限制）
      },
      maxQueueSize: 1000,
      taskTimeout: 300000,
      enablePriority: true,
      defaultMaxRetries: 3,
      retryDelay: 5000,
      storageType: 'redis'
    }
  })
  const [savingConfig, setSavingConfig] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStats = async (showSuccessToast = false) => {
    setRefreshing(true)
    try {
      const result = await fetchWithRetry('/api/queue/stats', undefined, {
        maxRetries: 2,
        retryDelay: 2000,
        retryOnErrors: ['SERVICE_UNAVAILABLE', 'HTML_RESPONSE']
      })

      if (!result.success) {
        // 只在监控标签页显示错误，避免切换标签页时也显示错误
        if (activeTab === 'monitor') {
          toast.error(result.userMessage)
        }
        return
      }

      const data = result.data

      if (data.success) {
        // 适配新统一队列格式（兼容旧格式）
        const adaptedStats = {
          global: data.data?.global || data.stats?.global || {
            running: 0,
            queued: 0,
            completed: 0,
            failed: 0
          },
          perUser: data.data?.byUser ?
            Object.entries(data.data.byUser).map(([uid, userStats]: [string, any]) => ({
              userId: parseInt(uid),
              ...userStats
            })) :
            data.stats?.perUser || [],
          config: {
            globalConcurrency: 5,
            perUserConcurrency: 2,
            perTypeConcurrency: {
              scrape: 3,
              'ai-analysis': 2,
              sync: 1,
              backup: 1,
              email: 3,
              export: 2,
              'link-check': 2,
              cleanup: 1,
              'offer-extraction': 2,
              'batch-offer-creation': 1,
              'ad-creative': 3,
              'campaign-publish': 2  // 🆕 广告系列发布
            },
            maxQueueSize: 1000,
            taskTimeout: 60000,
            enablePriority: true,
            storageType: 'redis',
            ...(data.data?.config || data.stats?.config || {})
          },
          // 新增字段
          byType: data.data?.byType || {}
        }

        setStats(adaptedStats)

        // 手动刷新时显示成功提示
        if (showSuccessToast) {
          toast.success(`队列数据已更新：运行 ${adaptedStats.global.running}，排队 ${adaptedStats.global.queued}`)
        }

        // 🔥 修复：从 /api/queue/config 获取配置，而不是用硬编码默认值
        // stats API 不返回 perTypeConcurrency，需要单独获取
        try {
          const configResult = await fetchWithRetry('/api/queue/config')
          if (configResult.success && configResult.data?.config) {
            const dbConfig = configResult.data.config
            setConfig({
              globalConcurrency: dbConfig.globalConcurrency || 5,
              perUserConcurrency: dbConfig.perUserConcurrency || 2,
              perTypeConcurrency: dbConfig.perTypeConcurrency || {
                scrape: 3,
                'ai-analysis': 2,
                sync: 1,
                backup: 1,
                email: 3,
                export: 2,
                'link-check': 2,
                cleanup: 1,
                'offer-extraction': 2,
                'batch-offer-creation': 1,
                'ad-creative': 3,
                'campaign-publish': 2  // 🆕 广告系列发布
              },
              maxQueueSize: dbConfig.maxQueueSize || 1000,
              taskTimeout: dbConfig.taskTimeout || 60000,
              enablePriority: dbConfig.enablePriority !== false,
              defaultMaxRetries: dbConfig.defaultMaxRetries || 3,
              retryDelay: dbConfig.retryDelay || 5000,
              storageType: dbConfig.storageType || 'redis'
            })
          }
        } catch (configError) {
          console.warn('获取队列配置失败，使用默认值:', configError)
        }
      } else {
        if (activeTab === 'monitor') {
          toast.error(data.error || '获取队列统计失败')
        }
      }
    } catch (error: any) {
      console.error('获取队列统计失败:', error)
      if (activeTab === 'monitor') {
        toast.error('获取队列统计时发生未知错误')
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      const result = await fetchWithRetry('/api/queue/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      })

      if (!result.success) {
        toast.error(result.userMessage)
        return
      }

      // 🔥 修复：使用API返回的新配置更新状态，而不是重新fetchStats
      const savedConfig = result.data?.config
      if (savedConfig) {
        setConfig(prev => ({
          ...prev,
          globalConcurrency: savedConfig.globalConcurrency ?? prev.globalConcurrency,
          perUserConcurrency: savedConfig.perUserConcurrency ?? prev.perUserConcurrency,
          perTypeConcurrency: savedConfig.perTypeConcurrency ?? prev.perTypeConcurrency,
          maxQueueSize: savedConfig.maxQueueSize ?? prev.maxQueueSize,
          taskTimeout: savedConfig.taskTimeout ?? prev.taskTimeout,
          defaultMaxRetries: savedConfig.defaultMaxRetries ?? prev.defaultMaxRetries,
          retryDelay: savedConfig.retryDelay ?? prev.retryDelay,
        }))
      }

      toast.success('配置已保存并生效')

      // 刷新统计信息（但不覆盖刚保存的配置）
      // await fetchStats()  // 移除：避免用旧配置覆盖新配置
    } catch (error: any) {
      console.error('保存配置失败:', error)
      toast.error('保存配置时发生未知错误')
    } finally {
      setSavingConfig(false)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [activeTab])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="p-8">
        <div className="text-center text-gray-500">
          <p>无法加载队列信息</p>
        </div>
      </div>
    )
  }

  const globalUtilization = stats.config.globalConcurrency > 0
    ? Math.round((stats.global.running / stats.config.globalConcurrency) * 100)
    : 0

  const totalTasks = stats.global.running + stats.global.queued + stats.global.completed + stats.global.failed

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">队列配置与监控</h1>
          <p className="text-gray-500 mt-1">管理批量任务队列和并发限制</p>
        </div>
        <div className="flex items-center space-x-3">
          {activeTab === 'monitor' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchStats(true)}
              disabled={refreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? '刷新中...' : '刷新'}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('monitor')}
            className={`
              py-4 px-1 border-b-2 font-medium text-sm transition-colors
              ${activeTab === 'monitor'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <Activity className="w-5 h-5 inline-block mr-2" />
            实时监控
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`
              py-4 px-1 border-b-2 font-medium text-sm transition-colors
              ${activeTab === 'config'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <Settings className="w-5 h-5 inline-block mr-2" />
            配置管理
          </button>
        </nav>
      </div>

      {/* Monitor Tab */}
      {activeTab === 'monitor' && (
        <div className="space-y-6">
          {/* Global Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Activity className="w-6 h-6 text-blue-600" />
                </div>
                <span className="text-sm font-medium text-gray-500">运行中</span>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-gray-900">{stats.global.running}</p>
                <p className="text-sm text-gray-500">
                  / {stats.config.globalConcurrency} 并发
                </p>
              </div>
              <div className="mt-4">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(globalUtilization, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">利用率: {globalUtilization}%</p>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <Clock className="w-6 h-6 text-yellow-600" />
                </div>
                <span className="text-sm font-medium text-gray-500">队列中</span>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-gray-900">{stats.global.queued}</p>
                <p className="text-sm text-gray-500">
                  / {stats.config.maxQueueSize} 最大
                </p>
              </div>
              <div className="mt-4">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-yellow-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((stats.global.queued / stats.config.maxQueueSize) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  队列使用: {Math.round((stats.global.queued / stats.config.maxQueueSize) * 100)}%
                </p>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                </div>
                <span className="text-sm font-medium text-gray-500">已完成</span>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-gray-900">{stats.global.completed}</p>
                <p className="text-sm text-gray-500">
                  成功率: {totalTasks > 0 ? Math.round((stats.global.completed / totalTasks) * 100) : 0}%
                </p>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <XCircle className="w-6 h-6 text-red-600" />
                </div>
                <span className="text-sm font-medium text-gray-500">失败</span>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-gray-900">{stats.global.failed}</p>
                <p className="text-sm text-gray-500">
                  失败率: {totalTasks > 0 ? Math.round((stats.global.failed / totalTasks) * 100) : 0}%
                </p>
              </div>
            </div>
          </div>

          {/* Task Type Stats with Concurrency Limits (Enhanced) */}
          {stats.byType && Object.keys(stats.byType).length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Settings className="w-5 h-5 mr-2" />
                任务类型分布与并发限制
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Object.entries(stats.byType).map(([type, count]: [string, any]) => {
                  const limit = stats.config.perTypeConcurrency?.[type] || 2
                  const utilization = limit > 0 ? Math.round((count / limit) * 100) : 0
                  return (
                    <div key={type} className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm font-medium text-gray-600">
                        {TASK_TYPE_LABELS[type] || type}
                      </p>
                      <div className="flex items-baseline justify-between mt-1">
                        <p className="text-2xl font-bold text-gray-900">{count}</p>
                        <p className="text-sm text-gray-500">/ {limit}</p>
                      </div>
                      <div className="mt-2">
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all duration-500 ${
                              utilization >= 100 ? 'bg-red-500' :
                              utilization >= 70 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(utilization, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{utilization}%</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Per-User Stats */}
          {stats.perUser.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Users className="w-5 h-5 mr-2" />
                用户队列状态
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">用户</th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-600">运行中</th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-600">队列中</th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-600">已完成</th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-600">失败</th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-600 w-32">利用率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.perUser.map((userStat) => {
                      const userUtilization = stats.config.perUserConcurrency > 0
                        ? Math.round((userStat.running / stats.config.perUserConcurrency) * 100)
                        : 0

                      return (
                        <tr key={userStat.userId} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-gray-900">{userStat.username}</span>
                              {userStat.email && (
                                <span className="text-xs text-gray-500">{userStat.email}</span>
                              )}
                            </div>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {userStat.running} / {stats.config.perUserConcurrency}
                            </span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              {userStat.queued}
                            </span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              {userStat.completed}
                            </span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              {userStat.failed}
                            </span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <div className="flex flex-col items-center space-y-1">
                              <div className="w-16 bg-gray-200 rounded-full h-2">
                                <div
                                  className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                                  style={{ width: `${Math.min(userUtilization, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-600 font-medium">{userUtilization}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty State */}
          {stats.perUser.length === 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">暂无活跃用户</h3>
              <p className="text-gray-500">当前没有用户在使用队列</p>
            </div>
          )}
        </div>
      )}

      {/* Config Tab */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* Warning Banner */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-yellow-800">配置说明</h3>
              <p className="text-sm text-yellow-700 mt-1">
                修改配置后会立即生效。建议根据服务器配置合理设置并发限制，避免服务器过载。
              </p>
            </div>
          </div>

          {/* Configuration Form */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">队列配置</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Global Concurrency */}
              <div>
                <Label htmlFor="globalConcurrency" className="text-sm font-medium text-gray-700">
                  全局并发限制
                </Label>
                <Input
                  id="globalConcurrency"
                  type="number"
                  min="1"
                  max="50"
                  value={config.globalConcurrency}
                  onChange={(e) => setConfig({ ...config, globalConcurrency: parseInt(e.target.value) || 1 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  所有用户的总并发任务数上限。自动根据CPU核心数优化：CPU核数 × 2（当前：{config.globalConcurrency}）
                </p>
              </div>

              {/* Per User Concurrency */}
              <div>
                <Label htmlFor="perUserConcurrency" className="text-sm font-medium text-gray-700">
                  单用户并发限制
                </Label>
                <Input
                  id="perUserConcurrency"
                  type="number"
                  min="1"
                  max="20"
                  value={config.perUserConcurrency}
                  onChange={(e) => setConfig({ ...config, perUserConcurrency: parseInt(e.target.value) || 1 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  单个用户同时运行的任务数上限。自动计算：全局并发 ÷ 4（当前：{config.perUserConcurrency}）
                </p>
              </div>

              {/* Max Queue Size */}
              <div>
                <Label htmlFor="maxQueueSize" className="text-sm font-medium text-gray-700">
                  队列最大长度
                </Label>
                <Input
                  id="maxQueueSize"
                  type="number"
                  min="10"
                  max="10000"
                  value={config.maxQueueSize}
                  onChange={(e) => setConfig({ ...config, maxQueueSize: parseInt(e.target.value) || 10 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  等待队列中最多可容纳的任务数（默认：1000）
                </p>
              </div>

              {/* Task Timeout */}
              <div>
                <Label htmlFor="taskTimeout" className="text-sm font-medium text-gray-700">
                  任务超时时间（毫秒）
                </Label>
                <Input
                  id="taskTimeout"
                  type="number"
                  min="10000"
                  max="600000"
                  step="1000"
                  value={config.taskTimeout}
                  onChange={(e) => setConfig({ ...config, taskTimeout: parseInt(e.target.value) || 10000 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  单个任务的最大执行时间，超时后自动终止（默认：300000ms = 5分钟）
                </p>
              </div>

              {/* Enable Priority */}
              <div>
                <Label htmlFor="enablePriority" className="text-sm font-medium text-gray-700">
                  启用优先级队列
                </Label>
                <Select
                  value={config.enablePriority.toString()}
                  onValueChange={(value) => setConfig({ ...config, enablePriority: value === 'true' })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">是</SelectItem>
                    <SelectItem value="false">否</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-gray-500 mt-1">
                  是否启用任务优先级功能，高优先级任务优先执行
                </p>
              </div>

              {/* Default Max Retries (New Unified Queue Feature) */}
              <div>
                <Label htmlFor="defaultMaxRetries" className="text-sm font-medium text-gray-700">
                  默认最大重试次数
                </Label>
                <Input
                  id="defaultMaxRetries"
                  type="number"
                  min="0"
                  max="5"
                  value={config.defaultMaxRetries}
                  onChange={(e) => setConfig({ ...config, defaultMaxRetries: parseInt(e.target.value) || 0 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  任务失败后的最大重试次数（默认：3）
                </p>
              </div>

              {/* Retry Delay (New Unified Queue Feature) */}
              <div>
                <Label htmlFor="retryDelay" className="text-sm font-medium text-gray-700">
                  重试延迟（毫秒）
                </Label>
                <Input
                  id="retryDelay"
                  type="number"
                  min="1000"
                  max="60000"
                  step="1000"
                  value={config.retryDelay}
                  onChange={(e) => setConfig({ ...config, retryDelay: parseInt(e.target.value) || 1000 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  任务重试前的等待时间（默认：5000ms = 5秒）
                </p>
              </div>

              {/* Storage Type (Read-only, New Unified Queue Feature) */}
              <div>
                <Label className="text-sm font-medium text-gray-700">
                  队列存储类型
                </Label>
                <Input
                  type="text"
                  value={config.storageType === 'redis' ? 'Redis (持久化)' : '内存 (回退)'}
                  readOnly
                  className="mt-1 bg-gray-50"
                />
                <p className="text-sm text-gray-500 mt-1">
                  由环境变量 REDIS_URL 决定，不可修改
                </p>
              </div>
            </div>

            {/* Per-Type Concurrency Configuration (New Section) */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-base font-semibold text-gray-900 mb-4">任务类型并发限制</h3>
              <p className="text-sm text-gray-500 mb-4">
                针对不同类型的任务设置独立的并发限制。系统会取三层限制（全局、用户、类型）中最严格的值。
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(config.perTypeConcurrency).map(([type, limit]) => (
                  <div key={type} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <Label className="text-sm font-medium text-gray-700">
                        {TASK_TYPE_LABELS[type] || type}
                      </Label>
                      <p className="text-xs text-gray-400">{type}</p>
                    </div>
                    <Input
                      type="number"
                      min="1"
                      max="10"
                      value={limit}
                      onChange={(e) => setConfig({
                        ...config,
                        perTypeConcurrency: {
                          ...config.perTypeConcurrency,
                          [type]: parseInt(e.target.value) || 1
                        }
                      })}
                      className="w-20 text-center"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Save Button */}
            <div className="mt-8 flex justify-end">
              <Button
                onClick={saveConfig}
                disabled={savingConfig}
                className="min-w-[120px]"
              >
                {savingConfig ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    保存配置
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Current Configuration Display */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">当前生效配置</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">全局并发限制</span>
                <span className="text-lg font-bold text-gray-900">{stats.config.globalConcurrency}</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">单用户并发限制</span>
                <span className="text-lg font-bold text-gray-900">{stats.config.perUserConcurrency}</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">队列最大长度</span>
                <span className="text-lg font-bold text-gray-900">{stats.config.maxQueueSize}</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">任务超时</span>
                <span className="text-lg font-bold text-gray-900">{Math.round(stats.config.taskTimeout / 1000)}s</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">优先级队列</span>
                <span className={`text-lg font-bold ${stats.config.enablePriority ? 'text-green-600' : 'text-gray-400'}`}>
                  {stats.config.enablePriority ? '已启用' : '已禁用'}
                </span>
              </div>
            </div>

            {/* Per-Type Concurrency Current Values */}
            {stats.config.perTypeConcurrency && (
              <div className="mt-6 pt-4 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-3">任务类型并发限制</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                  {Object.entries(stats.config.perTypeConcurrency).map(([type, limit]) => (
                    <div key={type} className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm">
                      <span className="text-gray-600 truncate" title={type}>
                        {TASK_TYPE_LABELS[type] || type}
                      </span>
                      <span className="font-bold text-gray-900 ml-2">{limit}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
