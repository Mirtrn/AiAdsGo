'use client'

/**
 * Step 3: Campaign Configuration (完整版)
 * 根据业务规范：显示所有广告配置参数，用户可修改，2列布局
 *
 * 优化：
 * 1. Target Country/Language 与 Offer 保持一致且只读
 * 2. Final URL Suffix 为必填项
 * 3. 使用统一命名规范自动生成 Campaign/AdGroup/Ad 名称
 * 4. 移除重复的确认按钮，点击"下一步"时验证配置
 */

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Settings, CheckCircle2, AlertCircle, Eye, Plus, X, Info, Lock, Zap } from 'lucide-react'
import { showError, showSuccess } from '@/lib/toast-utils'
import { generateNamingScheme } from '@/lib/naming-convention'
import { CURRENCY_SYMBOLS, formatCurrency, calculateMaxCPC } from '@/lib/currency'  // 🔧 修复(2025-12-13): 导入货币工具

// 格式化搜索量显示
const formatSearchVolume = (volume?: number): string => {
  if (!volume || volume === 0) return '-'
  if (volume < 1000) return volume.toString()
  if (volume < 10000) return `${(volume / 1000).toFixed(1)}K`
  if (volume < 1000000) return `${Math.floor(volume / 1000)}K`
  return `${(volume / 1000000).toFixed(1)}M`
}

/**
 * 🆕 P0-1优化：动态CPC出价计算
 * 基于关键词的lowTopPageBid搜索量加权平均，上浮20%确保竞争力
 * 公式：Σ(lowTopPageBid × searchVolume) / Σ(searchVolume) × 1.2
 */
const calculateDynamicCpc = (
  keywords: Array<{ lowTopPageBid?: number; highTopPageBid?: number; searchVolume?: number }>,
  currency: string
): number | null => {
  // 过滤有效的关键词（有出价且出价>0）
  const validKeywords = keywords.filter(kw => (kw.lowTopPageBid || 0) > 0)

  if (validKeywords.length === 0) return null

  // 计算搜索量加权平均
  let totalWeightedBid = 0
  let totalWeight = 0

  validKeywords.forEach(kw => {
    const bid = kw.lowTopPageBid || 0
    // 搜索量作为权重，最低权重为100（避免0搜索量的词被忽略）
    const weight = Math.max(kw.searchVolume || 0, 100)
    totalWeightedBid += bid * weight
    totalWeight += weight
  })

  const weightedAvgBid = totalWeightedBid / totalWeight

  // 上浮20%确保竞争力
  const suggestedCpc = weightedAvgBid * 1.2

  // 根据货币设置最低CPC
  const minCpc: Record<string, number> = {
    USD: 0.10,
    CNY: 0.70,
    EUR: 0.09,
    GBP: 0.08,
    JPY: 15,
    KRW: 130,
    AUD: 0.15,
    CAD: 0.14,
    HKD: 0.78,
    TWD: 3.15,
    SGD: 0.13,
    INR: 8.3,
  }

  return Math.max(suggestedCpc, minCpc[currency] || 0.10)
}

interface Props {
  offer: any
  selectedCreative: any
  selectedAccount: any  // 🔧 修复(2025-12-13): 新增selectedAccount参数，用于获取货币信息
  onConfigured: (config: any) => void
  initialConfig: any | null
}

interface CampaignConfig {
  // Campaign Level
  campaignName: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  targetCountry: string
  targetLanguage: string
  biddingStrategy: string
  finalUrlSuffix: string
  marketingObjective: 'WEB_TRAFFIC' | 'SALES' | 'LEADS' | 'STORE_VISITS'  // 🔧 新增(2025-12-24): 营销目标

  // Ad Group Level
  adGroupName: string
  maxCpcBid: number

  // Keywords Level - 🆕 P0-1优化：增加lowTopPageBid和highTopPageBid用于动态CPC计算
  keywords: Array<{
    text: string
    matchType: 'BROAD' | 'PHRASE' | 'EXACT'
    searchVolume?: number
    lowTopPageBid?: number
    highTopPageBid?: number
  }>
  negativeKeywords: string[]

  // Ad Level
  adName: string
  headlines: string[]  // 必须15个
  descriptions: string[]  // 必须4个
  finalUrls: string[]

  // Extensions
  callouts: string[]
  sitelinks: Array<{ text: string; description: string; url: string }>
}

export default function Step3CampaignConfig({ offer, selectedCreative, selectedAccount, onConfigured, initialConfig }: Props) {
  // 🔧 修复(2025-12-13): 从selectedAccount获取货币信息
  const accountCurrency = selectedAccount?.currencyCode || 'USD'
  const currencySymbol = CURRENCY_SYMBOLS[accountCurrency] || '$'

  // 🔧 修复(2025-12-13): 根据货币提供合理的默认值
  const getDefaultBudget = (currency: string): number => {
    const defaults: Record<string, number> = {
      USD: 10,
      CNY: 70,
      EUR: 10,
      GBP: 8,
      JPY: 1500,
      KRW: 13000,
      AUD: 15,
      CAD: 14,
      HKD: 78,
      TWD: 315,
      SGD: 13,
      INR: 830,
    }
    return defaults[currency] || 10
  }

  const getDefaultCPC = (currency: string): number => {
    const defaults: Record<string, number> = {
      USD: 0.17,
      CNY: 1.2,
      EUR: 0.16,
      GBP: 0.13,
      JPY: 25,
      KRW: 220,
      AUD: 0.26,
      CAD: 0.24,
      HKD: 1.3,
      TWD: 5.4,
      SGD: 0.23,
      INR: 14,
    }
    return defaults[currency] || 0.17
  }

  // 使用统一命名规范生成初始名称
  const getInitialNaming = useCallback(() => {
    const budgetAmount = initialConfig?.budgetAmount || getDefaultBudget(accountCurrency)
    const maxCpcBid = initialConfig?.maxCpcBid || getDefaultCPC(accountCurrency)
    const biddingStrategy = initialConfig?.biddingStrategy || 'MAXIMIZE_CLICKS'

    return generateNamingScheme({
      offer: {
        id: offer.id,
        brand: offer.brand || 'Brand',
        category: offer.category || undefined
      },
      config: {
        targetCountry: offer.targetCountry || 'US',
        budgetAmount,
        budgetType: 'DAILY',
        biddingStrategy,
        maxCpcBid
      },
      creative: selectedCreative ? {
        id: selectedCreative.id,
        theme: selectedCreative.theme || undefined
      } : undefined
    })
  }, [offer, selectedCreative, initialConfig])

  const initialNaming = getInitialNaming()

  const [config, setConfig] = useState<CampaignConfig>(
    initialConfig || {
      // Campaign Level - 使用统一命名规范
      campaignName: initialNaming.campaignName,
      budgetAmount: getDefaultBudget(accountCurrency),  // 🔧 修复(2025-12-13): 根据货币提供合理的默认值
      budgetType: 'DAILY' as const,  // 固定每日预算
      // 🔒 Target Country/Language 强制与 Offer 保持一致
      // 🔧 修复(2025-12-11): 使用驼峰命名 targetCountry（与API返回一致）
      targetCountry: offer.targetCountry || 'US',
      targetLanguage: offer.targetLanguage || 'en',
      biddingStrategy: 'MAXIMIZE_CLICKS',  // 业务规范：网站流量营销目标
      marketingObjective: 'WEB_TRAFFIC' as const,  // 🔧 新增(2025-12-24): 营销目标默认为网站流量
      // 🔧 修复(2025-12-11): API已统一返回camelCase，移除snake_case fallback
      finalUrlSuffix: selectedCreative?.finalUrlSuffix || offer.finalUrlSuffix || '',

      // Ad Group Level - 使用统一命名规范
      adGroupName: initialNaming.adGroupName,
      maxCpcBid: getDefaultCPC(accountCurrency),  // 🔧 修复(2025-12-13): 根据货币提供合理的默认值

      // Keywords Level - 优先使用keywordsWithVolume（包含搜索量）
      // 🆕 P0-1优化：同时提取lowTopPageBid和highTopPageBid用于动态CPC计算
      // 🔥 修复(2025-12-18)：保留创意中的matchType，不强制覆盖为PHRASE
      keywords: (selectedCreative?.keywordsWithVolume || selectedCreative?.keywords || []).map((k: any, idx: number) => {
        if (typeof k === 'string') {
          // 🔥 修复(2025-12-18): 字符串格式的关键词处理
          // 第一个词（品牌词）用EXACT，其他用PHRASE
          return {
            text: k,
            matchType: idx === 0 ? 'EXACT' : 'PHRASE' as const
          }
        }

        // 🔥 修复(2025-12-18): 强化验证，确保matchType有效
        const validMatchTypes = ['BROAD', 'EXACT', 'PHRASE', 'BROAD_MATCH_MODIFIER']
        const matchType = k.matchType && validMatchTypes.includes(k.matchType)
          ? k.matchType
          : (idx === 0 ? 'EXACT' : 'PHRASE')  // 缺失或无效时的默认值

        return {
          text: k.keyword || k.text,
          matchType: matchType as ('EXACT' | 'PHRASE' | 'BROAD' | 'BROAD_MATCH_MODIFIER'),
          searchVolume: k.searchVolume || 0,
          lowTopPageBid: k.lowTopPageBid || 0,
          highTopPageBid: k.highTopPageBid || 0
        }
      }),
      // 🎯 新增：从创意中读取否定关键词
      negativeKeywords: selectedCreative?.negativeKeywords || [],

      // Ad Level - 使用统一命名规范
      adName: initialNaming.adName || `RSA_${selectedCreative?.theme || 'Default'}_C${selectedCreative?.id || 0}`,
      headlines: selectedCreative?.headlines || [],
      descriptions: selectedCreative?.descriptions || [],
      // 🔧 修复(2025-12-11): API已统一返回camelCase，移除snake_case fallback
      finalUrls: [selectedCreative?.finalUrl || offer.finalUrl || offer.url],

      // Extensions
      callouts: selectedCreative?.callouts || [],
      sitelinks: selectedCreative?.sitelinks || []
    }
  )

  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [showPreview, setShowPreview] = useState(false)
  // 🆕 P0-1优化：动态CPC出价开关
  const [enableDynamicCpc, setEnableDynamicCpc] = useState(false)

  // 🆕 P0-1优化：计算动态CPC建议值
  const suggestedCpc = calculateDynamicCpc(config.keywords, accountCurrency)

  // 🆕 P0-1优化：当启用动态CPC时，自动更新出价
  useEffect(() => {
    if (enableDynamicCpc && suggestedCpc !== null) {
      handleChange('maxCpcBid', suggestedCpc)
    }
  }, [enableDynamicCpc, suggestedCpc])

  const handleChange = (field: keyof CampaignConfig, value: any) => {
    setConfig({
      ...config,
      [field]: value
    })
    setValidationErrors([])
  }

  const handleHeadlineChange = (index: number, value: string) => {
    const newHeadlines = [...config.headlines]
    newHeadlines[index] = value
    handleChange('headlines', newHeadlines)
  }

  const handleDescriptionChange = (index: number, value: string) => {
    const newDescriptions = [...config.descriptions]
    newDescriptions[index] = value
    handleChange('descriptions', newDescriptions)
  }

  const handleKeywordChange = (index: number, field: 'text' | 'matchType', value: any) => {
    const newKeywords = [...config.keywords]
    newKeywords[index] = { ...newKeywords[index], [field]: value }
    handleChange('keywords', newKeywords)
  }

  const handleAddKeyword = () => {
    handleChange('keywords', [
      ...config.keywords,
      { text: '', matchType: 'PHRASE' as const }
    ])
  }

  const handleRemoveKeyword = (index: number) => {
    const newKeywords = config.keywords.filter((_, i) => i !== index)
    handleChange('keywords', newKeywords)
  }

  const handleAddCallout = () => {
    handleChange('callouts', [...config.callouts, ''])
  }

  const handleCalloutChange = (index: number, value: string) => {
    const newCallouts = [...config.callouts]
    newCallouts[index] = value
    handleChange('callouts', newCallouts)
  }

  const handleRemoveCallout = (index: number) => {
    const newCallouts = config.callouts.filter((_, i) => i !== index)
    handleChange('callouts', newCallouts)
  }

  const handleAddSitelink = () => {
    handleChange('sitelinks', [
      ...config.sitelinks,
      { text: '', description: '', url: '' }
    ])
  }

  const handleSitelinkChange = (index: number, field: 'text' | 'description' | 'url', value: string) => {
    const newSitelinks = [...config.sitelinks]
    newSitelinks[index] = { ...newSitelinks[index], [field]: value }
    handleChange('sitelinks', newSitelinks)
  }

  const handleRemoveSitelink = (index: number) => {
    const newSitelinks = config.sitelinks.filter((_, i) => i !== index)
    handleChange('sitelinks', newSitelinks)
  }

  const validateConfig = (): boolean => {
    const errors: string[] = []

    // Campaign Level
    if (!config.campaignName.trim()) {
      errors.push('Campaign名称不能为空')
    }
    if (config.budgetAmount <= 0) {
      errors.push('预算金额必须大于0')
    }
    // 🔒 Final URL Suffix 必填验证
    if (!config.finalUrlSuffix.trim()) {
      errors.push('Final URL Suffix为必填项，用于追踪广告效果')
    }

    // Ad Group Level
    if (!config.adGroupName.trim()) {
      errors.push('Ad Group名称不能为空')
    }
    if (config.maxCpcBid <= 0) {
      errors.push('CPC出价必须大于0')
    }
    // 🔧 修复(2025-12-26): 验证CPC是计费单位的倍数
    const cpcMicros = Math.round(config.maxCpcBid * 1000000)
    if (cpcMicros % 10000 !== 0) {
      errors.push(`CPC出价必须是计费单位的倍数（0.01 ${accountCurrency}）`)
    }

    // Keywords Level
    if (config.keywords.length === 0) {
      errors.push('至少需要1个关键词')
    }
    config.keywords.forEach((kw, i) => {
      if (!kw.text.trim()) {
        errors.push(`关键词${i + 1}不能为空`)
      }
    })

    // Ad Level
    if (!config.adName.trim()) {
      errors.push('Ad名称不能为空')
    }

    // Headlines - 必须正好15个
    if (config.headlines.length !== 15) {
      errors.push(`Headlines必须正好15个，当前${config.headlines.length}个`)
    }
    config.headlines.forEach((h, i) => {
      if (!h.trim()) {
        errors.push(`Headline ${i + 1} 不能为空`)
      }
      if (h.length > 30) {
        errors.push(`Headline ${i + 1} 超过30字符限制 (${h.length}字符)`)
      }
    })

    // Descriptions - 必须正好4个
    if (config.descriptions.length !== 4) {
      errors.push(`Descriptions必须正好4个，当前${config.descriptions.length}个`)
    }
    config.descriptions.forEach((d, i) => {
      if (!d.trim()) {
        errors.push(`Description ${i + 1} 不能为空`)
      }
      if (d.length > 90) {
        errors.push(`Description ${i + 1} 超过90字符限制 (${d.length}字符)`)
      }
    })

    // Final URLs
    if (config.finalUrls.length === 0) {
      errors.push('至少需要1个Final URL')
    }

    // Extensions
    if (config.callouts.length === 0) {
      errors.push('缺少Callout配置')
    }
    if (config.sitelinks.length === 0) {
      errors.push('缺少Sitelink配置')
    }

    if (errors.length > 0) {
      setValidationErrors(errors)
      return false
    }

    return true
  }

  // 当配置有效时，自动触发 onConfigured
  // 这样"下一步"按钮可以正常工作
  useEffect(() => {
    // 检查基本必填项是否都有值
    const isBasicValid =
      config.campaignName.trim() &&
      config.budgetAmount > 0 &&
      config.finalUrlSuffix.trim() &&
      config.adGroupName.trim() &&
      config.maxCpcBid > 0 &&
      config.keywords.length > 0 &&
      config.adName.trim() &&
      config.headlines.length === 15 &&
      config.descriptions.length === 4 &&
      config.finalUrls.length > 0 &&
      config.callouts.length > 0 &&
      config.sitelinks.length > 0

    if (isBasicValid) {
      // 配置基本有效，传递给父组件
      onConfigured(config)
    }
  }, [config, onConfigured])

  // 手动验证配置（用于显示详细错误信息）
  const handleValidate = () => {
    if (!validateConfig()) {
      showError('配置验证失败', '请检查所有必填项')
      return false
    }
    showSuccess('配置验证通过', '可以点击"下一步"继续')
    return true
  }

  // 自动填充Headlines/Descriptions到15/4个
  const ensureHeadlinesCount = () => {
    if (config.headlines.length < 15) {
      const needed = 15 - config.headlines.length
      const newHeadlines = [
        ...config.headlines,
        ...Array(needed).fill('').map((_, i) => `Headline ${config.headlines.length + i + 1}`)
      ]
      handleChange('headlines', newHeadlines)
    }
  }

  const ensureDescriptionsCount = () => {
    if (config.descriptions.length < 4) {
      const needed = 4 - config.descriptions.length
      const newDescriptions = [
        ...config.descriptions,
        ...Array(needed).fill('').map((_, i) => `Description ${config.descriptions.length + i + 1}`)
      ]
      handleChange('descriptions', newDescriptions)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-600" />
                配置广告系列参数
              </CardTitle>
              <CardDescription>
                所有参数均可修改，配置完成后点击右下角"下一步"继续
              </CardDescription>
            </div>
            <Button onClick={handleValidate} variant="outline" size="sm">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              验证配置
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-semibold mb-2">发现 {validationErrors.length} 个配置问题：</div>
            <ul className="list-disc list-inside space-y-1">
              {validationErrors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* 1. Campaign Settings - 2列布局 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">1. Campaign（广告系列）</CardTitle>
          <CardDescription>预算、定位、出价策略</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            {/* Campaign Name - 使用统一命名规范 */}
            <div className="space-y-2">
              <Label>
                Campaign Name <Badge variant="destructive" className="ml-1">必需</Badge>
                <Badge variant="outline" className="ml-1">自动生成</Badge>
              </Label>
              <Input
                value={config.campaignName}
                onChange={(e) => handleChange('campaignName', e.target.value)}
                placeholder="例: Reolink - US Campaign"
              />
            </div>

            {/* Budget Amount + Type - 🔧 修复(2025-12-13): 使用动态货币符号 */}
            <div className="space-y-2">
              <Label>
                Budget <Badge variant="destructive" className="ml-1">必需</Badge>
                <Badge className="ml-1">默认{getDefaultBudget(accountCurrency)} {accountCurrency}</Badge>
              </Label>
              <div className="flex gap-2">
                <Select
                  value={config.budgetType}
                  onValueChange={(value) => handleChange('budgetType', value)}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">每日预算</SelectItem>
                    <SelectItem value="TOTAL">总预算</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative w-[180px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">{currencySymbol}</span>
                  <Input
                    type="number"
                    value={config.budgetAmount}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value)
                      handleChange('budgetAmount', isNaN(value) ? 0 : value)
                    }}
                    className="pl-7"
                    min="0"
                    step={accountCurrency === 'JPY' || accountCurrency === 'KRW' ? '100' : '1'}
                  />
                </div>
              </div>
            </div>

            {/* Target Country - 🔒 只读，与Offer保持一致 */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                Target Country
                <Badge variant="secondary" className="ml-1">
                  <Lock className="w-3 h-3 mr-1" />
                  与Offer一致
                </Badge>
              </Label>
              <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-md border">
                <span className="font-medium">{config.targetCountry}</span>
                <span className="text-sm text-muted-foreground">（来自Offer配置，不可修改）</span>
              </div>
            </div>

            {/* Target Language - 🔒 只读，与Offer保持一致 */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                Target Language
                <Badge variant="secondary" className="ml-1">
                  <Lock className="w-3 h-3 mr-1" />
                  与Offer一致
                </Badge>
              </Label>
              <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-md border">
                <span className="font-medium">{config.targetLanguage}</span>
                <span className="text-sm text-muted-foreground">（来自Offer配置，不可修改）</span>
              </div>
            </div>

            {/* Marketing Objective - 营销目标 */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                营销目标 (Marketing Objective)
                <Badge variant="outline" className="ml-1">
                  <Info className="w-3 h-3 mr-1" />
                  由Bidding Strategy决定
                </Badge>
              </Label>
              <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
                <Badge variant="default" className="bg-blue-600">
                  {config.biddingStrategy === 'MAXIMIZE_CLICKS' ? '网站流量 (Web Traffic)' :
                   config.biddingStrategy === 'MAXIMIZE_CONVERSIONS' ? '潜在客户 (Leads)' :
                   '手动出价 (Manual)'}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {config.biddingStrategy === 'MAXIMIZE_CLICKS' ? '优化点击量，吸引更多访问者' :
                   config.biddingStrategy === 'MAXIMIZE_CONVERSIONS' ? '优化转化量，获取潜在客户' :
                   '手动控制每次点击出价'}
                </span>
              </div>
            </div>

            {/* Bidding Strategy */}
            <div className="space-y-2">
              <Label>
                Bidding Strategy <Badge className="ml-1">默认Maximize Clicks</Badge>
              </Label>
              <Select
                value={config.biddingStrategy}
                onValueChange={(value) => handleChange('biddingStrategy', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MAXIMIZE_CLICKS">Maximize Clicks (网站流量)</SelectItem>
                  <SelectItem value="MANUAL_CPC">Manual CPC (手动出价)</SelectItem>
                  <SelectItem value="MAXIMIZE_CONVERSIONS">Maximize Conversions (潜在客户)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Final URL Suffix - 🔒 必填 */}
            <div className="space-y-2">
              <Label>
                Final URL Suffix <Badge variant="destructive" className="ml-1">必填</Badge>
              </Label>
              <Input
                value={config.finalUrlSuffix}
                onChange={(e) => handleChange('finalUrlSuffix', e.target.value)}
                placeholder="例如: maas=xxx&ref_=aa_maas&tag=maas&aa_campaignid=xxx"
                className={!config.finalUrlSuffix.trim() ? 'border-red-300 focus:border-red-500' : ''}
              />
              <p className="text-xs text-gray-500">
                URL跟踪参数，用于追踪广告效果和佣金归因，通常从推广链接中自动提取
              </p>
              {!config.finalUrlSuffix.trim() && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Final URL Suffix不能为空，否则无法追踪广告效果
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Ad Group Settings - 2列布局 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">2. Ad Group（广告组）</CardTitle>
          <CardDescription>命名、CPC出价、关键词</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            {/* Ad Group Name - 使用统一命名规范 */}
            <div className="space-y-2">
              <Label>
                Ad Group Name <Badge variant="destructive" className="ml-1">必需</Badge>
                <Badge variant="outline" className="ml-1">自动生成</Badge>
              </Label>
              <Input
                value={config.adGroupName}
                onChange={(e) => handleChange('adGroupName', e.target.value)}
                placeholder="例: Reolink - Security Cameras"
              />
            </div>

            {/* Max CPC Bid - 🔧 修复(2025-12-13): 使用动态货币符号 */}
            <div className="space-y-2">
              <Label>
                CPC Bid <Badge variant="destructive" className="ml-1">必需</Badge>
                <Badge className="ml-1">默认{getDefaultCPC(accountCurrency)} {accountCurrency}</Badge>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">{currencySymbol}</span>
                <Input
                  type="number"
                  value={config.maxCpcBid}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value)
                    if (isNaN(value) || value <= 0) {
                      handleChange('maxCpcBid', 0)
                    } else {
                      // 🔧 修复(2025-12-26): 自动四舍五入到计费单位（0.01货币单位）
                      const roundedValue = Math.round(value * 100) / 100
                      handleChange('maxCpcBid', roundedValue)
                    }
                    // 🆕 P0-1优化：手动修改CPC时关闭动态CPC
                    if (enableDynamicCpc) {
                      setEnableDynamicCpc(false)
                    }
                  }}
                  className="pl-7"
                  min="0"
                  step={accountCurrency === 'JPY' || accountCurrency === 'KRW' ? '1' : '0.01'}
                />
              </div>

              {/* 🆕 P0-1优化：动态CPC出价开关 */}
              <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-600" />
                  <div>
                    <div className="text-sm font-medium">启用动态CPC出价</div>
                    <div className="text-xs text-gray-500">根据关键词竞争度自动计算建议出价</div>
                  </div>
                </div>
                <Switch
                  checked={enableDynamicCpc}
                  onCheckedChange={(checked) => {
                    setEnableDynamicCpc(checked)
                    if (checked && suggestedCpc !== null) {
                      handleChange('maxCpcBid', suggestedCpc)
                    }
                  }}
                  disabled={suggestedCpc === null}
                />
              </div>

              {/* 🆕 P0-1优化：显示动态CPC建议值 */}
              {enableDynamicCpc && suggestedCpc !== null && (
                <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-800">
                  <CheckCircle2 className="inline h-4 w-4 mr-1" />
                  <strong>动态CPC已启用</strong>: {currencySymbol}{suggestedCpc.toFixed(2)}
                  <span className="ml-1 text-xs text-green-600">
                    (基于{config.keywords.filter(k => k.lowTopPageBid && k.lowTopPageBid > 0).length}个关键词的平均竞价 +20%)
                  </span>
                </div>
              )}

              {suggestedCpc === null && config.keywords.length > 0 && (
                <div className="p-2 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600">
                  <Info className="inline h-4 w-4 mr-1" />
                  暂无关键词竞价数据，无法启用动态CPC
                </div>
              )}

              {/* 🔧 修复(2025-12-13): 使用货币转换工具计算建议CPC */}
              {offer.productPrice && offer.commissionPayout && (() => {
                // 使用货币转换工具计算建议最大CPC
                const cpcResult = calculateMaxCPC(
                  offer.productPrice,
                  offer.commissionPayout,
                  'USD',  // 产品价格通常是USD
                  accountCurrency,  // 转换为账号货币
                  50  // 假设50个点击出一单
                )

                if (cpcResult) {
                  return (
                    <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
                      <Info className="inline h-4 w-4 mr-1" />
                      <strong>建议最大CPC</strong>: {cpcResult.maxCPCFormatted}
                      <span className="ml-1 text-xs text-blue-600">
                        (${cpcResult.calculationDetails.productPrice} × {cpcResult.calculationDetails.commissionRate.toFixed(2)}% ÷ {cpcResult.calculationDetails.clicksPerSale}，假设{cpcResult.calculationDetails.clicksPerSale}个点击出一单)
                      </span>
                    </div>
                  )
                }
                return null
              })()}
            </div>
          </div>

          <Separator className="my-4" />

          {/* Keywords */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>
                Keywords <Badge variant="destructive" className="ml-1">至少1个</Badge>
              </Label>
              <Button onClick={handleAddKeyword} variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-1" />
                添加关键词
              </Button>
            </div>

            <div className="space-y-2">
              {config.keywords.map((keyword, index) => (
                <div key={index} className="grid grid-cols-[1fr_140px_100px_40px] gap-2 items-center">
                  <Input
                    value={keyword.text}
                    onChange={(e) => handleKeywordChange(index, 'text', e.target.value)}
                    placeholder="关键词"
                  />
                  <Select
                    value={keyword.matchType}
                    onValueChange={(value) => handleKeywordChange(index, 'matchType', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BROAD">广泛</SelectItem>
                      <SelectItem value="PHRASE">词组</SelectItem>
                      <SelectItem value="EXACT">精确</SelectItem>
                    </SelectContent>
                  </Select>
                  {keyword.searchVolume !== undefined && (
                    <Badge variant="secondary" className="text-xs justify-center">
                      <span className="text-blue-600 font-semibold">{formatSearchVolume(keyword.searchVolume)}</span>
                      <span className="ml-1 text-gray-500">搜索量</span>
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveKeyword(index)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Ad Settings - Headlines & Descriptions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">3. Ad（广告）</CardTitle>
              <CardDescription>标题、描述、链接</CardDescription>
            </div>
            <div className="flex gap-2">
              {config.headlines.length < 15 && (
                <Button onClick={ensureHeadlinesCount} variant="outline" size="sm">
                  自动填充至15个Headlines
                </Button>
              )}
              {config.descriptions.length < 4 && (
                <Button onClick={ensureDescriptionsCount} variant="outline" size="sm">
                  自动填充至4个Descriptions
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Ad Name - 使用统一命名规范 */}
          <div className="space-y-2">
            <Label>
              Ad Name <Badge variant="destructive" className="ml-1">必需</Badge>
              <Badge variant="outline" className="ml-1">自动生成</Badge>
            </Label>
            <Input
              value={config.adName}
              onChange={(e) => handleChange('adName', e.target.value)}
              placeholder="例: Reolink - Security Camera Ad 1"
            />
          </div>

          {/* Headlines - 必须15个 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>
                Headlines <Badge variant="destructive" className="ml-1">必须15个</Badge>
                <Badge className="ml-1">{config.headlines.length}/15</Badge>
              </Label>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {config.headlines.map((headline, index) => (
                <div key={index} className="space-y-1">
                  <div className="text-xs text-gray-500">Headline {index + 1} ({headline.length}/30)</div>
                  <Input
                    value={headline}
                    onChange={(e) => handleHeadlineChange(index, e.target.value)}
                    placeholder={`Headline ${index + 1}`}
                    maxLength={30}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Descriptions - 必须4个 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>
                Descriptions <Badge variant="destructive" className="ml-1">必须4个</Badge>
                <Badge className="ml-1">{config.descriptions.length}/4</Badge>
              </Label>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {config.descriptions.map((desc, index) => (
                <div key={index} className="space-y-1">
                  <div className="text-xs text-gray-500">Description {index + 1} ({desc.length}/90)</div>
                  <Textarea
                    value={desc}
                    onChange={(e) => handleDescriptionChange(index, e.target.value)}
                    placeholder={`Description ${index + 1}`}
                    maxLength={90}
                    rows={3}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Final URLs */}
          <div className="space-y-2">
            <Label>
              Final URL <Badge variant="destructive" className="ml-1">必需</Badge>
            </Label>
            <Input
              value={config.finalUrls[0]}
              onChange={(e) => handleChange('finalUrls', [e.target.value])}
              placeholder="https://example.com"
            />
          </div>
        </CardContent>
      </Card>

      {/* 4. Extensions - Callouts & Sitelinks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">4. Extensions（附加信息）</CardTitle>
          <CardDescription>宣传信息、附加链接</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Callouts */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>
                Callouts <Badge variant="destructive" className="ml-1">至少1个</Badge>
              </Label>
              <Button onClick={handleAddCallout} variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-1" />
                添加Callout
              </Button>
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              {config.callouts.map((callout, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={callout}
                    onChange={(e) => handleCalloutChange(index, e.target.value)}
                    placeholder={`Callout ${index + 1}`}
                    maxLength={25}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveCallout(index)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Sitelinks */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>
                Sitelinks <Badge variant="destructive" className="ml-1">至少1个</Badge>
              </Label>
              <Button onClick={handleAddSitelink} variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-1" />
                添加Sitelink
              </Button>
            </div>
            <div className="space-y-3">
              {config.sitelinks.map((sitelink, index) => (
                <div key={index} className="grid md:grid-cols-3 gap-2 p-3 border rounded-lg">
                  <Input
                    value={sitelink.text}
                    onChange={(e) => handleSitelinkChange(index, 'text', e.target.value)}
                    placeholder="链接文字"
                  />
                  <Input
                    value={sitelink.description}
                    onChange={(e) => handleSitelinkChange(index, 'description', e.target.value)}
                    placeholder="描述"
                  />
                  <div className="flex gap-2">
                    <Input
                      value={sitelink.url}
                      onChange={(e) => handleSitelinkChange(index, 'url', e.target.value)}
                      placeholder="URL"
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveSitelink(index)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
