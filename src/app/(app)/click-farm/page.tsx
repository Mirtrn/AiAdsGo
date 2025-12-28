'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PlusCircle, Play, Square, RefreshCw, Eye, Edit2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import ClickFarmTaskModal from '@/components/ClickFarmTaskModal';
import ClickFarmDistributionChart from '@/components/ClickFarmDistributionChart';
import ClickFarmNotificationBadge from '@/components/ClickFarmNotificationBadge';
import type { ClickFarmTask, ClickFarmStats } from '@/lib/click-farm-types';

export default function ClickFarmPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<ClickFarmTask[]>([]);
  const [stats, setStats] = useState<ClickFarmStats | null>(null);
  const [distribution, setDistribution] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);  // 🆕 编辑任务ID
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);  // 🆕 删除确认对话框
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);  // 🆕 待删除任务ID

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load tasks, stats, and distribution in parallel
      const [tasksRes, statsRes, distributionRes] = await Promise.all([
        fetch('/api/click-farm/tasks'),
        fetch('/api/click-farm/stats'),
        fetch('/api/click-farm/hourly-distribution'),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.data.tasks || []);
      }

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.data);
      }

      if (distributionRes.ok) {
        const data = await distributionRes.json();
        setDistribution(data.data);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleStopTask = async (taskId: string) => {
    try {
      setActionLoading(taskId);
      const response = await fetch(`/api/click-farm/tasks/${taskId}/stop`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '停止任务失败');
      }

      toast.success('任务已停止');
      await loadData();
    } catch (error: any) {
      console.error('停止任务失败:', error);
      toast.error(error.message || '停止任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestartTask = async (taskId: string) => {
    try {
      setActionLoading(taskId);
      const response = await fetch(`/api/click-farm/tasks/${taskId}/restart`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '重启任务失败');
      }

      toast.success('任务已重启');
      await loadData();
    } catch (error: any) {
      console.error('重启任务失败:', error);
      toast.error(error.message || '重启任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteTask = async () => {
    if (!deleteTaskId) return;

    try {
      setActionLoading(deleteTaskId);
      const response = await fetch(`/api/click-farm/tasks/${deleteTaskId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '删除任务失败');
      }

      toast.success('任务已删除，历史数据已保留');
      setDeleteDialogOpen(false);
      setDeleteTaskId(null);
      await loadData();
    } catch (error: any) {
      console.error('删除任务失败:', error);
      toast.error(error.message || '删除任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      running: 'default',
      pending: 'secondary',
      paused: 'destructive',
      stopped: 'outline',
      completed: 'success'
    };

    const labels: Record<string, string> = {
      running: '运行中',
      pending: '等待中',
      paused: '已中止',
      stopped: '已停止',
      completed: '已完成'
    };

    return (
      <Badge variant={variants[status] || 'default'}>
        {labels[status] || status}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* 标题和操作 */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">补点击管理</h1>
        <div className="flex items-center gap-3">
          <ClickFarmNotificationBadge />
          <Button onClick={() => setModalOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            创建任务
          </Button>
        </div>
      </div>

      {/* 创建/编辑任务弹窗 */}
      <ClickFarmTaskModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditTaskId(null);  // 关闭时清除编辑ID
        }}
        onSuccess={loadData}
        editTaskId={editTaskId || undefined}  // 🆕 传入编辑任务ID
      />

      {/* 统计卡片 */}
      {stats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  今日点击
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.today.clicks.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  成功率: {stats.today.successRate}%
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  今日流量
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatBytes(stats.today.traffic)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  基于点击数推算
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  累计点击
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.cumulative.clicks.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  累计流量: {formatBytes(stats.cumulative.traffic)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* 🆕 任务状态分布卡片 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                任务状态分布
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-600">{stats.taskStatusDistribution.pending}</div>
                  <div className="text-xs text-muted-foreground">等待开始</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">{stats.taskStatusDistribution.running}</div>
                  <div className="text-xs text-muted-foreground">运行中</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-yellow-600">{stats.taskStatusDistribution.paused}</div>
                  <div className="text-xs text-muted-foreground">已中止</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-600">{stats.taskStatusDistribution.stopped}</div>
                  <div className="text-xs text-muted-foreground">已停止</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-purple-600">{stats.taskStatusDistribution.completed}</div>
                  <div className="text-xs text-muted-foreground">已完成</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold">{stats.taskStatusDistribution.total}</div>
                  <div className="text-xs text-muted-foreground">总任务数</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* 时间分布趋势图 */}
      <ClickFarmDistributionChart data={distribution} />

      {/* 任务列表 */}
      <Card>
        <CardHeader>
          <CardTitle>我的任务</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              暂无任务，点击"创建任务"开始
            </div>
          ) : (
            <div className="space-y-4">
              {tasks.map(task => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
                >
                  <div className="flex-1 cursor-pointer" onClick={() => router.push(`/click-farm/tasks/${task.id}`)}>
                    <div className="flex items-center gap-3">
                      <h3 className="font-medium">Offer #{task.offer_id}</h3>
                      {getStatusBadge(task.status)}
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground space-x-4">
                      <span>开始: {task.scheduled_start_date}</span>
                      <span>每日: {task.daily_click_count}次</span>
                      <span>进度: {task.progress}%</span>
                      <span>成功率: {task.total_clicks > 0 ? ((task.success_clicks / task.total_clicks) * 100).toFixed(1) : 0}%</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push(`/click-farm/tasks/${task.id}`)}
                      title="查看详情"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {/* 🆕 编辑按钮（仅pending/running状态可编辑） */}
                    {(task.status === 'pending' || task.status === 'running') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditTaskId(task.id);
                          setModalOpen(true);
                        }}
                        title="编辑任务"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    )}
                    {task.status === 'running' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleStopTask(task.id)}
                        disabled={actionLoading === task.id}
                      >
                        <Square className="h-4 w-4" />
                      </Button>
                    )}
                    {(task.status === 'stopped' || task.status === 'paused') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRestartTask(task.id)}
                        disabled={actionLoading === task.id}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                    {/* 🆕 删除按钮（所有状态都可删除） */}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setDeleteTaskId(task.id);
                        setDeleteDialogOpen(true);
                      }}
                      disabled={actionLoading === task.id}
                      title="删除任务"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={loadData}
                      disabled={loading}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 🆕 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除任务？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将删除该补点击任务。任务将被标记为已删除，但历史统计数据会被保留。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTaskId(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTask}
              className="bg-red-600 hover:bg-red-700"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
