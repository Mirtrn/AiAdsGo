'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Calendar, CheckCircle, XCircle, RefreshCw, Link as LinkIcon, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface SwapHistoryEntry {
  timestamp: string;
  action: 'check' | 'swap' | 'skip';
  old_url?: string;
  new_url?: string;
  reason?: string;
  success: boolean;
  error_message?: string;
}

interface UrlSwapHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
}

export default function UrlSwapHistory({
  open,
  onOpenChange,
  taskId,
}: UrlSwapHistoryProps) {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<SwapHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (open && taskId) {
      loadHistory();
    }
  }, [open, taskId]);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/url-swap/tasks/${taskId}/history`);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '获取历史失败');
      }

      const data = await response.json();
      setHistory(data.history || []);
      setTotal(data.total || 0);
    } catch (error: any) {
      console.error('加载历史失败:', error);
      toast.error(error.message || '加载历史失败');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateValue: string): string => {
    return new Date(dateValue).toLocaleString('zh-CN');
  };

  const getActionBadge = (action: string) => {
    const configs: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline'; className: string }> = {
      check: { label: '检测', variant: 'secondary', className: 'bg-blue-100 text-blue-700' },
      swap: { label: '换链', variant: 'default', className: 'bg-green-600' },
      skip: { label: '跳过', variant: 'outline', className: '' },
    };
    const config = configs[action] || { label: action, variant: 'outline' as const, className: '' };

    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const getResultBadge = (success: boolean) => {
    if (success) {
      return (
        <Badge variant="default" className="bg-green-600">
          <CheckCircle className="w-3 h-3 mr-1" />
          成功
        </Badge>
      );
    }
    return (
      <Badge variant="destructive">
        <XCircle className="w-3 h-3 mr-1" />
        失败
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            换链历史记录
          </DialogTitle>
          <DialogDescription>
            任务 #{taskId?.slice(0, 8)} 的执行历史，共 {total} 条记录
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              暂无历史记录
            </div>
          ) : (
            <div className="space-y-4">
              {/* Stats Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">
                    {history.filter(h => h.success).length}
                  </p>
                  <p className="text-xs text-green-700">成功</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">
                    {history.filter(h => !h.success).length}
                  </p>
                  <p className="text-xs text-red-700">失败</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">
                    {history.filter(h => h.action === 'swap').length}
                  </p>
                  <p className="text-xs text-blue-700">实际换链</p>
                </div>
              </div>

              {/* History List */}
              <div className="space-y-3">
                {history.map((entry, index) => (
                  <div
                    key={index}
                    className={`rounded-lg p-4 border ${
                      entry.success
                        ? 'bg-green-50/50 border-green-200'
                        : 'bg-red-50/50 border-red-200'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {getActionBadge(entry.action)}
                        {getResultBadge(entry.success)}
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(entry.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* URL Changes */}
                    {(entry.old_url || entry.new_url) && (
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        {entry.old_url && (
                          <div className="bg-red-100/50 rounded p-2">
                            <p className="text-xs text-red-700 mb-1">原链接</p>
                            <a
                              href={entry.old_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-red-800 hover:underline break-all"
                            >
                              {entry.old_url.length > 60
                                ? `${entry.old_url.substring(0, 60)}...`
                                : entry.old_url}
                              <ExternalLink className="inline ml-1 h-3 w-3" />
                            </a>
                          </div>
                        )}
                        {entry.new_url && (
                          <div className="bg-green-100/50 rounded p-2">
                            <p className="text-xs text-green-700 mb-1">新链接</p>
                            <a
                              href={entry.new_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-green-800 hover:underline break-all"
                            >
                              {entry.new_url.length > 60
                                ? `${entry.new_url.substring(0, 60)}...`
                                : entry.new_url}
                              <ExternalLink className="inline ml-1 h-3 w-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Reason / Error Message */}
                    {entry.reason && (
                      <p className="text-xs text-muted-foreground mb-2">
                        原因: {entry.reason}
                      </p>
                    )}
                    {entry.error_message && (
                      <p className="text-xs text-red-600">
                        错误: {entry.error_message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={loadHistory}
            disabled={loading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
