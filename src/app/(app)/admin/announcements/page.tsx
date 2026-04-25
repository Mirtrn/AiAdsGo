'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Eye, EyeOff, Megaphone, AlertTriangle, Wrench, Info, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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

interface Announcement {
  id: string
  title: string
  content: string
  type: string
  is_active: boolean | number
  scheduled_at: string | null
  expires_at: string | null
  created_at: string
  read_count: number
}

const TYPE_OPTIONS = [
  { value: 'info', label: '普通通知', icon: Info, badge: 'bg-blue-100 text-blue-700' },
  { value: 'warning', label: '重要通知', icon: AlertTriangle, badge: 'bg-yellow-100 text-yellow-700' },
  { value: 'maintenance', label: '维护通知', icon: Wrench, badge: 'bg-red-100 text-red-700' },
]

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

export default function AnnouncementsAdminPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 新建表单
  const [form, setForm] = useState({
    title: '',
    content: '',
    type: 'info',
    scheduled_at: '',
    expires_at: '',
  })

  const fetchAnnouncements = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/announcements')
      if (!res.ok) throw new Error('获取失败')
      const data = await res.json()
      setAnnouncements(data.announcements || [])
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAnnouncements() }, [])

  const handleCreate = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('标题和内容为必填')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          content: form.content.trim(),
          type: form.type,
          scheduled_at: form.scheduled_at || undefined,
          expires_at: form.expires_at || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('公告已发布')
      setCreateOpen(false)
      setForm({ title: '', content: '', type: 'info', scheduled_at: '', expires_at: '' })
      fetchAnnouncements()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleActive = async (ann: Announcement) => {
    const newActive = !ann.is_active
    try {
      const res = await fetch(`/api/admin/announcements/${ann.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: newActive }),
      })
      if (!res.ok) throw new Error('操作失败')
      toast.success(newActive ? '公告已激活' : '公告已停用')
      fetchAnnouncements()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const res = await fetch(`/api/admin/announcements/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('删除失败')
      toast.success('公告已删除')
      setDeleteTarget(null)
      fetchAnnouncements()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const getTypeCfg = (type: string) => TYPE_OPTIONS.find(o => o.value === type) || TYPE_OPTIONS[0]

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-blue-600" />
            公告管理
          </h1>
          <p className="mt-1 text-sm text-gray-500">发布系统公告，用户登录后将强制弹窗阅读</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          发布公告
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">加载中...</div>
      ) : announcements.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-gray-400">
            暂无公告，点击右上角「发布公告」创建
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {announcements.map(ann => {
            const cfg = getTypeCfg(ann.type)
            const IconComp = cfg.icon
            const active = Boolean(ann.is_active)
            return (
              <Card key={ann.id} className={`transition-all ${active ? '' : 'opacity-60'}`}>
                <CardContent className="py-4 px-5">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <IconComp className="w-5 h-5 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badge}`}>
                          {cfg.label}
                        </span>
                        {active ? (
                          <Badge variant="outline" className="text-green-600 border-green-300 text-xs">已激活</Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-400 text-xs">已停用</Badge>
                        )}
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {ann.read_count} 人已读
                        </span>
                      </div>
                      <h3 className="mt-1 font-semibold text-gray-900">{ann.title}</h3>
                      <p className="text-sm text-gray-600 mt-0.5 line-clamp-2 whitespace-pre-wrap">{ann.content}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                        <span>发布：{formatDateTime(ann.created_at)}</span>
                        {ann.scheduled_at && <span>维护时间：{formatDateTime(ann.scheduled_at)}</span>}
                        {ann.expires_at && <span>过期：{formatDateTime(ann.expires_at)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => handleToggleActive(ann)}
                      >
                        {active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {active ? '停用' : '激活'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => setDeleteTarget(ann)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 创建公告弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>发布新公告</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>公告类型</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>标题 <span className="text-red-500">*</span></Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="如：系统将于今晚 22:00 进行维护"
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label>内容 <span className="text-red-500">*</span></Label>
              <Textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="详细说明..."
                rows={4}
                maxLength={2000}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>维护开始时间（选填）</Label>
                <Input
                  type="datetime-local"
                  value={form.scheduled_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>公告过期时间（选填）</Label>
                <Input
                  type="datetime-local"
                  value={form.expires_at}
                  onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? '发布中...' : '发布公告'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除公告</AlertDialogTitle>
            <AlertDialogDescription>
              删除后所有用户的已读记录也将一并清除，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
