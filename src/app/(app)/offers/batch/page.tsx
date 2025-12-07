'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBatchTask } from '@/hooks/useBatchTask'

export default function BatchUploadOffersPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)

  const {
    isProcessing,
    batchId,
    status,
    totalCount,
    completedCount,
    failedCount,
    progress,
    error: batchError,
    connectionType,
    createBatchTask,
    reset,
  } = useBatchTask()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        alert('请选择CSV文件')
        return
      }
      setFile(selectedFile)
      // 重置之前的批量任务状态
      reset()
    }
  }

  const handleUpload = async () => {
    if (!file) {
      alert('请先选择文件')
      return
    }

    try {
      // 直接上传CSV文件，后端处理解析和校验
      // target_country必须在CSV中指定
      await createBatchTask(file)
    } catch (err: any) {
      console.error('Upload failed:', err)
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

            {batchError && (
              <div className="mb-4 px-4 py-3 bg-red-50 border border-red-400 text-red-700 rounded">
                {batchError}
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
                  disabled={isProcessing}
                  className="block w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-sm file:font-semibold
                    file:bg-indigo-50 file:text-indigo-700
                    hover:file:bg-indigo-100
                    disabled:opacity-50 disabled:cursor-not-allowed"
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
                  disabled={isProcessing}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  取消
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!file || isProcessing}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? '处理中...' : '开始上传'}
                </button>
              </div>
            </div>
          </div>

          {/* 实时进度显示 */}
          {batchId && (
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-gray-900">批量任务进度</h2>
                <div className="flex items-center space-x-2">
                  {connectionType && (
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">
                      {connectionType === 'sse' ? '📡 实时推送' : '🔄 轮询模式'}
                    </span>
                  )}
                  {status && (
                    <span className={`text-xs px-2 py-1 rounded ${
                      status === 'completed' ? 'bg-green-100 text-green-800' :
                      status === 'failed' ? 'bg-red-100 text-red-800' :
                      status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {status === 'pending' ? '⏳ 等待中' :
                       status === 'running' ? '🔄 进行中' :
                       status === 'completed' ? '✅ 已完成' :
                       status === 'failed' ? '❌ 失败' :
                       status === 'partial' ? '⚠️ 部分完成' : status}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                {/* 批量任务ID */}
                <div className="text-xs text-gray-500">
                  任务ID: <span className="font-mono">{batchId}</span>
                </div>

                {/* 进度条 */}
                <div>
                  <div className="flex justify-between text-sm text-gray-700 mb-2">
                    <span>整体进度</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div
                      className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* 统计信息 */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500">总计</p>
                    <p className="text-xl font-bold text-gray-900">{totalCount}</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3">
                    <p className="text-xs text-blue-600">进行中</p>
                    <p className="text-xl font-bold text-blue-900">
                      {totalCount - completedCount - failedCount}
                    </p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3">
                    <p className="text-xs text-green-600">成功</p>
                    <p className="text-xl font-bold text-green-900">{completedCount}</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-3">
                    <p className="text-xs text-red-600">失败</p>
                    <p className="text-xl font-bold text-red-900">{failedCount}</p>
                  </div>
                </div>

                {/* 完成后的操作 */}
                {(status === 'completed' || status === 'partial') && (
                  <div className="flex justify-end space-x-3 pt-4 border-t">
                    <button
                      onClick={reset}
                      className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      继续上传
                    </button>
                    <button
                      onClick={() => router.push('/offers')}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                    >
                      查看Offer列表
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
