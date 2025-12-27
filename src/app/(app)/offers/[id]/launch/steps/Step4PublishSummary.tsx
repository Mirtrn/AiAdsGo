'use client'

/**
 * Step 4: Publish Summary and Confirmation
 * 汇总信息、确认发布
 *
 * v2.1 - 两列布局：左侧发布选项/按钮，右侧发布结果
 */

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
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
import { Rocket, CheckCircle2, AlertCircle, Loader2, TrendingUp, Settings, Link2 } from 'lucide-react'
import { CURRENCY_SYMBOLS } from '@/lib/currency'

interface Props {
  offer: any
  selectedCreative: any
  campaignConfig: any
  selectedAccount: any
  onPublishComplete: () => void
  onGoBackToStep3: () => void  // 🔥 新增：返回第3步的回调函数
}

export default function Step4PublishSummary({
  offer,
  selectedCreative,
  campaignConfig,
  selectedAccount,
  onPublishComplete,
  onGoBackToStep3  // 🔥 新增：返回第3步的回调函数
}: Props) {
  const [pauseOldCampaigns, setPauseOldCampaigns] = useState(false)
  const [enableCampaignImmediately, setEnableCampaignImmediately] = useState(false)  // 默认不启用
  const [publishing, setPublishing] = useState(false)

  // 🔧 修复(2025-12-24): 获取正确的货币符号
  const accountCurrency = selectedAccount?.currencyCode || 'USD'
  const currencySymbol = CURRENCY_SYMBOLS[accountCurrency] || '$'

  // 🔥 新增：调试日志 - 追踪selectedCreative中的否定关键词
  console.log(`[Step4] selectedCreative ID: ${selectedCreative.id}`)
  console.log(`[Step4] selectedCreative.negativeKeywords存在: ${!!selectedCreative.negativeKeywords}`)
  console.log(`[Step4] selectedCreative.negativeKeywords长度: ${selectedCreative.negativeKeywords?.length || 0}`)
  console.log(`[Step4] selectedCreative.negativeKeywords示例: ${selectedCreative.negativeKeywords?.slice(0, 5).join(', ') || 'NONE'}`)

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

  // 🔥 新增(2025-12-19)：Launch Score评分结果（成功时显示）
  const [launchScoreSuccess, setLaunchScoreSuccess] = useState<{
    totalScore: number
    breakdown: any
    overallRecommendations: string[]
  } | null>(null)

  // 🔥 新增：Launch Score 阻止详情
  const [launchScoreBlockDetails, setLaunchScoreBlockDetails] = useState<{
    launchScore: number
    threshold: number
    breakdown: any
    issues: string[]
    suggestions: string[]
    overallRecommendations: string[]  // 🔧 新增：整体建议字段
    canForcePublish?: boolean  // 🔥 新增：是否可以强制发布（60-80分时为true）
  } | null>(null)

  // 🔥 新增：确认暂停对话框相关state
  const [showPauseConfirm, setShowPauseConfirm] = useState(false)
  const [existingCampaigns, setExistingCampaigns] = useState<any[]>([])
  const [pauseConfirmMessage, setPauseConfirmMessage] = useState('')

  // 🔥 新增：强制发布确认对话框
  const [showForcePublishConfirm, setShowForcePublishConfirm] = useState(false)

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

  // 🔥 新增：重置发布状态（用于"返回修改"）- 现在会直接跳转到第3步
  const resetPublishState = () => {
    // 直接跳转到第3步，让用户修改广告配置
    onGoBackToStep3()
  }

  // 🔥 新增：强制发布处理函数（用于60-80分警告时）
  const handleForcePublish = async () => {
    try {
      setShowForcePublishConfirm(false)
      setPublishing(true)
      setShowPublishResult(true)
      setPublishSteps([])
      setLaunchScoreBlockDetails(null)

      addPublishStep('creating', '创建广告系列结构...', 'running')
      setPublishStatus({
        step: 'creating',
        message: '创建广告系列结构...',
        success: false
      })

      const response = await fetch('/api/campaigns/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'credentials': 'include'
        },
        body: JSON.stringify({
          offerId: offer.id,
          adCreativeId: selectedCreative.id,
          googleAdsAccountId: selectedAccount.id,
          campaignConfig: campaignConfig,
          pauseOldCampaigns: pauseOldCampaigns,
          enableCampaignImmediately: enableCampaignImmediately,
          forcePublish: true  // 🔥 关键：强制发布标志
        })
      })

      const data = await response.json()

      // 处理可能的错误
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_BLOCKED') {
        console.error('❌ Launch Score过低（无法强制发布）:', data)
        const details = data.details || {}

        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 60,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || []
        })

        addPublishStep('creating', `投放评分过低 (${details.launchScore || 0}分)，无法强制发布`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分过低，需要≥${details.threshold || 60}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      if (response.status === 422) {
        console.error('❌ 422错误:', data)
        setPublishing(false)
        addPublishStep('creating', data.message || '发布失败', 'failed')
        setPublishStatus({
          step: 'failed',
          message: data.error || data.message || '发布失败',
          success: false
        })
        return
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || '发布失败')
      }

      // 发布成功
      addPublishStep('creating', '创建广告系列结构', 'success')
      addPublishStep('syncing', '同步到Google Ads...', 'running')
      setPublishStatus({
        step: 'syncing',
        message: '同步到Google Ads...',
        success: false
      })

      await new Promise(resolve => setTimeout(resolve, 2000))

      addPublishStep('syncing', '同步完成', 'success')
      addPublishStep('completed', '广告系列已成功发布到Google Ads', 'success')
      setPublishStatus({
        step: 'completed',
        message: '发布成功！广告系列已上线',
        success: true
      })

      // 🔧 修复(2025-12-18): 发布成功后不再跳转，用户留在发布页面
      // onPublishComplete() 已改为空操作，不需要延迟调用
      onPublishComplete()
    } catch (error: any) {
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
          'Content-Type': 'application/json',
          'credentials': 'include'
        },
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
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || []  // 🔧 新增：整体建议
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

      // 🔥 处理Launch Score警告的情况（422状态码）- 显示建议但不阻止发布
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_WARNING') {
        console.warn('⚠️ Launch Score偏低:', data)
        const details = data.details || {}

        // 存储Launch Score警告详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 80,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || [],  // 🔧 新增：整体建议
          canForcePublish: details.canForcePublish === true  // 🔥 新增：标记可以强制发布
        })

        addPublishStep('creating', `投放评分偏低 (${details.launchScore || 0}分)，建议优化`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分偏低，建议≥${details.threshold || 80}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 处理需要确认暂停的情况（422状态码）- 使用新的数据结构
      if (response.status === 422 && data.action === 'CONFIRM_PAUSE_OLD_CAMPAIGNS') {
        console.log('⚠️ 需要用户确认是否暂停旧Campaign:', data)

        // 🔥 新数据结构：区分系统创建和用户手动创建的广告系列
        const ownCampaigns = data.existingCampaigns?.own || []
        const manualCampaigns = data.existingCampaigns?.manual || []

        // 合并所有需要暂停的广告系列
        const allCampaignsToPause = [...ownCampaigns, ...manualCampaigns]
        setExistingCampaigns(allCampaignsToPause)

        // 构建详细消息
        const totalCount = data.total?.all || allCampaignsToPause.length
        const ownCount = data.total?.own || ownCampaigns.length
        const manualCount = data.total?.manual || manualCampaigns.length

        const details = data.details || {}
        const detailText = details.own || details.manual
          ? `\n${details.own || ''}${details.own && details.manual ? '\n' : ''}${details.manual || ''}`
          : ''

        setPauseConfirmMessage(`${data.message || ''}${detailText}`)
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

      // 🔥 新增(2025-12-18)：422通用处理（兜底） - 处理任何422错误，即使action不匹配
      // 这确保即使后端返回意外的422状态和action值，前端也能正确处理而不会卡在加载中
      if (response.status === 422) {
        console.error('❌ 422错误（未识别的action或其他422错误）:', data)
        setPublishing(false)  // 🔥 关键：停止加载动画
        addPublishStep('creating', data.message || '发布失败', 'failed')
        setPublishStatus({
          step: 'failed',
          message: data.error || data.message || '发布失败',
          success: false
        })
        return
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || '发布失败')
      }

      // 🔥 修复(2025-12-19): 202 Accepted表示任务已提交到后台队列
      // 不能立即认为成功，必须轮询campaign.creation_status直到synced或failed
      if (response.status === 202) {
        console.log('📦 任务已提交到后台队列，开始轮询状态...')

        // 🔥 新增(2025-12-19)：保存Launch Score评分结果
        if (data.launchScore) {
          setLaunchScoreSuccess({
            totalScore: data.launchScore.totalScore,
            breakdown: data.launchScore.breakdown,
            overallRecommendations: data.launchScore.overallRecommendations || []
          })
          console.log(`📊 Launch Score评分: ${data.launchScore.totalScore}分`)
        }

        addPublishStep('creating', '创建广告系列结构', 'success')
        addPublishStep('syncing', '同步到Google Ads...(轮询中)', 'running')
        setPublishStatus({
          step: 'syncing',
          message: '正在后台处理，请稍候...',
          success: false
        })

        // 获取所有已创建的campaign ID
        const campaignIds: number[] = data.campaigns?.map((c: any) => c.id) || []
        console.log(`📊 需要轮询的Campaign数量: ${campaignIds.length}`)

        // 轮询直到所有campaign完成或失败（最多30次轮询，每次1秒）
        let allCompleted = false
        let pollCount = 0
        const maxPolls = 30
        const campaignStatuses: Record<number, { status: string; error?: string }> = {}

        while (!allCompleted && pollCount < maxPolls) {
          await new Promise(resolve => setTimeout(resolve, 1000))
          pollCount++

          // 检查每个campaign的状态
          let hasRunning = false
          for (const campaignId of campaignIds) {
            if (campaignStatuses[campaignId]) continue // 已完成，无需再查

            try {
              const statusRes = await fetch(`/api/offers/${offer.id}/campaigns/status?campaignId=${campaignId}`, {
                credentials: 'include'
              })

              if (statusRes.ok) {
                const statusData = await statusRes.json()
                const campaign = statusData.campaign

                if (campaign) {
                  console.log(`   Campaign ${campaignId}: ${campaign.creation_status}`)

                  if (campaign.creation_status === 'synced') {
                    campaignStatuses[campaignId] = { status: 'success' }
                  } else if (campaign.creation_status === 'failed') {
                    campaignStatuses[campaignId] = { status: 'failed', error: campaign.creation_error }
                  } else {
                    hasRunning = true
                  }
                }
              }
            } catch (e) {
              console.warn(`   查询Campaign ${campaignId}失败:`, e)
            }
          }

          allCompleted = !hasRunning

          if (!allCompleted) {
            const completed = Object.values(campaignStatuses).length
            console.log(`⏳ 轮询 #${pollCount}/${maxPolls}: 已完成 ${completed}/${campaignIds.length} 个campaign`)
          }
        }

        // 判断最终结果
        const failedCampaigns = Object.entries(campaignStatuses)
          .filter(([_, s]) => s.status === 'failed')
          .map(([id, _]) => id)

        const successCount = Object.values(campaignStatuses).filter(s => s.status === 'success').length

        if (failedCampaigns.length > 0) {
          // 部分或全部失败
          const errorMsg = `${failedCampaigns.length}个广告系列发布失败`
          console.error(`❌ ${errorMsg}`)
          addPublishStep('syncing', errorMsg, 'failed')
          setPublishStatus({
            step: 'failed',
            message: errorMsg,
            success: false
          })
          setPublishing(false)
          return
        }

        if (pollCount >= maxPolls && successCount === 0) {
          // 超时未完成
          console.error('❌ 广告系列处理超时')
          addPublishStep('syncing', '处理超时，请稍后检查发布结果', 'failed')
          setPublishStatus({
            step: 'failed',
            message: '处理超时，请稍后检查发布结果',
            success: false
          })
          setPublishing(false)
          return
        }

        // 全部成功
        console.log(`✅ 所有${successCount}个广告系列发布成功`)
        addPublishStep('syncing', '同步完成', 'success')
        addPublishStep('completed', `${successCount}个广告系列已成功发布到Google Ads`, 'success')
        setPublishStatus({
          step: 'completed',
          message: '发布成功！广告系列已上线',
          success: true
        })
        onPublishComplete()
        return
      }
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
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || []  // 🔧 新增：整体建议
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

      // 🔥 处理Launch Score警告的情况 - 显示建议但不阻止发布 (handleConfirmPauseAndPublish)
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_WARNING') {
        console.warn('⚠️ Launch Score偏低:', data)
        const details = data.details || {}

        // 存储Launch Score警告详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 80,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || [],  // 🔧 新增：整体建议
          canForcePublish: details.canForcePublish === true  // 🔥 新增：标记可以强制发布
        })

        addPublishStep('pausing', `已暂停${existingCampaigns.length}个旧广告系列`, 'success')
        addPublishStep('creating', `投放评分偏低 (${details.launchScore || 0}分)，建议优化`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分偏低，建议≥${details.threshold || 80}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 新增(2025-12-18)：422通用处理（兜底）- 在handleConfirmPauseAndPublish中也需要
      if (response.status === 422) {
        console.error('❌ 422错误（未识别的action或其他422错误）:', data)
        setPublishing(false)  // 🔥 关键：停止加载动画
        addPublishStep('pausing', `已暂停${existingCampaigns.length}个旧广告系列`, 'success')
        addPublishStep('creating', data.message || '发布失败', 'failed')
        setPublishStatus({
          step: 'failed',
          message: data.error || data.message || '发布失败',
          success: false
        })
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

      // 🔧 修复(2025-12-18): 发布成功后不再跳转，用户留在发布页面
      // onPublishComplete() 已改为空操作，不需要延迟调用
      onPublishComplete()
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
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || []  // 🔧 新增：整体建议
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

      // 🔥 处理Launch Score警告的情况 - 显示建议但不阻止发布 (handlePublishTogether)
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_WARNING') {
        console.warn('⚠️ Launch Score偏低:', data)
        const details = data.details || {}

        // 存储Launch Score警告详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 80,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || [],  // 🔧 新增：整体建议
          canForcePublish: details.canForcePublish === true  // 🔥 新增：标记可以强制发布
        })

        addPublishStep('creating', `投放评分偏低 (${details.launchScore || 0}分)，建议优化`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分偏低，建议≥${details.threshold || 80}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 新增(2025-12-18)：422通用处理（兜底）- 在handlePublishTogether中也需要
      if (response.status === 422) {
        console.error('❌ 422错误（未识别的action或其他422错误）:', data)
        setPublishing(false)  // 🔥 关键：停止加载动画
        addPublishStep('creating', data.message || '发布失败', 'failed')
        setPublishStatus({
          step: 'failed',
          message: data.error || data.message || '发布失败',
          success: false
        })
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

      // 🔧 修复(2025-12-18): 发布成功后不再跳转，用户留在发布页面
      // onPublishComplete() 已改为空操作，不需要延迟调用
      onPublishComplete()
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

      {/* 🚀 两列布局：左侧发布选项，右侧发布结果 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左列：Publish Options & Button */}
        <Card className="border-2 border-blue-200 bg-blue-50/50 lg:h-[400px] flex flex-col">
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Rocket className="w-4 h-4 text-blue-600" />
              发布选项
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
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

        {/* 右列：发布结果卡片 - 始终显示 */}
        <Card className={`border-2 lg:h-[400px] flex flex-col ${
          publishStatus?.success
            ? 'border-green-200 bg-green-50/30'
            : publishStatus?.step === 'failed'
            ? 'border-red-200 bg-red-50/30'
            : showPublishResult
            ? 'border-blue-200 bg-blue-50/30'
            : 'border-gray-200 bg-gray-50/30'
        }`}>
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              {publishStatus?.success ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : publishStatus?.step === 'failed' ? (
                <AlertCircle className="w-4 h-4 text-red-600" />
              ) : showPublishResult ? (
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              ) : (
                <AlertCircle className="w-4 h-4 text-gray-400" />
              )}
              发布结果
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
            <div className="space-y-4">
              {/* 等待发布状态 - 显示准备信息 */}
              {!showPublishResult && publishSteps.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full py-8">
                  <div className="text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
                      <Rocket className="w-8 h-8 text-gray-400" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">准备发布数据</div>
                      <div className="text-xs text-gray-500 space-y-1">
                        <div className="flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                          <span>已生成广告创意</span>
                        </div>
                        <div className="flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                          <span>已关联Google Ads账号</span>
                        </div>
                        <div className="flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                          <span>已配置广告系列参数</span>
                        </div>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-gray-200 w-full">
                      <div className="text-xs text-gray-500 text-center">
                        已暂停 <span className="font-semibold text-gray-700">0</span> 个广告系列
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 发布中/已发布状态 - 显示步骤列表 */}
              {(showPublishResult || publishSteps.length > 0) && (
                <>
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

                    {/* 主要问题 - 🔥 添加中英文翻译 */}
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
                      <div className="mb-3">
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

                    {/* 🔧 新增：整体建议 */}
                    {launchScoreBlockDetails.overallRecommendations && launchScoreBlockDetails.overallRecommendations.length > 0 && (
                      <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-blue-600" />
                          整体优化建议
                        </div>
                        <ul className="space-y-1">
                          {launchScoreBlockDetails.overallRecommendations.slice(0, 3).map((rec, idx) => (
                            <li key={idx} className="text-xs text-blue-700 flex items-start gap-2">
                              <span className="text-blue-500 mt-0.5">•</span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 返回修改按钮和强制发布按钮 */}
                    <div className="mt-4 pt-3 border-t border-red-200 space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={resetPublishState}
                        className="w-full"
                      >
                        返回修改配置
                      </Button>
                      {/* 🔥 新增：强制发布按钮（仅在60-80分警告时显示） */}
                      {launchScoreBlockDetails.canForcePublish && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setShowForcePublishConfirm(true)}
                          className="w-full"
                        >
                          强制发布（已确认风险）
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* 🔥 新增(2025-12-19)：Launch Score评分结果（成功时显示） */}
                {launchScoreSuccess && (
                  <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    {/* 标题和总分 */}
                    <div className="flex items-center justify-between mb-3 pb-3 border-b border-blue-200">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-blue-600" />
                        <span className="text-sm font-semibold text-blue-800">
                          投放评分
                        </span>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${getScoreColor(launchScoreSuccess.totalScore)}`}>
                          {launchScoreSuccess.totalScore}
                          <span className="text-sm font-normal text-gray-500">分</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {launchScoreSuccess.totalScore >= 80 ? '优秀' : '良好'}
                        </div>
                      </div>
                    </div>

                    {/* 各维度得分 */}
                    {launchScoreSuccess.breakdown && Object.keys(launchScoreSuccess.breakdown).length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2">各维度得分</div>
                        <div className="grid grid-cols-2 gap-2">
                          {launchScoreSuccess.breakdown.launchViability && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">投放可行性</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreSuccess.breakdown.launchViability.score}/{launchScoreSuccess.breakdown.launchViability.max}
                              </span>
                            </div>
                          )}
                          {launchScoreSuccess.breakdown.adQuality && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">广告质量</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreSuccess.breakdown.adQuality.score}/{launchScoreSuccess.breakdown.adQuality.max}
                              </span>
                            </div>
                          )}
                          {launchScoreSuccess.breakdown.keywordStrategy && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">关键词策略</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreSuccess.breakdown.keywordStrategy.score}/{launchScoreSuccess.breakdown.keywordStrategy.max}
                              </span>
                            </div>
                          )}
                          {launchScoreSuccess.breakdown.basicConfig && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">基础配置</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreSuccess.breakdown.basicConfig.score}/{launchScoreSuccess.breakdown.basicConfig.max}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 优化建议（如果有） */}
                    {launchScoreSuccess.overallRecommendations && launchScoreSuccess.overallRecommendations.length > 0 && (
                      <div className="mt-3 p-3 bg-white rounded-lg border">
                        <div className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-blue-600" />
                          优化建议
                        </div>
                        <ul className="space-y-1">
                          {launchScoreSuccess.overallRecommendations.slice(0, 3).map((rec, idx) => (
                            <li key={idx} className="text-xs text-blue-700 flex items-start gap-2">
                              <span className="text-blue-500 mt-0.5">•</span>
                              <span>{rec}</span>
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
                        广告系列已成功发布
                      </span>
                    </div>
                  </div>
                )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
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
          {/* Score Display - 使用7维度新评分系统 */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <div className="text-sm text-gray-600 mb-1">综合评分</div>
              <div className={`text-3xl font-bold ${getScoreColor(selectedCreative.score)}`}>
                {selectedCreative.score.toFixed(1)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {/* 显示7个维度 */}
              {selectedCreative.adStrength?.dimensions ? (
                <>
                  <div>
                    <span className="text-gray-600">相关性:</span>{' '}
                    <span className="font-semibold">{selectedCreative.adStrength.dimensions.relevance.score}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">质量:</span>{' '}
                    <span className="font-semibold">{selectedCreative.adStrength.dimensions.quality.score}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">吸引力:</span>{' '}
                    <span className="font-semibold">{selectedCreative.adStrength.dimensions.completeness.score}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">多样性:</span>{' '}
                    <span className="font-semibold">{selectedCreative.adStrength.dimensions.diversity.score}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">合规性:</span>{' '}
                    <span className="font-semibold">{selectedCreative.adStrength.dimensions.compliance.score}</span>
                  </div>
                  {selectedCreative.adStrength.dimensions.brandSearchVolume && (
                    <div>
                      <span className="text-gray-600">品牌影响力:</span>{' '}
                      <span className="font-semibold">{selectedCreative.adStrength.dimensions.brandSearchVolume.score}</span>
                    </div>
                  )}
                  {selectedCreative.adStrength.dimensions.competitivePositioning && (
                    <div>
                      <span className="text-gray-600">竞争定位:</span>{' '}
                      <span className="font-semibold">{selectedCreative.adStrength.dimensions.competitivePositioning.score}</span>
                    </div>
                  )}
                </>
              ) : (
                /* 降级到旧的5维度显示（包含clarity） */
                <>
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
                  <div>
                    <span className="text-gray-600">清晰度:</span>{' '}
                    <span className="font-semibold">{selectedCreative.scoreBreakdown.clarity}</span>
                  </div>
                </>
              )}
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
                  {currencySymbol}{campaignConfig.budgetAmount.toFixed(2)} /{' '}
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
                <div className="font-semibold mt-1">{currencySymbol}{campaignConfig.maxCpcBid.toFixed(2)}</div>
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
                      <TableCell>{currencySymbol}{camp.budgetAmount}</TableCell>
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

      {/* 🔥 新增：强制发布确认对话框（60-80分警告时）*/}
      <Dialog open={showForcePublishConfirm} onOpenChange={setShowForcePublishConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              确认强制发布
            </DialogTitle>
            <DialogDescription>
              该Offer的投放评分为 {launchScoreBlockDetails?.launchScore}分，低于建议值{launchScoreBlockDetails?.threshold}分
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
              <h4 className="text-sm font-semibold text-amber-900 mb-2">⚠️ 风险提示：</h4>
              <ul className="text-xs text-amber-800 space-y-1">
                <li>• 投放评分较低可能导致广告表现不佳</li>
                <li>• 建议先优化创意或配置后再发布</li>
                <li>• 强制发布需要自行承担风险</li>
              </ul>
            </div>

            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">💡 建议：</h4>
              <ul className="text-xs text-blue-800 space-y-1">
                {launchScoreBlockDetails?.suggestions?.slice(0, 3).map((suggestion: string, idx: number) => (
                  <li key={idx}>• {suggestion}</li>
                ))}
              </ul>
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowForcePublishConfirm(false)}
              disabled={publishing}
            >
              返回修改
            </Button>
            <Button
              variant="destructive"
              onClick={handleForcePublish}
              disabled={publishing}
            >
              {publishing ? '发布中...' : '确认强制发布'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
