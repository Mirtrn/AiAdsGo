'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface AIModel {
  id: number
  model_id: string
  display_name: string
  cost_label: string
  is_enabled: boolean
  sort_order: number
  notes: string
  created_at: string
  updated_at: string
}

const emptyForm = {
  model_id: '',
  display_name: '',
  cost_label: '',
  is_enabled: true,
  sort_order: 100,
  notes: '',
}

export default function AdminAIModelsPage() {
  const [models, setModels] = useState<AIModel[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 弹窗状态
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<AIModel | null>(null)

  // 连通性测试状态
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, 'ok' | 'fail' | null>>({})

  const fetchModels = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ai-models')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setModels(data.models || [])
    } catch (e: any) {
      toast.error('加载模型列表失败', { description: e.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchModels() }, [])

  const openAdd = () => {
    setEditingId(null)
    setForm({ ...emptyForm })
    setDialogOpen(true)
  }

  const openEdit = (m: AIModel) => {
    setEditingId(m.id)
    setForm({
      model_id: m.model_id,
      display_name: m.display_name,
      cost_label: m.cost_label,
      is_enabled: m.is_enabled,
      sort_order: m.sort_order,
      notes: m.notes,
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.model_id.trim()) { toast.error('模型 ID 不能为空'); return }
    if (!form.display_name.trim()) { toast.error('展示名称不能为空'); return }

    setSaving(true)
    try {
      const url = editingId ? `/api/admin/ai-models/${editingId}` : '/api/admin/ai-models'
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '操作失败')
      toast.success(editingId ? '模型已更新' : '模型已添加')
      setDialogOpen(false)
      fetchModels()
    } catch (e: any) {
      toast.error('保存失败', { description: e.message })
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = async (m: AIModel) => {
    try {
      const res = await fetch(`/api/admin/ai-models/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: !m.is_enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(m.is_enabled ? `已禁用 ${m.display_name}` : `已启用 ${m.display_name}`)
      fetchModels()
    } catch (e: any) {
      toast.error('操作失败', { description: e.message })
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const res = await fetch(`/api/admin/ai-models/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`已删除模型 ${deleteTarget.display_name}`)
      setDeleteTarget(null)
      fetchModels()
    } catch (e: any) {
      toast.error('删除失败', { description: e.message })
    }
  }

  const handleTest = async (m: AIModel) => {
    setTestingId(m.id)
    setTestResults(prev => ({ ...prev, [m.id]: null }))
    try {
      // 直接用公开接口模拟请求，这里用一个简单的 ping 方式
      const res = await fetch('/api/settings/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ai',
          config: { litellm_model: m.model_id },
        }),
      })
      const data = await res.json()
      const ok = data.valid === true
      setTestResults(prev => ({ ...prev, [m.id]: ok ? 'ok' : 'fail' }))
      if (ok) {
        toast.success(`${m.display_name} 连通正常 ✅`)
      } else {
        // 将错误信息中的实际model_id替换为展示名，避免暴露内部名称
        const friendlyMsg = data.message
          ? data.message.replace(new RegExp(m.model_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), m.display_name)
          : data.message
        toast.error(`${m.display_name} 连通失败`, { description: friendlyMsg })
      }
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [m.id]: 'fail' }))
      toast.error('测试失败', { description: e.message })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI 模型管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            管理用户可选择的 AI 模型列表，启用/禁用、添加、修改或删除模型
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchModels} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            添加模型
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            模型列表
            <Badge variant="secondary" className="ml-2">{models.length} 个</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">加载中...</span>
            </div>
          ) : models.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p>暂无模型配置</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={openAdd}>
                <Plus className="w-4 h-4 mr-2" />添加第一个模型
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">排序</TableHead>
                  <TableHead>模型 ID</TableHead>
                  <TableHead>展示名</TableHead>
                  <TableHead>价格</TableHead>
                  <TableHead className="w-20 text-center">状态</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead className="w-48 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map(m => (
                  <TableRow key={m.id} className={!m.is_enabled ? 'opacity-50' : ''}>
                    <TableCell className="text-center text-gray-400">
                      <span className="text-xs font-mono">{m.sort_order}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-600">{m.model_id}</TableCell>
                    <TableCell>
                      <span className="font-medium">{m.display_name}</span>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">{m.cost_label || '—'}</TableCell>
                    <TableCell className="text-center">
                      <button
                        onClick={() => handleToggleEnabled(m)}
                        title={m.is_enabled ? '点击禁用' : '点击启用'}
                      >
                        {m.is_enabled ? (
                          <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-200 cursor-pointer">启用</Badge>
                        ) : (
                          <Badge variant="secondary" className="cursor-pointer">禁用</Badge>
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="text-xs text-gray-400 max-w-[160px] truncate" title={m.notes}>{m.notes || '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* 连通性测试 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleTest(m)}
                          disabled={testingId === m.id}
                          title="测试连通性"
                        >
                          {testingId === m.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : testResults[m.id] === 'ok' ? (
                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                          ) : testResults[m.id] === 'fail' ? (
                            <XCircle className="w-3 h-3 text-red-500" />
                          ) : (
                            <span>测试</span>
                          )}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openEdit(m)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeleteTarget(m)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 添加/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑模型' : '添加模型'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>模型 ID <span className="text-red-500">*</span></Label>
              <Input
                className="mt-1 font-mono text-sm"
                placeholder="如 gpt-5.4 或 google/gemini-3-flash-preview"
                value={form.model_id}
                onChange={e => setForm(f => ({ ...f, model_id: e.target.value }))}
                disabled={!!editingId}
              />
              <p className="text-xs text-gray-400 mt-1">实际调用的模型标识符，添加后不可修改</p>
            </div>
            <div>
              <Label>展示名称 <span className="text-red-500">*</span></Label>
              <Input
                className="mt-1"
                placeholder="如 Spark / Nova / Swift"
                value={form.display_name}
                onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">在下拉列表和报错弹窗中显示的名称</p>
            </div>
            <div>
              <Label>价格标注</Label>
              <Input
                className="mt-1"
                placeholder="如 ≈¥1.5/条"
                value={form.cost_label}
                onChange={e => setForm(f => ({ ...f, cost_label: e.target.value }))}
              />
            </div>
            <div>
              <Label>排序权重</Label>
              <Input
                className="mt-1"
                type="number"
                min={1}
                placeholder="100"
                value={form.sort_order}
                onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 100 }))}
              />
              <p className="text-xs text-gray-400 mt-1">数值越小越靠前</p>
            </div>
            <div>
              <Label>内部备注</Label>
              <Input
                className="mt-1"
                placeholder="可选，仅管理员可见"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_enabled"
                checked={form.is_enabled}
                onChange={e => setForm(f => ({ ...f, is_enabled: e.target.checked }))}
                className="w-4 h-4"
              />
              <Label htmlFor="is_enabled" className="cursor-pointer">启用（在用户下拉列表中显示）</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? '保存修改' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              即将删除模型 <span className="font-semibold text-gray-900">{deleteTarget?.display_name}</span>（{deleteTarget?.model_id}）。<br />
              删除后用户将无法选择该模型，<strong>此操作不可撤销</strong>。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
