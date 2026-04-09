'use client'

/**
 * Step 1: Ad Creative Generation
 * 生成广告创意、评分、对比分析
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RefreshCw, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, ExternalLink, Wand2, HelpCircle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { showError, showSuccess } from '@/lib/toast-utils'
import ScoreRadarChart from '@/components/charts/ScoreRadarChart'
import { BonusScoreCard } from '@/components/BonusScoreCard'
import { ConversionFeedbackForm } from '@/components/ConversionFeedbackForm'
import { CreativeTypeProgress } from '@/components/CreativeTypeProgress'

interface Props {
  offer: any
  onCreativeSelected: (creative: any) => void
  selectedCreative: any | null
}

interface KeywordWithVolume {
  keyword: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
  // 🔥 修复(2025-12-18): 添加matchType字段确保前后端类型定义一致
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD' | 'BROAD_MATCH_MODIFIER'
  lowTopPageBid?: number
  highTopPageBid?: number
  source?: 'AI_GENERATED' | 'KEYWORD_EXPANSION' | 'MERGED'
  intentCategory?: string
}

interface HeadlineAsset {
  text: string
  type?: 'brand' | 'product' | 'promo' | 'cta' | 'urgency'
  length?: number
  keywords?: string[]
  hasNumber?: boolean
  hasUrgency?: boolean
}

interface DescriptionAsset {
  text: string
  type?: 'value' | 'cta'
  length?: number
  hasCTA?: boolean
  keywords?: string[]
}

interface QualityMetrics {
  headline_diversity_score?: number
  keyword_relevance_score?: number
}

interface Creative {
  id: number
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  keywordsWithVolume?: KeywordWithVolume[]
  negativeKeywords?: string[]  // 🎯 新增：否定关键词
  callouts?: string[]
  sitelinks?: Array<{
    text: string
    url: string
    description?: string
  }>
  // 🔧 修复(2025-12-11): 与API响应保持一致 - camelCase
  finalUrl: string
  score: number
  scoreBreakdown: {
    relevance: number
    quality: number
    engagement: number
    diversity: number
    clarity: number
  }
  scoreExplanation: string
  // 🔧 修复(2025-12-11): snake_case → camelCase
  generationRound: number
  theme: string
  aiModel: string

  // 🆕 关键词分桶字段 (v4.10)
  // 🔥 2025-12-22: 添加桶D(高购买意图)支持
  keywordBucket?: 'A' | 'B' | 'C' | 'D' | 'S'  // 关键词桶标识: A=品牌, B=场景, C=功能, D=高购买意图, S=综合
  bucketIntent?: string            // 创意类型说明（KISS-3：A=品牌/信任，B=场景+功能，D=转化/价值·全量关键词）
  isSynthetic?: boolean            // 是否为综合创意

  // AD_STRENGTH新增字段
  headlinesWithMetadata?: HeadlineAsset[]
  descriptionsWithMetadata?: DescriptionAsset[]
  qualityMetrics?: QualityMetrics
  adStrength?: {
    rating: 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT' | 'PENDING'
    score: number
    isExcellent: boolean
    dimensions: {
      diversity: { score: number; weight: number; details: any }
      relevance: { score: number; weight: number; details: any }
      completeness: { score: number; weight: number; details: any }
      quality: { score: number; weight: number; details: any }
      compliance: { score: number; weight: number; details: any }
      brandSearchVolume?: { score: number; weight: number; details: any }
      competitivePositioning?: { score: number; weight: number; details: any }
    }
    suggestions: string[]
  }
  optimization?: {
    attempts: number
    targetRating: string
    achieved: boolean
    history: Array<{
      attempt: number
      rating: string
      score: number
      suggestions: string[]
    }>
  }
}

type GenerationProgressState = {
  step: string
  progress: number
  message: string
  details?: any
}

type NormalizedCreativeBucket = 'A' | 'B' | 'D'

const CREATIVE_BUCKET_ORDER: NormalizedCreativeBucket[] = ['A', 'B', 'D']

const CREATIVE_BUCKET_META: Record<NormalizedCreativeBucket, {
  shortLabel: string
  fullLabel: string
  buttonLabel: string
}> = {
  A: {
    shortLabel: '品牌/信任',
    fullLabel: '品牌/信任导向',
    buttonLabel: '第 1 个创意：品牌/信任'
  },
  B: {
    shortLabel: '场景+功能',
    fullLabel: '场景+功能导向',
    buttonLabel: '第 2 个创意：场景+功能'
  },
  D: {
    shortLabel: '转化/价值',
    fullLabel: '转化/价值导向'
      + '·全量关键词',
    buttonLabel: '第 3 个创意：转化/价值'
  }
}

const normalizeCreativeBucket = (bucket: string | null | undefined): NormalizedCreativeBucket | null => {
  const upper = String(bucket || '').toUpperCase()
  if (upper === 'A') return 'A'
  if (upper === 'B' || upper === 'C') return 'B'
  if (upper === 'D' || upper === 'S') return 'D'
  return null
}

const getNextCreativeBucket = (generatedBuckets: string[]): NormalizedCreativeBucket | null => {
  const generatedBucketSet = new Set(
    generatedBuckets
      .map(bucket => normalizeCreativeBucket(bucket))
      .filter((bucket): bucket is NormalizedCreativeBucket => bucket !== null)
  )

  return CREATIVE_BUCKET_ORDER.find(bucket => !generatedBucketSet.has(bucket)) ?? null
}

const formatElapsedTime = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`

// 格式化搜索量显示
const formatSearchVolume = (volume: number): string => {
  if (volume === 0) return '-'
  if (volume < 1000) return volume.toString()
  if (volume < 10000) return `${(volume / 1000).toFixed(1)}K`
  if (volume < 1000000) return `${Math.round(volume / 1000)}K`
  return `${(volume / 1000000).toFixed(1)}M`
}

// 竞争度颜色映射
const getCompetitionColor = (competition?: string): string => {
  if (!competition) return 'text-gray-500'
  const comp = competition.toUpperCase()
  if (comp === 'LOW') return 'text-green-600'
  if (comp === 'MEDIUM') return 'text-yellow-600'
  if (comp === 'HIGH') return 'text-red-600'
  return 'text-gray-500'
}

// Ad Strength评级颜色和样式
const getAdStrengthColor = (rating: string) => {
  switch (rating) {
    case 'EXCELLENT':
      return 'text-green-600 bg-green-50 border-green-200'
    case 'GOOD':
      return 'text-blue-600 bg-blue-50 border-blue-200'
    case 'AVERAGE':
      return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    case 'POOR':
      return 'text-red-600 bg-red-50 border-red-200'
    default:
      return 'text-gray-600 bg-gray-50 border-gray-200'
  }
}

const getAdStrengthBadge = (rating: string) => {
  switch (rating) {
    case 'EXCELLENT':
      return { label: '优秀', variant: 'default' as const, className: 'bg-green-600 hover:bg-green-700' }
    case 'GOOD':
      return { label: '良好', variant: 'default' as const, className: 'bg-blue-600 hover:bg-blue-700' }
    case 'AVERAGE':
      return { label: '一般', variant: 'secondary' as const, className: 'bg-yellow-500 hover:bg-yellow-600' }
    case 'POOR':
      return { label: '待优化', variant: 'destructive' as const }
    default:
      return { label: '待评估', variant: 'outline' as const }
  }
}

const getAdStrengthLabel = (rating: string) => {
  const labels: Record<string, string> = {
    'EXCELLENT': '优秀',
    'GOOD': '良好',
    'AVERAGE': '一般',
    'POOR': '待优化',
    'PENDING': '待评估'
  }
  return labels[rating] || rating
}

// 错误类型与解决方案映射
const ERROR_SOLUTIONS: Record<string, { title: string; description: string; action?: string; actionLabel?: string }> = {
  '前置校验失败': {
    title: '数据质量问题',
    description: 'Offer 的网站数据抓取可能失败，导致品牌或关键词信息不正确。建议返回 Offer 详情页重新抓取数据，或检查推广链接是否可正常访问。',
    action: 'offer-detail',
    actionLabel: '返回Offer详情'
  },
  '品牌描述': {
    title: '品牌信息不匹配',
    description: '检测到品牌描述与录入品牌不一致，可能是网站抓取失败导致AI返回了错误的品牌信息。建议重新创建 Offer 或检查推广链接。',
    action: 'offer-detail',
    actionLabel: '返回Offer详情'
  },
  'unknown': {
    title: '关键词数据异常',
    description: '检测到过多无效关键词，可能是网站抓取失败。建议返回 Offer 详情页检查数据，或重新创建 Offer。',
    action: 'offer-detail',
    actionLabel: '返回Offer详情'
  },
  '无可用关键词': {
    title: '关键词数据不足',
    description: '当前Offer还没有关键词数据，网站可能未能成功抓取到产品关键词。建议重新创建Offer并确保网站可以正常访问抓取。',
    action: 'offer-detail',
    actionLabel: '返回Offer详情'
  },
  'AI配置缺失': {
    title: 'AI 提供商未配置',
    description: '当前账号尚未配置 AI 提供商。请前往设置页面，选择 AI 提供商（LiteLLM Gateway / Gemini / OpenAI / Claude）并填写对应的 API Key 后重试。',
    action: 'settings',
    actionLabel: '前往设置'
  },
  '尚未配置任何 AI 提供商': {
    title: 'AI 提供商未配置',
    description: '当前账号尚未配置 AI 提供商。请前往设置页面，选择 AI 提供商（LiteLLM Gateway / Gemini / OpenAI / Claude）并填写对应的 API Key 后重试。',
    action: 'settings',
    actionLabel: '前往设置'
  },
  '关键词池创建失败': {
    title: '关键词准备失败',
    description: '无法创建关键词池，网站数据抓取可能失败。建议重新创建Offer并确保网站可以正常访问抓取。',
    action: 'offer-detail',
    actionLabel: '返回Offer详情'
  },
  '请先生成关键词': {
    title: '需要先完成数据抓取',
    description: '创意生成需要关键词数据支持。网站可能未能成功抓取，建议重新创建Offer并确保网站可以正常访问抓取。',
    action: 'offer-detail',
    actionLabel: '返回Offer详情'
  },
  'Offer信息抓取失败': {
    title: '网站数据抓取失败',
    description: 'Offer的网站数据抓取失败，无法生成创意。请返回重新创建Offer或联系管理员检查代理配置。',
    action: 'offer-detail',
    actionLabel: '返回Offer详情'
  },
  '网站数据抓取失败': {
    title: '数据获取失败',
    description: '无法获取推广链接的网站数据。请检查推广链接是否有效，或稍后重试。',
    action: 'retry',
    actionLabel: '重新尝试'
  },
  '代理配置': {
    title: '代理配置问题',
    description: '代理服务配置异常或不可用。请检查设置中的代理URL配置是否正确。',
    action: 'settings',
    actionLabel: '检查代理配置'
  },
  'INSUFFICIENT_BALANCE': {
    title: '中转服务余额不足',
    description: '当前 Gemini 中转账户余额不足，无法生成创意。请前往设置页面充值/更换有余额的 API Key，或切换到 Gemini 官方 API 后重试。',
    action: 'settings',
    actionLabel: '前往设置'
  },
  '按量余额不足': {
    title: '中转服务余额不足',
    description: '当前 Gemini 中转账户余额不足，无法生成创意。请前往设置页面充值/更换有余额的 API Key，或切换到 Gemini 官方 API 后重试。',
    action: 'settings',
    actionLabel: '前往设置'
  },
  '402 Payment Required': {
    title: '中转服务余额不足',
    description: '当前 Gemini 中转账户余额不足，无法生成创意。请前往设置页面充值/更换有余额的 API Key，或切换到 Gemini 官方 API 后重试。',
    action: 'settings',
    actionLabel: '前往设置'
  },
  '第三方中转账户余额不足': {
    title: '中转服务余额不足',
    description: '当前 Gemini 中转账户余额不足，无法生成创意。请前往设置页面充值/更换有余额的 API Key，或切换到 Gemini 官方 API 后重试。',
    action: 'settings',
    actionLabel: '前往设置'
  },
  '余额不足': {
    title: '中转服务余额不足',
    description: '当前 Gemini 中转账户余额不足，无法生成创意。请前往设置页面充值/更换有余额的 API Key，或切换到 Gemini 官方 API 后重试。',
    action: 'settings',
    actionLabel: '前往设置'
  },
  'quota': {
    title: 'API配额已用完',
    description: 'Gemini API 每日免费配额已用完。请等待配额重置（通常在第二天），或前往设置页面升级到付费计划。',
    action: 'settings',
    actionLabel: '查看配置'
  },
  'RESOURCE_EXHAUSTED': {
    title: 'API配额已用完',
    description: 'Gemini API 配额已耗尽。请等待配额重置或升级到付费计划。',
    action: 'settings',
    actionLabel: '查看配置'
  },
  'UPSTREAM_ERROR': {
    title: '上游服务暂不可用',
    description: 'AI 上游服务当前不稳定或暂不可用，请稍后再试；若频繁出现，可更换时间段重试。',
    action: 'retry',
    actionLabel: '重新尝试'
  },
  '上游服务暂不可用': {
    title: '上游服务暂不可用',
    description: 'AI 上游服务当前不稳定或暂不可用，请稍后再试；若频繁出现，可更换时间段重试。',
    action: 'retry',
    actionLabel: '重新尝试'
  },
  '超过最大重试次数': {
    title: 'AI服务繁忙',
    description: 'Gemini API 连续重试仍失败（超过最大重试次数）。可能是服务限流、网络波动或临时故障。建议稍后再试，必要时在设置中切换服务商或检查API Key。',
    action: 'retry',
    actionLabel: '重新尝试'
  },
  'Gemini API调用失败': {
    title: 'AI 服务调用失败',
    description: 'AI 服务调用失败，请稍后重试；如果持续失败，可能是服务商临时故障或网络波动。',
    action: 'retry',
    actionLabel: '重新尝试'
  },
  'Gemini': {
    title: 'AI服务配置问题',
    description: 'Gemini API 配置异常或配额不足。请检查 API Key 是否有效。',
    action: 'settings',
    actionLabel: '检查AI配置'
  },
  'AI服务不可用': {
    title: 'AI服务暂时不可用',
    description: '当前AI服务繁忙或配置异常，请稍后重试或联系管理员检查配置。',
    action: 'settings',
    actionLabel: '检查配置'
  },
  'API Key': {
    title: 'API配置问题',
    description: 'API Key 未配置或已失效。请在设置页面检查并更新相关配置。',
    action: 'settings',
    actionLabel: '前往设置'
  },
  '超时': {
    title: '生成超时',
    description: '创意生成时间过长，可能是网络问题或AI服务响应缓慢。请稍后重试。',
    action: 'retry',
    actionLabel: '重新尝试'
  },
  'timeout': {
    title: '连接超时',
    description: '广告创意生成需要较长时间，连接已超时。任务仍在后台继续处理，请刷新页面或稍后查看结果。',
    action: 'retry',
    actionLabel: '刷新查看结果'
  },
  '网络': {
    title: '网络问题',
    description: '网络连接不稳定或已断开。请检查网络连接后重试。',
    action: 'retry',
    actionLabel: '重新尝试'
  },
  '未授权': {
    title: '登录已过期',
    description: '您的登录状态已过期，请重新登录后再试。',
    action: 'login',
    actionLabel: '重新登录'
  },
  'Unauthorized': {
    title: '登录已过期',
    description: '您的登录状态已过期，请重新登录后再试。',
    action: 'login',
    actionLabel: '重新登录'
  }
}

// 匹配错误信息到解决方案
const getErrorSolution = (errorMessage: string) => {
  for (const [key, solution] of Object.entries(ERROR_SOLUTIONS)) {
    if (errorMessage.includes(key)) {
      return solution
    }
  }
  // 默认解决方案
  return {
    title: '生成失败',
    description: errorMessage || '创意生成过程中出现错误，请稍后重试。',
    action: 'retry',
    actionLabel: '重新尝试'
  }
}

function CreativeGenerationOverviewPanel(props: {
  generatedBuckets: string[]
  activeBucket: NormalizedCreativeBucket | null
  generationProgress: GenerationProgressState | null
  generating: boolean
  elapsedTime: number
  sseTimeout: boolean
  taskStatus: 'running' | 'completed' | 'failed' | null
  offer: any
}) {
  const {
    generatedBuckets,
    activeBucket,
    generationProgress,
    generating,
    elapsedTime,
    sseTimeout,
    taskStatus,
    offer
  } = props
  const completedCount = generatedBuckets.length
  const isGenerationLimitReached = completedCount >= CREATIVE_BUCKET_ORDER.length
  const activeProgress = Math.max(0, Math.min(100, generationProgress?.progress ?? 0))
  const hasActiveGeneration = Boolean(activeBucket && (generating || taskStatus === 'running' || generationProgress))
  const isCompletedIdle = isGenerationLimitReached && !hasActiveGeneration
  const overallProgress = hasActiveGeneration
    ? Math.round(((completedCount + activeProgress / 100) / CREATIVE_BUCKET_ORDER.length) * 100)
    : Math.round((completedCount / CREATIVE_BUCKET_ORDER.length) * 100)
  const currentGenerationIndex = activeBucket ? completedCount + 1 : null
  const currentBucketMeta = activeBucket ? CREATIVE_BUCKET_META[activeBucket] : null
  const attemptText = generationProgress?.details?.attempt
    ? `第 ${generationProgress.details.attempt} / ${generationProgress.details.maxRetries || 3} 次尝试`
    : null
  const statusText = hasActiveGeneration
    ? `已生成 ${completedCount}/3，正在生成第 ${currentGenerationIndex} 个创意`
    : isGenerationLimitReached
      ? '已完成 3/3 个创意类型'
      : completedCount === 0
        ? '尚未开始生成，请手动逐个生成 3 个创意类型'
        : `已生成 ${completedCount}/3，下一个是第 ${completedCount + 1} 个创意`
  const toneClassName = sseTimeout && taskStatus === 'running'
    ? 'border-amber-200 bg-amber-50/80'
    : hasActiveGeneration
      ? 'border-purple-200 bg-gradient-to-br from-purple-50 via-white to-blue-50'
      : isGenerationLimitReached
        ? 'border-green-200 bg-green-50/70'
        : 'border-gray-200 bg-white'
  const statusBadgeClassName = sseTimeout && taskStatus === 'running'
    ? 'bg-amber-100 text-amber-700 border-amber-200'
    : hasActiveGeneration
      ? 'bg-purple-100 text-purple-700 border-purple-200'
      : isGenerationLimitReached
        ? 'bg-green-100 text-green-700 border-green-200'
        : 'bg-gray-100 text-gray-700 border-gray-200'
  const messageText = sseTimeout && taskStatus === 'running'
    ? '连接已中断，任务仍在后台继续，系统正在自动轮询恢复状态。'
    : hasActiveGeneration
      ? generationProgress?.message || '正在准备生成任务...'
      : isGenerationLimitReached
        ? '3 个创意类型均已生成，可直接对比并选择。'
        : completedCount > 0
          ? `下一次将生成${CREATIVE_BUCKET_META[getNextCreativeBucket(generatedBuckets) || 'A'].fullLabel}。`
          : '建议按 A → B → D 的顺序逐个生成，便于对比不同投放意图。'

  return (
    <Card className={toneClassName}>
      <CardContent className={`p-4 ${isCompletedIdle ? 'space-y-3' : 'space-y-4'}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={statusBadgeClassName}>
                {hasActiveGeneration ? '进行中' : isGenerationLimitReached ? '已完成' : '待开始'}
              </Badge>
              <span className="text-sm text-gray-500">Step 1 / 4</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">创意生成总进度</h3>
              <p className="text-sm text-gray-600">{statusText}</p>
            </div>
          </div>

          <div className="min-w-[150px] rounded-xl border border-white/70 bg-white/90 px-3 py-2 text-right shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Overall</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{overallProgress}%</div>
            <div className="text-xs text-gray-500">{completedCount} / 3 已完成</div>
          </div>
        </div>

        <div className={`space-y-1.5 ${isCompletedIdle ? 'pb-0.5' : ''}`}>
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>整体完成度</span>
            <span className="font-medium text-gray-900">{overallProgress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-600 via-blue-500 to-cyan-500 transition-all duration-500 ease-out"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>

        {!isCompletedIdle && (
          <CreativeTypeProgress
            generatedBuckets={generatedBuckets}
            activeBucket={activeBucket}
            offer={offer}
          />
        )}

        {isCompletedIdle ? (
          <div className="rounded-xl border border-gray-200 bg-white/80 px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                全部创意已生成完成，可直接对比并选择
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">A 品牌/信任</span>
                <span className="rounded-md bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">B 场景+功能</span>
                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">D 转化/价值</span>
              </div>
              <div className="text-sm text-gray-600">已用时 {formatElapsedTime(elapsedTime)}</div>
            </div>
            <div className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-1.5 text-sm text-amber-700">
              <span className="font-medium">已达生成上限：</span>
              需重生请先删除对应类型创意。
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white/80 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <div className="font-medium text-gray-900">
                {hasActiveGeneration && currentBucketMeta
                  ? `当前正在生成第 ${currentGenerationIndex} 个创意`
                  : '当前任务状态'}
              </div>
              {hasActiveGeneration && currentBucketMeta && (
                <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                  {currentBucketMeta.shortLabel}
                </Badge>
              )}
              <span className="text-gray-600">已用时 {formatElapsedTime(elapsedTime)}</span>
              <span className="text-gray-600">进度 {hasActiveGeneration ? `${activeProgress}%` : isGenerationLimitReached ? '100%' : `${overallProgress}%`}</span>
              <span className="text-gray-600">阶段 {generationProgress?.step || '-'}</span>
              <span className="text-gray-600">重试 {attemptText || '-'}</span>
            </div>
            <div className="mt-2 space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    sseTimeout && taskStatus === 'running'
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                      : 'bg-gradient-to-r from-purple-500 to-blue-500'
                  }`}
                  style={{ width: `${hasActiveGeneration ? activeProgress : isGenerationLimitReached ? 100 : overallProgress}%` }}
                />
              </div>
              <p className={`pr-1 text-sm ${
                sseTimeout && taskStatus === 'running' ? 'text-amber-700' : 'text-gray-700'
              }`}>
                {hasActiveGeneration && currentBucketMeta
                  ? currentBucketMeta.fullLabel
                  : isGenerationLimitReached
                    ? '全部创意已生成完成'
                    : '点击右上角按钮继续生成下一类创意'}
                {' · '}
                {messageText}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function Step1CreativeGeneration({ offer, onCreativeSelected, selectedCreative }: Props) {
  const router = useRouter()
  const [generating, setGenerating] = useState(false)
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(
    selectedCreative?.id || null
  )
  const [generationCount, setGenerationCount] = useState(0)

  // 🆕 v4.16: 已生成的bucket列表
  const [generatedBuckets, setGeneratedBuckets] = useState<string[]>([])

  // 生成进度状态
  const [generationProgress, setGenerationProgress] = useState<{
    step: string
    progress: number
    message: string
    details?: any
  } | null>(null)

  /**
   * 处理401未授权错误 - 跳转到登录页
   */
  const handleUnauthorized = () => {
    // auth_token 是 HttpOnly Cookie，JS 无法清除，由服务端 /api/auth/logout 负责
    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search)
    router.push(`/login?redirect=${redirectUrl}`)
  }

  // 🆕 错误状态
  const [generationError, setGenerationError] = useState<{
    message: string
    solution: ReturnType<typeof getErrorSolution>
  } | null>(null)

  // 生成开始时间（用于计算总耗时）
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null)
  const [elapsedTime, setElapsedTime] = useState<number>(0)

  // 展开/折叠状态管理
  const [expandedSections, setExpandedSections] = useState<Record<number, Record<string, boolean>>>({})

  // Bonus Score & Conversion Feedback
  const [showFeedbackForm, setShowFeedbackForm] = useState(false)
  const [selectedCreativeForFeedback, setSelectedCreativeForFeedback] = useState<number | null>(null)
  const [bonusScoreRefreshKey, setBonusScoreRefreshKey] = useState(0)

  // 🆕 临时 AI Provider 选择（优先级高于全局设置，留空则使用全局设置）
  const [selectedAIProvider, setSelectedAIProvider] = useState<'default' | 'gemini' | 'openai' | 'anthropic'>('default')

  // 🆕 SSE超时处理状态
  const [sseTimeout, setSseTimeout] = useState(false)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [pollingTimer, setPollingTimer] = useState<NodeJS.Timeout | null>(null)
  const [taskStatus, setTaskStatus] = useState<'running' | 'completed' | 'failed' | null>(null)
  const nextBucket = getNextCreativeBucket(generatedBuckets)
  const activeBucket = currentTaskId && (generating || taskStatus === 'running' || generationProgress)
    ? nextBucket
    : null
  const nextBucketMeta = nextBucket ? CREATIVE_BUCKET_META[nextBucket] : null
  const generateButtonLabel = generating && activeBucket
    ? `正在生成${CREATIVE_BUCKET_META[activeBucket].buttonLabel}...`
    : nextBucketMeta
      ? `生成${nextBucketMeta.buttonLabel}`
      : '已达生成上限'
  const generateButtonTitle = generating && activeBucket
    ? `${CREATIVE_BUCKET_META[activeBucket].fullLabel}正在生成中，请等待当前任务完成`
    : nextBucketMeta
      ? `生成${nextBucketMeta.fullLabel}`
      : '已达到 3 个创意类型的生成上限'

  // 🆕 处理错误解决方案的操作
  const handleErrorAction = (action?: string) => {
    if (!action) return

    switch (action) {
      case 'offer-detail':
        // 返回 Offer 详情页
        router.push(`/offers/${offer.id}`)
        break
      case 'settings':
        // 跳转到设置页面
        router.push('/settings')
        break
      case 'login':
        // 跳转到登录页面
        router.push('/login')
        break
      case 'retry':
        // 重新尝试生成
        setGenerationError(null)
        setSseTimeout(false)
        handleGenerate()
        break
      default:
        break
    }
  }

  // 🆕 轮询检查任务状态（SSE断开后使用）
  const pollTaskStatus = async (taskId: string) => {
    try {
      const response = await fetch(`/api/creative-tasks/${taskId}`, {
        credentials: 'include'
      })
      if (!response.ok) return null

      const task = await response.json()
      setTaskStatus(task.status)

      // 任务仍在运行
      if (task.status === 'running' || task.status === 'pending') {
        if (task.progress !== undefined) {
          setGenerationProgress({
            step: task.stage || 'processing',
            progress: task.progress,
            message: task.message || '正在处理...'
          })
        }
        return 'running'
      }

      // 任务完成
      if (task.status === 'completed') {
        // 刷新创意列表
        await fetchExistingCreatives()
        showSuccess('✅ 生成完成', '广告创意已生成完成，请查看结果')
        setSseTimeout(false)
        setGenerating(false)
        setGenerationProgress(null)
        setGenerationStartTime(null)
        setCurrentTaskId(null)
        return 'completed'
      }

      // 任务失败
      if (task.status === 'failed') {
        const errorMessage = task.error || '任务执行失败'
        setGenerationError({ message: errorMessage, solution: getErrorSolution(errorMessage) })
        setSseTimeout(false)
        setGenerating(false)
        setGenerationProgress(null)
        setGenerationStartTime(null)
        setCurrentTaskId(null)
        return 'failed'
      }

      return null
    } catch (error: any) {
      console.error('Polling task status error:', error)
      return null
    }
  }

  // 🆕 开始轮询任务状态
  const startPolling = (taskId: string) => {
    // 立即检查一次
    pollTaskStatus(taskId).then(status => {
      if (status === 'running') {
        // 继续轮询，每3秒检查一次
        const timer = setInterval(async () => {
          const currentStatus = await pollTaskStatus(taskId)
          if (currentStatus !== 'running') {
            clearInterval(timer)
            setPollingTimer(null)
          }
        }, 3000)
        setPollingTimer(timer)
      }
    })
  }

  // 🆕 清理轮询定时器
  useEffect(() => {
    return () => {
      if (pollingTimer) {
        clearInterval(pollingTimer)
      }
    }
  }, [pollingTimer])

  const toggleSection = (creativeId: number, section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [creativeId]: {
        ...prev[creativeId],
        [section]: !prev[creativeId]?.[section]
      }
    }))
  }

  const isSectionExpanded = (creativeId: number, section: string) => {
    return expandedSections[creativeId]?.[section] || false
  }

  useEffect(() => {
    fetchExistingCreatives()
  }, [offer.id])

  // 计时器：每秒更新已用时间
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null
    if (generating && generationStartTime) {
      timer = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - generationStartTime) / 1000))
      }, 1000)
    } else {
      setElapsedTime(0)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [generating, generationStartTime])

  const fetchExistingCreatives = async () => {
    try {
      const response = await fetch(`/api/offers/${offer.id}/generate-ad-creative`, {
        credentials: 'include'
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) return

      const data = await response.json()
      if (data.creatives && data.creatives.length > 0) {
        // 转换数据库创意为前端需要的格式（构造adStrength对象）
        const formattedCreatives = data.creatives.map((c: any) => {
          // 🔧 确保 score 是数字类型（数据库可能返回字符串）
          const numericScore = typeof c.score === 'number' ? c.score : (parseFloat(c.score) || 0)
          const calculatedRating = numericScore >= 85 ? 'EXCELLENT' : numericScore >= 70 ? 'GOOD' : numericScore >= 50 ? 'AVERAGE' : 'POOR'

          return {
            ...c,
            score: numericScore,  // 🔧 确保 score 始终是数字
            // 构造adStrength对象（如果不存在）- 必须包含完整的7个维度
            adStrength: c.adStrength || {
              rating: calculatedRating,
              score: numericScore,
              dimensions: {
                diversity: {
                  score: c.scoreBreakdown?.diversity || 0,
                  weight: 0.18,
                  details: ''
                },
                relevance: {
                  score: c.scoreBreakdown?.relevance || 0,
                  weight: 0.18,
                  details: ''
                },
                completeness: {
                  score: c.scoreBreakdown?.engagement || 0,
                  weight: 0.14,
                  details: ''
                },
                quality: {
                  score: c.scoreBreakdown?.quality || 0,
                  weight: 0.14,
                  details: ''
                },
                compliance: {
                  score: c.scoreBreakdown?.clarity || 0,
                  weight: 0.08,
                  details: ''
                },
                // 🔧 新增：品牌搜索量维度 (18%)
                brandSearchVolume: {
                  score: c.scoreBreakdown?.brandSearchVolume || 0,
                  weight: 0.18,
                  details: { monthlySearchVolume: 0, volumeLevel: 'micro', dataSource: 'unavailable' }
                },
                // 🔧 新增：竞争定位维度 (10%)
                competitivePositioning: {
                  score: c.scoreBreakdown?.competitivePositioning || 0,
                  weight: 0.10,
                  details: { priceAdvantage: 0, uniqueMarketPosition: 0, competitiveComparison: 0, valueEmphasis: 0 }
                }
              },
              suggestions: c.scoreExplanation ? [c.scoreExplanation] : []
            }
          }
        })

        // 🎯 排序：按分数从高到低，若分数相同则按创建时间从新到旧
        const sortedCreatives = formattedCreatives
          .sort((a: any, b: any) => {
            // 首先按分数从高到低排序
            if (b.score !== a.score) {
              return b.score - a.score
            }
            // 若分数相同，按创建时间从新到旧排序
            const timeA = new Date(a.createdAt).getTime()
            const timeB = new Date(b.createdAt).getTime()
            return timeB - timeA
          })
          // 🎯 只取前 3 个最佳创意
          .slice(0, 3)

        setCreatives(sortedCreatives)

        // ✅ KISS-3类型：generationCount 表示“已生成的创意类型数”（最多3：A/B/D）
        const normalizeBucket = (b: string | undefined): string | null => {
          const upper = String(b || '').toUpperCase()
          if (upper === 'A') return 'A'
          if (upper === 'B' || upper === 'C') return 'B'
          if (upper === 'D' || upper === 'S') return 'D'
          return null
        }

        const usedTypesSet = new Set(
          formattedCreatives
            .map((c: Creative) => normalizeBucket(c.keywordBucket))
            .filter((b: string | null): b is string => !!b)
        )

        const orderedTypes = ['A', 'B', 'D'].filter(t => usedTypesSet.has(t))
        setGenerationCount(orderedTypes.length)

        // 🆕 v4.16: 从API响应获取已生成的bucket列表
        if (data.generatedBuckets && Array.isArray(data.generatedBuckets)) {
          const normalized = (data.generatedBuckets as string[])
            .map(b => normalizeBucket(b))
            .filter((b: string | null): b is string => !!b)
          const ordered = ['A', 'B', 'D'].filter(t => normalized.includes(t))
          setGeneratedBuckets(ordered)
        } else {
          // Fallback: 从现有创意中提取bucket
          setGeneratedBuckets(orderedTypes)
        }

        // Auto-select if already selected
        const selected = sortedCreatives.find((c: Creative) => c.id === selectedCreative?.id)
        if (selected) {
          setSelectedId(selected.id)
        }
      } else {
        // 没有现有创意时，重置生成次数状态，允许重新生成
        setCreatives([])
        setGenerationCount(0)
        setGeneratedBuckets([])
        setSelectedId(null)
      }
    } catch (error) {
      console.error('Failed to fetch creatives:', error)
    }
  }

  const handleGenerate = async () => {
    let queuedTaskId: string | null = null
    let shouldKeepTaskTracking = false

    try {
      setGenerating(true)
      setGenerationError(null)  // 🆕 清除之前的错误
      setSseTimeout(false)
      setTaskStatus(null)
      setGenerationStartTime(Date.now())
      setGenerationProgress({
        step: 'init',
        progress: 0,
        message: '正在初始化...'
      })

      // 🔥 Step 1: 入队获取taskId（KISS-3类型：后端自动选择A/B/D）
      const enqueueResponse = await fetch(`/api/offers/${offer.id}/generate-creatives-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          maxRetries: 3,
          targetRating: 'EXCELLENT',
          // 🆕 临时 AI Provider 覆盖：'default' 表示使用全局设置
          ...(selectedAIProvider !== 'default' ? { aiProvider: selectedAIProvider } : {}),
        })
      })

      if (!enqueueResponse.ok) {
        const errorData = await enqueueResponse.json()

        // 🔧 修复: 安全处理错误数据，确保字段类型正确
        const errorMessage = typeof errorData.error === 'string' ? errorData.error : String(errorData.error || '任务入队失败')
        const errorDetails = typeof errorData.details === 'string' ? errorData.details : ''

        // 检查是否是API配置缺失错误
        const isApiConfigError = errorMessage.includes('Google Ads API 配置')
          || errorDetails.includes('Google Ads API')
          || (Array.isArray(errorData.missingFields) && errorData.missingFields.length > 0)

        if (isApiConfigError) {
          // 友好提示：API配置缺失
          throw new Error(
            `⚠️ 缺少 Google Ads API 配置\n\n` +
            `为了获取关键词真实搜索量，需要配置 Google Ads API 凭证：\n` +
            `${Array.isArray(errorData.missingFields) ? errorData.missingFields.map((field: string) => `• ${field}`).join('\n') : '• Developer Token\n• Refresh Token\n• Customer ID'}\n\n` +
            `请前往【设置】→【Google Ads API】进行配置后重试。`
          )
        }

        throw new Error(errorMessage)
      }

      const { taskId } = await enqueueResponse.json()
      queuedTaskId = taskId
      setCurrentTaskId(taskId)  // 🆕 保存taskId用于轮询

      // 🔥 Step 2: 订阅SSE流（带 15 分钟超时保护，防止 Gemini API 挂起时前端永远卡死）
      const sseAbortController = new AbortController()
      const SSE_TIMEOUT_MS = 15 * 60 * 1000 // 15 分钟
      const sseTimeoutId = setTimeout(() => {
        sseAbortController.abort()
      }, SSE_TIMEOUT_MS)

      let response: Response
      try {
        response = await fetch(`/api/creative-tasks/${taskId}/stream`, {
          credentials: 'include',
          signal: sseAbortController.signal,
        })
      } catch (fetchErr: any) {
        clearTimeout(sseTimeoutId)
        if (fetchErr?.name === 'AbortError') {
          throw new Error('SSE timeout')
        }
        throw fetchErr
      }

      if (!response.ok) {
        clearTimeout(sseTimeoutId)
        throw new Error('无法订阅任务进度')
      }

      // 读取SSE流
      const reader = response.body?.getReader()
      if (!reader) {
        clearTimeout(sseTimeoutId)
        throw new Error('无法读取响应流')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        let done: boolean, value: Uint8Array | undefined
        try {
          ;({ done, value } = await reader.read())
        } catch (readErr: any) {
          clearTimeout(sseTimeoutId)
          if (readErr?.name === 'AbortError') {
            throw new Error('SSE timeout')
          }
          throw readErr
        }
        if (done) {
          clearTimeout(sseTimeoutId)
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.type === 'progress') {
                setGenerationProgress({
                  step: data.step,
                  progress: data.progress,
                  message: data.message,
                  details: data.details
                })
              } else if (data.type === 'result') {
                // 生成成功
                const rating = data.adStrength.rating
                const score = data.adStrength.score

                // 🔧 修复(2025-12-22): 质量低于70分时显示警告提示
                const MINIMUM_SCORE = 70
                const hasQualityWarning = score < MINIMUM_SCORE

                if (hasQualityWarning) {
                  showSuccess(
                    '⚠️ 生成完成（质量待优化）',
                    `Ad Strength: ${rating === 'EXCELLENT' ? '优秀' : rating === 'GOOD' ? '良好' : rating === 'AVERAGE' ? '一般' : '待优化'} (${score}分)\n建议：配置 Google Ads API 以获取真实搜索量数据，提升质量评分`
                  )
                } else {
                  showSuccess(
                    '✅ 生成成功',
                    `Ad Strength: ${rating === 'EXCELLENT' ? '优秀' : rating === 'GOOD' ? '良好' : rating === 'AVERAGE' ? '一般' : '待优化'} (${score}分)`
                  )
                }

                await fetchExistingCreatives()
              } else if (data.type === 'error') {
                const message =
                  (typeof data.error === 'string' && data.error) ||
                  (typeof data.message === 'string' && data.message) ||
                  (typeof data?.data?.message === 'string' && data.data.message) ||
                  '任务失败'
                throw new Error(message)
              }
            } catch (parseError: any) {
              // 🔧 修复(2026-01-26): 区分JSON解析错误和业务错误
              // 只有真正的JSON解析错误才吞掉，业务错误（从SSE type:error抛出的）必须重新抛出
              const isJsonParseError = parseError instanceof SyntaxError ||
                parseError?.message?.includes?.('JSON') ||
                parseError?.message?.includes?.('Unexpected token')

              if (isJsonParseError) {
                // JSON解析失败，可能是不完整的SSE数据，忽略
                console.warn('解析SSE数据失败:', parseError)
              } else {
                // 业务错误（前置校验失败、SSE超时、网络错误等），重新抛出让外层处理
                throw parseError
              }
            }
          }
        }
      }
    } catch (error: any) {
      const errorMessage = error.message || '生成失败'

      // 🔧 修复(2025-12-27): 判断是否为SSE超时
      const isSSETimeout = errorMessage === 'SSE timeout' || errorMessage.includes('SSE timeout')

      // 🔧 修复(2025-12-27): 判断是否为网络错误
      const isNetworkError = !errorMessage ||
        (errorMessage.toLowerCase().includes('network') ||
        errorMessage.toLowerCase().includes('fetch') ||
        errorMessage.toLowerCase().includes('failed to fetch') ||
        errorMessage.toLowerCase().includes('networkerror') ||
        errorMessage.includes('断开了') ||
        errorMessage.includes('网络连接'))

      // SSE超时或网络中断，但任务可能在后端继续运行
      if ((isSSETimeout || isNetworkError) && queuedTaskId) {
        shouldKeepTaskTracking = true
        setSseTimeout(true)
        setGenerating(false)
        startPolling(queuedTaskId)
        return
      }

      const solution = getErrorSolution(errorMessage)
      setGenerationError({ message: errorMessage, solution })
      showError(solution.title, solution.description)
    } finally {
      // 🆕 如果SSE正常完成或任务已完成，才清理状态
      if (!shouldKeepTaskTracking) {
        setGenerating(false)
        setGenerationProgress(null)
        setGenerationStartTime(null)
        setCurrentTaskId(null)
      }
    }
  }

  const handleSelect = async (creative: Creative) => {
    try {
      const response = await fetch(`/api/ad-creatives/${creative.id}/select`, {
        method: 'POST',
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('选择失败')
      }

      setSelectedId(creative.id)
      onCreativeSelected(creative)
      showSuccess('已选择', '创意已选择，可以进入下一步')
    } catch (error: any) {
      showError('选择失败', error.message)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50 border-green-200'
    if (score >= 60) return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    return 'text-red-600 bg-red-50 border-red-200'
  }

  const getScoreBadge = (score: number) => {
    if (score >= 80) return { label: '优秀', variant: 'default' as const, className: 'bg-green-600' }
    if (score >= 60) return { label: '良好', variant: 'secondary' as const, className: 'bg-yellow-500' }
    return { label: '待优化', variant: 'destructive' as const }
  }

  // 渲染可展开的列表
  const renderExpandableList = (
    creativeId: number,
    sectionKey: string,
    items: string[] | any[],
    title: string,
    defaultShow = 3
  ) => {
    const isExpanded = isSectionExpanded(creativeId, sectionKey)
    const displayItems = isExpanded ? items : items.slice(0, defaultShow)
    const hasMore = items.length > defaultShow

    // 🔧 修复(2025-12-24): 处理对象数组（如{text: '...'}）和字符串数组
    const getItemText = (item: any): string => {
      if (typeof item === 'string') return item
      if (typeof item === 'object' && item !== null && 'text' in item) return item.text
      return String(item)
    }

    return (
      <div>
        <div className="text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
          <span>{title} ({items.length})</span>
          {hasMore && (
            <button
              onClick={() => toggleSection(creativeId, sectionKey)}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              {isExpanded ? (
                <>收起 <ChevronUp className="w-3 h-3" /></>
              ) : (
                <>展开全部 <ChevronDown className="w-3 h-3" /></>
              )}
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          {displayItems.map((item, i) => (
            <div key={i} className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
              {getItemText(item)}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wand2 className="w-6 h-6 text-purple-600" />
            生成广告创意
          </h2>
          <p className="text-gray-500 mt-1">
            AI自动生成广告创意，包含标题、描述、关键词等完整内容，并提供专业评分和解释
          </p>
        </div>
        <div className="flex items-center gap-3">
          {creatives.length > 0 && (
            <Badge variant="secondary" className="px-3 py-1.5 text-sm font-medium bg-white border border-gray-200 shadow-sm">
              已生成类型: {generationCount}/3 | 展示最佳3个
            </Badge>
          )}

          {/* 🆕 临时 AI Provider 选择器 */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Select
                    value={selectedAIProvider}
                    onValueChange={(v) => setSelectedAIProvider(v as typeof selectedAIProvider)}
                    disabled={generating}
                  >
                    <SelectTrigger className="w-36 h-9 text-sm bg-white border-gray-200 shadow-sm">
                      <SelectValue placeholder="AI 提供商" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">🌐 全局设置</SelectItem>
                      <SelectItem value="gemini">✨ Gemini</SelectItem>
                      <SelectItem value="openai">🤖 OpenAI</SelectItem>
                      <SelectItem value="anthropic">🧠 Claude</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                临时切换本次生成使用的 AI 模型。"全局设置"将使用【设置】页面中配置的默认 AI 提供商。
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button
            onClick={handleGenerate}
            disabled={generating || generatedBuckets.length >= 3}
            className={`shadow-md border-0 ${
              generatedBuckets.length >= 3
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-500/20'
                : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 shadow-purple-500/20'
            } text-white`}
            title={generateButtonTitle}
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {generateButtonLabel}
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                {generateButtonLabel}
              </>
            )}
          </Button>
        </div>
      </div>

      <CreativeGenerationOverviewPanel
        generatedBuckets={generatedBuckets}
        activeBucket={activeBucket}
        generationProgress={generationProgress}
        generating={generating}
        elapsedTime={elapsedTime}
        sseTimeout={sseTimeout}
        taskStatus={taskStatus}
        offer={offer}
      />

      {/* 🆕 错误提示（当已有创意但生成新创意失败时显示） */}
      {generationError && creatives.length > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="flex items-center justify-between">
            <div className="text-red-700">
              <span className="font-medium">{generationError.solution.title}：</span>
              {generationError.solution.description}
            </div>
            <div className="flex items-center gap-2 ml-4 flex-shrink-0">
              {generationError.solution.action && generationError.solution.action !== 'retry' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleErrorAction(generationError.solution.action)}
                  className="border-red-300 text-red-700 hover:bg-red-100"
                >
                  {generationError.solution.actionLabel}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setGenerationError(null)}
                className="text-red-600 hover:text-red-800 hover:bg-red-100"
              >
                关闭
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Creatives List */}
      {creatives.length === 0 ? (
        <Card className="border-dashed border-2 border-gray-200 bg-gray-50/50 py-8">
          <CardContent className="text-center">
            {/* 🆕 SSE超时但任务仍在运行中 */}
            {sseTimeout && taskStatus === 'running' && (
              <div className="space-y-4">
                <div className="w-16 h-16 bg-gradient-to-br from-amber-100 to-orange-100 rounded-full flex items-center justify-center mx-auto">
                  <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-amber-700 mb-1">
                    任务正在后台处理中...
                  </h3>
                  <p className="text-gray-600 text-sm max-w-md mx-auto">
                    由于网络连接断开，任务已转入后台继续处理。系统正在自动监控任务状态，请稍后刷新查看结果。
                  </p>
                </div>
                {/* 进度信息 */}
                {generationProgress && (
                  <div className="max-w-md mx-auto">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>进度</span>
                      <span>{generationProgress.progress}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${generationProgress.progress}%` }}
                      />
                    </div>
                    <p className="text-amber-600 font-medium text-sm mt-2">
                      {generationProgress.message}
                    </p>
                  </div>
                )}
                {/* 刷新按钮 */}
                <Button
                  onClick={() => fetchExistingCreatives()}
                  className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 border-0"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  刷新查看结果
                </Button>
              </div>
            )}

            {/* 🆕 SSE超时且任务已完成 */}
            {sseTimeout && taskStatus === 'completed' && (
              <div className="space-y-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-green-700 mb-1">
                    生成已完成
                  </h3>
                  <p className="text-gray-600 text-sm">
                    广告创意已生成完成，请点击下方按钮查看结果。
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setSseTimeout(false)
                    setTaskStatus(null)
                    setCurrentTaskId(null)
                    fetchExistingCreatives()
                  }}
                  className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 border-0"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  查看生成结果
                </Button>
              </div>
            )}

            {/* 🆕 SSE超时且任务失败 */}
            {sseTimeout && taskStatus === 'failed' && (
              <div className="space-y-4">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-red-700 mb-1">
                    任务执行失败
                  </h3>
                  <p className="text-gray-600 text-sm max-w-md mx-auto">
                    后台任务执行过程中出现错误，请点击重试按钮重新生成。
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setSseTimeout(false)
                    setTaskStatus(null)
                    setCurrentTaskId(null)
                    handleGenerate()
                  }}
                  className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 border-0"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  重新生成
                </Button>
              </div>
            )}

            {/* 🆕 SSE超时但轮询中（无明确状态） */}
            {sseTimeout && !taskStatus && (
              <div className="space-y-4">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto">
                  <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-purple-700 mb-1">
                    正在恢复任务状态...
                  </h3>
                  <p className="text-gray-600 text-sm max-w-md mx-auto">
                    正在检查任务执行状态，请稍候...
                  </p>
                </div>
              </div>
            )}

            {/* 正常生成中 */}
            {!sseTimeout && generating && generationProgress ? (
              // 生成中显示进度
              <div className="space-y-4">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto">
                  <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">
                    AI正在生成广告创意
                  </h3>
                  <p className="text-purple-600 font-medium text-sm">
                    {generationProgress.message}
                  </p>
                </div>
                {/* 进度条 */}
                <div className="max-w-md mx-auto">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>进度</span>
                    <span>{generationProgress.progress}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${generationProgress.progress}%` }}
                    />
                  </div>
                  {/* 总耗时显示 */}
                      <div className="flex justify-center mt-2">
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                      已用时: {formatElapsedTime(elapsedTime)}
                    </span>
                  </div>
                </div>
                {/* 详细信息 */}
                {generationProgress.details && (
                  <div className="text-xs text-gray-500 space-y-1">
                    {generationProgress.details.attempt && (
                      <p>第 {generationProgress.details.attempt} / {generationProgress.details.maxRetries || 3} 次尝试</p>
                    )}
                    {generationProgress.details.rating && (
                      <p className="flex items-center justify-center gap-1">
                        当前评级:
                        <span className={`font-medium ${
                          generationProgress.details.rating === 'EXCELLENT' ? 'text-green-600' :
                          generationProgress.details.rating === 'GOOD' ? 'text-blue-600' :
                          generationProgress.details.rating === 'AVERAGE' ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {generationProgress.details.rating === 'EXCELLENT' ? '优秀' :
                           generationProgress.details.rating === 'GOOD' ? '良好' :
                           generationProgress.details.rating === 'AVERAGE' ? '一般' : '待优化'}
                        </span>
                        ({generationProgress.details.score}分)
                      </p>
                    )}
                    {generationProgress.details.suggestions && generationProgress.details.suggestions.length > 0 && (
                      <div className="mt-2 text-left bg-yellow-50 rounded-lg p-2 max-w-sm mx-auto">
                        <p className="font-medium text-yellow-800 mb-1">优化建议:</p>
                        <ul className="text-yellow-700 list-disc list-inside">
                          {generationProgress.details.suggestions.map((s: string, i: number) => (
                            <li key={i} className="truncate">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  AI正在努力创作最优质的广告文案，请稍候...
                </p>
              </div>
            ) : generationError ? (
              // 🆕 显示错误状态和解决方案
              <div className="space-y-4">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-red-700 mb-1">
                    {generationError.solution.title}
                  </h3>
                  <p className="text-gray-600 max-w-md mx-auto mb-4 text-sm">
                    {generationError.solution.description}
                  </p>
                </div>

                {/* 原始错误信息（折叠显示） */}
                <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-2 max-w-md mx-auto">
                  <span className="font-medium">错误详情：</span>{generationError.message}
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center justify-center gap-3">
                  {generationError.solution.action && generationError.solution.action !== 'retry' && (
                    <Button
                      onClick={() => handleErrorAction(generationError.solution.action)}
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 border-0"
                    >
                      {generationError.solution.actionLabel}
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      setGenerationError(null)
                      handleGenerate()
                    }}
                    variant={generationError.solution.action === 'retry' ? 'default' : 'outline'}
                    className={generationError.solution.action === 'retry' ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 border-0' : ''}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    重新尝试
                  </Button>
                </div>
              </div>
            ) : (
              // 未生成时显示空状态
              <>
                <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-4">
                  <Wand2 className="w-8 h-8 text-purple-500" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-1">
                  还没有广告创意
                </h3>
                <p className="text-gray-500 max-w-md mx-auto mb-4 text-sm">
                  点击右上角的"开始生成创意"按钮，AI将自动生成高质量的Google Ads广告文案
                </p>
                <Button
                  onClick={handleGenerate}
                  disabled={generating || generatedBuckets.length >= 3}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 border-0"
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  {generateButtonLabel}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {creatives.map((creative, index) => {
            const isSelected = selectedId === creative.id
            const rankLabels = ['🥇 TOP 1', '🥈 TOP 2', '🥉 TOP 3']

            return (
              <Card
                key={creative.id}
                className={`relative transition-all duration-200 group hover:shadow-md ${isSelected
                  ? 'ring-2 ring-purple-500 shadow-lg bg-purple-50/10'
                  : 'hover:border-purple-200'
                  }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <span className="font-bold text-gray-900">{rankLabels[index]}</span>
                        {/* 轮次标记 */}
                        <Badge
                          variant="outline"
                          className={`
                            text-[11px] px-1.5 py-0.5 h-5 font-semibold border
                            ${creative.generationRound === 1 ? 'bg-blue-50 text-blue-700 border-blue-300' : ''}
                            ${creative.generationRound === 2 ? 'bg-green-50 text-green-700 border-green-300' : ''}
                            ${creative.generationRound === 3 ? 'bg-orange-50 text-orange-700 border-orange-300' : ''}
                            ${creative.generationRound > 3 ? 'bg-gray-50 text-gray-600 border-gray-300' : ''}
                          `}
                        >
                          {creative.generationRound}
                        </Badge>
                      </CardTitle>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <span>{(() => {
                          // ✅ KISS-3类型：只展示3个用户可见类型（A / B(含C) / D(含S)）
                          const bucketKey = (creative.keywordBucket || '').toUpperCase()
                          const normalized = bucketKey === 'A'
                            ? 'A'
                            : (bucketKey === 'B' || bucketKey === 'C')
                              ? 'B'
                              : (bucketKey === 'D' || bucketKey === 'S')
                                ? 'D'
                                : null

                          const labelMap: Record<string, string> = {
                            A: '品牌/信任导向',
                            B: '场景+功能导向',
                            D: '转化/价值导向·全量关键词'
                          }

                          return normalized ? labelMap[normalized] : '创意'
                        })()}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {/* 广告创意ID - 右上角显示 */}
                      <div className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-md font-mono border border-gray-200">
                        ID: {creative.id}
                      </div>

                      {isSelected && (
                        <Badge variant="default" className="bg-purple-600 hover:bg-purple-700">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          已选择
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  {/* Ad Strength Rating Display */}
                  {creative.adStrength ? (
                    <div className={`p-4 rounded-xl border ${getAdStrengthColor(creative.adStrength.rating)} bg-opacity-50`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium text-gray-700">Ad Strength</span>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-xs p-3 text-xs">
                                <p className="font-semibold mb-2">Ad Strength 7维度评分说明：</p>
                                <ul className="space-y-1">
                                  <li><strong>相关性 (18%)</strong>：关键词与广告的匹配度</li>
                                  <li><strong>质量 (14%)</strong>：数字、CTA、紧迫感等元素</li>
                                  <li><strong>吸引力 (14%)</strong>：标题和描述的完整性</li>
                                  <li><strong>多样性 (18%)</strong>：资产类型和长度的多样化</li>
                                  <li><strong>清晰度 (8%)</strong>：政策合规性和内容规范</li>
                                  <li><strong>品牌影响力 (18%)</strong>：品牌词的搜索热度</li>
                                  <li><strong>竞争定位 (10%)</strong>：价格优势和差异化表达</li>
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Badge
                          variant={getAdStrengthBadge(creative.adStrength.rating).variant}
                          className={getAdStrengthBadge(creative.adStrength.rating).className}
                        >
                          {getAdStrengthBadge(creative.adStrength.rating).label}
                        </Badge>
                      </div>
                      <div className="flex items-baseline gap-2 mb-3">
                        <div className="text-3xl font-bold tracking-tight">{(typeof creative.adStrength.score === 'number' ? creative.adStrength.score : parseFloat(creative.adStrength.score) || 0).toFixed(0)}</div>
                        <div className="text-sm text-gray-500 font-medium">/ 100</div>
                      </div>

                      {/* Radar Chart - Ad Strength Dimensions */}
                      {creative.adStrength.dimensions && (
                        <div className="mt-2">
                          <ScoreRadarChart
                            scoreBreakdown={{
                              diversity: creative.adStrength.dimensions.diversity.score,
                              relevance: creative.adStrength.dimensions.relevance.score,
                              engagement: creative.adStrength.dimensions.completeness.score,
                              quality: creative.adStrength.dimensions.quality.score,
                              clarity: creative.adStrength.dimensions.compliance.score,
                              brandSearchVolume: creative.adStrength.dimensions.brandSearchVolume?.score,
                              competitivePositioning: creative.adStrength.dimensions.competitivePositioning?.score
                            }}
                            maxScores={{
                              diversity: 18,
                              relevance: 18,
                              engagement: 14,
                              quality: 14,
                              clarity: 8,
                              brandSearchVolume: 18,
                              competitivePositioning: 10
                            }}
                            size="sm"
                          />
                        </div>
                      )}

                      {/* Performance Bonus Score */}
                      <div className="mt-3 border-t pt-3">
                        <BonusScoreCard
                          key={`bonus-${creative.id}-${bonusScoreRefreshKey}`}
                          adCreativeId={creative.id}
                          baseScore={creative.adStrength.score || 0}
                          onConversionClick={() => {
                            setSelectedCreativeForFeedback(creative.id)
                            setShowFeedbackForm(true)
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    /* Fallback: Old Score Display */
                    <div className={`p-4 rounded-xl border ${getScoreColor(creative.score)}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">综合评分</span>
                        <Badge variant={getScoreBadge(creative.score).variant} className={getScoreBadge(creative.score).className}>
                          {getScoreBadge(creative.score).label}
                        </Badge>
                      </div>
                      <div className="text-3xl font-bold">{(typeof creative.score === 'number' ? creative.score : parseFloat(creative.score) || 0).toFixed(1)}</div>
                    </div>
                  )}

                  <Separator />

                  {/* Headlines */}
                  {renderExpandableList(
                    creative.id,
                    'headlines',
                    creative.headlines,
                    '标题'
                  )}

                  {/* Descriptions */}
                  {creative.descriptions && creative.descriptions.length > 0 && (
                    <>
                      <Separator />
                      {renderExpandableList(
                        creative.id,
                        'descriptions',
                        creative.descriptions,
                        '描述'
                      )}
                    </>
                  )}

                  {/* Keywords */}
                  <Separator />
                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-3 flex items-center justify-between">
                      <span>关键词 ({creative.keywordsWithVolume?.length || creative.keywords.length})</span>
                      {(creative.keywordsWithVolume?.length || creative.keywords.length) > 3 && (
                        <button
                          onClick={() => toggleSection(creative.id, 'keywords')}
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"
                        >
                          {isSectionExpanded(creative.id, 'keywords') ? (
                            <>收起 <ChevronUp className="w-3 h-3" /></>
                          ) : (
                            <>展开全部 <ChevronDown className="w-3 h-3" /></>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {creative.keywordsWithVolume ? (
                        (isSectionExpanded(creative.id, 'keywords')
                          ? creative.keywordsWithVolume
                          : creative.keywordsWithVolume.slice(0, 3)
                        ).map((kw, i) => (
                          <Badge key={i} variant="secondary" className="text-xs flex items-center gap-1.5 px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200">
                            <span className="font-medium">{kw.keyword}</span>
                            {kw.searchVolume > 0 && (
                              <>
                                <span className="text-gray-300">|</span>
                                <span className="text-blue-600 font-semibold">{formatSearchVolume(kw.searchVolume)}</span>
                              </>
                            )}
                          </Badge>
                        ))
                      ) : (
                        (isSectionExpanded(creative.id, 'keywords')
                          ? creative.keywords
                          : creative.keywords.slice(0, 3)
                        ).map((k, i) => (
                          <Badge key={i} variant="secondary" className="text-xs bg-gray-100 text-gray-700">
                            {k}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Negative Keywords */}
                  {creative.negativeKeywords && creative.negativeKeywords.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-3 flex items-center justify-between">
                          <span>否定关键词 ({creative.negativeKeywords.length})</span>
                          {creative.negativeKeywords.length > 5 && (
                            <button
                              onClick={() => toggleSection(creative.id, 'negativeKeywords')}
                              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"
                            >
                              {isSectionExpanded(creative.id, 'negativeKeywords') ? (
                                <>收起 <ChevronUp className="w-3 h-3" /></>
                              ) : (
                                <>展开全部 <ChevronDown className="w-3 h-3" /></>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(isSectionExpanded(creative.id, 'negativeKeywords')
                            ? creative.negativeKeywords
                            : creative.negativeKeywords.slice(0, 5)
                          ).map((nk, i) => (
                            <Badge key={i} variant="outline" className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 border-red-200">
                              {nk}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Callouts */}
                  {creative.callouts && creative.callouts.length > 0 && (
                    <>
                      <Separator />
                      {renderExpandableList(
                        creative.id,
                        'callouts',
                        creative.callouts,
                        '附加信息',
                        4
                      )}
                    </>
                  )}

                  {/* Sitelinks */}
                  {creative.sitelinks && creative.sitelinks.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2">
                          附加链接 ({creative.sitelinks.length})
                        </div>
                        <div className="space-y-1">
                          {creative.sitelinks.map((link, i) => (
                            <div key={i}>
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:text-blue-800 underline hover:no-underline inline-flex items-center gap-1"
                              >
                                {link.text}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Select Button */}
                  <Button
                    className={`w-full transition-all duration-200 ${isSelected
                      ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                      : 'bg-gray-900 hover:bg-gray-800 text-white'
                      }`}
                    onClick={() => handleSelect(creative)}
                    disabled={isSelected}
                  >
                    {isSelected ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        已选择此创意
                      </>
                    ) : (
                      '选择此创意'
                    )}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Conversion Feedback Dialog */}
      {selectedCreativeForFeedback && (
        <ConversionFeedbackForm
          adCreativeId={selectedCreativeForFeedback}
          open={showFeedbackForm}
          onOpenChange={setShowFeedbackForm}
          onSuccess={() => {
            // Refresh bonus score data
            setBonusScoreRefreshKey(prev => prev + 1)
            setShowFeedbackForm(false)
          }}
        />
      )}
    </div>
  )
}
