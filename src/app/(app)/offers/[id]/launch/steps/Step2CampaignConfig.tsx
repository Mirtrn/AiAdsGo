'use client'

/**
 * Step 2: Campaign Configuration (完整版)
 * 根据业务规范：显示所有广告配置参数，用户可修改，2列布局
 */

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Settings, CheckCircle2, AlertCircle, Eye, Plus, X, Info } from 'lucide-react'
import { showError, showSuccess } from '@/lib/toast-utils'

// 格式化搜索量显示
const formatSearchVolume = (volume?: number): string => {
  if (!volume || volume === 0) return '-'
  if (volume < 1000) return volume.toString()
  if (volume < 10000) return `${(volume / 1000).toFixed(1)}K`
  if (volume < 1000000) return `${Math.floor(volume / 1000)}K`
  return `${(volume / 1000000).toFixed(1)}M`
}

interface Props {
  offer: any
  selectedCreative: any
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

  // Ad Group Level
  adGroupName: string
  maxCpcBid: number

  // Keywords Level
  keywords: Array<{ text: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT'; searchVolume?: number }>
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

export default function Step2CampaignConfig({ offer, selectedCreative, onConfigured, initialConfig }: Props) {
  const [config, setConfig] = useState<CampaignConfig>(
    initialConfig || {
      // Campaign Level - 符合业务规范
      campaignName: `${offer.brand || 'Brand'} - ${offer.target_country || 'US'} Campaign`,
      budgetAmount: 10,  // 10 USD（业务规范）
      budgetType: 'DAILY' as const,  // 固定每日预算
      targetCountry: offer.target_country || 'US',
      targetLanguage: offer.target_language || 'en',
      biddingStrategy: 'MAXIMIZE_CLICKS',  // 业务规范：网站流量营销目标
      // 优先使用: 创意的final_url_suffix → Offer解析后的final_url_suffix
      finalUrlSuffix: selectedCreative?.final_url_suffix || offer.finalUrlSuffix || offer.final_url_suffix || '',

      // Ad Group Level
      adGroupName: `${offer.brand || 'Brand'} - Ad Group 1`,
      maxCpcBid: 0.17,  // 0.17 USD（业务规范）

      // Keywords Level - 优先使用keywordsWithVolume（包含搜索量）
      keywords: (selectedCreative?.keywordsWithVolume || selectedCreative?.keywords || []).map((k: any) => {
        if (typeof k === 'string') {
          return { text: k, matchType: 'PHRASE' as const }
        }
        return {
          text: k.keyword || k.text,
          matchType: 'PHRASE' as const,
          searchVolume: k.searchVolume || 0
        }
      }),
      negativeKeywords: [],

      // Ad Level
      adName: `${offer.brand || 'Brand'} - Ad 1`,
      headlines: selectedCreative?.headlines || [],
      descriptions: selectedCreative?.descriptions || [],
      // 优先使用: 创意的final_url → Offer解析后的final_url → 原始url
      finalUrls: [selectedCreative?.final_url || offer.finalUrl || offer.final_url || offer.url],

      // Extensions
      callouts: selectedCreative?.callouts || [],
      sitelinks: selectedCreative?.sitelinks || []
    }
  )

  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [showPreview, setShowPreview] = useState(false)

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
    if (!config.campaignName.includes(offer.brand || '')) {
      errors.push('Campaign名称必须包含品牌名')
    }
    if (config.budgetAmount <= 0) {
      errors.push('预算金额必须大于0')
    }

    // Ad Group Level
    if (!config.adGroupName.trim()) {
      errors.push('Ad Group名称不能为空')
    }
    if (!config.adGroupName.includes(offer.brand || '')) {
      errors.push('Ad Group名称必须包含品牌名')
    }
    if (config.maxCpcBid <= 0) {
      errors.push('CPC出价必须大于0')
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
    if (!config.adName.includes(offer.brand || '')) {
      errors.push('Ad名称必须包含品牌名')
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

  const handleConfirm = () => {
    if (!validateConfig()) {
      showError('配置验证失败', '请检查所有必填项')
      return
    }

    onConfigured(config)
    showSuccess('配置完成', '广告系列参数已保存')
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
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            配置广告系列参数
          </CardTitle>
          <CardDescription>
            所有参数均可修改，配置完成后进入下一步
          </CardDescription>
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
            {/* Campaign Name */}
            <div className="space-y-2">
              <Label>
                Campaign Name <Badge variant="destructive" className="ml-1">必需</Badge>
                <Badge className="ml-1">需含品牌名</Badge>
              </Label>
              <Input
                value={config.campaignName}
                onChange={(e) => handleChange('campaignName', e.target.value)}
                placeholder="例: Reolink - US Campaign"
              />
            </div>

            {/* Budget Amount + Type */}
            <div className="space-y-2">
              <Label>
                Budget <Badge variant="destructive" className="ml-1">必需</Badge>
                <Badge className="ml-1">默认10 USD</Badge>
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <Input
                    type="number"
                    value={config.budgetAmount}
                    onChange={(e) => handleChange('budgetAmount', parseFloat(e.target.value))}
                    className="pl-7"
                    min="0"
                    step="10"
                  />
                </div>
                <Select
                  value={config.budgetType}
                  onValueChange={(value) => handleChange('budgetType', value)}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">每日预算</SelectItem>
                    <SelectItem value="TOTAL">总预算</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Target Country */}
            <div className="space-y-2">
              <Label>
                Target Country <Badge variant="destructive" className="ml-1">必需</Badge>
              </Label>
              <Input
                value={config.targetCountry}
                onChange={(e) => handleChange('targetCountry', e.target.value)}
                placeholder="US, GB, CA..."
              />
            </div>

            {/* Target Language */}
            <div className="space-y-2">
              <Label>
                Target Language <Badge variant="destructive" className="ml-1">必需</Badge>
              </Label>
              <Input
                value={config.targetLanguage}
                onChange={(e) => handleChange('targetLanguage', e.target.value)}
                placeholder="en, zh, ja..."
              />
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

            {/* Final URL Suffix */}
            <div className="space-y-2">
              <Label>
                Final URL Suffix <Badge variant="secondary" className="ml-1">可选</Badge>
              </Label>
              <Input
                value={config.finalUrlSuffix}
                onChange={(e) => handleChange('finalUrlSuffix', e.target.value)}
                placeholder="例如: utm_source={lpurl}&utm_campaign={campaignid}"
              />
              <p className="text-xs text-gray-500">
                URL跟踪参数，留空则不添加。示例: utm_source=google&utm_medium=cpc
              </p>
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
            {/* Ad Group Name */}
            <div className="space-y-2">
              <Label>
                Ad Group Name <Badge variant="destructive" className="ml-1">必需</Badge>
                <Badge className="ml-1">需含品牌名</Badge>
              </Label>
              <Input
                value={config.adGroupName}
                onChange={(e) => handleChange('adGroupName', e.target.value)}
                placeholder="例: Reolink - Security Cameras"
              />
            </div>

            {/* Max CPC Bid */}
            <div className="space-y-2">
              <Label>
                CPC Bid <Badge variant="destructive" className="ml-1">必需</Badge>
                <Badge className="ml-1">默认0.17 USD</Badge>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <Input
                  type="number"
                  value={config.maxCpcBid}
                  onChange={(e) => handleChange('maxCpcBid', parseFloat(e.target.value))}
                  className="pl-7"
                  min="0"
                  step="0.01"
                />
              </div>
              {offer.product_price && offer.commission_payout && (() => {
                // 需求31: 计算建议最大CPC = product_price * commission_payout / 50
                const priceMatch = String(offer.product_price).match(/[\d.,]+/)
                const commissionMatch = String(offer.commission_payout).match(/[\d.]+/)

                if (priceMatch && commissionMatch) {
                  const price = parseFloat(priceMatch[0].replace(/,/g, ''))
                  const commission = parseFloat(commissionMatch[0]) / 100
                  const suggestedCPC = (price * commission / 50).toFixed(2)

                  return (
                    <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
                      <Info className="inline h-4 w-4 mr-1" />
                      <strong>建议最大CPC</strong>: ${suggestedCPC}
                      <span className="ml-1 text-xs text-blue-600">
                        (${price} × {(commission * 100).toFixed(2)}% ÷ 50，假设50个点击出一单)
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
          {/* Ad Name */}
          <div className="space-y-2">
            <Label>
              Ad Name <Badge variant="destructive" className="ml-1">必需</Badge>
              <Badge className="ml-1">需含品牌名</Badge>
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

      {/* Confirm Button */}
      <Card>
        <CardContent className="py-4">
          <Button onClick={handleConfirm} className="w-full" size="lg">
            <CheckCircle2 className="w-5 h-5 mr-2" />
            确认配置并进入下一步
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
