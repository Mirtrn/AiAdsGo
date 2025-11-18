'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim())
      const offer: any = {}

      headers.forEach((header, index) => {
        if (values[index]) {
          offer[header] = values[index]
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
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      // 读取CSV文件
      const text = await file.text()
      const offers = parseCSV(text)

      // 发送批量创建请求
      const response = await fetch('/api/offers/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ offers }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '批量上传失败')
      }

      setResults(data)
    } catch (err: any) {
      setError(err.message || '批量上传失败，请稍后重试')
    } finally {
      setUploading(false)
    }
  }

  const downloadTemplate = () => {
    const template = `url,brand,category,target_country,affiliate_link,product_price,commission_payout,product_currency,brand_description,unique_selling_points,product_highlights,target_audience
https://www.amazon.com/stores/page/xxx,Reolink,安防监控,US,https://pboost.me/xxx,$699.00,6.75%,USD,专业安防品牌,4K高清 夜视,POE供电 防水,家庭用户
https://www.amazon.com/stores/page/yyy,Anker,电子配件,US,,99.99,10,USD,充电品牌,快充技术,多口充电,科技爱好者`

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'offer_template.csv'
    link.click()
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
              <h1 className="text-xl font-bold text-gray-900">批量上传Offers</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 说明和模板下载 */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">使用说明</h2>

            <div className="space-y-3 text-sm text-gray-600">
              <p>1. 下载CSV模板文件，按照格式填写Offer信息</p>
              <p>2. 必填字段：<span className="font-mono text-indigo-600">url, brand, target_country</span></p>
              <p>3. 定价字段（可选）：<span className="font-mono text-indigo-600">product_price, commission_payout, product_currency</span></p>
              <p>4. 单次最多上传100条Offer</p>
              <p>5. 上传成功后可查看详细结果</p>
            </div>

            <div className="mt-6">
              <button
                onClick={downloadTemplate}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载CSV模板
              </button>
            </div>
          </div>

          {/* CSV字段说明 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <h3 className="text-sm font-medium text-blue-900 mb-3">📋 CSV字段说明</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium text-blue-900">基础字段</p>
                <ul className="mt-2 space-y-1 text-blue-700">
                  <li>• <span className="font-mono">url</span> - 商品/店铺URL（必填）</li>
                  <li>• <span className="font-mono">brand</span> - 品牌名称（必填）</li>
                  <li>• <span className="font-mono">target_country</span> - 目标国家代码（必填）</li>
                  <li>• <span className="font-mono">category</span> - 产品分类</li>
                  <li>• <span className="font-mono">affiliate_link</span> - 联盟链接</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-blue-900">定价字段（用于CPC建议）</p>
                <ul className="mt-2 space-y-1 text-blue-700">
                  <li>• <span className="font-mono">product_price</span> - 产品价格（如：$699.00）</li>
                  <li>• <span className="font-mono">commission_payout</span> - 佣金比例（如：6.75%）</li>
                  <li>• <span className="font-mono">product_currency</span> - 价格货币（如：USD）</li>
                </ul>
                <p className="mt-3 font-medium text-blue-900">描述字段</p>
                <ul className="mt-2 space-y-1 text-blue-700">
                  <li>• <span className="font-mono">brand_description</span> - 品牌描述</li>
                  <li>• <span className="font-mono">unique_selling_points</span> - 独特卖点</li>
                  <li>• <span className="font-mono">product_highlights</span> - 产品亮点</li>
                  <li>• <span className="font-mono">target_audience</span> - 目标受众</li>
                </ul>
              </div>
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
    </div>
  )
}
