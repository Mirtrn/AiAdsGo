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
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Loader2, AlertCircle, TrendingUp, Edit3, RotateCcw, GripVertical, Clock, Globe, Link, Tag, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { getTimezoneByCountry } from '@/lib/timezone-utils';
import { REFERER_OPTIONS, SOCIAL_MEDIA_REFERRERS, CreateClickFarmTaskRequest } from '@/lib/click-farm-types';
import { balanceDistribution, generateDefaultDistribution } from '@/lib/click-farm/distribution';
import HourlyDistributionEditor from '@/components/ui/HourlyDistributionEditor';

interface ClickFarmTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  preSelectedOfferId?: number; // 预选的Offer ID
  editTaskId?: string | number; // 🆕 编辑模式：传入任务ID
}

interface Offer {
  id: number;
  offerName?: string;
  name?: string;
  brand?: string;
  brand_name?: string;
  targetCountry: string;  // API返回驼峰命名
  affiliateLink?: string;  // API返回驼峰命名
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
  const [isDistributionManuallyModified, setIsDistributionManuallyModified] = useState(false);
  const [draggedHour, setDraggedHour] = useState<number | null>(null);
  const [timezone, setTimezone] = useState<string>('America/New_York');  // 🆕 timezone状态

  // 🆕 Referer配置状态
  const [refererConfig, setRefererConfig] = useState<{
    type: 'none' | 'random' | 'specific';
    referer?: string;
  }>({ type: 'none' });

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
      // 🆕 加载Referer配置
      if (task.referer_config) {
        const refererCfg = typeof task.referer_config === 'string'
          ? JSON.parse(task.referer_config)
          : task.referer_config;
        setRefererConfig({
          type: refererCfg.type || 'none',
          referer: refererCfg.referer
        });
      } else {
        setRefererConfig({ type: 'none' });
      }
      setIsDistributionManuallyModified(false); // 重置手动修改标志
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

  // 🆕 并行加载辅助数据（代理检查和分布计算同时进行）
  // 🔧 修复(2025-12-30): loadOffers 需要等待分布数据生成完成，避免用户点击"创建任务"时 distribution 仍为空
  const loadAuxiliaryData = async (offer: Offer, offersList: Offer[]) => {
    // 🆕 分布曲线使用前端计算，无需API调用
    const [proxyResult] = await Promise.all([
      // 并行检查代理
      fetch(`/api/settings/proxy?country=${offer.targetCountry.toLowerCase()}`)
        .then(async (res) => {
          if (!res.ok) return { warning: `未配置${offer.targetCountry}代理，请先前往设置页面配置` };
          const data = await res.json();
          if (!data.data?.proxy_url) return { warning: `未配置${offer.targetCountry}代理，请先前往设置页面配置` };
          return { warning: '' };
        })
        .catch(() => ({ warning: '检查代理配置失败' })),
    ]);

    // 更新状态
    if (proxyResult.warning) {
      setProxyWarning(proxyResult.warning);
    } else {
      setProxyWarning('');
    }

    const autoTimezone = getTimezoneByCountry(offer.targetCountry);
    setTimezone(autoTimezone);

    console.log('[ClickFarmTaskModal] loadAuxiliaryData DEBUG: dailyClickCount=', dailyClickCount, 'timePeriod=', timePeriod);

    // 🆕 同步计算分布曲线（确保在 loadOffers 返回前已完成）
    if (dailyClickCount > 0) {
      const [startTime, endTime] = timePeriod.split('-');
      console.log('[ClickFarmTaskModal] loadAuxiliaryData: 计算分布 startTime=', startTime, 'endTime=', endTime, 'dailyClickCount=', dailyClickCount);
      const dist = generateDefaultDistribution(dailyClickCount, startTime, endTime);
      console.log('[ClickFarmTaskModal] loadAuxiliaryData: 生成分布 dist.length=', dist.length, 'sum=', dist.reduce((a,b)=>a+b,0));
      setDistribution(dist);
      console.log('[ClickFarmTaskModal] loadAuxiliaryData: setDistribution 已调用');
    } else {
      console.log('[ClickFarmTaskModal] loadAuxiliaryData: dailyClickCount <= 0，跳过分布生成');
    }
  };

  // 🆕 使用 useLayoutEffect 确保在 DOM 更新前处理 preSelectedOfferId
  // 关键：每次 open 变为 true 时都执行
  // 注意：distribution 由 loadAuxiliaryData 自动生成，无需在此处调用 generateDistribution
  useLayoutEffect(() => {
    console.log('[ClickFarmTaskModal] useLayoutEffect EXECUTE: open=', open, 'preSelectedOfferId=', preSelectedOfferId, 'offers.length=', offers.length, 'selectedOfferId=', selectedOfferId, 'distribution.length=', distribution.length);
    if (!open) return;

    // 如果有 preSelectedOfferId 且 offers 已加载，找到并选中它
    if (preSelectedOfferId && offers.length > 0) {
      const offer = offers.find(o => o.id === preSelectedOfferId);
      if (offer) {
        console.log('[ClickFarmTaskModal] useLayoutEffect: 选中 offer id =', offer.id, 'name =', offer.name);
        setSelectedOfferId(preSelectedOfferId);
        // distribution 由 loadAuxiliaryData 自动生成，无需重复调用
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

  // Update distribution when settings change (only if not manually modified)
  // 注意：初始分布由 loadAuxiliaryData 自动生成，无需额外调用
  useEffect(() => {
    if (selectedOfferId && dailyClickCount > 0 && timePeriod && !isDistributionManuallyModified) {
      const [startTime, endTime] = timePeriod.split('-');
      const newDist = generateDefaultDistribution(dailyClickCount, startTime, endTime);
      setDistribution(newDist);
    }
  }, [selectedOfferId, dailyClickCount, timePeriod, isDistributionManuallyModified]);

  const loadOffers = async () => {
    try {
      setLoadingOffers(true);
      console.log('[ClickFarmTaskModal] loadOffers START: preSelectedOfferId =', preSelectedOfferId);

      // 🆕 如果有 preSelectedOfferId，只获取单个Offer的信息
      if (preSelectedOfferId) {
        const response = await fetch(`/api/offers/${preSelectedOfferId}`, {
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          // 如果单个offer获取失败，降级获取列表
          console.log('[ClickFarmTaskModal] loadOffers: 单个offer获取失败，降级获取列表');
          await loadOffersList();
          return;
        }

        const data = await response.json();
        const offerData = data.offer || data.data;
        console.log('[ClickFarmTaskModal] loadOffers: 获取单个offer:', offerData);

        if (offerData) {
          setOffers([offerData]);
          setSelectedOfferId(preSelectedOfferId);
          // 🔧 修复(2025-12-30): 等待分布数据生成完成后再返回，避免用户点击"创建任务"时 distribution 仍为空
          await loadAuxiliaryData(offerData, [offerData]);
        }
      } else {
        // 没有 preSelectedOfferId 时，获取列表
        await loadOffersList();
      }

      console.log('[ClickFarmTaskModal] loadOffers END');
    } catch (error) {
      console.error('加载Offer失败:', error);
      toast.error('加载Offer列表失败');
    } finally {
      setLoadingOffers(false);
    }
  };

  // 🆕 获取Offer列表（用于没有 preSelectedOfferId 的情况）
  const loadOffersList = async () => {
    const response = await fetch('/api/offers?limit=100&isActive=true', {
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) throw new Error('加载Offer失败');

    const data = await response.json();
    const offersData = data.offers || [];
    console.log('[ClickFarmTaskModal] loadOffersList: API返回', offersData.length, '个offers');
    setOffers(offersData);

    if (offersData.length > 0) {
      setSelectedOfferId(offersData[0].id);
      // 🔧 修复(2025-12-30): 等待分布数据生成完成后再返回，避免用户点击"创建任务"时 distribution 仍为空
      await loadAuxiliaryData(offersData[0], offersData);
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

  const handleOfferChange = async (offerId: number, offersDataParam?: Offer[]) => {
    console.log('[ClickFarmTaskModal] handleOfferChange START: offerId =', offerId, 'current offers.length =', offers.length, 'current selectedOfferId =', selectedOfferId);
    setSelectedOfferId(offerId);
    setIsDistributionManuallyModified(false); // 重置手动修改标志

    // 🆕 使用传入的 offersDataParam，如果没传则使用 state offers
    const offersList = offersDataParam || offers;
    const offer = offersList.find(o => o.id === offerId);
    console.log('[ClickFarmTaskModal] handleOfferChange: 找到offer?', !!offer, 'offerName:', offer?.offerName, 'brand:', offer?.brand, 'targetCountry:', offer?.targetCountry);
    if (offer) {
      // 🆕 使用并行加载替代串行调用
      await loadAuxiliaryData(offer, offersList);
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
    setIsDistributionManuallyModified(false);
    toast.success('已重置为默认分布');
  };

  const handleBalanceDistribution = () => {
    const [startTime, endTime] = timePeriod.split('-');
    const balanced = balanceDistribution(dailyClickCount, startTime, endTime);
    setDistribution(balanced);
    setIsDistributionManuallyModified(true);
    toast.success('已应用均衡分布');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ==========================================
    // 第一部分：Offer信息完整性校验
    // ==========================================

    // 1.1 校验Offer是否已选择
    if (!selectedOfferId) {
      toast.error('请选择一个Offer');
      return;
    }

    // 1.2 校验selectedOffer对象存在
    if (!selectedOffer) {
      toast.error('无法获取Offer信息，请重新选择');
      return;
    }

    // 1.3 校验Offer基本信息完整性
    const offerValidationErrors: string[] = [];

    if (!selectedOffer.affiliateLink) {
      offerValidationErrors.push('联盟推广链接（affiliateLink）未配置');
    } else {
      // 1.4 校验联盟链接格式有效性
      try {
        const url = new URL(selectedOffer.affiliateLink);
        if (!url.protocol.startsWith('http')) {
          offerValidationErrors.push('联盟推广链接协议无效（需http/https）');
        }
        if (!url.hostname) {
          offerValidationErrors.push('联盟推广链接域名无效');
        }
      } catch {
        offerValidationErrors.push('联盟推广链接格式无效（需有效的URL格式）');
      }
    }

    if (!selectedOffer.targetCountry) {
      offerValidationErrors.push('投放国家（targetCountry）未配置');
    }

    // 1.5 校验Offer名称标识（至少有一个可识别的名称）
    const offerName = selectedOffer.offerName || selectedOffer.brand || selectedOffer.name || selectedOffer.brand_name;
    if (!offerName || offerName.trim() === '') {
      offerValidationErrors.push('Offer名称信息不完整（无品牌、名称或Offer名称）');
    }

    // 如果有Offer信息校验错误，一次性显示
    if (offerValidationErrors.length > 0) {
      toast.error('Offer信息不完整，无法创建补点击任务');
      offerValidationErrors.forEach(err => {
        toast.error(err, { description: '请先完善Offer信息后再试' });
      });
      return;
    }

    // ==========================================
    // 第二部分：任务配置校验
    // ==========================================

    // 2.1 校验每日点击数
    if (!dailyClickCount || dailyClickCount < 1) {
      toast.error('每日点击数必须大于等于1');
      return;
    }
    if (dailyClickCount > 1000) {
      toast.error('每日点击数不能超过1000');
      return;
    }
    if (!Number.isInteger(dailyClickCount)) {
      toast.error('每日点击数必须为整数');
      return;
    }

    // 2.2 校验时间范围格式
    if (!timePeriod || !timePeriod.includes('-')) {
      toast.error('时间范围格式无效，请重新选择');
      return;
    }

    const [startTime, endTime] = timePeriod.split('-');
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

    if (!timeRegex.test(startTime)) {
      toast.error(`开始时间"${startTime}"格式无效（需HH:mm格式）`);
      return;
    }
    if (!timeRegex.test(endTime) && endTime !== '24:00') {
      toast.error(`结束时间"${endTime}"格式无效（需HH:mm格式或24:00）`);
      return;
    }

    // 2.3 校验持续天数
    if (!durationDays) {
      toast.error('请选择任务持续天数');
      return;
    }
    if (durationDays !== 9999 && (durationDays < 1 || durationDays > 365)) {
      toast.error('任务持续天数必须在1-365天之间，或选择"不限期"');
      return;
    }

    // 2.4 校验开始日期
    if (!scheduledStartDate) {
      toast.error('请选择任务开始日期');
      return;
    }
    // 校验日期格式
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(scheduledStartDate)) {
      toast.error('开始日期格式无效（需YYYY-MM-DD格式）');
      return;
    }
    // 校验开始日期不能是过去（允许今天及以后）
    const today = new Date().toISOString().split('T')[0];
    if (scheduledStartDate < today) {
      toast.error('开始日期不能早于今天');
      return;
    }

    // 2.5 校验时区
    if (!timezone) {
      toast.error('执行时区未设置，请重新选择Offer');
      return;
    }
    // 简单的IANA时区格式校验
    const ianaTimezoneRegex = /^[A-Za-z]+\/[A-Za-z_]+$/;
    if (!ianaTimezoneRegex.test(timezone)) {
      toast.error('执行时区格式无效');
      return;
    }

    // 2.6 校验24小时分布
    if (!distribution || !Array.isArray(distribution)) {
      toast.error('请先生成时间分布');
      return;
    }
    if (distribution.length !== 24) {
      toast.error(`时间分布数据无效（期望24小时，实际${distribution.length}小时）`);
      return;
    }

    // 2.7 校验分布数据有效性
    const invalidHours = distribution.find((count, hour) => {
      if (typeof count !== 'number' || count < 0) return true;
      // 检查时间与分布的对应关系
      const [startHour] = startTime.split(':').map(Number);
      const [endHour] = endTime.split(':').map(Number);
      // 非执行时间内应该有0点击
      if (endTime === '24:00') {
        // 🔧 修复(2025-12-30): 非执行时间应该检查count !== 0,而不是直接返回true
        if (hour < startHour) return count !== 0;
      } else if (endHour > startHour) {
        // 普通时间段，如 06:00-18:00
        if (hour < startHour || hour >= endHour) return count !== 0;
      } else {
        // 跨越午夜，如 22:00-06:00
        if (hour < startHour && hour >= endHour) return count !== 0;
      }
      return false;
    });
    if (invalidHours !== undefined) {
      toast.error('时间分布数据与时间范围不匹配');
      return;
    }

    // 2.8 校验分布总和是否等于每日点击数
    const distributionTotal = distribution.reduce((sum, count) => sum + count, 0);
    if (distributionTotal !== dailyClickCount) {
      toast.error(`时间分布总和（${distributionTotal}）不等于每日点击数（${dailyClickCount}），请重新生成分布`);
      return;
    }

    // ==========================================
    // 第三部分：外部依赖校验
    // ==========================================

    if (proxyWarning) {
      toast.error('请先配置代理');
      return;
    }

    // ==========================================
    // 第四部分：提交数据
    // ==========================================

    try {
      setLoading(true);

      const requestData: CreateClickFarmTaskRequest = {
        offer_id: selectedOfferId!,
        daily_click_count: dailyClickCount,
        start_time: startTime,
        end_time: endTime,
        duration_days: durationDays === 9999 ? -1 : durationDays,
        scheduled_start_date: scheduledStartDate,
        hourly_distribution: distribution,
        timezone: timezone,
        referer_config: refererConfig,  // 🆕 添加Referer配置
      };

      console.log('[ClickFarmTaskModal] 发送请求数据:', {
        ...requestData,
        hourly_distribution: `[array of ${requestData.hourly_distribution.length} items]`,
        offer_info: {
          id: selectedOffer.id,
          name: offerName,
          country: selectedOffer.targetCountry,
          affiliateLink: '***hidden***'
        },
        referer_config: requestData.referer_config
      });

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
      setIsDistributionManuallyModified(false);
      setDraggedHour(null);
      setRefererConfig({ type: 'none' });  // 🆕 重置Referer配置

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
      <DialogContent className="max-w-xl sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="shrink-0">
          <DialogTitle>{isEditMode ? '编辑补点击任务' : '创建补点击任务'}</DialogTitle>
          <DialogDescription>
            配置自动点击任务，帮助广告冷启动和提升投放表现
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Offer Selection + Offer Info Card */}
          <div className="space-y-4">
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
                          #{offer.id} - {offer.offerName || offer.brand || offer.name || offer.brand_name} ({offer.targetCountry})
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
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  {/* Offer ID */}
                  <div className="flex items-center gap-2 text-sm">
                    <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Offer ID:</span>
                    <span className="font-medium">#{selectedOffer.id}</span>
                  </div>

                  {/* 产品标识 */}
                  <div className="flex items-center gap-2 text-sm">
                    <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">产品标识:</span>
                    <Badge className="h-5 text-xs" variant="outline">
                      {selectedOffer.offerName || selectedOffer.brand || selectedOffer.name || selectedOffer.brand_name || `Offer #${selectedOffer.id}`}
                    </Badge>
                  </div>

                  {/* 投放国家 */}
                  <div className="flex items-center gap-2 text-sm">
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">投放国家:</span>
                    <span className="font-medium">{selectedOffer.targetCountry}</span>
                  </div>

                  {/* 执行时区 */}
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">时区:</span>
                    <span className="font-medium">{timezone}</span>
                  </div>

                  {/* 联盟推广链接：单行显示，截断 */}
                  <div className="flex items-start gap-2 pt-2 border-t border-muted-foreground/20">
                    <Link className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="text-muted-foreground text-sm block">联盟推广链接:</span>
                      {selectedOffer.affiliateLink ? (
                        <div className="relative group">
                          <a
                            href={selectedOffer.affiliateLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-sm break-all block"
                          >
                            {selectedOffer.affiliateLink.length > 60
                              ? `${selectedOffer.affiliateLink.substring(0, 60)}...`
                              : selectedOffer.affiliateLink}
                          </a>
                          {/* Tooltip显示完整链接 */}
                          <div className="hidden group-hover:block absolute z-10 left-0 bottom-full mb-2 p-2 bg-popover text-popover-foreground text-xs rounded shadow-lg border max-w-[350px] break-all">
                            {selectedOffer.affiliateLink}
                          </div>
                        </div>
                      ) : (
                        <Badge variant="destructive" className="text-xs">
                          未配置联盟链接
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic">
                  请选择一个 Offer
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Proxy Warning + Core Config + Referer Config */}
          <div className="space-y-4">
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
                    onClick={() => window.open('/settings', '_blank')}
                  >
                    前往配置
                  </Button>
                </div>
              </Alert>
            )}

            {/* Configuration Fields - 2 Column Layout */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {/* Daily Click Count */}
              <div className="space-y-1">
                <Label htmlFor="dailyClicks">每日点击数 *</Label>
                <Input
                  id="dailyClicks"
                  type="number"
                  min={1}
                  max={1000}
                  value={dailyClickCount}
                  onChange={(e) => {
                    setDailyClickCount(parseInt(e.target.value) || 0);
                    setIsDistributionManuallyModified(false); // Reset manual modification flag
                  }}
                  placeholder="建议: 216次/天"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  按需配置自然点击量
                </p>
              </div>

              {/* Scheduled Start Date */}
              <div className="space-y-1">
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
                  默认今天，可选未来日期
                </p>
              </div>

              {/* Time Period */}
              <div className="space-y-1">
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
              <div className="space-y-1">
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

            {/* Referer配置 */}
            <div className="space-y-1.5 pt-2.5 border-t">
              <Label className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Referer来源配置
              </Label>
              <p className="text-xs text-muted-foreground">
                模拟真实用户来源，防止反爬识别
              </p>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {/* Referer类型选择 */}
                <div className="space-y-1">
                  <Label htmlFor="refererType">Referer类型</Label>
                  <Select
                    id="refererType"
                    value={refererConfig.type}
                    onValueChange={(value) => {
                      setRefererConfig(prev => ({
                        ...prev,
                        type: value as 'none' | 'random' | 'specific',
                        referer: value === 'specific' ? prev.referer : undefined
                      }));
                    }}
                  >
                    <SelectContent>
                      {REFERER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {REFERER_OPTIONS.find(o => o.value === refererConfig.type)?.description}
                  </p>
                </div>

                {/* 特定Referer选择（仅当类型为specific时显示） */}
                {refererConfig.type === 'specific' ? (
                  <div className="space-y-1">
                    <Label htmlFor="specificReferer">选择Referer</Label>
                    <Select
                      id="specificReferer"
                      value={refererConfig.referer || ''}
                      onValueChange={(value) => {
                        setRefererConfig(prev => ({ ...prev, referer: value }));
                      }}
                    >
                      <SelectContent>
                        {SOCIAL_MEDIA_REFERRERS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Bottom: Time Distribution Curve (spans both columns) */}
          <div className="col-span-1 lg:col-span-2">
            {/* Distribution Preview - Enhanced Editor */}
            {distribution.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    时间分布曲线
                  </Label>
                  <div className="flex items-center gap-2">
                    {isEditingDistribution && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={handleBalanceDistribution}
                          className="h-8 text-xs"
                        >
                          <TrendingUp className="h-3 w-3 mr-1" />
                          均衡分布
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={resetDistribution}
                          className="h-8 text-xs"
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          重置
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant={isEditingDistribution ? "default" : "outline"}
                      onClick={toggleEditMode}
                      className="h-8"
                    >
                      {isEditingDistribution ? '完成编辑' : '自定义编辑'}
                    </Button>
                  </div>
                </div>

                {/* Enhanced Distribution Editor */}
                <HourlyDistributionEditor
                  distribution={distribution}
                  dailyClickCount={dailyClickCount}
                  timePeriod={timePeriod}
                  isEditing={isEditingDistribution}
                  onChange={(hour, value) => {
                    if (!isEditingDistribution) return;
                    const newDistribution = [...distribution];
                    newDistribution[hour] = Math.max(0, value);

                    // 保持总数不变，智能重新分配差值
                    const currentTotal = newDistribution.reduce((sum, n) => sum + n, 0);
                    const diff = dailyClickCount - currentTotal;

                    if (diff !== 0) {
                      // 将差值按比例分配给其他小时
                      const otherHours = newDistribution
                        .map((val, idx) => ({ idx, val }))
                        .filter(({ idx }) => idx !== hour && newDistribution[idx] > 0);

                      if (otherHours.length > 0) {
                        const totalOthers = otherHours.reduce((sum, { val }) => sum + val, 0);

                        for (const { idx } of otherHours) {
                          const ratio = totalOthers > 0 ? newDistribution[idx] / totalOthers : 1 / otherHours.length;
                          newDistribution[idx] = Math.max(0, Math.round(newDistribution[idx] + diff * ratio));
                        }
                      }

                      // 最终微调确保总数精确
                      const finalTotal = newDistribution.reduce((sum, n) => sum + n, 0);
                      const finalDiff = dailyClickCount - finalTotal;
                      if (finalDiff !== 0) {
                        const maxIdx = newDistribution.indexOf(Math.max(...newDistribution));
                        newDistribution[maxIdx] = Math.max(0, newDistribution[maxIdx] + finalDiff);
                      }
                    }

                    setDistribution(newDistribution);
                  }}
                />
              </div>
            )}

            {/* DialogFooter inside form */}
            <div className="pt-4 border-t">
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
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
