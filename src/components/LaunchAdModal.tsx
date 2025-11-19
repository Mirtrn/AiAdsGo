'use client'

/**
 * LaunchAdModal - P1-3优化版
 * 使用shadcn/ui Dialog + Stepper组件
 */

import { useState, useMemo } from 'react'
import { calculateSuggestedMaxCPC } from '@/lib/pricing-utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Stepper, Step } from '@/components/ui/stepper'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { AlertCircle, RefreshCw, Sparkles, Rocket } from 'lucide-react'

interface LaunchAdModalProps {
  open: boolean
  onClose: () => void
  offer: {
    id: number
    offerName: string
    brand: string
    targetCountry: string
    targetLanguage: string
    url: string
    affiliateLink: string | null
    // 需求28：产品价格和佣金比例
    productPrice?: string | null
    commissionPayout?: string | null
  }
}

type AdOrientation = 'brand' | 'product' | 'promo'

interface AdVariant {
  orientation: AdOrientation
  headline1: string
  headline2: string
  headline3: string
  description1: string
  description2: string
  callouts: string[]
  sitelinks: { title: string; url: string }[]
  qualityScore?: number
}

export default function LaunchAdModal({ open, onClose, offer }: LaunchAdModalProps) {
  const [currentStep, setCurrentStep] = useState(1)

  // Step 1: Ad variants selection
  const [numVariants, setNumVariants] = useState(1)
  const [selectedOrientations, setSelectedOrientations] = useState<AdOrientation[]>(['brand'])

  // Step 2: Campaign settings (Requirement 14 defaults)
  const [campaignSettings, setCampaignSettings] = useState({
    objective: 'Website traffic',
    conversionGoals: 'Page views',
    campaignType: 'Search',
    biddingStrategy: 'Maximize clicks',
    maxCpcBidLimit: '¥1.2', // or US$0.17
    dailyBudget: '¥100', // or US$100
    euPoliticalAds: 'No',
  })

  // Step 2.5: Keyword suggestions
  const [keywordSuggestions, setKeywordSuggestions] = useState<any[]>([])
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  const [isLoadingKeywords, setIsLoadingKeywords] = useState(false)
  const [showKeywords, setShowKeywords] = useState(false)

  // Step 3: Generated creatives
  const [generatedVariants, setGeneratedVariants] = useState<AdVariant[]>([])
  const [isGenerating, setIsGenerating] = useState(false)

  // 需求28：计算建议最大CPC
  const suggestedMaxCPC = useMemo(() => {
    if (offer.productPrice && offer.commissionPayout) {
      return calculateSuggestedMaxCPC(
        offer.productPrice,
        offer.commissionPayout,
        offer.targetCountry === 'CN' ? 'CNY' : 'USD'
      )
    }
    return null
  }, [offer.productPrice, offer.commissionPayout, offer.targetCountry])

  // Stepper配置
  const steps: Step[] = [
    { id: 1, label: '选择变体', description: '广告数量' },
    { id: 2, label: '配置参数', description: '系列设置' },
    { id: 3, label: '生成创意', description: 'AI评分' },
    { id: 4, label: '确认发布', description: '上线投放' },
  ]

  const handleVariantCountChange = (count: 1 | 2 | 3) => {
    setNumVariants(count)

    // Requirement 16: If 1 variant, must be brand-oriented
    if (count === 1) {
      setSelectedOrientations(['brand'])
    } else if (count === 2) {
      setSelectedOrientations(['brand', 'product'])
    } else {
      setSelectedOrientations(['brand', 'product', 'promo'])
    }
  }

  const handleGetKeywordSuggestions = async () => {
    setIsLoadingKeywords(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // 调用Keyword Planner API获取关键词建议
      const response = await fetch(`/api/offers/${offer.id}/keyword-ideas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          seedKeywords: [],
          useUrl: true,
          filterOptions: {
            minMonthlySearches: 100,
            maxCompetitionIndex: 80,
          }
        })
      })

      if (!response.ok) {
        const errorData = await response.json()

        // 处理特殊错误：需要连接Google Ads账号
        if (errorData.needsConnection) {
          const shouldConnect = confirm(
            '您还未连接Google Ads账号。\n\n' +
            '点击"确定"前往连接您的Google Ads账号，\n' +
            '点击"取消"稍后再连接。'
          )

          if (shouldConnect) {
            window.location.href = '/api/auth/google-ads/authorize'
          }
          return
        }

        // 处理特殊错误：需要重新授权
        if (errorData.needsReauth) {
          const shouldReauth = confirm(
            'Google Ads账号授权已过期。\n\n' +
            '点击"确定"重新授权，\n' +
            '点击"取消"稍后再授权。'
          )

          if (shouldReauth) {
            window.location.href = '/api/auth/google-ads/authorize'
          }
          return
        }

        throw new Error(errorData.error || '获取关键词建议失败')
      }

      const data = await response.json()

      setKeywordSuggestions(data.keywords || [])
      setShowKeywords(true)

      console.log(`✨ 获取到${data.keywords.length}个关键词建议`)
    } catch (error: any) {
      console.error('获取关键词建议失败:', error)
      alert(`获取关键词建议失败: ${error.message || '请重试'}`)
    } finally {
      setIsLoadingKeywords(false)
    }
  }

  const handleToggleKeyword = (keywordText: string) => {
    setSelectedKeywords(prev => {
      if (prev.includes(keywordText)) {
        return prev.filter(kw => kw !== keywordText)
      } else {
        return [...prev, keywordText]
      }
    })
  }

  const handleGenerateCreatives = async () => {
    setIsGenerating(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // 调用真实的AI创意生成API（Gemini 2.5）
      const response = await fetch(`/api/offers/${offer.id}/generate-creatives`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          orientations: selectedOrientations
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '生成创意失败')
      }

      const data = await response.json()

      // 转换API返回的数据为组件所需格式
      const variants: AdVariant[] = data.variants.map((variant: any) => ({
        orientation: variant.orientation,
        headline1: variant.headline1,
        headline2: variant.headline2,
        headline3: variant.headline3,
        description1: variant.description1,
        description2: variant.description2,
        callouts: variant.callouts,
        sitelinks: variant.sitelinks,
        qualityScore: variant.qualityScore
      }))

      setGeneratedVariants(variants)
      setCurrentStep(3)

      // 如果使用了学习系统，显示提示
      if (data.variants.some((v: any) => v.usedLearning)) {
        console.log('✨ 已根据历史高表现创意优化生成')
      }
    } catch (error: any) {
      console.error('创意生成失败:', error)
      alert(`创意生成失败: ${error.message || '请重试'}`)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleRegenerateVariant = async (index: number) => {
    // Requirement 17: Support regeneration with real AI
    setIsGenerating(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const currentVariant = generatedVariants[index]

      // 重新生成该导向的创意
      const response = await fetch(`/api/offers/${offer.id}/generate-creatives`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          orientations: [currentVariant.orientation] // 只生成当前导向
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '重新生成失败')
      }

      const data = await response.json()

      if (data.variants && data.variants.length > 0) {
        const newVariant: AdVariant = {
          orientation: data.variants[0].orientation,
          headline1: data.variants[0].headline1,
          headline2: data.variants[0].headline2,
          headline3: data.variants[0].headline3,
          description1: data.variants[0].description1,
          description2: data.variants[0].description2,
          callouts: data.variants[0].callouts,
          sitelinks: data.variants[0].sitelinks,
          qualityScore: data.variants[0].qualityScore
        }

        const updatedVariants = [...generatedVariants]
        updatedVariants[index] = newVariant
        setGeneratedVariants(updatedVariants)
      }
    } catch (error: any) {
      console.error('重新生成失败:', error)
      alert(`重新生成失败: ${error.message || '请重试'}`)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleLaunchAds = async () => {
    setIsGenerating(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // 调用真实的Google Ads Campaign创建API
      const response = await fetch(`/api/offers/${offer.id}/launch-ads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          variants: generatedVariants,
          campaignSettings: {
            ...campaignSettings,
            status: 'enabled', // 默认启用
          },
          keywords: selectedKeywords.map(text => ({
            text,
            matchType: 'BROAD', // 默认使用广泛匹配
          })),
        })
      })

      if (!response.ok) {
        const errorData = await response.json()

        // 处理特殊错误：需要连接Google Ads账号
        if (errorData.needsConnection) {
          const shouldConnect = confirm(
            '您还未连接Google Ads账号。\n\n' +
            '点击"确定"前往连接您的Google Ads账号，\n' +
            '点击"取消"稍后再连接。'
          )

          if (shouldConnect) {
            window.location.href = '/api/auth/google-ads/authorize'
          }
          return
        }

        // 处理特殊错误：需要重新授权
        if (errorData.needsReauth) {
          const shouldReauth = confirm(
            'Google Ads账号授权已过期。\n\n' +
            '点击"确定"重新授权，\n' +
            '点击"取消"稍后再授权。'
          )

          if (shouldReauth) {
            window.location.href = '/api/auth/google-ads/authorize'
          }
          return
        }

        throw new Error(errorData.error || '创建广告失败')
      }

      const data = await response.json()

      // 显示成功消息
      alert(
        `✅ ${data.message}\n\n` +
        `广告系列ID: ${data.campaign.id}\n` +
        `广告系列名称: ${data.campaign.name}\n` +
        `每日预算: $${data.campaign.dailyBudget}\n` +
        `广告变体数: ${data.ads.length}\n\n` +
        `您可以在Google Ads后台查看和管理您的广告。`
      )

      onClose()
    } catch (error: any) {
      console.error('创建广告失败:', error)
      alert(
        `❌ 创建广告失败\n\n` +
        `错误信息: ${error.message || '未知错误'}\n\n` +
        `请检查您的Google Ads账号连接状态，或联系技术支持。`
      )
    } finally {
      setIsGenerating(false)
    }
  }


  const renderStep1 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">选择广告变体数量</h3>
        <p className="text-sm text-muted-foreground">
          创建多个有差异化的广告可以快速测试哪种策略效果最好
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((count) => (
            <Button
              key={count}
              variant={numVariants === count ? 'default' : 'outline'}
              size="lg"
              onClick={() => handleVariantCountChange(count as 1 | 2 | 3)}
              className="h-20 flex flex-col items-center justify-center"
            >
              <span className="text-2xl font-bold">{count}</span>
              <span className="text-xs mt-1">个广告</span>
            </Button>
          ))}
        </div>

        {/* Requirement 16: Show orientations */}
        <Card>
          <CardContent className="pt-6">
            <h4 className="text-sm font-medium mb-3">广告变体类型</h4>
            <div className="space-y-2">
              {selectedOrientations.map((orientation, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {index + 1}
                  </Badge>
                  <span className="text-sm">
                    {orientation === 'brand' ? '品牌导向' : orientation === 'product' ? '产品导向' : '促销导向'}
                  </span>
                  {orientation === 'brand' && (
                    <Badge variant="outline" className="ml-auto">必选</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button onClick={() => setCurrentStep(2)}>
          下一步
        </Button>
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">广告系列设置</h3>
        <p className="text-sm text-muted-foreground">
          以下是根据最佳实践预设的默认值，您可以根据需要调整
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="objective">Objective (目标)</Label>
          <Input
            id="objective"
            value={campaignSettings.objective}
            onChange={(e) => setCampaignSettings({...campaignSettings, objective: e.target.value})}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="conversionGoals">Conversion Goals (转化目标)</Label>
          <Input
            id="conversionGoals"
            value={campaignSettings.conversionGoals}
            onChange={(e) => setCampaignSettings({...campaignSettings, conversionGoals: e.target.value})}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="campaignType">Campaign Type (广告系列类型)</Label>
          <Input
            id="campaignType"
            value={campaignSettings.campaignType}
            onChange={(e) => setCampaignSettings({...campaignSettings, campaignType: e.target.value})}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="biddingStrategy">Bidding Strategy (出价策略)</Label>
          <Input
            id="biddingStrategy"
            value={campaignSettings.biddingStrategy}
            onChange={(e) => setCampaignSettings({...campaignSettings, biddingStrategy: e.target.value})}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="maxCpc">Maximum CPC Bid Limit (最大CPC出价)</Label>
          <Input
            id="maxCpc"
            value={campaignSettings.maxCpcBidLimit}
            onChange={(e) => setCampaignSettings({...campaignSettings, maxCpcBidLimit: e.target.value})}
          />
          <p className="text-xs text-muted-foreground">默认: ¥1.2 或 US$0.17</p>
          {suggestedMaxCPC && (
            <Card className="mt-2">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs font-medium">建议最大CPC</p>
                    <p className="text-sm font-semibold text-primary">
                      {suggestedMaxCPC.currency === 'CNY' ? '¥' : '$'}{suggestedMaxCPC.formatted}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      根据产品价格 ({offer.productPrice}) × 佣金比例 ({offer.commissionPayout}) ÷ 50 计算
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="dailyBudget">Daily Budget (每日预算)</Label>
          <Input
            id="dailyBudget"
            value={campaignSettings.dailyBudget}
            onChange={(e) => setCampaignSettings({...campaignSettings, dailyBudget: e.target.value})}
          />
          <p className="text-xs text-muted-foreground">默认: ¥100 或 US$100</p>
        </div>
      </div>

      {/* Keyword Suggestions Section */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-sm font-medium">关键词建议（可选）</h4>
            <p className="text-xs text-muted-foreground mt-0.5">基于AI分析，为您推荐高价值关键词</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGetKeywordSuggestions}
            disabled={isLoadingKeywords}
          >
            {isLoadingKeywords ? '加载中...' : showKeywords ? '刷新关键词' : '获取关键词建议'}
          </Button>
        </div>

        {showKeywords && keywordSuggestions.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between text-xs mb-3">
                <span>已选中 {selectedKeywords.length} 个关键词</span>
                {selectedKeywords.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedKeywords([])}
                    className="h-auto py-1 text-xs"
                  >
                    清除选择
                  </Button>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2">
                {keywordSuggestions.slice(0, 20).map((kw, index) => (
                  <label
                    key={index}
                    className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedKeywords.includes(kw.text)}
                      onChange={() => handleToggleKeyword(kw.text)}
                      className="h-4 w-4 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{kw.text}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          月搜索: {kw.avgMonthlySearchesFormatted}
                        </Badge>
                        <Badge
                          variant={
                            kw.competition === 'LOW' ? 'default' :
                            kw.competition === 'MEDIUM' ? 'secondary' : 'destructive'
                          }
                          className="text-xs"
                        >
                          竞争: {kw.competition === 'LOW' ? '低' : kw.competition === 'MEDIUM' ? '中' : '高'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          CPC: {kw.avgTopOfPageBid}
                        </span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {keywordSuggestions.length > 20 && (
                <p className="text-xs text-muted-foreground text-center mt-3">
                  显示前20个关键词，共{keywordSuggestions.length}个建议
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {showKeywords && keywordSuggestions.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                未找到关键词建议，请尝试调整Offer信息或手动输入关键词
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setCurrentStep(1)}>
          上一步
        </Button>
        <Button onClick={handleGenerateCreatives} disabled={isGenerating}>
          {isGenerating ? '生成中...' : '生成广告创意'}
        </Button>
      </div>
    </div>
  )

  const renderStep3 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">广告创意预览与评分</h3>
        <p className="text-sm text-muted-foreground">
          AI已生成 {generatedVariants.length} 个广告变体，每个都经过质量评分（满分100分）
        </p>
      </div>

      <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
        {generatedVariants.map((variant, index) => (
          <Card key={index}>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">广告变体 {index + 1}</Badge>
                  <Badge variant="secondary">
                    {variant.orientation === 'brand' ? '品牌导向' :
                     variant.orientation === 'product' ? '产品导向' : '促销导向'}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRegenerateVariant(index)}
                  disabled={isGenerating}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  {isGenerating ? '生成中...' : '重新生成'}
                </Button>
              </div>

              {/* Quality Score */}
              <div className="flex items-center gap-2 mb-4 p-3 bg-accent/50 rounded-lg">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">质量评分:</span>
                <span className={`text-xl font-bold ${
                  variant.qualityScore && variant.qualityScore >= 90 ? 'text-green-600' :
                  variant.qualityScore && variant.qualityScore >= 80 ? 'text-blue-600' :
                  'text-yellow-600'
                }`}>
                  {variant.qualityScore}/100
                </span>
              </div>

              {/* Ad Content */}
              <div className="space-y-3 text-sm">
                <div className="p-2 bg-accent/20 rounded">
                  <span className="font-medium text-muted-foreground text-xs">标题1</span>
                  <p className="text-base font-medium">{variant.headline1}</p>
                </div>
                <div className="p-2 bg-accent/20 rounded">
                  <span className="font-medium text-muted-foreground text-xs">标题2</span>
                  <p className="text-base font-medium">{variant.headline2}</p>
                </div>
                <div className="p-2 bg-accent/20 rounded">
                  <span className="font-medium text-muted-foreground text-xs">标题3</span>
                  <p className="text-base font-medium">{variant.headline3}</p>
                </div>
                <div className="p-2 bg-accent/20 rounded">
                  <span className="font-medium text-muted-foreground text-xs">描述1</span>
                  <p>{variant.description1}</p>
                </div>
                <div className="p-2 bg-accent/20 rounded">
                  <span className="font-medium text-muted-foreground text-xs">描述2</span>
                  <p>{variant.description2}</p>
                </div>
                <div className="p-2 bg-accent/20 rounded">
                  <span className="font-medium text-muted-foreground text-xs">摘录</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {variant.callouts.map((callout, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {callout}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setCurrentStep(2)}>
          上一步
        </Button>
        <Button onClick={() => setCurrentStep(4)}>
          下一步
        </Button>
      </div>
    </div>
  )

  const renderStep4 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">确认并发布</h3>
        <p className="text-sm text-muted-foreground">
          请确认以下信息无误后，点击"立即发布"创建Google Ads广告
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs mb-1">Offer名称</p>
              <p className="font-medium">{offer.offerName}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">品牌</p>
              <p className="font-medium">{offer.brand}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">推广国家</p>
              <Badge variant="outline">{offer.targetCountry}</Badge>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">推广语言</p>
              <p className="font-medium">{offer.targetLanguage}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">广告变体数</p>
              <Badge>{numVariants} 个</Badge>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">每日预算</p>
              <p className="font-medium">{campaignSettings.dailyBudget}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">出价策略</p>
              <p className="font-medium">{campaignSettings.biddingStrategy}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">最大CPC</p>
              <p className="font-medium">{campaignSettings.maxCpcBidLimit}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-yellow-200 bg-yellow-50/50">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-sm font-medium text-yellow-800 mb-2">重要提示</h4>
              <p className="text-sm text-yellow-700 mb-2">
                发布后广告将立即在Google Ads平台上线并开始投放，请确保：
              </p>
              <ul className="text-sm text-yellow-700 space-y-1 ml-4 list-disc">
                <li>Google Ads账号已正确关联</li>
                <li>账号余额充足</li>
                <li>广告内容符合Google Ads政策</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setCurrentStep(3)}>
          上一步
        </Button>
        <Button onClick={handleLaunchAds} className="bg-green-600 hover:bg-green-700">
          <Rocket className="w-4 h-4 mr-2" />
          立即发布
        </Button>
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            一键上广告 - {offer.offerName}
          </DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <Stepper steps={steps} currentStep={currentStep} className="mb-6" />

        {/* Step Content */}
        <div className="mt-2">
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
          {currentStep === 4 && renderStep4()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
