'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Loader2, AlertCircle, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import type { CreateClickFarmTaskRequest } from '@/lib/click-farm-types';

interface ClickFarmTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  preSelectedOfferId?: number; // 预选的Offer ID
}

interface Offer {
  id: number;
  name: string;
  brand_name: string;
  target_country: string;
  affiliate_link: string;
}

const TIME_PERIODS = [
  { value: '00:00-24:00', label: '全天 (00:00-24:00)', hours: 24 },
  { value: '06:00-24:00', label: '白天 (06:00-24:00)', hours: 18 },
];

const DURATION_OPTIONS = [
  { value: 7, label: '7天' },
  { value: 14, label: '14天' },
  { value: 30, label: '30天' },
  { value: 9999, label: '不限期' },
];

export default function ClickFarmTaskModal({
  open,
  onOpenChange,
  onSuccess,
  preSelectedOfferId,
}: ClickFarmTaskModalProps) {
  const [loading, setLoading] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(true);

  // Form state
  const [selectedOfferId, setSelectedOfferId] = useState<number | null>(null);
  const [dailyClickCount, setDailyClickCount] = useState(216);
  const [timePeriod, setTimePeriod] = useState('06:00-24:00');
  const [durationDays, setDurationDays] = useState(14);
  const [proxyWarning, setProxyWarning] = useState('');
  const [distribution, setDistribution] = useState<number[]>([]);

  // Load offers on mount
  useEffect(() => {
    if (open) {
      loadOffers();
    }
  }, [open]);

  // Set preselected offer when offers are loaded
  useEffect(() => {
    if (preSelectedOfferId && offers.length > 0 && !selectedOfferId) {
      const offer = offers.find(o => o.id === preSelectedOfferId);
      if (offer) {
        setSelectedOfferId(preSelectedOfferId);
      }
    }
  }, [preSelectedOfferId, offers, selectedOfferId]);

  // Update distribution when settings change
  useEffect(() => {
    if (selectedOfferId && dailyClickCount > 0) {
      generateDistribution();
    }
  }, [selectedOfferId, dailyClickCount, timePeriod]);

  const loadOffers = async () => {
    try {
      setLoadingOffers(true);
      const response = await fetch('/api/offers?limit=100&isActive=true');
      if (!response.ok) throw new Error('加载Offer失败');

      const data = await response.json();
      setOffers(data.data || []);

      // 如果有预选的offer ID，使用它；否则选择第一个
      if (preSelectedOfferId && data.data?.some((o: Offer) => o.id === preSelectedOfferId)) {
        setSelectedOfferId(preSelectedOfferId);
      } else if (data.data?.length > 0 && !selectedOfferId) {
        setSelectedOfferId(data.data[0].id);
      }
    } catch (error) {
      console.error('加载Offer失败:', error);
      toast.error('加载Offer列表失败');
    } finally {
      setLoadingOffers(false);
    }
  };

  const generateDistribution = async () => {
    try {
      const [startTime, endTime] = timePeriod.split('-');
      const response = await fetch('/api/click-farm/distribution/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          daily_click_count: dailyClickCount,
          start_time: startTime,
          end_time: endTime,
        }),
      });

      if (!response.ok) throw new Error('生成分布失败');

      const data = await response.json();
      setDistribution(data.data.distribution);
    } catch (error) {
      console.error('生成时间分布失败:', error);
      toast.error('生成时间分布失败');
    }
  };

  const checkProxy = async (targetCountry: string) => {
    try {
      const response = await fetch(
        `/api/settings/proxy?country=${targetCountry.toLowerCase()}`
      );

      if (!response.ok) {
        setProxyWarning(`未配置${targetCountry}代理，请先前往设置页面配置`);
        return false;
      }

      const data = await response.json();
      if (!data.data?.proxy_url) {
        setProxyWarning(`未配置${targetCountry}代理，请先前往设置页面配置`);
        return false;
      }

      setProxyWarning('');
      return true;
    } catch (error) {
      setProxyWarning('检查代理配置失败');
      return false;
    }
  };

  const handleOfferChange = async (offerId: number) => {
    setSelectedOfferId(offerId);

    const offer = offers.find(o => o.id === offerId);
    if (offer) {
      await checkProxy(offer.target_country);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedOfferId) {
      toast.error('请选择一个Offer');
      return;
    }

    if (dailyClickCount < 1 || dailyClickCount > 1000) {
      toast.error('每日点击数必须在1-1000之间');
      return;
    }

    if (proxyWarning) {
      toast.error('请先配置代理');
      return;
    }

    try {
      setLoading(true);

      const [startTime, endTime] = timePeriod.split('-');

      const requestData: CreateClickFarmTaskRequest = {
        offer_id: selectedOfferId!,
        daily_click_count: dailyClickCount,
        start_time: startTime,
        end_time: endTime,
        duration_days: durationDays === 9999 ? null : durationDays,
        hourly_distribution: distribution,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      const response = await fetch('/api/click-farm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '创建任务失败');
      }

      toast.success('补点击任务创建成功');
      onOpenChange(false);
      onSuccess?.();

      // Reset form
      setSelectedOfferId(null);
      setDailyClickCount(216);
      setTimePeriod('06:00-24:00');
      setDurationDays(14);
      setDistribution([]);
      setProxyWarning('');

    } catch (error: any) {
      console.error('创建任务失败:', error);
      toast.error(error.message || '创建任务失败');
    } finally {
      setLoading(false);
    }
  };

  const selectedOffer = offers.find(o => o.id === selectedOfferId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>创建补点击任务</DialogTitle>
          <DialogDescription>
            配置自动点击任务，帮助广告冷启动和提升投放表现
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Offer Selection */}
          <div className="space-y-2">
            <Label htmlFor="offer">选择Offer *</Label>
            {loadingOffers ? (
              <div className="flex items-center justify-center h-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载中...
              </div>
            ) : (
              <Select
                id="offer"
                value={selectedOfferId?.toString() || ''}
                onValueChange={(value) => handleOfferChange(parseInt(value))}
                required
              >
                <SelectContent>
                  <SelectItem value="" disabled>
                    请选择Offer
                  </SelectItem>
                  {offers.map((offer) => (
                    <SelectItem key={offer.id} value={offer.id.toString()}>
                      #{offer.id} - {offer.brand_name || offer.name} ({offer.target_country})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {selectedOffer && (
              <p className="text-xs text-muted-foreground">
                目标国家: {selectedOffer.target_country}
              </p>
            )}
          </div>

          {/* Proxy Warning */}
          {proxyWarning && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <div className="ml-2">
                <p className="font-medium">{proxyWarning}</p>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => window.open('/settings/proxy', '_blank')}
                >
                  前往配置 →
                </Button>
              </div>
            </Alert>
          )}

          {/* Daily Click Count */}
          <div className="space-y-2">
            <Label htmlFor="dailyClicks">每日点击数 *</Label>
            <Input
              id="dailyClicks"
              type="number"
              min={1}
              max={1000}
              value={dailyClickCount}
              onChange={(e) => setDailyClickCount(parseInt(e.target.value) || 0)}
              placeholder="建议: 216次/天"
              required
            />
            <p className="text-xs text-muted-foreground">
              推荐: 216次/天（模拟自然流量）。范围: 1-1000
            </p>
          </div>

          {/* Time Period */}
          <div className="space-y-2">
            <Label htmlFor="timePeriod">时间段 *</Label>
            <Select
              id="timePeriod"
              value={timePeriod}
              onValueChange={setTimePeriod}
              required
            >
              <SelectContent>
                {TIME_PERIODS.map((period) => (
                  <SelectItem key={period.value} value={period.value}>
                    {period.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label htmlFor="duration">持续时长 *</Label>
            <Select
              id="duration"
              value={durationDays.toString()}
              onValueChange={(value) => setDurationDays(parseInt(value))}
              required
            >
              <SelectContent>
                {DURATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value.toString()}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Distribution Preview */}
          {distribution.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                时间分布预览
              </Label>
              <div className="grid grid-cols-12 gap-1 p-3 bg-muted/50 rounded-md">
                {distribution.map((count, hour) => (
                  <div
                    key={hour}
                    className="flex flex-col items-center"
                    title={`${hour}:00 - ${count}次`}
                  >
                    <div
                      className="w-full bg-primary rounded-t"
                      style={{
                        height: `${Math.max(4, (count / Math.max(...distribution)) * 40)}px`,
                      }}
                    />
                    <span className="text-[10px] text-muted-foreground mt-1">
                      {hour}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                总计: {distribution.reduce((sum, n) => sum + n, 0)} 次点击
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              取消
            </Button>
            <Button type="submit" disabled={loading || !!proxyWarning}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              创建任务
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
