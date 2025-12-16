'use client'

/**
 * Step 4: Publish Summary and Confirmation
 * 汇总信息、确认发布
 *
 * v2.0 - 两列布局：左侧发布选项/按钮，右侧Launch Score评估面板
 */

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Rocket, CheckCircle2, AlertCircle, Loader2, TrendingUp, Settings, Link2, Info, Target, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { showError, showSuccess } from '@/lib/toast-utils'
import type { LaunchScoreData, ScoreDimension } from '@/components/launch-score/types'
import { DIMENSION_CONFIG } from '@/components/launch-score/types'

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
  const [enableCampaignImmediately, setEnableCampaignImmediately] = useState(false)  // 默认不启用
  const [publishing, setPublishing] = useState(false)
  const [publishStatus, setPublishStatus] = useState<{
    step: string
    message: string
    success: boolean
  } | null>(null)

  // 🔥 新增：发布流程步骤记录
  const [publishSteps, setPublishSteps] = useState<Array<{
    step: string
    message: string
    status: 'pending' | 'running' | 'success' | 'failed'
    timestamp?: Date
  }>>([])

  // 🔥 新增：发布结果模式（点击发布后切换）
  const [showPublishResult, setShowPublishResult] = useState(false)

  // 🔥 新增：Launch Score 阻止详情
  const [launchScoreBlockDetails, setLaunchScoreBlockDetails] = useState<{
    launchScore: number
    threshold: number
    breakdown: any
    issues: string[]
    suggestions: string[]
  } | null>(null)

  // 🔥 新增：确认暂停对话框相关state
  const [showPauseConfirm, setShowPauseConfirm] = useState(false)
  const [existingCampaigns, setExistingCampaigns] = useState<any[]>([])
  const [pauseConfirmMessage, setPauseConfirmMessage] = useState('')

  // 🚀 Launch Score 相关状态
  const [launchScoreData, setLaunchScoreData] = useState<LaunchScoreData | null>(null)
  const [loadingLaunchScore, setLoadingLaunchScore] = useState(false)
  const [analyzingLaunchScore, setAnalyzingLaunchScore] = useState(false)
  const [launchScoreError, setLaunchScoreError] = useState('')
  const [launchScoreExpanded, setLaunchScoreExpanded] = useState(true)

  // 🚀 加载已有Launch Score
  const loadLaunchScore = useCallback(async () => {
    if (!offer?.id || !selectedCreative?.id) return

    setLoadingLaunchScore(true)
    setLaunchScoreError('')

    try {
      const response = await fetch(`/api/offers/${offer.id}/launch-score`, {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        if (data.launchScore) {
          const parsed: LaunchScoreData = {
            totalScore: data.launchScore.total_score,
            launchViability: JSON.parse(data.launchScore.launch_viability_data || '{}'),
            adQuality: JSON.parse(data.launchScore.ad_quality_data || '{}'),
            keywordStrategy: JSON.parse(data.launchScore.keyword_strategy_data || '{}'),
            basicConfig: JSON.parse(data.launchScore.basic_config_data || '{}'),
            overallRecommendations: JSON.parse(data.launchScore.recommendations || '[]'),
          }
          setLaunchScoreData(parsed)
        }
      }
    } catch (err: any) {
      console.error('加载Launch Score失败:', err)
    } finally {
      setLoadingLaunchScore(false)
    }
  }, [offer?.id, selectedCreative?.id])

  // 🚀 执行Launch Score分析
  const handleAnalyzeLaunchScore = useCallback(async () => {
    if (!offer?.id || !selectedCreative?.id) return

    setAnalyzingLaunchScore(true)
    setLaunchScoreError('')

    try {
      const response = await fetch(`/api/offers/${offer.id}/launch-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ creativeId: selectedCreative.id }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '分析失败')
      }

      setLaunchScoreData(data)
    } catch (err: any) {
      setLaunchScoreError(err.message)
    } finally {
      setAnalyzingLaunchScore(false)
    }
  }, [offer?.id, selectedCreative?.id])

  // 组件挂载时加载Launch Score
  useEffect(() => {
    loadLaunchScore()
  }, [loadLaunchScore])

  // 🔥 辅助函数：添加/更新发布步骤
  const addPublishStep = (step: string, message: string, status: 'pending' | 'running' | 'success' | 'failed') => {
    setPublishSteps(prev => {
      const existing = prev.find(s => s.step === step)
      if (existing) {
        return prev.map(s => s.step === step ? { ...s, message, status, timestamp: new Date() } : s)
      }
      return [...prev, { step, message, status, timestamp: new Date() }]
    })
  }

  const handlePublish = async () => {
    try {
      setPublishing(true)
      setShowPublishResult(true)  // 🔥 切换到发布结果模式
      setPublishSteps([])  // 清空之前的步骤
      setLaunchScoreBlockDetails(null)  // 清空之前的阻止详情

      addPublishStep('preparing', '准备发布数据...', 'running')
      setPublishStatus({
        step: 'preparing',
        message: '准备发布数据...',
        success: false
      })

      // Step 1: Pause old campaigns if requested
      addPublishStep('preparing', '准备发布数据', 'success')

      if (pauseOldCampaigns) {
        addPublishStep('pausing', '暂停已存在的广告系列...', 'running')
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
            addPublishStep('pausing', `暂停部分失败 (${pauseData.message || pauseData.error})`, 'failed')
            setPublishStatus({
              step: 'pausing',
              message: `暂停旧广告系列部分失败 (${pauseData.message || pauseData.error})`,
              success: false
            })
          } else {
            addPublishStep('pausing', `已暂停 ${pauseData.pausedCount} 个广告系列`, 'success')
            setPublishStatus({
              step: 'pausing',
              message: `已暂停 ${pauseData.pausedCount} 个广告系列`,
              success: true
            })
          }
        } catch (error: any) {
          console.error('暂停旧广告系列错误:', error)
          addPublishStep('pausing', '暂停失败，继续发布新广告', 'failed')
          setPublishStatus({
            step: 'pausing',
            message: '暂停旧广告系列失败，但继续发布新广告',
            success: false
          })
        }

        await new Promise(resolve => setTimeout(resolve, 500))
      }

      // Step 2: Create campaign structure
      addPublishStep('creating', '创建广告系列结构...', 'running')
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
          offerId: offer.id,
          adCreativeId: selectedCreative.id,
          googleAdsAccountId: selectedAccount.id,
          campaignConfig: campaignConfig,
          pauseOldCampaigns: pauseOldCampaigns,
          enableCampaignImmediately: enableCampaignImmediately,
          forcePublish: false
        })
      })

      const data = await response.json()

      // 🔥 处理Launch Score过低的情况（422状态码）- 在卡片中显示而不是toast
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_BLOCKED') {
        console.error('❌ Launch Score过低:', data)
        const details = data.details || {}

        // 存储Launch Score阻止详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 60,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || []
        })

        addPublishStep('creating', `投放评分过低 (${details.launchScore || 0}分)，发布被阻止`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分过低，需要≥${details.threshold || 60}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 处理需要确认暂停的情况（422状态码）
      if (response.status === 422 && data.action === 'CONFIRM_PAUSE_OLD_CAMPAIGNS') {
        console.log('⚠️ 需要用户确认是否暂停旧Campaign:', data)
        setExistingCampaigns(data.existingCampaigns || [])
        setPauseConfirmMessage(data.message || '')
        setShowPauseConfirm(true)
        setShowPublishResult(false)  // 退出发布结果模式
        setPublishing(false)
        return
      }

      // 🔥 处理Ads账号被其他Offer占用的情况（409状态码）- 在卡片中显示而不是toast
      if (response.status === 409) {
        console.error('❌ Ads账号冲突:', data)
        const errorMessage = data.message || data.error?.error?.message || 'Ads账号已被其他Offer占用'
        const suggestion = data.suggestion || '请选择其他Ads账号'
        addPublishStep('creating', `账号冲突: ${errorMessage}`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `${errorMessage}\n${suggestion}`,
          success: false
        })
        setPublishing(false)
        return
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || '发布失败')
      }

      // Step 3: Sync to Google Ads
      addPublishStep('creating', '创建广告系列结构', 'success')
      addPublishStep('syncing', '同步到Google Ads...', 'running')
      setPublishStatus({
        step: 'syncing',
        message: '同步到Google Ads...',
        success: false
      })

      // TODO: Implement actual Google Ads API sync
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Success - 在卡片中显示而不是toast
      addPublishStep('syncing', '同步完成', 'success')
      addPublishStep('completed', '广告系列已成功发布到Google Ads', 'success')
      setPublishStatus({
        step: 'completed',
        message: '发布成功！广告系列已上线',
        success: true
      })

      // Redirect after 3 seconds (给用户更多时间查看结果)
      setTimeout(() => {
        onPublishComplete()
      }, 3000)
    } catch (error: any) {
      // 发布失败 - 在卡片中显示而不是toast
      addPublishStep('error', error.message || '发布失败', 'failed')
      setPublishStatus({
        step: 'failed',
        message: error.message || '发布失败',
        success: false
      })
    } finally {
      setPublishing(false)
    }
  }

  // 🔥 新增：用户确认暂停并发布
  const handleConfirmPauseAndPublish = async () => {
    try {
      setShowPauseConfirm(false)
      setPublishing(true)
      setShowPublishResult(true)  // 🔥 切换到发布结果模式
      setPublishSteps([])  // 清空之前的步骤
      setLaunchScoreBlockDetails(null)  // 清空之前的阻止详情

      addPublishStep('pausing', `正在暂停${existingCampaigns.length}个旧广告系列...`, 'running')
      setPublishStatus({
        step: 'pausing',
        message: `正在暂停${existingCampaigns.length}个旧广告系列...`,
        success: false
      })

      const response = await fetch('/api/campaigns/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          offerId: offer.id,
          adCreativeId: selectedCreative.id,
          googleAdsAccountId: selectedAccount.id,
          campaignConfig: campaignConfig,
          pauseOldCampaigns: true, // 用户确认暂停
          enableCampaignImmediately: enableCampaignImmediately,  // 是否立即启用Campaign
          forcePublish: false
        })
      })

      const data = await response.json()

      // 🔥 处理Launch Score过低的情况 - 在卡片中显示而不是toast (handleConfirmPauseAndPublish)
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_BLOCKED') {
        console.error('❌ Launch Score过低:', data)
        const details = data.details || {}

        // 存储Launch Score阻止详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 60,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || []
        })

        addPublishStep('pausing', `已暂停${existingCampaigns.length}个旧广告系列`, 'success')
        addPublishStep('creating', `投放评分过低 (${details.launchScore || 0}分)，发布被阻止`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分过低，需要≥${details.threshold || 60}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || '发布失败')
      }

      // 发布成功 - 在卡片中显示而不是toast
      addPublishStep('pausing', `已暂停${existingCampaigns.length}个旧广告系列`, 'success')
      addPublishStep('creating', '创建广告系列结构', 'success')
      addPublishStep('completed', '新广告已创建', 'success')
      setPublishStatus({
        step: 'completed',
        message: '发布成功！广告系列已上线',
        success: true
      })

      setTimeout(() => {
        onPublishComplete()
      }, 3000)

    } catch (error: any) {
      // 发布失败 - 在卡片中显示而不是toast
      addPublishStep('error', error.message || '发布失败', 'failed')
      setPublishStatus({
        step: 'failed',
        message: error.message || '发布失败',
        success: false
      })
    } finally {
      setPublishing(false)
    }
  }

  // 🔥 新增：用户选择直接发布（A/B测试模式）
  const handlePublishTogether = async () => {
    try {
      setShowPauseConfirm(false)
      setPublishing(true)
      setShowPublishResult(true)  // 🔥 切换到发布结果模式
      setPublishSteps([])  // 清空之前的步骤
      setLaunchScoreBlockDetails(null)  // 清空之前的阻止详情

      addPublishStep('creating', '创建新广告（A/B测试模式）...', 'running')
      setPublishStatus({
        step: 'creating',
        message: '创建新广告（A/B测试模式）...',
        success: false
      })

      const response = await fetch('/api/campaigns/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          offerId: offer.id,
          adCreativeId: selectedCreative.id,
          googleAdsAccountId: selectedAccount.id,
          campaignConfig: campaignConfig,
          pauseOldCampaigns: false, // 不暂停
          enableCampaignImmediately: enableCampaignImmediately,  // 是否立即启用Campaign
          forcePublish: true // 强制发布（跳过确认）
        })
      })

      const data = await response.json()

      // 🔥 处理Launch Score过低的情况 - 在卡片中显示而不是toast (handlePublishTogether)
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_BLOCKED') {
        console.error('❌ Launch Score过低:', data)
        const details = data.details || {}

        // 存储Launch Score阻止详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 60,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || []
        })

        addPublishStep('creating', `投放评分过低 (${details.launchScore || 0}分)，发布被阻止`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分过低，需要≥${details.threshold || 60}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || '发布失败')
      }

      // 发布成功 - 在卡片中显示而不是toast
      addPublishStep('creating', '创建广告系列结构', 'success')
      addPublishStep('completed', '新广告已创建，旧广告继续运行（A/B测试模式）', 'success')
      setPublishStatus({
        step: 'completed',
        message: '发布成功！新旧广告同时运行',
        success: true
      })

      setTimeout(() => {
        onPublishComplete()
      }, 3000)

    } catch (error: any) {
      // 发布失败 - 在卡片中显示而不是toast
      addPublishStep('error', error.message || '发布失败', 'failed')
      setPublishStatus({
        step: 'failed',
        message: error.message || '发布失败',
        success: false
      })
    } finally {
      setPublishing(false)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  // 🚀 Launch Score 辅助函数
  const getScoreGrade = (score: number) => {
    if (score >= 80) return { grade: 'A', label: '优秀', color: 'text-green-600', bgColor: 'bg-green-100' }
    if (score >= 60) return { grade: 'B', label: '良好', color: 'text-yellow-600', bgColor: 'bg-yellow-100' }
    if (score >= 40) return { grade: 'C', label: '一般', color: 'text-orange-600', bgColor: 'bg-orange-100' }
    return { grade: 'D', label: '较差', color: 'text-red-600', bgColor: 'bg-red-100' }
  }

  const getDimensionProgress = (dimension: ScoreDimension & { score?: number }, maxScore: number) => {
    const score = dimension?.score || 0
    return Math.round((score / maxScore) * 100)
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

      {/* 🚀 两列布局：左侧发布选项，右侧Launch Score */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左列：Publish Options & Button */}
        <Card className="border-2 border-blue-200 bg-blue-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Rocket className="w-4 h-4 text-blue-600" />
              发布选项
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Options */}
              <div className="space-y-3">
                <div className="flex items-start space-x-3 p-3 bg-white rounded-lg border hover:border-blue-300 transition-colors">
                  <Checkbox
                    id="enableImmediately"
                    checked={enableCampaignImmediately}
                    onCheckedChange={(checked) => setEnableCampaignImmediately(checked as boolean)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="enableImmediately"
                      className="text-sm font-medium cursor-pointer flex items-center gap-2"
                    >
                      立即启用新广告系列
                      <Badge variant={enableCampaignImmediately ? "default" : "outline"} className="text-xs">
                        {enableCampaignImmediately ? '立即投放' : '暂停状态'}
                      </Badge>
                    </Label>
                    <p className="text-xs text-gray-500 mt-1">
                      {enableCampaignImmediately ? '发布后立即开始投放广告' : '发布后保持暂停，可在Google Ads后台手动启用'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3 p-3 bg-white rounded-lg border hover:border-blue-300 transition-colors">
                  <Checkbox
                    id="pauseOld"
                    checked={pauseOldCampaigns}
                    onCheckedChange={(checked) => setPauseOldCampaigns(checked as boolean)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="pauseOld"
                      className="text-sm font-medium cursor-pointer flex items-center gap-2"
                    >
                      暂停所有旧广告系列
                      <Badge variant={pauseOldCampaigns ? "destructive" : "outline"} className="text-xs">
                        {pauseOldCampaigns ? '将暂停' : '保持运行'}
                      </Badge>
                    </Label>
                    <p className="text-xs text-gray-500 mt-1">
                      {pauseOldCampaigns ? '发布新广告前，先暂停该Offer的所有旧广告系列' : '新旧广告同时运行（A/B测试模式）'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Publish Button */}
              <Button
                onClick={handlePublish}
                disabled={publishing}
                size="lg"
                className="w-full h-12 text-base font-semibold"
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
            </div>
          </CardContent>
        </Card>

        {/* 右列：发布结果 或 Launch Score 评估面板 */}
        {showPublishResult ? (
          /* 🔥 发布结果卡片 */
          <Card className={`border-2 ${publishStatus?.success ? 'border-green-200 bg-green-50/30' : publishStatus?.step === 'failed' ? 'border-red-200 bg-red-50/30' : 'border-blue-200 bg-blue-50/30'}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {publishStatus?.success ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : publishStatus?.step === 'failed' ? (
                  <AlertCircle className="w-4 h-4 text-red-600" />
                ) : (
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                )}
                发布结果
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* 发布步骤列表 */}
                <div className="space-y-2">
                  {publishSteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-white rounded border">
                      {step.status === 'running' ? (
                        <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" />
                      ) : step.status === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      ) : step.status === 'failed' ? (
                        <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />
                      )}
                      <span className={`text-sm ${step.status === 'failed' ? 'text-red-700' : step.status === 'success' ? 'text-green-700' : 'text-gray-700'}`}>
                        {step.message}
                      </span>
                    </div>
                  ))}
                </div>

                {/* 投放评分阻止详情 */}
                {launchScoreBlockDetails && (
                  <div className="mt-4 p-4 bg-red-50 rounded-lg border border-red-200">
                    {/* 标题和总分 */}
                    <div className="flex items-center justify-between mb-3 pb-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-red-600" />
                        <span className="text-sm font-semibold text-red-800">
                          投放评分不足
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-red-600">
                          {launchScoreBlockDetails.launchScore}
                          <span className="text-sm font-normal text-gray-500">分</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          最低要求 {launchScoreBlockDetails.threshold} 分
                        </div>
                      </div>
                    </div>

                    {/* 各维度得分 */}
                    {launchScoreBlockDetails.breakdown && Object.keys(launchScoreBlockDetails.breakdown).length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2">各维度得分</div>
                        <div className="grid grid-cols-2 gap-2">
                          {launchScoreBlockDetails.breakdown.launchViability && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">投放可行性</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreBlockDetails.breakdown.launchViability.score}/{launchScoreBlockDetails.breakdown.launchViability.max}
                              </span>
                            </div>
                          )}
                          {launchScoreBlockDetails.breakdown.adQuality && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">广告质量</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreBlockDetails.breakdown.adQuality.score}/{launchScoreBlockDetails.breakdown.adQuality.max}
                              </span>
                            </div>
                          )}
                          {launchScoreBlockDetails.breakdown.keywordStrategy && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">关键词策略</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreBlockDetails.breakdown.keywordStrategy.score}/{launchScoreBlockDetails.breakdown.keywordStrategy.max}
                              </span>
                            </div>
                          )}
                          {launchScoreBlockDetails.breakdown.basicConfig && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">基础配置</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreBlockDetails.breakdown.basicConfig.score}/{launchScoreBlockDetails.breakdown.basicConfig.max}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 主要问题 */}
                    {launchScoreBlockDetails.issues && launchScoreBlockDetails.issues.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-amber-500" />
                          主要问题
                        </div>
                        <ul className="space-y-1">
                          {launchScoreBlockDetails.issues.slice(0, 5).map((issue, idx) => (
                            <li key={idx} className="text-xs text-gray-600 flex items-start gap-2 p-1.5 bg-white rounded">
                              <span className="text-amber-500 mt-0.5">•</span>
                              <span>{issue}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 改进建议 */}
                    {launchScoreBlockDetails.suggestions && launchScoreBlockDetails.suggestions.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          改进建议
                        </div>
                        <ul className="space-y-1">
                          {launchScoreBlockDetails.suggestions.slice(0, 5).map((suggestion, idx) => (
                            <li key={idx} className="text-xs text-gray-600 flex items-start gap-2 p-1.5 bg-white rounded">
                              <span className="text-green-500 mt-0.5">•</span>
                              <span>{suggestion}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* 成功后的提示 */}
                {publishStatus?.success && (
                  <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-green-800">
                        广告系列已成功发布，即将跳转...
                      </span>
                    </div>
                  </div>
                )}

                {/* 返回按钮（失败时显示） */}
                {publishStatus?.step === 'failed' && !publishing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPublishResult(false)}
                    className="w-full mt-2"
                  >
                    返回修改
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          /* Launch Score 评估面板 */
          <Card className="border-2 border-purple-200 bg-purple-50/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-4 h-4 text-purple-600" />
                  投放评分
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAnalyzeLaunchScore}
                    disabled={analyzingLaunchScore || loadingLaunchScore}
                    className="h-7 px-2"
                  >
                    {analyzingLaunchScore ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLaunchScoreExpanded(!launchScoreExpanded)}
                    className="h-7 px-2"
                  >
                    {launchScoreExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingLaunchScore ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                <span className="ml-2 text-sm text-gray-500">加载中...</span>
              </div>
            ) : launchScoreError ? (
              <Alert className="bg-red-50 border-red-200">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">{launchScoreError}</AlertDescription>
              </Alert>
            ) : !launchScoreData ? (
              <div className="text-center py-6">
                <Target className="w-10 h-10 mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500 mb-3">暂无评分数据</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAnalyzeLaunchScore}
                  disabled={analyzingLaunchScore}
                >
                  {analyzingLaunchScore ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <Target className="w-4 h-4 mr-2" />
                      开始评估
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 总分显示 */}
                <div className="flex items-center justify-between p-3 bg-white rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className={`text-3xl font-bold ${getScoreGrade(launchScoreData.totalScore).color}`}>
                      {launchScoreData.totalScore}
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">总分 / 100</div>
                      <Badge className={`${getScoreGrade(launchScoreData.totalScore).bgColor} ${getScoreGrade(launchScoreData.totalScore).color} border-0`}>
                        {getScoreGrade(launchScoreData.totalScore).grade} - {getScoreGrade(launchScoreData.totalScore).label}
                      </Badge>
                    </div>
                  </div>
                  {launchScoreData.totalScore < 60 && (
                    <Badge variant="destructive" className="text-xs">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      发布风险较高
                    </Badge>
                  )}
                </div>

                {/* 四维度评分 - 可折叠 */}
                {launchScoreExpanded && (
                  <TooltipProvider>
                    <div className="space-y-2">
                      {/* 投放可行性 */}
                      <div className="p-2 bg-white rounded border">
                        <div className="flex items-center justify-between mb-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs font-medium text-gray-700 cursor-help flex items-center gap-1">
                                {DIMENSION_CONFIG.launchViability.name}
                                <Info className="w-3 h-3 text-gray-400" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">{DIMENSION_CONFIG.launchViability.description}</p>
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-xs font-semibold">
                            {launchScoreData.launchViability?.score || 0}/{DIMENSION_CONFIG.launchViability.maxScore}
                          </span>
                        </div>
                        <Progress
                          value={getDimensionProgress(launchScoreData.launchViability, DIMENSION_CONFIG.launchViability.maxScore)}
                          className="h-1.5"
                        />
                      </div>

                      {/* 广告质量 */}
                      <div className="p-2 bg-white rounded border">
                        <div className="flex items-center justify-between mb-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs font-medium text-gray-700 cursor-help flex items-center gap-1">
                                {DIMENSION_CONFIG.adQuality.name}
                                <Info className="w-3 h-3 text-gray-400" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">{DIMENSION_CONFIG.adQuality.description}</p>
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-xs font-semibold">
                            {launchScoreData.adQuality?.score || 0}/{DIMENSION_CONFIG.adQuality.maxScore}
                          </span>
                        </div>
                        <Progress
                          value={getDimensionProgress(launchScoreData.adQuality, DIMENSION_CONFIG.adQuality.maxScore)}
                          className="h-1.5"
                        />
                      </div>

                      {/* 关键词策略 */}
                      <div className="p-2 bg-white rounded border">
                        <div className="flex items-center justify-between mb-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs font-medium text-gray-700 cursor-help flex items-center gap-1">
                                {DIMENSION_CONFIG.keywordStrategy.name}
                                <Info className="w-3 h-3 text-gray-400" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">{DIMENSION_CONFIG.keywordStrategy.description}</p>
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-xs font-semibold">
                            {launchScoreData.keywordStrategy?.score || 0}/{DIMENSION_CONFIG.keywordStrategy.maxScore}
                          </span>
                        </div>
                        <Progress
                          value={getDimensionProgress(launchScoreData.keywordStrategy, DIMENSION_CONFIG.keywordStrategy.maxScore)}
                          className="h-1.5"
                        />
                      </div>

                      {/* 基础配置 */}
                      <div className="p-2 bg-white rounded border">
                        <div className="flex items-center justify-between mb-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs font-medium text-gray-700 cursor-help flex items-center gap-1">
                                {DIMENSION_CONFIG.basicConfig.name}
                                <Info className="w-3 h-3 text-gray-400" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">{DIMENSION_CONFIG.basicConfig.description}</p>
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-xs font-semibold">
                            {launchScoreData.basicConfig?.score || 0}/{DIMENSION_CONFIG.basicConfig.maxScore}
                          </span>
                        </div>
                        <Progress
                          value={getDimensionProgress(launchScoreData.basicConfig, DIMENSION_CONFIG.basicConfig.maxScore)}
                          className="h-1.5"
                        />
                      </div>
                    </div>

                    {/* 主要问题和建议 */}
                    {launchScoreData.overallRecommendations && launchScoreData.overallRecommendations.length > 0 && (
                      <div className="pt-2 border-t">
                        <div className="text-xs font-medium text-gray-700 mb-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-amber-500" />
                          改进建议
                        </div>
                        <ul className="space-y-1">
                          {launchScoreData.overallRecommendations.slice(0, 3).map((rec: string, idx: number) => (
                            <li key={idx} className="text-xs text-gray-600 flex items-start gap-1.5">
                              <span className="text-amber-500 mt-0.5">•</span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </TooltipProvider>
                )}
              </div>
            )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Publish Status - 仅在非发布结果模式下显示 */}
      {!showPublishResult && publishStatus && (
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
                <span className="font-semibold">{selectedCreative.scoreBreakdown.relevance}</span>
              </div>
              <div>
                <span className="text-gray-600">质量:</span>{' '}
                <span className="font-semibold">{selectedCreative.scoreBreakdown.quality}</span>
              </div>
              <div>
                <span className="text-gray-600">吸引力:</span>{' '}
                <span className="font-semibold">{selectedCreative.scoreBreakdown.engagement}</span>
              </div>
              <div>
                <span className="text-gray-600">多样性:</span>{' '}
                <span className="font-semibold">{selectedCreative.scoreBreakdown.diversity}</span>
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
                <div className="text-sm font-mono bg-gray-50 p-2 rounded mt-1 break-all whitespace-pre-wrap">
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
              <div className="font-semibold">{selectedAccount.accountName || '广告账号'}</div>
              <div className="text-sm text-gray-600 font-mono mt-1">
                {selectedAccount.customerId}
              </div>
            </div>
            <Badge variant="default" className="bg-green-600">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              已验证
            </Badge>
          </div>
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

      {/* 🔥 暂停确认对话框 */}
      <Dialog open={showPauseConfirm} onOpenChange={setShowPauseConfirm}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>检测到已激活的广告系列</DialogTitle>
            <DialogDescription>
              {pauseConfirmMessage}
            </DialogDescription>
          </DialogHeader>

          {existingCampaigns.length > 0 && (
            <div className="my-4">
              <h4 className="text-sm font-medium mb-2">当前激活的广告系列：</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>广告系列名称</TableHead>
                    <TableHead>创意主题</TableHead>
                    <TableHead>预算</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingCampaigns.map((camp: any) => (
                    <TableRow key={camp.id}>
                      <TableCell className="font-medium">{camp.campaignName}</TableCell>
                      <TableCell>{camp.creativeTheme || '-'}</TableCell>
                      <TableCell>${camp.budgetAmount}</TableCell>
                      <TableCell>{new Date(camp.createdAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setShowPauseConfirm(false)}
              disabled={publishing}
            >
              取消
            </Button>
            <Button
              variant="default"
              onClick={handlePublishTogether}
              disabled={publishing}
            >
              {publishing ? '发布中...' : '直接发布（A/B测试）'}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmPauseAndPublish}
              disabled={publishing}
            >
              {publishing ? '暂停并发布中...' : '暂停旧系列并发布'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
