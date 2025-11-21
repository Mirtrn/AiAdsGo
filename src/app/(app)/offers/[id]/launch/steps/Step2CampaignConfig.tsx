'use client'

/**
 * Step 2: Campaign Configuration
 * 配置广告系列、广告组、广告参数
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
import { Settings, CheckCircle2, AlertCircle, Eye } from 'lucide-react'
import { showError, showSuccess } from '@/lib/toast-utils'

interface Props {
  offer: any
  selectedCreative: any
  onConfigured: (config: any) => void
  initialConfig: any | null
}

interface CampaignConfig {
  campaignName: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  targetCountry: string
  targetLanguage: string
  biddingStrategy: string
  finalUrlSuffix: string
  adGroupName: string
  maxCpcBid: number
  keywords: string[]
  negativeKeywords: string[]
}

export default function Step2CampaignConfig({ offer, selectedCreative, onConfigured, initialConfig }: Props) {
  const [config, setConfig] = useState<CampaignConfig>(
    initialConfig || {
      campaignName: `${offer.brand}_${offer.targetCountry}_${new Date().getTime().toString().slice(-6)}`,
      budgetAmount: 50,
      budgetType: 'DAILY' as const,
      targetCountry: offer.targetCountry,
      targetLanguage: offer.targetLanguage || 'en',
      biddingStrategy: 'MAXIMIZE_CONVERSIONS',
      finalUrlSuffix: 'utm_source=google&utm_medium=cpc',
      adGroupName: `${offer.brand}_AdGroup_01`,
      maxCpcBid: 2.0,
      keywords: selectedCreative?.keywords || [],
      negativeKeywords: []
    }
  )

  const [keywordInput, setKeywordInput] = useState('')
  const [negativeKeywordInput, setNegativeKeywordInput] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  useEffect(() => {
    // Initialize keywords from creative
    if (selectedCreative?.keywords && config.keywords.length === 0) {
      setConfig({
        ...config,
        keywords: selectedCreative.keywords
      })
    }
  }, [selectedCreative])

  const handleChange = (field: keyof CampaignConfig, value: any) => {
    setConfig({
      ...config,
      [field]: value
    })
    setValidationErrors([])
  }

  const handleAddKeyword = () => {
    if (!keywordInput.trim()) return

    const keywords = keywordInput.split(',').map(k => k.trim()).filter(k => k)
    setConfig({
      ...config,
      keywords: [...config.keywords, ...keywords]
    })
    setKeywordInput('')
  }

  const handleRemoveKeyword = (index: number) => {
    setConfig({
      ...config,
      keywords: config.keywords.filter((_, i) => i !== index)
    })
  }

  const handleAddNegativeKeyword = () => {
    if (!negativeKeywordInput.trim()) return

    const keywords = negativeKeywordInput.split(',').map(k => k.trim()).filter(k => k)
    setConfig({
      ...config,
      negativeKeywords: [...config.negativeKeywords, ...keywords]
    })
    setNegativeKeywordInput('')
  }

  const handleRemoveNegativeKeyword = (index: number) => {
    setConfig({
      ...config,
      negativeKeywords: config.negativeKeywords.filter((_, i) => i !== index)
    })
  }

  const validateConfig = (): boolean => {
    const errors: string[] = []

    if (!config.campaignName.trim()) {
      errors.push('广告系列名称不能为空')
    }

    if (config.budgetAmount <= 0) {
      errors.push('预算金额必须大于0')
    }

    if (!config.adGroupName.trim()) {
      errors.push('广告组名称不能为空')
    }

    if (config.maxCpcBid <= 0) {
      errors.push('最大CPC出价必须大于0')
    }

    if (config.keywords.length === 0) {
      errors.push('至少需要一个关键词')
    }

    if (errors.length > 0) {
      setValidationErrors(errors)
      return false
    }

    return true
  }

  const handleConfirm = () => {
    if (!validateConfig()) {
      showError('配置验证失败', '请检查必填项')
      return
    }

    onConfigured(config)
    showSuccess('配置完成', '广告系列参数已保存')
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            配置广告系列
          </CardTitle>
          <CardDescription>
            设置广告系列、广告组和广告的参数，配置完成后可预览广告效果
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {validationErrors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Campaign Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">广告系列设置 (Campaign)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Campaign Name */}
            <div className="space-y-2">
              <Label htmlFor="campaignName">
                广告系列名称 (Campaign Name) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="campaignName"
                value={config.campaignName}
                onChange={(e) => handleChange('campaignName', e.target.value)}
                placeholder="例: Brand_US_Campaign"
              />
            </div>

            {/* Budget Amount */}
            <div className="space-y-2">
              <Label htmlFor="budgetAmount">
                预算金额 (Budget Amount) <span className="text-red-500">*</span>
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <Input
                    id="budgetAmount"
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
              <Label htmlFor="targetCountry">
                目标国家 (Target Country)
              </Label>
              <Input
                id="targetCountry"
                value={config.targetCountry}
                onChange={(e) => handleChange('targetCountry', e.target.value)}
                placeholder="US, UK, CN..."
              />
            </div>

            {/* Target Language */}
            <div className="space-y-2">
              <Label htmlFor="targetLanguage">
                目标语言 (Target Language)
              </Label>
              <Input
                id="targetLanguage"
                value={config.targetLanguage}
                onChange={(e) => handleChange('targetLanguage', e.target.value)}
                placeholder="en, zh, es..."
              />
            </div>

            {/* Bidding Strategy */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="biddingStrategy">
                出价策略 (Bidding Strategy)
              </Label>
              <Select
                value={config.biddingStrategy}
                onValueChange={(value) => handleChange('biddingStrategy', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MAXIMIZE_CONVERSIONS">最大化转化</SelectItem>
                  <SelectItem value="MAXIMIZE_CONVERSION_VALUE">最大化转化价值</SelectItem>
                  <SelectItem value="TARGET_CPA">目标每次转化费用</SelectItem>
                  <SelectItem value="TARGET_ROAS">目标广告支出回报率</SelectItem>
                  <SelectItem value="MANUAL_CPC">手动CPC</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Final URL Suffix */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="finalUrlSuffix">
                最终网址后缀 (Final URL Suffix)
              </Label>
              <Input
                id="finalUrlSuffix"
                value={config.finalUrlSuffix}
                onChange={(e) => handleChange('finalUrlSuffix', e.target.value)}
                placeholder="utm_source=google&utm_medium=cpc&utm_campaign=..."
              />
              <p className="text-xs text-gray-500">
                用于跟踪广告效果，将自动附加到所有广告的最终URL
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ad Group Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">广告组设置 (Ad Group)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Ad Group Name */}
            <div className="space-y-2">
              <Label htmlFor="adGroupName">
                广告组名称 (Ad Group Name) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="adGroupName"
                value={config.adGroupName}
                onChange={(e) => handleChange('adGroupName', e.target.value)}
                placeholder="例: Brand_AdGroup_01"
              />
            </div>

            {/* Max CPC Bid */}
            <div className="space-y-2">
              <Label htmlFor="maxCpcBid">
                最大CPC出价 (Max CPC Bid) <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <Input
                  id="maxCpcBid"
                  type="number"
                  value={config.maxCpcBid}
                  onChange={(e) => handleChange('maxCpcBid', parseFloat(e.target.value))}
                  className="pl-7"
                  min="0"
                  step="0.1"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Keywords */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>
                关键词 (Keywords) <span className="text-red-500">*</span>
              </Label>
              <Badge variant="outline">{config.keywords.length} 个关键词</Badge>
            </div>

            <div className="flex gap-2">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddKeyword()}
                placeholder="输入关键词，逗号分隔多个"
              />
              <Button onClick={handleAddKeyword} variant="outline">
                添加
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 min-h-[60px] p-3 border rounded-lg bg-gray-50">
              {config.keywords.length === 0 ? (
                <span className="text-sm text-gray-400">暂无关键词</span>
              ) : (
                config.keywords.map((keyword, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="cursor-pointer hover:bg-red-100"
                    onClick={() => handleRemoveKeyword(index)}
                  >
                    {keyword}
                    <span className="ml-1 text-red-600">×</span>
                  </Badge>
                ))
              )}
            </div>
          </div>

          <Separator />

          {/* Negative Keywords */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>否定关键词 (Negative Keywords)</Label>
              <Badge variant="outline">{config.negativeKeywords.length} 个否定关键词</Badge>
            </div>

            <div className="flex gap-2">
              <Input
                value={negativeKeywordInput}
                onChange={(e) => setNegativeKeywordInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddNegativeKeyword()}
                placeholder="输入否定关键词，逗号分隔多个"
              />
              <Button onClick={handleAddNegativeKeyword} variant="outline">
                添加
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 min-h-[60px] p-3 border rounded-lg bg-gray-50">
              {config.negativeKeywords.length === 0 ? (
                <span className="text-sm text-gray-400">暂无否定关键词</span>
              ) : (
                config.negativeKeywords.map((keyword, index) => (
                  <Badge
                    key={index}
                    variant="destructive"
                    className="cursor-pointer hover:bg-red-700"
                    onClick={() => handleRemoveNegativeKeyword(index)}
                  >
                    {keyword}
                    <span className="ml-1">×</span>
                  </Badge>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ad Preview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">广告预览 (Ad Preview)</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
            >
              <Eye className="w-4 h-4 mr-2" />
              {showPreview ? '隐藏预览' : '显示预览'}
            </Button>
          </div>
        </CardHeader>

        {showPreview && (
          <CardContent>
            <div className="border rounded-lg p-4 bg-white max-w-[600px]">
              {/* Ad Display */}
              <div className="space-y-2">
                <div className="text-xs text-green-700 font-medium">广告 · {offer.url}</div>

                {/* Headlines */}
                <div className="space-y-1">
                  {selectedCreative.headlines.slice(0, 3).map((headline: string, i: number) => (
                    <div key={i} className="text-blue-600 text-lg font-medium hover:underline cursor-pointer">
                      {headline}
                    </div>
                  ))}
                </div>

                {/* Descriptions */}
                <div className="space-y-1">
                  {selectedCreative.descriptions.slice(0, 2).map((desc: string, i: number) => (
                    <p key={i} className="text-sm text-gray-700">
                      {desc}
                    </p>
                  ))}
                </div>

                {/* Final URL Display */}
                <div className="text-xs text-gray-500 mt-2">
                  {selectedCreative.final_url}
                  {config.finalUrlSuffix && `?${config.finalUrlSuffix}`}
                </div>

                {/* Callouts */}
                {selectedCreative.callouts && selectedCreative.callouts.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
                    {selectedCreative.callouts.slice(0, 4).map((callout: string, i: number) => (
                      <span key={i} className="text-xs text-gray-600">
                        {callout}
                      </span>
                    ))}
                  </div>
                )}

                {/* Sitelinks */}
                {selectedCreative.sitelinks && selectedCreative.sitelinks.length > 0 && (
                  <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t">
                    {selectedCreative.sitelinks.slice(0, 4).map((link: any, i: number) => (
                      <div key={i} className="text-sm">
                        <div className="text-blue-600 font-medium hover:underline cursor-pointer">
                          {link.text}
                        </div>
                        {link.description && (
                          <div className="text-xs text-gray-600">{link.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              * 这是简化的预览效果，实际展示效果可能因设备和位置而异
            </p>
          </CardContent>
        )}
      </Card>

      {/* Confirm Button */}
      <Card>
        <CardContent className="py-4">
          <Button onClick={handleConfirm} className="w-full" size="lg">
            <CheckCircle2 className="w-5 h-5 mr-2" />
            确认配置
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
