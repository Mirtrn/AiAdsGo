'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import {
  Search,
  RefreshCw,
  Play,
  Square,
  Eye,
  Edit2,
  Trash2,
  Zap,
  FileText,
  TrendingUp,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import ClickFarmTaskModal from '@/components/ClickFarmTaskModal';
import { ResponsivePagination } from '@/components/ui/responsive-pagination';
import type { ClickFarmTaskListItem, ClickFarmStats } from '@/lib/click-farm-types';

export default function ClickFarmPage() {
  const router = useRouter();

  // Data states
  const [tasks, setTasks] = useState<ClickFarmTaskListItem[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<ClickFarmTaskListItem[]>([]);
  const [stats, setStats] = useState<ClickFarmStats | null>(null);
  const [loading, setLoading] = useState(true);

  // UI states
  const [modalOpen, setModalOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterTasks();
  }, [tasks, searchQuery, statusFilter]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tasksRes, statsRes] = await Promise.all([
        fetch('/api/click-farm/tasks'),
        fetch('/api/click-farm/stats'),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.data.tasks || []);
      }

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.data);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterTasks = () => {
    let result = [...tasks];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.id.toLowerCase().includes(query) ||
        t.offer_id.toString().includes(query)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(t => t.status === statusFilter);
    }

    setFilteredTasks(result);
    setCurrentPage(1);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
      toast.error(error.message || '删除任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
      running: { label: '运行中', variant: 'default', className: 'bg-green-600' },
      pending: { label: '等待中', variant: 'secondary', className: 'bg-blue-100 text-blue-700' },
      paused: { label: '已中止', variant: 'destructive', className: '' },
      stopped: { label: '已停止', variant: 'outline', className: '' },
      completed: { label: '已完成', variant: 'default', className: 'bg-purple-600' },
    };
    const config = configs[status] || { label: status, variant: 'outline' as const, className: '' };

    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const paginatedTasks = filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">补点击任务</h1>
              <Badge variant="outline" className="text-sm">
                {tasks.length}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={loadData}
                className="flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                刷新
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Summary Statistics - 一行6列布局 */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">今日点击</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {stats.today.clicks.toLocaleString()}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">今日成功率</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {stats.today.successRate}%
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">今日流量</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {formatBytes(stats.today.traffic)}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                    <AlertCircle className="w-4 h-4 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">累计点击</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {stats.cumulative.clicks.toLocaleString()}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">累计成功率</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {stats.cumulative.successRate}%
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-purple-100 rounded-full flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">累计流量</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {formatBytes(stats.cumulative.traffic)}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                    <AlertCircle className="w-4 h-4 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Task Status Distribution */}
        {stats && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
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
        )}

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="搜索任务ID或Offer ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">所有状态</option>
                <option value="running">运行中</option>
                <option value="pending">等待中</option>
                <option value="paused">已中止</option>
                <option value="stopped">已停止</option>
                <option value="completed">已完成</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Task List */}
        {filteredTasks.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow border border-gray-200">
            <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
              <Zap className="w-full h-full" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">未找到任务</h3>
            <p className="mt-2 text-sm text-gray-500">
              {tasks.length === 0
                ? '您还没有创建任何补点击任务，请前往 /offers 页面为特定 Offer 创建任务。'
                : '没有找到符合筛选条件的任务。'}
            </p>
            {tasks.length === 0 && (
              <div className="mt-6">
                <p className="text-sm text-muted-foreground">暂无补点击任务</p>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead className="w-[80px]">Offer</TableHead>
                    <TableHead className="w-[100px]">状态</TableHead>
                    <TableHead className="w-[120px]">国家/时区</TableHead>
                    <TableHead className="w-[100px]">每日点击</TableHead>
                    <TableHead className="w-[80px]">进度</TableHead>
                    <TableHead className="w-[100px]">成功率</TableHead>
                    <TableHead className="w-[150px]">开始日期</TableHead>
                    <TableHead className="w-[120px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTasks.map((task) => (
                    <TableRow key={task.id} className="hover:bg-gray-50/50">
                      <TableCell className="font-mono text-xs">
                        #{task.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 h-auto text-blue-600"
                          onClick={() => router.push(`/offers/${task.offer_id}`)}
                        >
                          #{task.offer_id}
                        </Button>
                      </TableCell>
                      <TableCell>{getStatusBadge(task.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-xs">
                            {task.target_country || '-'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>{task.daily_click_count}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <div className="w-12 bg-gray-200 rounded-full h-1.5">
                            <div
                              className="bg-blue-600 h-1.5 rounded-full"
                              style={{ width: `${task.progress}%` }}
                            />
                          </div>
                          <span className="text-xs">{task.progress}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {task.total_clicks > 0
                          ? `${((task.success_clicks / task.total_clicks) * 100).toFixed(1)}%`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {task.scheduled_start_date}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => router.push(`/click-farm/tasks/${task.id}`)}
                            className="text-blue-600 hover:text-blue-800"
                            title="查看详情"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {(task.status === 'pending' || task.status === 'running') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditTaskId(task.id);
                                setModalOpen(true);
                              }}
                              className="text-gray-600"
                              title="编辑任务"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                          )}
                          {task.status === 'running' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleStopTask(task.id)}
                              disabled={actionLoading === task.id}
                              className="text-yellow-600"
                              title="停止任务"
                            >
                              <Square className="w-4 h-4" />
                            </Button>
                          )}
                          {(task.status === 'stopped' || task.status === 'paused') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRestartTask(task.id)}
                              disabled={actionLoading === task.id}
                              className="text-green-600"
                              title="重启任务"
                            >
                              <Play className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setDeleteTaskId(task.id);
                              setDeleteDialogOpen(true);
                            }}
                            disabled={actionLoading === task.id}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="删除任务"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {filteredTasks.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-200">
                  <ResponsivePagination
                    currentPage={currentPage}
                    totalPages={Math.ceil(filteredTasks.length / pageSize)}
                    totalItems={filteredTasks.length}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
                    pageSizeOptions={[10, 20, 50, 100]}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Edit Task Modal */}
      <ClickFarmTaskModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditTaskId(null);
        }}
        onSuccess={loadData}
        editTaskId={editTaskId || undefined}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除任务？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将删除该补点击任务。任务将被标记为已删除，但历史统计数据会被保留。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTaskId(null)}>取消</AlertDialogCancel>
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
