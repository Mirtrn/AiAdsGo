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
  Eye,
  Play,
  AlertTriangle,
  Link,
  CheckCircle,
  Clock,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { ResponsivePagination } from '@/components/ui/responsive-pagination';
import type { UrlSwapTask, UrlSwapGlobalStats } from '@/lib/url-swap-types';

interface UrlSwapAdminStats extends UrlSwapGlobalStats {
  userTaskDistribution: {
    userId: number;
    username: string;
    taskCount: number;
    enabledTasks: number;
  }[];
}

export default function AdminUrlSwapPage() {
  const router = useRouter();

  // Data states
  const [tasks, setTasks] = useState<UrlSwapTask[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<UrlSwapTask[]>([]);
  const [stats, setStats] = useState<UrlSwapAdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  // UI states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [retryTaskId, setRetryTaskId] = useState<string | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

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
        fetch('/api/admin/url-swap/tasks'),
        fetch('/api/admin/url-swap/stats'),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.data?.tasks || []);
      }

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.data);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
      toast.error('加载数据失败');
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
        t.offer_id.toString().includes(query) ||
        t.user_id.toString().includes(query)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(t => t.status === statusFilter);
    }

    setFilteredTasks(result);
    setCurrentPage(1);
  };

  const formatDateTime = (dateValue: string | null): string => {
    if (!dateValue) return '-';
    return new Date(dateValue).toLocaleString('zh-CN');
  };

  const formatDate = (dateValue: string | null): string => {
    if (!dateValue) return '-';
    return dateValue.split('T')[0];
  };

  const handleRetryTask = async () => {
    if (!retryTaskId) return;

    try {
      setActionLoading(retryTaskId);
      const response = await fetch(`/api/admin/url-swap/tasks/${retryTaskId}/retry`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || '重试任务失败');
      }

      toast.success(data.message || '任务已重新加入队列');
      setRetryDialogOpen(false);
      setRetryTaskId(null);
      await loadData();
    } catch (error: any) {
      toast.error(error.message || '重试任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
      enabled: { label: '启用', variant: 'default', className: 'bg-green-600' },
      disabled: { label: '已暂停', variant: 'secondary', className: 'bg-yellow-100 text-yellow-700' },
      error: { label: '错误', variant: 'destructive', className: '' },
      completed: { label: '已完成', variant: 'default', className: 'bg-blue-600' },
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
              <h1 className="text-2xl font-bold text-gray-900">换链任务管理</h1>
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

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Summary Statistics */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">总任务</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {stats.total_tasks}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                    <Link className="w-4 h-4 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">已启用</p>
                    <p className="text-xl font-bold text-green-600 mt-1">
                      {stats.active_tasks}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                    <Play className="w-4 h-4 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">已暂停</p>
                    <p className="text-xl font-bold text-yellow-600 mt-1">
                      {stats.disabled_tasks}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-yellow-100 rounded-full flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4 text-yellow-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">链接变更</p>
                    <p className="text-xl font-bold text-purple-600 mt-1">
                      {stats.url_changed_count}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-purple-100 rounded-full flex items-center justify-center shrink-0">
                    <Link className="w-4 h-4 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">成功率</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {stats.total_swaps > 0
                        ? ((stats.success_swaps / stats.total_swaps) * 100).toFixed(1)
                        : 0}%
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                    <CheckCircle className="w-4 h-4 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* User Distribution */}
        {stats?.userTaskDistribution && stats.userTaskDistribution.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5" />
                用户任务分布
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {stats.userTaskDistribution.slice(0, 12).map((user) => (
                  <div key={user.userId} className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="font-medium text-sm">{user.username}</p>
                    <p className="text-xs text-muted-foreground">
                      {user.taskCount} 任务 ({user.enabledTasks} 启用)
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="搜索任务ID、Offer ID或User ID..."
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
                <option value="enabled">已启用</option>
                <option value="disabled">已暂停</option>
                <option value="error">错误</option>
                <option value="completed">已完成</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Task List */}
        {filteredTasks.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow border border-gray-200">
            <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
              <Link className="w-full h-full" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">未找到任务</h3>
            <p className="mt-2 text-sm text-gray-500">
              {tasks.length === 0 ? '系统中暂无换链任务' : '没有找到符合筛选条件的任务。'}
            </p>
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead className="w-[60px]">用户</TableHead>
                    <TableHead className="w-[60px]">Offer</TableHead>
                    <TableHead className="w-[100px]">状态</TableHead>
                    <TableHead className="w-[100px]">间隔</TableHead>
                    <TableHead className="w-[120px]">下次执行</TableHead>
                    <TableHead className="w-[100px]">成功/总计</TableHead>
                    <TableHead className="w-[100px]">链接变更</TableHead>
                    <TableHead className="w-[120px]">创建时间</TableHead>
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
                          onClick={() => router.push(`/admin/users?userId=${task.user_id}`)}
                        >
                          #{task.user_id}
                        </Button>
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
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getStatusBadge(task.status)}
                          {task.status === 'error' && task.error_message && (
                            <span className="text-xs text-red-600" title={task.error_message}>
                              {task.error_message.slice(0, 15)}...
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{task.swap_interval_minutes}m</TableCell>
                      <TableCell className="text-sm">
                        {formatDateTime(task.next_swap_at)}
                      </TableCell>
                      <TableCell>
                        <span className="text-green-600">{task.success_swaps}</span>
                        <span className="text-gray-400">/</span>
                        <span>{task.total_swaps}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-purple-600">{task.url_changed_count}</span>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {formatDate(task.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => router.push(`/url-swap/${task.id}`)}
                            className="text-blue-600 hover:text-blue-800"
                            title="查看详情"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {task.status === 'error' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setRetryTaskId(task.id);
                                setRetryDialogOpen(true);
                              }}
                              disabled={actionLoading === task.id}
                              className="text-green-600 hover:text-green-700"
                              title="重试任务"
                            >
                              <Play className="w-4 h-4" />
                            </Button>
                          )}
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

      {/* Retry Confirmation Dialog */}
      <AlertDialog open={retryDialogOpen} onOpenChange={setRetryDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              确认重试任务？
            </AlertDialogTitle>
            <AlertDialogDescription>
              此操作将重新启用任务并将其加入执行队列。任务将按照设定的间隔开始检测链接变化。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRetryTaskId(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRetryTask}
              disabled={actionLoading !== null}
            >
              {actionLoading ? '重试中...' : '确认重试'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
