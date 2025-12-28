'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Activity, TrendingUp, Users, CheckCircle, Zap } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface GlobalStats {
  total_tasks: number;
  active_tasks: number;
  total_clicks: number;
  success_clicks: number;
  success_rate: number;
  today_clicks: number;
  today_traffic: number;
  total_traffic: number;
  // 🆕 任务状态分布
  taskStatusDistribution: {
    pending: number;
    running: number;
    paused: number;
    stopped: number;
    completed: number;
    total: number;
  };
}

interface TopUser {
  user_id: number;
  username: string;
  total_clicks: number;
  success_rate: number;
  traffic: number;
}

interface TaskItem {
  id: string;
  user_id: number;
  username: string;
  offer_id: number;
  offer_name: string;
  daily_click_count: number;
  status: string;
  progress: number;
  total_clicks: number;
  success_rate: number;
  traffic: number;
  created_at: string;
}

export default function AdminClickFarmPage() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    loadData();
  }, [currentPage]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load stats, top users, and tasks in parallel
      const [statsRes, topUsersRes, tasksRes] = await Promise.all([
        fetch('/api/admin/click-farm/stats'),
        fetch('/api/admin/click-farm/top-users'),
        fetch(`/api/admin/click-farm/tasks?page=${currentPage}&limit=${pageSize}`),
      ]);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.data);
      }

      if (topUsersRes.ok) {
        const data = await topUsersRes.json();
        setTopUsers(data.data || []);
      }

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.data.tasks || []);
        setTotalPages(Math.ceil((data.data.total || 0) / pageSize));
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
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      running: 'default',
      pending: 'secondary',
      paused: 'destructive',
      stopped: 'outline',
      completed: 'default',
    };

    const labels: Record<string, string> = {
      running: '运行中',
      pending: '待执行',
      paused: '已暂停',
      stopped: '已停止',
      completed: '已完成',
    };

    return (
      <Badge variant={variants[status] || 'outline'}>
        {labels[status] || status}
      </Badge>
    );
  };

  if (loading && !stats) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">补点击管理</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">补点击管理</h1>
        <Badge variant="outline" className="text-sm">
          <Activity className="mr-1 h-3 w-3" />
          管理员视图
        </Badge>
      </div>

      {/* 全局统计卡片 */}
      {stats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">任务总数</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total_tasks.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  活跃: {stats.active_tasks}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">总点击数</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total_clicks.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  今日: {stats.today_clicks.toLocaleString()}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">平均成功率</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.success_rate.toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground mt-1">
                  成功: {stats.success_clicks.toLocaleString()}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">总流量</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatBytes(stats.total_traffic)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  今日: {formatBytes(stats.today_traffic)}
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

      {/* Top 10 用户 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Top 10 用户（按点击量排序）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topUsers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">暂无数据</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">排名</TableHead>
                  <TableHead>用户ID</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead className="text-right">总点击数</TableHead>
                  <TableHead className="text-right">成功率</TableHead>
                  <TableHead className="text-right">总流量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topUsers.map((user, index) => (
                  <TableRow key={user.user_id}>
                    <TableCell className="font-medium">#{index + 1}</TableCell>
                    <TableCell className="font-mono text-sm">{user.user_id}</TableCell>
                    <TableCell>{user.username}</TableCell>
                    <TableCell className="text-right font-medium">
                      {user.total_clicks.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={user.success_rate >= 95 ? 'text-green-600 font-medium' : ''}>
                        {user.success_rate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{formatBytes(user.traffic)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 所有用户任务列表 */}
      <Card>
        <CardHeader>
          <CardTitle>所有用户任务列表</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">暂无任务</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>用户</TableHead>
                    <TableHead>Offer</TableHead>
                    <TableHead className="text-right">每日点击</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">进度</TableHead>
                    <TableHead className="text-right">总点击</TableHead>
                    <TableHead className="text-right">成功率</TableHead>
                    <TableHead className="text-right">流量</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map(task => (
                    <TableRow key={task.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{task.username}</div>
                          <div className="text-xs text-muted-foreground">ID: {task.user_id}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[200px] truncate" title={task.offer_name}>
                          {task.offer_name || `Offer #${task.offer_id}`}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{task.daily_click_count}</TableCell>
                      <TableCell>{getStatusBadge(task.status)}</TableCell>
                      <TableCell className="text-right">{task.progress}%</TableCell>
                      <TableCell className="text-right">{task.total_clicks.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        {task.success_rate.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">{formatBytes(task.traffic)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(task.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    第 {currentPage} / {totalPages} 页
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                    >
                      上一页
                    </button>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
