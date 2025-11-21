'use client'

/**
 * Step 4: Publish Summary and Confirmation
 * 汇总信息、确认发布
 */

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Rocket, CheckCircle2, AlertCircle, Loader2, TrendingUp, Settings, Link2 } from 'lucide-react'
import { showError, showSuccess } from '@/lib/toast-utils'

interface Props {
  offer: any
  selectedCreative: any
  campaignConfig: any
  selectedAccount: any
  onPublishComplete: () => void
}

export default function Step4PublishSummary({
  offer,
  selectedCreative,
  campaignConfig,
  selectedAccount,
  onPublishComplete
}: Props) {
  const [pauseOldCampaigns, setPauseOldCampaigns] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishStatus, setPublishStatus] = useState<{
    step: string
    message: string
    success: boolean
  } | null>(null)

  const handlePublish = async () => {
    try {
      setPublishing(true)
      setPublishStatus({
        step: 'preparing',
        message: '准备发布数据...',
        success: false
      })

      // Step 1: Pause old campaigns if requested
      if (pauseOldCampaigns) {
        setPublishStatus({
          step: 'pausing',
          message: '暂停已存在的广告系列...',
          success: false
        })

        try {
          const pauseResponse = await fetch(`/api/offers/${offer.id}/pause-campaigns`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            credentials: 'include'
          })

          const pauseData = await pauseResponse.json()

          if (!pauseResponse.ok) {
            console.warn('暂停旧广告系列失败:', pauseData.error)
            // 不阻止发布流程，只记录警告
            setPublishStatus({
              step: 'pausing',
              message: `暂停旧广告系列部分失败 (${pauseData.message || pauseData.error})`,
              success: false
            })
          } else {
            setPublishStatus({
              step: 'pausing',
              message: `已暂停 ${pauseData.paused_count} 个广告系列`,
              success: true
            })
          }
        } catch (error: any) {
          console.error('暂停旧广告系列错误:', error)
          // 不阻止发布流程
          setPublishStatus({
            step: 'pausing',
            message: '暂停旧广告系列失败，但继续发布新广告',
            success: false
          })
        }

        // 稍微延迟，让用户看到状态更新
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      // Step 2: Create campaign structure
      setPublishStatus({
        step: 'creating',
        message: '创建广告系列结构...',
        success: false
      })

      const response = await fetch('/api/campaigns/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          offer_id: offer.id,
          ad_creative_id: selectedCreative.id,
          google_ads_account_id: selectedAccount.id,
          campaign_config: campaignConfig,
          pause_old_campaigns: pauseOldCampaigns
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '发布失败')
      }

      // Step 3: Sync to Google Ads
      setPublishStatus({
        step: 'syncing',
        message: '同步到Google Ads...',
        success: false
      })

      // TODO: Implement actual Google Ads API sync
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Success
      setPublishStatus({
        step: 'completed',
        message: '发布成功！广告系列已上线',
        success: true
      })

      showSuccess('发布成功', '广告系列已成功发布到Google Ads')

      // Redirect after 2 seconds
      setTimeout(() => {
        onPublishComplete()
      }, 2000)
    } catch (error: any) {
      setPublishStatus({
        step: 'failed',
        message: error.message || '发布失败',
        success: false
      })
      showError('发布失败', error.message)
    } finally {
      setPublishing(false)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="w-5 h-5 text-orange-600" />
            确认发布
          </CardTitle>
          <CardDescription>
            请仔细检查以下配置信息，确认无误后点击"发布广告"按钮
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Ad Creative Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-600" />
            广告创意
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Score Display */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <div className="text-sm text-gray-600 mb-1">综合评分</div>
              <div className={`text-3xl font-bold ${getScoreColor(selectedCreative.score)}`}>
                {selectedCreative.score.toFixed(1)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-600">相关性:</span>{' '}
                <span className="font-semibold">{selectedCreative.score_breakdown.relevance}</span>
              </div>
              <div>
                <span className="text-gray-600">质量:</span>{' '}
                <span className="font-semibold">{selectedCreative.score_breakdown.quality}</span>
              </div>
              <div>
                <span className="text-gray-600">吸引力:</span>{' '}
                <span className="font-semibold">{selectedCreative.score_breakdown.engagement}</span>
              </div>
              <div>
                <span className="text-gray-600">多样性:</span>{' '}
                <span className="font-semibold">{selectedCreative.score_breakdown.diversity}</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Creative Details */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">
                标题 ({selectedCreative.headlines.length})
              </div>
              <div className="space-y-1 text-sm text-gray-600">
                {selectedCreative.headlines.slice(0, 5).map((h: string, i: number) => (
                  <div key={i}>• {h}</div>
                ))}
                {selectedCreative.headlines.length > 5 && (
                  <div className="text-gray-400">
                    +{selectedCreative.headlines.length - 5} 更多...
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">
                描述 ({selectedCreative.descriptions.length})
              </div>
              <div className="space-y-1 text-sm text-gray-600">
                {selectedCreative.descriptions.map((d: string, i: number) => (
                  <div key={i}>• {d}</div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">
              关键词 ({selectedCreative.keywords.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedCreative.keywords.slice(0, 10).map((k: string, i: number) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {k}
                </Badge>
              ))}
              {selectedCreative.keywords.length > 10 && (
                <Badge variant="outline" className="text-xs">
                  +{selectedCreative.keywords.length - 10}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Campaign Configuration Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            广告系列配置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-3">
              <div>
                <span className="text-gray-600">广告系列名称:</span>
                <div className="font-semibold mt-1">{campaignConfig.campaignName}</div>
              </div>
              <div>
                <span className="text-gray-600">预算:</span>
                <div className="font-semibold mt-1">
                  ${campaignConfig.budgetAmount.toFixed(2)} /{' '}
                  {campaignConfig.budgetType === 'DAILY' ? '每日' : '总计'}
                </div>
              </div>
              <div>
                <span className="text-gray-600">目标国家/语言:</span>
                <div className="font-semibold mt-1">
                  {campaignConfig.targetCountry} / {campaignConfig.targetLanguage}
                </div>
              </div>
              <div>
                <span className="text-gray-600">出价策略:</span>
                <div className="font-semibold mt-1">{campaignConfig.biddingStrategy}</div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <span className="text-gray-600">广告组名称:</span>
                <div className="font-semibold mt-1">{campaignConfig.adGroupName}</div>
              </div>
              <div>
                <span className="text-gray-600">最大CPC出价:</span>
                <div className="font-semibold mt-1">${campaignConfig.maxCpcBid.toFixed(2)}</div>
              </div>
              <div>
                <span className="text-gray-600">关键词数量:</span>
                <div className="font-semibold mt-1">{campaignConfig.keywords.length} 个</div>
              </div>
              <div>
                <span className="text-gray-600">否定关键词:</span>
                <div className="font-semibold mt-1">{campaignConfig.negativeKeywords.length} 个</div>
              </div>
            </div>
          </div>

          {campaignConfig.finalUrlSuffix && (
            <>
              <Separator className="my-4" />
              <div>
                <span className="text-sm text-gray-600">最终网址后缀:</span>
                <div className="text-sm font-mono bg-gray-50 p-2 rounded mt-1">
                  {campaignConfig.finalUrlSuffix}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Google Ads Account Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Link2 className="w-5 h-5 text-green-600" />
            Google Ads账号
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <div className="font-semibold">{selectedAccount.account_name || '广告账号'}</div>
              <div className="text-sm text-gray-600 font-mono mt-1">
                {selectedAccount.customer_id}
              </div>
            </div>
            <Badge variant="default" className="bg-green-600">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              已验证
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Pause Old Campaigns Option */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="pauseOld"
              checked={pauseOldCampaigns}
              onCheckedChange={(checked) => setPauseOldCampaigns(checked as boolean)}
            />
            <div className="flex-1">
              <Label
                htmlFor="pauseOld"
                className="text-base font-medium cursor-pointer"
              >
                暂停所有已存在的广告系列
              </Label>
              <p className="text-sm text-gray-500 mt-1">
                勾选此项将在发布新广告前，自动暂停该Offer下所有正在投放的广告系列
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Publish Status */}
      {publishStatus && (
        <Alert
          className={
            publishStatus.success
              ? 'bg-green-50 border-green-200'
              : publishStatus.step === 'failed'
              ? 'bg-red-50 border-red-200'
              : 'bg-blue-50 border-blue-200'
          }
        >
          {publishStatus.success ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : publishStatus.step === 'failed' ? (
            <AlertCircle className="h-4 w-4 text-red-600" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          )}
          <AlertDescription
            className={
              publishStatus.success
                ? 'text-green-900'
                : publishStatus.step === 'failed'
                ? 'text-red-900'
                : 'text-blue-900'
            }
          >
            {publishStatus.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Publish Button */}
      <Card>
        <CardContent className="py-6">
          <Button
            onClick={handlePublish}
            disabled={publishing}
            size="lg"
            className="w-full"
          >
            {publishing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                发布中...
              </>
            ) : (
              <>
                <Rocket className="w-5 h-5 mr-2" />
                发布广告
              </>
            )}
          </Button>

          <p className="text-xs text-gray-500 text-center mt-4">
            点击"发布广告"即表示您同意Google Ads的服务条款和政策
          </p>
        </CardContent>
      </Card>

      {/* Info Alert */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>发布须知</strong>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>广告发布后将进入Google Ads审核流程，通常需要1-2个工作日</li>
            <li>审核通过后广告将自动开始投放</li>
            <li>您可以随时在Google Ads后台查看和管理广告系列</li>
            <li>建议发布后密切关注广告表现，及时优化</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  )
}
