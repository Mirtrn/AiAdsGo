'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BatchUploadProgress } from '@/components/BatchUploadProgress'

interface UploadResult {
  success: boolean
  row: number
  offer?: {
    id: number
    brand: string
    url: string
  }
  error?: string
}

export default function BatchUploadOffersPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<{
    summary?: {
      total: number
      success: number
      failed: number
    }
    results?: UploadResult[]
  } | null>(null)
  const [uploadedOfferIds, setUploadedOfferIds] = useState<number[]>([])
  const [showProgress, setShowProgress] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        setError('请选择CSV文件')
        setFile(null)
        return
      }
      setFile(selectedFile)
      setError('')
      setResults(null)
    }
  }

  const parseCSV = (text: string): any[] => {
    const lines = text.split('\n').filter((line) => line.trim())
    if (lines.length < 2) {
      throw new Error('CSV文件至少需要包含表头和一行数据')
    }

    const headers = lines[0].split(',').map((h) => h.trim())
    const offers: any[] = []

    // 字段映射：将中文表头映射为API字段名
    const fieldMapping: Record<string, string> = {
      '推广链接': 'affiliate_link',
      '推广国家': 'target_country',
      '产品价格': 'product_price',
      '佣金比例': 'commission_payout',
      // 兼容英文表头
      'affiliate_link': 'affiliate_link',
      'target_country': 'target_country',
      'product_price': 'product_price',
      'commission_payout': 'commission_payout',
    }

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim())
      const offer: any = {}

      headers.forEach((header, index) => {
        const apiField = fieldMapping[header] || header
        if (values[index]) {
          offer[apiField] = values[index]
        }
      })

      offers.push(offer)
    }

    return offers
  }

  const handleUpload = async () => {
    if (!file) {
      setError('请先选择文件')
      return
    }

    setUploading(true)
    setError('')
    setResults(null)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // 读取CSV文件
      const text = await file.text()
      const offers = parseCSV(text)

      // 发送批量创建请求
      const response = await fetch('/api/offers/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
},
        body: JSON.stringify({ offers }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '批量上传失败')
      }

      setResults(data)

      // 提取成功创建的Offer IDs，启动进度显示
      const offerIds = data.results
        ?.filter((r: UploadResult) => r.success && r.offer?.id)
        .map((r: UploadResult) => r.offer!.id) || []

      if (offerIds.length > 0) {
        setUploadedOfferIds(offerIds)
        setShowProgress(true)
      }
    } catch (err: any) {
      setError(err.message || '批量上传失败，请稍后重试')
    } finally {
      setUploading(false)
    }
  }

  const downloadTemplate = () => {
    // 直接打开模板下载API，避免前端处理CSV格式
    window.open('/api/offers/batch-template', '_blank')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <a href="/offers" className="text-indigo-600 hover:text-indigo-500 mr-4">
                ← 返回列表
              </a>
              <h1 className="text-xl font-bold text-gray-900">导入Offer</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 说明和模板下载 */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">📋 使用说明</h2>

            <div className="space-y-3 text-sm text-gray-600">
              <p><strong>步骤1：</strong>点击下方"下载CSV模板"按钮，获取标准格式模板</p>
              <p><strong>步骤2：</strong>在模板中填写Offer信息（必填：推广链接、推广国家）</p>
              <p><strong>步骤3：</strong>上传填好的CSV文件（单次最多100条）</p>
              <p><strong>步骤4：</strong>等待处理完成，查看导入结果</p>
            </div>

            <div className="mt-6">
              <button
                onClick={downloadTemplate}
                className="inline-flex items-center px-4 py-2 border border-indigo-600 shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载CSV模板
              </button>
              <p className="mt-2 text-xs text-gray-500">
                💡 提示：模板包含示例数据，可直接参考填写
              </p>
            </div>
          </div>

          {/* CSV字段说明 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <h3 className="text-sm font-medium text-blue-900 mb-3">📋 CSV字段说明</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium text-blue-900 mb-2">✅ 必填字段</p>
                <ul className="mt-2 space-y-1.5 text-blue-700">
                  <li>• <span className="font-mono bg-white px-2 py-0.5 rounded">推广链接</span> - 联盟推广URL</li>
                  <li>• <span className="font-mono bg-white px-2 py-0.5 rounded">推广国家</span> - 国家代码（如：US, UK, DE）</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-blue-900 mb-2">📊 可选字段</p>
                <ul className="mt-2 space-y-1.5 text-blue-700">
                  <li>• <span className="font-mono bg-white px-2 py-0.5 rounded">产品价格</span> - 带货币符号（如：$699.00）</li>
                  <li>• <span className="font-mono bg-white px-2 py-0.5 rounded">佣金比例</span> - 百分比（如：6.75%）</li>
                </ul>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-blue-200">
              <p className="text-xs text-blue-600">
                💡 <strong>提示：</strong>产品价格和佣金比例用于自动计算建议CPC，帮助优化广告投放成本
              </p>
              <p className="text-xs text-blue-600 mt-2">
                🤖 <strong>自动提取：</strong>品牌名称、Final URL、品牌描述等信息将通过系统自动抓取获得
              </p>
            </div>
          </div>

          {/* 上传区域 */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">上传文件</h2>

            {error && (
              <div className="mb-4 px-4 py-3 bg-red-50 border border-red-400 text-red-700 rounded">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择CSV文件
                </label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-sm file:font-semibold
                    file:bg-indigo-50 file:text-indigo-700
                    hover:file:bg-indigo-100"
                />
                {file && (
                  <p className="mt-2 text-sm text-gray-600">
                    已选择：{file.name} ({(file.size / 1024).toFixed(2)} KB)
                  </p>
                )}
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => router.push('/offers')}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? '上传中...' : '开始上传'}
                </button>
              </div>
            </div>
          </div>

          {/* 上传结果 */}
          {results && (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">上传结果</h2>

              {/* 汇总 */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-500">总计</p>
                  <p className="text-2xl font-bold text-gray-900">{results.summary?.total}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <p className="text-sm text-green-600">成功</p>
                  <p className="text-2xl font-bold text-green-900">{results.summary?.success}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-4">
                  <p className="text-sm text-red-600">失败</p>
                  <p className="text-2xl font-bold text-red-900">{results.summary?.failed}</p>
                </div>
              </div>

              {/* 详细结果 */}
              {results.results && results.results.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-3">详细结果</h3>
                  <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-300">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">行号</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">品牌</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">信息</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {results.results.map((result, idx) => (
                          <tr key={idx} className={result.success ? '' : 'bg-red-50'}>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                              {result.row}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm">
                              {result.success ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  成功
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                  失败
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                              {result.offer?.brand || '-'}
                            </td>
                            <td className="px-3 py-4 text-sm text-gray-500">
                              {result.success ? (
                                <a
                                  href={`/offers/${result.offer?.id}`}
                                  className="text-indigo-600 hover:text-indigo-900"
                                >
                                  查看详情 →
                                </a>
                              ) : (
                                <span className="text-red-600">{result.error}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={() => router.push('/offers')}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                    >
                      返回Offer列表
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* 批量上传进度显示（浮动，不阻塞用户操作） */}
      {showProgress && uploadedOfferIds.length > 0 && (
        <BatchUploadProgress
          offerIds={uploadedOfferIds}
          onComplete={() => {
            // 全部完成后，可以选择刷新结果或显示通知
            console.log('批量上传全部完成！')
          }}
          onClose={() => {
            setShowProgress(false)
          }}
        />
      )}
    </div>
  )
}
