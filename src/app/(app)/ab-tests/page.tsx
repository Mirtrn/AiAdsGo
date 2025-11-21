'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showSuccess, showError } from '@/lib/toast-utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  FlaskConical,
  Plus,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Clock,
  Target,
} from 'lucide-react'

interface ABTest {
  id: number
  offer_id: number
  test_name: string
  test_description: string | null
  test_type: string
  status: string
  start_date: string | null
  end_date: string | null
  winner_variant_id: number | null
  statistical_confidence: number | null
  variant_count: number
  offer_brand: string
  offer_product_name: string
  created_at: string
  updated_at: string
}

export default function ABTestsPage() {
  const router = useRouter()
  const [tests, setTests] = useState<ABTest[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  useEffect(() => {
    fetchTests()
  }, [filterStatus])

  const fetchTests = async () => {
    try {
      setLoading(true)
      let url = '/api/ab-tests'
      if (filterStatus !== 'all') {
        url += `?status=${filterStatus}`
      }

      const response = await fetch(url, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取A/B测试列表失败')
      }

      const data = await response.json()
      setTests(data.tests || [])
    } catch (err: any) {
      showError('加载失败', err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleStatusChange = async (testId: number, newStatus: string) => {
    try {
      const response = await fetch(`/api/ab-tests/${testId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '更新状态失败')
      }

      showSuccess('成功', `测试状态已更新为: ${getStatusLabel(newStatus)}`)
      await fetchTests()
    } catch (err: any) {
      showError('更新失败', err.message)
    }
  }

  const handleDelete = async (testId: number, testName: string) => {
    if (!confirm(`确定要删除测试 "${testName}" 吗？\n\n此操作无法撤销。`)) {
      return
    }

    try {
      const response = await fetch(`/api/ab-tests/${testId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '删除失败')
      }

      showSuccess('删除成功', `测试 "${testName}" 已删除`)
      await fetchTests()
    } catch (err: any) {
      showError('删除失败', err.message)
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'secondary',
      running: 'default',
      paused: 'outline',
      completed: 'default',
      cancelled: 'destructive',
    }

    const icons: Record<string, any> = {
      draft: Clock,
      running: Play,
      paused: Pause,
      completed: CheckCircle2,
      cancelled: XCircle,
    }

    const Icon = icons[status] || Clock

    return (
      <Badge variant={variants[status] || 'secondary'} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {getStatusLabel(status)}
      </Badge>
    )
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: '草稿',
      running: '进行中',
      paused: '已暂停',
      completed: '已完成',
      cancelled: '已取消',
    }
    return labels[status] || status
  }

  const getTestTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      headline: '标题',
      description: '描述',
      cta: '行动号召',
      image: '图片',
      full_creative: '完整创意',
    }
    return labels[type] || type
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
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
              <button
                onClick={() => router.push('/dashboard')}
                className="text-indigo-600 hover:text-indigo-500 mr-4"
              >
                ← 返回Dashboard
              </button>
              <FlaskConical className="h-6 w-6 text-gray-700 mr-2" />
              <h1 className="text-xl font-bold text-gray-900">A/B测试管理</h1>
            </div>
            <div className="flex items-center">
              <Button
                onClick={() => router.push('/ab-tests/create')}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                创建A/B测试
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0 space-y-6">
          {/* Filter Tabs */}
          <div className="flex gap-2">
            {['all', 'draft', 'running', 'paused', 'completed'].map((status) => (
              <Button
                key={status}
                variant={filterStatus === status ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterStatus(status)}
              >
                {status === 'all' ? '全部' : getStatusLabel(status)}
              </Button>
            ))}
          </div>

          {/* Test List */}
          {tests.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FlaskConical className="h-16 w-16 text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {filterStatus === 'all' ? '还没有A/B测试' : `没有${getStatusLabel(filterStatus)}的测试`}
                </h3>
                <p className="text-gray-600 mb-6 text-center max-w-md">
                  创建A/B测试来对比不同广告创意的表现，找出最佳变体
                </p>
                <Button onClick={() => router.push('/ab-tests/create')}>
                  <Plus className="h-4 w-4 mr-2" />
                  创建第一个A/B测试
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6">
              {tests.map((test) => (
                <Card key={test.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <CardTitle
                            className="cursor-pointer hover:text-indigo-600"
                            onClick={() => router.push(`/ab-tests/${test.id}`)}
                          >
                            {test.test_name}
                          </CardTitle>
                          {getStatusBadge(test.status)}
                          <Badge variant="outline">{getTestTypeLabel(test.test_type)}</Badge>
                        </div>
                        {test.test_description && (
                          <p className="text-sm text-gray-600">{test.test_description}</p>
                        )}
                      </div>
                      <div className="flex gap-2 ml-4">
                        {test.status === 'draft' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusChange(test.id, 'running')}
                          >
                            <Play className="h-4 w-4 mr-1" />
                            启动
                          </Button>
                        )}
                        {test.status === 'running' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusChange(test.id, 'paused')}
                          >
                            <Pause className="h-4 w-4 mr-1" />
                            暂停
                          </Button>
                        )}
                        {test.status === 'paused' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusChange(test.id, 'running')}
                          >
                            <Play className="h-4 w-4 mr-1" />
                            继续
                          </Button>
                        )}
                        {(test.status === 'draft' || test.status === 'cancelled') && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(test.id, test.test_name)}
                          >
                            删除
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600">关联Offer</p>
                        <p className="font-semibold">
                          {test.offer_brand} - {test.offer_product_name}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">测试变体</p>
                        <p className="font-semibold">{test.variant_count} 个变体</p>
                      </div>
                      <div>
                        <p className="text-gray-600">开始时间</p>
                        <p className="font-semibold">{formatDate(test.start_date)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">
                          {test.status === 'completed' ? '结束时间' : '创建时间'}
                        </p>
                        <p className="font-semibold">
                          {formatDate(test.end_date || test.created_at)}
                        </p>
                      </div>
                    </div>

                    {test.winner_variant_id && (
                      <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md flex items-center gap-2">
                        <Target className="h-5 w-5 text-green-600" />
                        <span className="text-sm text-green-800">
                          已确定获胜变体
                          {test.statistical_confidence && (
                            <span className="ml-2 font-semibold">
                              (置信度: {(test.statistical_confidence * 100).toFixed(1)}%)
                            </span>
                          )}
                        </span>
                      </div>
                    )}

                    <div className="mt-4 flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/ab-tests/${test.id}`)}
                      >
                        <TrendingUp className="h-4 w-4 mr-2" />
                        查看结果
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
