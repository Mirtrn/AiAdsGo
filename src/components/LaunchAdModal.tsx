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
import { Textarea } from '@/components/ui/textarea'
import { AlertCircle, RefreshCw, Wand2, Rocket } from 'lucide-react'
import { showSuccess, showError, showWarning, showConfirm } from '@/lib/toast-utils'

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
          const shouldConnect = await showConfirm(
            '未连接Google Ads账号',
            '您还未连接Google Ads账号。点击"确定"前往连接，点击"取消"稍后再连接。'
          )

          if (shouldConnect) {
            window.location.href = '/api/auth/google-ads/authorize'
          }
          return
        }

        // 处理特殊错误：需要重新授权
        if (errorData.needsReauth) {
          const shouldReauth = await showConfirm(
            'Google Ads授权已过期',
            'Google Ads账号授权已过期。点击"确定"重新授权，点击"取消"稍后再授权。'
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

      showSuccess('关键词获取成功', `已获取到 ${data.keywords.length} 个关键词建议`)
    } catch (error: any) {
      console.error('获取关键词建议失败:', error)
      showError('获取关键词建议失败', error.message || '请重试')
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
        showSuccess('创意生成成功', '已根据历史高表现创意优化生成')
      } else {
        showSuccess('创意生成成功', `已生成 ${variants.length} 个广告变体`)
      }
    } catch (error: any) {
      console.error('创意生成失败:', error)
      showError('创意生成失败', error.message || '请重试')
    } finally {
      setIsGenerating(false)
    }
  }

  // P1-4: 更新单个variant的字段
  const updateVariantField = (variantIndex: number, field: keyof AdVariant, value: string) => {
    const updatedVariants = [...generatedVariants]
    updatedVariants[variantIndex] = {
      ...updatedVariants[variantIndex],
      [field]: value
    }
    setGeneratedVariants(updatedVariants)
  }

  // P1-4: 更新callouts数组中的特定项
  const updateCallout = (variantIndex: number, calloutIndex: number, value: string) => {
    const updatedVariants = [...generatedVariants]
    const updatedCallouts = [...updatedVariants[variantIndex].callouts]
    updatedCallouts[calloutIndex] = value
    updatedVariants[variantIndex] = {
      ...updatedVariants[variantIndex],
      callouts: updatedCallouts
    }
    setGeneratedVariants(updatedVariants)
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
        showSuccess('重新生成成功', '广告创意已更新')
      }
    } catch (error: any) {
      console.error('重新生成失败:', error)
      showError('重新生成失败', error.message || '请重试')
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
          const shouldConnect = await showConfirm(
            '未连接Google Ads账号',
            '您还未连接Google Ads账号。点击"确定"前往连接，点击"取消"稍后再连接。'
          )

          if (shouldConnect) {
            window.location.href = '/api/auth/google-ads/authorize'
          }
          return
        }

        // 处理特殊错误：需要重新授权
        if (errorData.needsReauth) {
          const shouldReauth = await showConfirm(
            'Google Ads授权已过期',
            'Google Ads账号授权已过期。点击"确定"重新授权，点击"取消"稍后再授权。'
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
      showSuccess(
        '广告发布成功',
        `${data.campaign.name} 已创建，包含 ${data.ads.length} 个广告变体。您可以在Google Ads后台查看和管理。`
      )

      onClose()
    } catch (error: any) {
      console.error('创建广告失败:', error)
      showError(
        '创建广告失败',
        error.message || '请检查您的Google Ads账号连接状态，或联系技术支持'
      )
    } finally {
      setIsGenerating(false)
    }
  }


  const renderStep1 = () => (
    <div className="space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold text-gray-900">Select Ad Strategy</h3>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Choose how many ad variants to launch. Testing multiple angles helps identify high-performing copy faster.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((count) => (
          <div
            key={count}
            onClick={() => handleVariantCountChange(count as 1 | 2 | 3)}
            className={`cursor-pointer relative p-6 rounded-2xl border-2 transition-all duration-200 hover:shadow-lg ${numVariants === count
              ? 'border-blue-600 bg-blue-50/50 ring-1 ring-blue-600'
              : 'border-gray-200 bg-white hover:border-blue-300'
              }`}
          >
            <div className="flex flex-col items-center text-center space-y-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold transition-colors ${numVariants === count ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}>
                {count}
              </div>
              <div>
                <span className="block text-lg font-bold text-gray-900">{count} Ad{count > 1 ? 's' : ''}</span>
                <span className="text-xs text-gray-500 mt-1 block">
                  {count === 1 ? 'Brand Focus' : count === 2 ? 'Brand + Product' : 'Brand + Product + Promo'}
                </span>
              </div>
            </div>
            {numVariants === count && (
              <div className="absolute top-4 right-4 text-blue-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>

      <Card className="bg-gray-50 border-gray-200 shadow-sm">
        <CardContent className="pt-6">
          <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-blue-600 rounded-full"></span>
            Selected Strategy Mix
          </h4>
          <div className="space-y-3">
            {selectedOrientations.map((orientation, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-100 shadow-sm">
                <Badge variant="secondary" className="h-6 w-6 rounded-full flex items-center justify-center p-0">
                  {index + 1}
                </Badge>
                <div className="flex-1">
                  <span className="text-sm font-medium text-gray-900 block">
                    {orientation === 'brand' ? 'Brand Oriented' : orientation === 'product' ? 'Product Oriented' : 'Promo Oriented'}
                  </span>
                  <span className="text-xs text-gray-500">
                    {orientation === 'brand' ? 'Focuses on brand identity and trust.' :
                      orientation === 'product' ? 'Highlights specific product features.' :
                        'Emphasizes special offers and discounts.'}
                  </span>
                </div>
                {orientation === 'brand' && (
                  <Badge variant="outline" className="text-xs border-blue-200 text-blue-700 bg-blue-50">Required</Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pt-4">
        <Button onClick={() => setCurrentStep(2)} className="w-full sm:w-auto px-8">
          Next Step
        </Button>
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div className="space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold text-gray-900">Campaign Settings</h3>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Configure your campaign parameters. We've pre-filled these with best practices.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="objective" className="text-sm font-medium text-gray-700">Objective</Label>
          <Input
            id="objective"
            value={campaignSettings.objective}
            onChange={(e) => setCampaignSettings({ ...campaignSettings, objective: e.target.value })}
            className="bg-white"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="conversionGoals" className="text-sm font-medium text-gray-700">Conversion Goals</Label>
          <Input
            id="conversionGoals"
            value={campaignSettings.conversionGoals}
            onChange={(e) => setCampaignSettings({ ...campaignSettings, conversionGoals: e.target.value })}
            className="bg-white"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="campaignType" className="text-sm font-medium text-gray-700">Campaign Type</Label>
          <Input
            id="campaignType"
            value={campaignSettings.campaignType}
            onChange={(e) => setCampaignSettings({ ...campaignSettings, campaignType: e.target.value })}
            className="bg-white"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="biddingStrategy" className="text-sm font-medium text-gray-700">Bidding Strategy</Label>
          <Input
            id="biddingStrategy"
            value={campaignSettings.biddingStrategy}
            onChange={(e) => setCampaignSettings({ ...campaignSettings, biddingStrategy: e.target.value })}
            className="bg-white"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="maxCpc" className="text-sm font-medium text-gray-700">Max CPC Bid Limit</Label>
          <div className="relative">
            <Input
              id="maxCpc"
              value={campaignSettings.maxCpcBidLimit}
              onChange={(e) => setCampaignSettings({ ...campaignSettings, maxCpcBidLimit: e.target.value })}
              className="bg-white pr-20"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Default: ¥1.2</span>
          </div>

          {suggestedMaxCPC && (
            <div className="mt-2 p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-start gap-3">
              <Wand2 className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-blue-900">AI Suggested Max CPC</p>
                <p className="text-sm font-bold text-blue-700">
                  {suggestedMaxCPC.currency === 'CNY' ? '¥' : '$'}{suggestedMaxCPC.formatted}
                </p>
                <p className="text-[10px] text-blue-600/80 mt-0.5">
                  Based on product price ({offer.productPrice}) & commission ({offer.commissionPayout})
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="dailyBudget" className="text-sm font-medium text-gray-700">Daily Budget</Label>
          <div className="relative">
            <Input
              id="dailyBudget"
              value={campaignSettings.dailyBudget}
              onChange={(e) => setCampaignSettings({ ...campaignSettings, dailyBudget: e.target.value })}
              className="bg-white pr-20"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Default: ¥100</span>
          </div>
        </div>
      </div>

      {/* Keyword Suggestions Section */}
      <div className="border-t border-gray-100 pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Keyword Suggestions</h4>
            <p className="text-xs text-gray-500 mt-0.5">Get high-value keywords based on AI analysis.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGetKeywordSuggestions}
            disabled={isLoadingKeywords}
            className="text-blue-600 border-blue-200 hover:bg-blue-50"
          >
            {isLoadingKeywords ? (
              <>
                <RefreshCw className="w-3 h-3 mr-2 animate-spin" /> Loading...
              </>
            ) : showKeywords ? 'Refresh Keywords' : 'Get Suggestions'}
          </Button>
        </div>

        {showKeywords && keywordSuggestions.length > 0 && (
          <Card className="border-gray-200 shadow-sm">
            <CardContent className="p-0">
              <div className="p-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">Selected: {selectedKeywords.length}</span>
                {selectedKeywords.length > 0 && (
                  <button
                    onClick={() => setSelectedKeywords([])}
                    className="text-xs text-red-500 hover:text-red-600 font-medium"
                  >
                    Clear Selection
                  </button>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                {keywordSuggestions.slice(0, 20).map((kw, index) => (
                  <label
                    key={index}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200 border ${selectedKeywords.includes(kw.text)
                      ? 'bg-blue-50 border-blue-200'
                      : 'hover:bg-gray-50 border-transparent'
                      }`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selectedKeywords.includes(kw.text) ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
                      }`}>
                      {selectedKeywords.includes(kw.text) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedKeywords.includes(kw.text)}
                      onChange={() => handleToggleKeyword(kw.text)}
                      className="hidden"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{kw.text}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-800">
                          Vol: {kw.avgMonthlySearchesFormatted}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${kw.competition === 'LOW' ? 'bg-green-100 text-green-800' :
                          kw.competition === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                          }`}>
                          Comp: {kw.competition === 'LOW' ? 'Low' : kw.competition === 'MEDIUM' ? 'Med' : 'High'}
                        </span>
                        <span className="text-[10px] text-gray-500">
                          CPC: {kw.avgTopOfPageBid}
                        </span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={() => setCurrentStep(1)}>
          Back
        </Button>
        <Button onClick={handleGenerateCreatives} disabled={isGenerating} className="min-w-[140px]">
          {isGenerating ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generating...
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4 mr-2" /> Generate Ads
            </>
          )}
        </Button>
      </div>
    </div>
  )

  const renderStep3 = () => (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold text-gray-900">Review Ad Creatives</h3>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          AI has generated {generatedVariants.length} variants. Review and regenerate if needed.
        </p>
      </div>

      <div className="space-y-6 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
        {generatedVariants.map((variant, index) => (
          <Card key={index} className="overflow-hidden border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gray-50/50 border-b border-gray-100 p-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold">
                  {index + 1}
                </span>
                <Badge variant="secondary" className="bg-white border border-gray-200 text-gray-700">
                  {variant.orientation === 'brand' ? 'Brand Focus' :
                    variant.orientation === 'product' ? 'Product Focus' : 'Promo Focus'}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 px-3 py-1 bg-white rounded-full border border-gray-200 shadow-sm">
                  <Wand2 className="w-3.5 h-3.5 text-yellow-500" />
                  <span className="text-xs font-medium text-gray-600">Score:</span>
                  <span className={`text-sm font-bold ${variant.qualityScore && variant.qualityScore >= 90 ? 'text-green-600' :
                    variant.qualityScore && variant.qualityScore >= 80 ? 'text-blue-600' :
                      'text-yellow-600'
                    }`}>
                    {variant.qualityScore}/100
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRegenerateVariant(index)}
                  disabled={isGenerating}
                  className="h-8 w-8 p-0 rounded-full hover:bg-gray-200"
                >
                  <RefreshCw className={`w-4 h-4 text-gray-500 ${isGenerating ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>

            <CardContent className="p-5 space-y-5">
              {/* Headlines - P1-4: 可编辑 */}
              <div className="space-y-3">
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Headlines (可编辑)</h5>
                <div className="grid gap-2">
                  {['headline1', 'headline2', 'headline3'].map((field, i) => (
                    <Input
                      key={i}
                      value={variant[field as keyof AdVariant] as string}
                      onChange={(e) => updateVariantField(index, field as keyof AdVariant, e.target.value)}
                      className="text-sm font-medium"
                      placeholder={`标题 ${i + 1}`}
                      maxLength={30}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-500">每个标题最多30个字符</p>
              </div>

              {/* Descriptions - P1-4: 可编辑 */}
              <div className="space-y-3">
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Descriptions (可编辑)</h5>
                <div className="grid gap-2">
                  {['description1', 'description2'].map((field, i) => (
                    <Textarea
                      key={i}
                      value={variant[field as keyof AdVariant] as string}
                      onChange={(e) => updateVariantField(index, field as keyof AdVariant, e.target.value)}
                      className="text-sm leading-relaxed min-h-[80px]"
                      placeholder={`描述 ${i + 1}`}
                      maxLength={90}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-500">每个描述最多90个字符</p>
              </div>

              {/* Assets - P1-4: 可编辑 */}
              <div className="space-y-3">
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Callouts 附加信息 (可编辑)</h5>
                <div className="grid gap-2">
                  {variant.callouts.map((callout, idx) => (
                    <Input
                      key={idx}
                      value={callout}
                      onChange={(e) => updateCallout(index, idx, e.target.value)}
                      className="text-sm"
                      placeholder={`附加信息 ${idx + 1}`}
                      maxLength={25}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-500">每个附加信息最多25个字符</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={() => setCurrentStep(2)}>
          Back
        </Button>
        <Button onClick={() => setCurrentStep(4)} className="min-w-[140px]">
          Next Step
        </Button>
      </div>
    </div>
  )

  const renderStep4 = () => (
    <div className="space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold text-gray-900">Ready to Launch</h3>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Review your campaign details one last time before launching.
        </p>
      </div>

      <Card className="overflow-hidden border-gray-200 shadow-sm">
        <div className="bg-gray-50/50 px-6 py-4 border-b border-gray-100">
          <h4 className="font-semibold text-gray-900">Campaign Summary</h4>
        </div>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 gap-y-6 gap-x-8">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Offer Name</p>
              <p className="font-medium text-gray-900">{offer.offerName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Brand</p>
              <p className="font-medium text-gray-900">{offer.brand}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Targeting</p>
              <div className="flex gap-2">
                <Badge variant="outline" className="bg-gray-50">{offer.targetCountry}</Badge>
                <Badge variant="outline" className="bg-gray-50">{offer.targetLanguage}</Badge>
              </div>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">🎯 Campaigns to Create</p>
              <div className="flex flex-wrap gap-2">
                {generatedVariants.map((variant, index) => (
                  <Badge
                    key={index}
                    className="bg-gradient-to-r from-purple-100 to-blue-100 text-purple-800 hover:from-purple-200 hover:to-blue-200 border-none px-3 py-1"
                  >
                    {index + 1}. {variant.orientation} theme
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-2">
                💡 Each campaign focuses on a single theme for better performance
              </p>
            </div>
            <div className="col-span-2 border-t border-gray-100 pt-4 mt-2"></div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Daily Budget</p>
              <p className="font-bold text-gray-900 text-lg">{campaignSettings.dailyBudget}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Max CPC</p>
              <p className="font-bold text-gray-900 text-lg">{campaignSettings.maxCpcBidLimit}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="text-sm font-medium text-blue-900 mb-1">🎯 Single-Theme Campaign Strategy</h4>
          <p className="text-sm text-blue-800 leading-relaxed mb-2">
            This will create <strong>{generatedVariants.length} separate campaigns</strong>, each focused on a single theme ({generatedVariants.map(v => v.orientation).join(', ')}). This approach improves ad relevance and Quality Score by 30-40%.
          </p>
          <p className="text-xs text-blue-700">
            💡 Each campaign will have its own budget, keywords, and ad group optimized for its theme.
          </p>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={() => setCurrentStep(3)}>
          Back
        </Button>
        <Button
          onClick={handleLaunchAds}
          className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 min-w-[160px]"
          disabled={isGenerating}
        >
          {isGenerating ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Launching...
            </>
          ) : (
            <>
              <Rocket className="w-4 h-4 mr-2" /> Launch {generatedVariants.length} Campaign{generatedVariants.length > 1 ? 's' : ''}
            </>
          )}
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
