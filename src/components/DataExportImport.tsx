'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Download, Upload, AlertCircle, CheckCircle2 } from 'lucide-react'

export function DataExportImport() {
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json')
  const [exportType, setExportType] = useState<'offers' | 'campaigns'>('offers')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [importResults, setImportResults] = useState<any>(null)

  // 导出数据
  const handleExport = async () => {
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch(`/api/export/${exportType}?format=${exportFormat}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('导出失败')
      }

      // 下载文件
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${exportType}_${new Date().toISOString().split('T')[0]}.${exportFormat}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      setMessage({ type: 'success', text: '导出成功！' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '导出失败',
      })
    } finally {
      setLoading(false)
    }
  }

  // 导入数据
  const handleImport = async () => {
    if (!importFile) {
      setMessage({ type: 'error', text: '请先选择文件' })
      return
    }

    setLoading(true)
    setMessage(null)
    setImportResults(null)

    try {
      // 读取文件内容
      const fileContent = await importFile.text()
      let offers: any[]

      if (importFile.name.endsWith('.json')) {
        offers = JSON.parse(fileContent)
      } else if (importFile.name.endsWith('.csv')) {
        // 简单的CSV解析（实际项目中应使用专业库）
        const lines = fileContent.split('\n')
        const headers = lines[0].split(',')
        offers = lines.slice(1).map((line) => {
          const values = line.split(',')
          const obj: any = {}
          headers.forEach((header, index) => {
            obj[header.trim()] = values[index]?.trim()
          })
          return obj
        })
      } else {
        throw new Error('不支持的文件格式，请使用JSON或CSV文件')
      }

      // 发送导入请求
      const response = await fetch('/api/import/offers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ offers, mode: 'create' }),
      })

      if (!response.ok) {
        throw new Error('导入失败')
      }

      const result = await response.json()
      setImportResults(result.results)
      setMessage({
        type: result.results.failed === 0 ? 'success' : 'error',
        text: result.message,
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '导入失败',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 数据导出 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            数据导出
          </CardTitle>
          <CardDescription>
            导出您的Offers或Campaigns数据为JSON或CSV格式
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">数据类型</label>
              <Select value={exportType} onValueChange={(value: any) => setExportType(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="offers">Offers</SelectItem>
                  <SelectItem value="campaigns">Campaigns</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">导出格式</label>
              <Select value={exportFormat} onValueChange={(value: any) => setExportFormat(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleExport} disabled={loading} className="w-full">
            {loading ? '导出中...' : '导出数据'}
          </Button>
        </CardContent>
      </Card>

      {/* 数据导入 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            数据导入
          </CardTitle>
          <CardDescription>
            批量导入Offers数据（支持JSON和CSV格式）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">选择文件</label>
            <input
              type="file"
              accept=".json,.csv"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="w-full border border-gray-300 rounded-md p-2"
            />
          </div>

          <Button onClick={handleImport} disabled={loading || !importFile} className="w-full">
            {loading ? '导入中...' : '导入数据'}
          </Button>

          {importResults && (
            <div className="space-y-2">
              <div className="text-sm">
                <p>总数: {importResults.total}</p>
                <p className="text-green-600">成功: {importResults.success}</p>
                <p className="text-red-600">失败: {importResults.failed}</p>
              </div>

              {importResults.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto">
                  <p className="text-sm font-medium mb-1">错误详情:</p>
                  {importResults.errors.slice(0, 5).map((err: any, idx: number) => (
                    <p key={idx} className="text-xs text-red-600">
                      行 {err.index + 1}: {err.error}
                    </p>
                  ))}
                  {importResults.errors.length > 5 && (
                    <p className="text-xs text-gray-500 mt-1">
                      ...还有 {importResults.errors.length - 5} 个错误
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 消息提示 */}
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
          {message.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
