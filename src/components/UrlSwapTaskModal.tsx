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
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Loader2, AlertCircle, Link, Clock, Globe, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import type { UrlSwapTask } from '@/lib/url-swap-types';

interface UrlSwapTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  offerId?: number;  // 创建模式下必填
  editTaskId?: string;  // 编辑模式下必填（二选一）
}

interface Offer {
  id: number;
  offerName?: string;
  name?: string;
  brand?: string;
  brand_name?: string;
  targetCountry: string;
  affiliateLink?: string;
  // 🆕 关联的Google Ads信息（从Campaign获取）
  googleCustomerId?: string;
  googleCampaignId?: string;
}

const SWAP_INTERVAL_OPTIONS = [
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 120, label: '2 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '24 小时' },
];

const DURATION_OPTIONS = [
  { value: 7, label: '7 天' },
  { value: 14, label: '14 天' },
  { value: 30, label: '30 天' },
  { value: 60, label: '60 天' },
  { value: 90, label: '90 天' },
  { value: -1, label: '不限期' },
];

export default function UrlSwapTaskModal({
  open,
  onOpenChange,
  onSuccess,
  offerId,
  editTaskId,
}: UrlSwapTaskModalProps) {
  const [loading, setLoading] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loadingOffer, setLoadingOffer] = useState(true);
  const [taskData, setTaskData] = useState<UrlSwapTask | null>(null);
  const [proxyWarning, setProxyWarning] = useState('');

  // Form state
  const [swapIntervalMinutes, setSwapIntervalMinutes] = useState(30);
  const [durationDays, setDurationDays] = useState(30);
  const [googleCustomerId, setGoogleCustomerId] = useState('');
  const [googleCampaignId, setGoogleCampaignId] = useState('');

  const isEditMode = !!editTaskId;

  // Load existing task data (edit mode)
  useEffect(() => {
    if (open && editTaskId) {
      loadTaskData();
    }
  }, [open, editTaskId]);

  // Load offer (create mode)
  useEffect(() => {
    if (open && !editTaskId && offerId) {
      loadOfferById(offerId);
    }
  }, [open, offerId, editTaskId]);

  const loadTaskData = async () => {
    try {
      const response = await fetch(`/api/url-swap/tasks/${editTaskId}`);
      if (!response.ok) throw new Error('加载任务失败');

      const { data: task } = await response.json();
      setTaskData(task);
      setSwapIntervalMinutes(task.swap_interval_minutes);
      setDurationDays(task.duration_days);
      setGoogleCustomerId(task.google_customer_id || '');
      setGoogleCampaignId(task.google_campaign_id || '');

      // 加载关联的Offer信息
      if (task.offer_id) {
        loadOfferById(task.offer_id);
      }
    } catch (error) {
      console.error('加载任务失败:', error);
      toast.error('加载任务失败');
      onOpenChange(false);
    }
  };

  const loadOfferById = async (id: number) => {
    try {
      setLoadingOffer(true);

      // 获取Offer信息
      const response = await fetch(`/api/offers/${id}`);
      if (!response.ok) throw new Error('加载Offer失败');

      const data = await response.json();
      const offerData = data.offer || data.data;

      if (offerData) {
        // 🆕 获取该Offer关联的最新Campaign，提取Google Ads信息
        try {
          const campaignsResponse = await fetch(`/api/offers/${id}/campaigns`);
          if (campaignsResponse.ok) {
            const campaignsData = await campaignsResponse.json();
            const campaigns = campaignsData.data || campaignsData.campaigns || [];

            if (campaigns.length > 0) {
              // 使用最新的Campaign（按创建时间降序）
              const latestCampaign = campaigns[0];

              // 从Campaign的google_ads_account获取customer_id
              if (latestCampaign.google_ads_account) {
                offerData.googleCustomerId = latestCampaign.google_ads_account.customer_id;
              }

              // 从Campaign获取google_campaign_id
              if (latestCampaign.google_campaign_id) {
                offerData.googleCampaignId = latestCampaign.google_campaign_id;
              }

              // 🔥 自动填充表单字段（仅在创建模式下，编辑模式使用已保存的值）
              if (!isEditMode) {
                if (offerData.googleCustomerId) {
                  setGoogleCustomerId(offerData.googleCustomerId);
                }
                if (offerData.googleCampaignId) {
                  setGoogleCampaignId(offerData.googleCampaignId);
                }
              }
            }
          }
        } catch (campaignError) {
          console.warn('获取Campaign信息失败:', campaignError);
          // 不影响主流程，继续执行
        }

        setOffer(offerData);
        checkProxy(offerData);
      }
    } catch (error) {
      console.error('加载Offer失败:', error);
      toast.error('加载Offer失败');
    } finally {
      setLoadingOffer(false);
    }
  };

  const checkProxy = async (offerData: Offer) => {
    try {
      const response = await fetch(`/api/settings/proxy?country=${offerData.targetCountry.toLowerCase()}`);
      if (!response.ok) {
        setProxyWarning(`未配置 ${offerData.targetCountry} 代理，请先前往设置页面配置`);
        return;
      }
      const data = await response.json();
      if (!data.data?.proxy_url) {
        setProxyWarning(`未配置 ${offerData.targetCountry} 代理，请先前往设置页面配置`);
      } else {
        setProxyWarning('');
      }
    } catch {
      setProxyWarning('检查代理配置失败');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!offer) {
      toast.error('无法获取Offer信息');
      return;
    }

    if (!offer.affiliateLink) {
      toast.error('Offer未配置联盟推广链接，无法创建换链任务');
      return;
    }

    if (proxyWarning) {
      toast.error('请先配置代理');
      return;
    }

    if (swapIntervalMinutes < 5 || swapIntervalMinutes > 1440) {
      toast.error('换链间隔必须在5-1440分钟之间');
      return;
    }

    if (durationDays !== -1 && (durationDays < 1 || durationDays > 365)) {
      toast.error('任务持续天数必须在1-365天之间，或选择"不限期"');
      return;
    }

    try {
      setLoading(true);

      const requestData = {
        offer_id: offer.id,
        swap_interval_minutes: swapIntervalMinutes,
        duration_days: durationDays === -1 ? -1 : durationDays,
        google_customer_id: googleCustomerId || null,
        google_campaign_id: googleCampaignId || null,
      };

      const url = isEditMode
        ? `/api/url-swap/tasks/${editTaskId}`
        : '/api/url-swap/tasks';

      const response = await fetch(url, {
        method: isEditMode ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `${isEditMode ? '更新' : '创建'}任务失败`);
      }

      toast.success(`换链任务${isEditMode ? '更新' : '创建'}成功`);
      onOpenChange(false);
      onSuccess?.();
      resetFormState();
    } catch (error: any) {
      console.error('创建任务失败:', error);
      toast.error(error.message || '创建任务失败');
    } finally {
      setLoading(false);
    }
  };

  const resetFormState = () => {
    setSwapIntervalMinutes(30);
    setDurationDays(30);
    setGoogleCustomerId('');
    setGoogleCampaignId('');
    setProxyWarning('');
    setTaskData(null);
  };

  const handleDialogOpenChange = (newOpen: boolean) => {
    if (!newOpen && !loading) {
      setTimeout(() => {
        resetFormState();
      }, 200);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? '编辑换链任务' : '创建换链任务'}</DialogTitle>
          <DialogDescription>
            配置自动监控Offer链接变更并更新广告链接的任务
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Offer Info Card */}
          <div className="space-y-2">
            <Label>关联 Offer</Label>
            {loadingOffer ? (
              <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载Offer信息...
              </div>
            ) : offer ? (
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Offer ID:</span>
                  <span className="font-medium">#{offer.id}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">产品:</span>
                  <Badge variant="outline">
                    {offer.offerName || offer.brand || offer.name || offer.brand_name || `Offer #${offer.id}`}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">投放国家:</span>
                  <span className="font-medium">{offer.targetCountry}</span>
                </div>
                {offer.affiliateLink && (
                  <div className="flex items-start gap-2 pt-2 border-t border-muted-foreground/20">
                    <Link className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="text-muted-foreground text-sm block">联盟推广链接:</span>
                      <a
                        href={offer.affiliateLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm break-all block"
                      >
                        {offer.affiliateLink.length > 50
                          ? `${offer.affiliateLink.substring(0, 50)}...`
                          : offer.affiliateLink}
                        <ExternalLink className="inline ml-1 h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                加载失败，请重试
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
                  onClick={() => window.open('/settings', '_blank')}
                >
                  前往配置
                </Button>
              </div>
            </Alert>
          )}

          {/* Task Configuration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="interval">换链间隔 *</Label>
              <Select
                id="interval"
                value={swapIntervalMinutes.toString()}
                onValueChange={(value) => setSwapIntervalMinutes(parseInt(value))}
                required
              >
                <SelectContent>
                  {SWAP_INTERVAL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value.toString()}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                检测Offer链接变化的频率
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">任务持续 *</Label>
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

          {/* Google Ads Configuration */}
          <div className="space-y-3 pt-2 border-t">
            <Label className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Google Ads 配置
              {offer?.googleCustomerId || offer?.googleCampaignId ? (
                <Badge variant="secondary" className="ml-2">已关联</Badge>
              ) : (
                <span className="text-xs text-muted-foreground font-normal">（可选）</span>
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              {offer?.googleCustomerId || offer?.googleCampaignId
                ? '从关联的Campaign自动获取，如需修改请前往Campaign管理页面'
                : '配置后可在广告账户中查看关联的换链任务'
              }
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customerId">Customer ID</Label>
                <Input
                  id="customerId"
                  value={googleCustomerId}
                  onChange={(e) => setGoogleCustomerId(e.target.value)}
                  placeholder="例如: 123-456-7890"
                  disabled={!!(offer?.googleCustomerId)}
                  className={offer?.googleCustomerId ? 'bg-gray-50' : ''}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaignId">Campaign ID</Label>
                <Input
                  id="campaignId"
                  value={googleCampaignId}
                  onChange={(e) => setGoogleCampaignId(e.target.value)}
                  placeholder="例如: 123456789"
                  disabled={!!(offer?.googleCampaignId)}
                  className={offer?.googleCampaignId ? 'bg-gray-50' : ''}
                />
              </div>
            </div>
          </div>

          {/* Dialog Footer */}
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
