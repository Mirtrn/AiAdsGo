'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, Play, Square, RefreshCw } from 'lucide-react';
import type { ClickFarmTask, ClickFarmStats } from '@/lib/click-farm-types';

export default function ClickFarmPage() {
  const [tasks, setTasks] = useState<ClickFarmTask[]>([]);
  const [stats, setStats] = useState<ClickFarmStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tasksRes, statsRes] = await Promise.all([
        fetch('/api/click-farm/tasks'),
        fetch('/api/click-farm/stats')
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

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          创建任务
        </Button>
      </div>

      {/* 统计卡片 */}
      {stats && (
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
      )}

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
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-medium">Offer #{task.offer_id}</h3>
                      {getStatusBadge(task.status)}
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground space-x-4">
                      <span>每日: {task.daily_click_count}次</span>
                      <span>进度: {task.progress}%</span>
                      <span>成功率: {task.total_clicks > 0 ? ((task.success_clicks / task.total_clicks) * 100).toFixed(1) : 0}%</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {task.status === 'running' && (
                      <Button size="sm" variant="outline">
                        <Square className="h-4 w-4" />
                      </Button>
                    )}
                    {(task.status === 'stopped' || task.status === 'paused') && (
                      <Button size="sm" variant="outline">
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
