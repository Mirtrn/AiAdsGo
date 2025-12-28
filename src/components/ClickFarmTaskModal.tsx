'use client';

import { useState, useEffect, useLayoutEffect } from 'react';
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
import { Loader2, AlertCircle, TrendingUp, Edit3, RotateCcw, GripVertical, Clock, Globe, Link, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { getTimezoneByCountry } from '@/lib/timezone-utils';
import type { CreateClickFarmTaskRequest } from '@/lib/click-farm-types';
import SmoothCurveChart from '@/components/ui/SmoothCurveChart';

interface ClickFarmTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  preSelectedOfferId?: number; // 预选的Offer ID
  editTaskId?: string | number; // 🆕 编辑模式：传入任务ID
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
  editTaskId,  // 🆕 编辑模式参数
}: ClickFarmTaskModalProps) {
  const [loading, setLoading] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(true);

  // Form state
  const [selectedOfferId, setSelectedOfferId] = useState<number | null>(null);
  const [dailyClickCount, setDailyClickCount] = useState(216);
  const [timePeriod, setTimePeriod] = useState('06:00-24:00');
  const [durationDays, setDurationDays] = useState(14);
  const [scheduledStartDate, setScheduledStartDate] = useState<string>(  // 🆕 开始日期状态
    new Date().toISOString().split('T')[0]  // 默认当天
  );
  const [proxyWarning, setProxyWarning] = useState('');
  const [distribution, setDistribution] = useState<number[]>([]);
  const [isEditingDistribution, setIsEditingDistribution] = useState(false);
  const [draggedHour, setDraggedHour] = useState<number | null>(null);
  const [timezone, setTimezone] = useState<string>('America/New_York');  // 🆕 timezone状态

  const isEditMode = !!editTaskId;  // 🆕 判断是否为编辑模式

  // 🆕 加载现有任务数据（编辑模式）
  useEffect(() => {
    if (open && editTaskId) {
      loadTaskData();
    }
  }, [open, editTaskId]);

  // 🆕 加载任务数据
  const loadTaskData = async () => {
    try {
      const response = await fetch(`/api/click-farm/tasks/${editTaskId}`);
      if (!response.ok) throw new Error('加载任务失败');

      const { data: task } = await response.json();

      setSelectedOfferId(task.offer_id);
      setDailyClickCount(task.daily_click_count);
      setTimePeriod(task.start_time === '00:00' && task.end_time === '24:00'
        ? '00:00-24:00'
        : '06:00-24:00');
      setDurationDays(task.duration_days);
      setScheduledStartDate(task.scheduled_start_date);  // 🆕 加载scheduled_start_date
      setDistribution(task.hourly_distribution);
      setTimezone(task.timezone);  // 🆕 加载timezone
    } catch (error) {
      console.error('加载任务失败:', error);
      toast.error('加载任务失败');
      onOpenChange(false);
    }
  };

  // Load offers on mount
  useEffect(() => {
    if (open) {
      loadOffers();
    }
  }, [open]);

  // 🆕 使用 useLayoutEffect 确保在 DOM 更新前处理 preSelectedOfferId
  // 关键：每次 open 变为 true 时都执行
  useLayoutEffect(() => {
    console.log('[ClickFarmTaskModal] useLayoutEffect EXECUTE: open=', open, 'preSelectedOfferId=', preSelectedOfferId, 'offers.length=', offers.length, 'selectedOfferId=', selectedOfferId, 'distribution.length=', distribution.length);
    if (!open) return;

    // 如果有 preSelectedOfferId 且 offers 已加载，找到并选中它
    if (preSelectedOfferId && offers.length > 0) {
      const offer = offers.find(o => o.id === preSelectedOfferId);
      if (offer) {
        console.log('[ClickFarmTaskModal] useLayoutEffect: 选中 offer id =', offer.id, 'name =', offer.name);
        setSelectedOfferId(preSelectedOfferId);

        // 立即生成分布
        if (dailyClickCount > 0 && distribution.length === 0) {
          console.log('[ClickFarmTaskModal] useLayoutEffect: 调用 generateDistribution');
          generateDistribution();
        } else {
          console.log('[ClickFarmTaskModal] useLayoutEffect: 跳过 generateDistribution, distribution.length =', distribution.length);
        }
      } else {
        console.log('[ClickFarmTaskModal] useLayoutEffect: 未找到对应的 offer');
      }
    } else if (!preSelectedOfferId && offers.length > 0 && !selectedOfferId) {
      // 如果没有 preSelectedOfferId，选择第一个 offer
      console.log('[ClickFarmTaskModal] useLayoutEffect: 无 preSelectedOfferId，选择第一个 offer');
      if (offers[0]) {
        handleOfferChange(offers[0].id);
      }
    } else {
      console.log('[ClickFarmTaskModal] useLayoutEffect: 条件不满足 - preSelectedOfferId:', preSelectedOfferId, 'offers.length:', offers.length, 'selectedOfferId:', selectedOfferId);
    }
  }, [open, preSelectedOfferId, offers.length]);

  // Generate distribution when offer is selected
  useEffect(() => {
    if (selectedOfferId && dailyClickCount > 0 && distribution.length === 0) {
      generateDistribution();
    }
  }, [selectedOfferId, dailyClickCount, distribution.length]);

  // Update distribution when settings change
  useEffect(() => {
    if (selectedOfferId && dailyClickCount > 0 && distribution.length > 0) {
      generateDistribution();
    }
  }, [selectedOfferId, dailyClickCount, timePeriod]);

  const loadOffers = async () => {
    try {
      setLoadingOffers(true);
      console.log('[ClickFarmTaskModal] loadOffers START: preSelectedOfferId =', preSelectedOfferId, 'current offers.length =', offers.length);
      const response = await fetch('/api/offers?limit=100&isActive=true');
      if (!response.ok) throw new Error('加载Offer失败');

      const data = await response.json();
      console.log('[ClickFarmTaskModal] loadOffers: API返回', data.data?.length, '个offers');
      const offersData = data.data || [];
      setOffers(offersData);
      console.log('[ClickFarmTaskModal] loadOffers: setOffers 完成, offers.length =', offersData.length);

      // 🆕 如果有预选的offer ID，优先使用它；否则选择第一个
      if (preSelectedOfferId) {
        console.log('[ClickFarmTaskModal] loadOffers: 检测到 preSelectedOfferId =', preSelectedOfferId);
        const offerExists = offersData.some((o: Offer) => o.id === preSelectedOfferId);
        console.log('[ClickFarmTaskModal] loadOffers: offer存在?', offerExists);
        if (offerExists) {
          console.log('[ClickFarmTaskModal] loadOffers: 调用 handleOfferChange');
          await handleOfferChange(preSelectedOfferId);
        } else {
          console.log('[ClickFarmTaskModal] loadOffers: offer不存在，使用第一个');
          if (offersData.length > 0) {
            await handleOfferChange(offersData[0].id);
          }
        }
      } else if (offersData.length > 0 && !selectedOfferId) {
        console.log('[ClickFarmTaskModal] loadOffers: 没有preSelectedOfferId，选择第一个');
        await handleOfferChange(offersData[0].id);
      } else {
        console.log('[ClickFarmTaskModal] loadOffers: 条件不满足 - preSelectedOfferId:', preSelectedOfferId, 'selectedOfferId:', selectedOfferId);
      }
      console.log('[ClickFarmTaskModal] loadOffers END');
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
    console.log('[ClickFarmTaskModal] handleOfferChange START: offerId =', offerId, 'current offers.length =', offers.length, 'current selectedOfferId =', selectedOfferId);
    setSelectedOfferId(offerId);

    const offer = offers.find(o => o.id === offerId);
    console.log('[ClickFarmTaskModal] handleOfferChange: 找到offer?', !!offer, 'offer:', offer?.name);
    if (offer) {
      await checkProxy(offer.target_country);
      const autoTimezone = getTimezoneByCountry(offer.target_country);
      setTimezone(autoTimezone);
      console.log(`[ClickFarmTaskModal] handleOfferChange: timezone = ${autoTimezone}, dailyClickCount = ${dailyClickCount}, distribution.length = ${distribution.length}`);

      if (dailyClickCount > 0 && distribution.length === 0) {
        console.log('[ClickFarmTaskModal] handleOfferChange: 调用 generateDistribution');
        await generateDistribution();
      } else {
        console.log('[ClickFarmTaskModal] handleOfferChange: 跳过 generateDistribution, distribution.length =', distribution.length);
      }
    }
    console.log('[ClickFarmTaskModal] handleOfferChange END');
  };

  /**
   * 拖拽编辑分布曲线
   */
  const handleDistributionBarDrag = (hour: number, deltaY: number) => {
    if (!isEditingDistribution || distribution.length === 0) return;

    // Calculate new value based on drag distance
    const maxValue = Math.max(...distribution);
    const pixelsPerClick = 40 / maxValue; // 40px max height
    const clicksDelta = Math.round(-deltaY / pixelsPerClick); // negative because drag up = increase

    const newDistribution = [...distribution];
    const oldValue = newDistribution[hour];
    const newValue = Math.max(0, oldValue + clicksDelta);

    newDistribution[hour] = newValue;

    // Normalize to maintain total daily click count
    const currentTotal = newDistribution.reduce((sum, n) => sum + n, 0);
    if (currentTotal !== dailyClickCount && currentTotal > 0) {
      const ratio = dailyClickCount / currentTotal;
      for (let i = 0; i < newDistribution.length; i++) {
        newDistribution[i] = Math.round(newDistribution[i] * ratio);
      }
    }

    // Final adjustment to ensure exact total
    const finalTotal = newDistribution.reduce((sum, n) => sum + n, 0);
    const diff = dailyClickCount - finalTotal;
    if (diff !== 0) {
      // Add/subtract diff to the hour with highest value (excluding current hour if it was just set to 0)
      const maxIndex = newDistribution.indexOf(Math.max(...newDistribution));
      newDistribution[maxIndex] = Math.max(0, newDistribution[maxIndex] + diff);
    }

    setDistribution(newDistribution);
  };

  const handleBarMouseDown = (hour: number, e: React.MouseEvent) => {
    if (!isEditingDistribution) return;

    e.preventDefault();
    setDraggedHour(hour);

    const startY = e.clientY;
    const startValue = distribution[hour];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      handleDistributionBarDrag(hour, deltaY);
    };

    const handleMouseUp = () => {
      setDraggedHour(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const toggleEditMode = () => {
    if (distribution.length === 0) {
      toast.error('请先配置Offer和每日点击数以生成分布');
      return;
    }
    setIsEditingDistribution(!isEditingDistribution);
  };

  const resetDistribution = () => {
    generateDistribution();
    toast.success('已重置为默认分布');
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
        scheduled_start_date: scheduledStartDate,  // 🆕 包含scheduled_start_date
        hourly_distribution: distribution,
        timezone: timezone,  // 🆕 使用自动匹配的timezone state，而不是服务器时区
      };

      // 🆕 编辑模式：使用PUT方法
      const response = await fetch(
        isEditMode ? `/api/click-farm/tasks/${editTaskId}` : '/api/click-farm/tasks',
        {
          method: isEditMode ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestData),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `${isEditMode ? '更新' : '创建'}任务失败`);
      }

      toast.success(`补点击任务${isEditMode ? '更新' : '创建'}成功`);
      onOpenChange(false);
      onSuccess?.();

      // Reset form
      setSelectedOfferId(null);
      setDailyClickCount(216);
      setTimePeriod('06:00-24:00');
      setDurationDays(14);
      setScheduledStartDate(new Date().toISOString().split('T')[0]);  // 🆕 重置为当天
      setDistribution([]);
      setProxyWarning('');
      setIsEditingDistribution(false);
      setDraggedHour(null);

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
          <DialogTitle>{isEditMode ? '编辑补点击任务' : '创建补点击任务'}</DialogTitle>
          <DialogDescription>
            配置自动点击任务，帮助广告冷启动和提升投放表现
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Offer Selection - Show dropdown when no preSelectedOfferId */}
          {!preSelectedOfferId && (
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
            </div>
          )}

          {/* Offer Info - Show full offer details (displayed after selection or when preSelectedOfferId is provided) */}
          <div className="space-y-2">
            <Label>关联 Offer</Label>

            {/* Offer Info Card */}
            {selectedOffer ? (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">
                      <span className="text-muted-foreground">名称:</span> {selectedOffer.name || selectedOffer.brand_name || `Offer #${selectedOffer.id}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>
                      <span className="text-muted-foreground">国家:</span> {selectedOffer.target_country}
                    </span>
                  </div>
                  <div className="col-span-2 flex items-start gap-2">
                    <Link className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="truncate text-xs">
                      <span className="text-muted-foreground">链接:</span> {selectedOffer.affiliate_link}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                请选择一个 Offer
              </div>
            )}

            {/* Timezone Display */}
            {selectedOffer && (
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">执行时区:</span>
                <span className="font-mono">{timezone}</span>
                <span className="text-xs text-muted-foreground">
                  (自动匹配 {selectedOffer.target_country})
                </span>
              </div>
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

          {/* Configuration Fields - 2 Column Layout */}
          <div className="grid grid-cols-2 gap-4">
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
                推荐: 216次/天（模拟自然流量）
              </p>
            </div>

            {/* Scheduled Start Date */}
            <div className="space-y-2">
              <Label htmlFor="scheduledStartDate">开始日期 *</Label>
              <Input
                id="scheduledStartDate"
                type="date"
                value={scheduledStartDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setScheduledStartDate(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                默认当天，可选择未来日期
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
          </div>

          {/* Distribution Preview - Smooth Curve */}
          {distribution.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  时间分布曲线
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={toggleEditMode}
                >
                  {isEditingDistribution ? '完成编辑' : '自定义编辑'}
                </Button>
              </div>

              {/* Smooth Curve Visualization */}
              <SmoothCurveChart data={distribution} />

              <p className="text-xs text-muted-foreground">
                总计: {distribution.reduce((sum, n) => sum + n, 0)} 次点击/天
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
              {isEditMode ? '更新任务' : '创建任务'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
