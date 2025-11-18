'use client'

import { useState, useMemo } from 'react'
import { calculateSuggestedMaxCPC } from '@/lib/pricing-utils'

interface LaunchAdModalProps {
  isOpen: boolean
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

export default function LaunchAdModal({ isOpen, onClose, offer }: LaunchAdModalProps) {
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

  if (!isOpen) return null

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

  const renderStepIndicator = () => (
    <div className="flex items-center justify-between mb-8">
      {[1, 2, 3, 4].map((step) => (
        <div key={step} className="flex items-center flex-1">
          <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
            currentStep >= step
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'bg-white border-gray-300 text-gray-500'
          }`}>
            {step}
          </div>
          {step < 4 && (
            <div className={`flex-1 h-1 mx-2 ${
              currentStep > step ? 'bg-indigo-600' : 'bg-gray-300'
            }`} />
          )}
        </div>
      ))}
    </div>
  )

  const renderStep1 = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">选择广告变体数量</h3>
      <p className="text-sm text-gray-600">
        创建多个有差异化的广告可以快速测试哪种策略效果最好
      </p>

      <div className="space-y-4">
        <div className="flex space-x-4">
          {[1, 2, 3].map((count) => (
            <button
              key={count}
              onClick={() => handleVariantCountChange(count as 1 | 2 | 3)}
              className={`flex-1 py-3 px-4 border-2 rounded-lg font-medium ${
                numVariants === count
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
              }`}
            >
              {count} 个广告
            </button>
          ))}
        </div>

        {/* Requirement 16: Show orientations */}
        <div className="bg-gray-50 p-4 rounded-md">
          <h4 className="text-sm font-medium text-gray-900 mb-2">广告变体类型</h4>
          <ul className="space-y-1 text-sm text-gray-600">
            {selectedOrientations.map((orientation, index) => (
              <li key={index}>
                {index + 1}. {orientation === 'brand' ? '品牌导向' : orientation === 'product' ? '产品导向' : '促销导向'}
                {orientation === 'brand' && ' (必选)'}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex justify-end space-x-3 pt-4">
        <button
          onClick={onClose}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          取消
        </button>
        <button
          onClick={() => setCurrentStep(2)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
        >
          下一步
        </button>
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">广告系列设置</h3>
      <p className="text-sm text-gray-600">
        以下是根据最佳实践预设的默认值，您可以根据需要调整
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Objective (目标)
          </label>
          <input
            type="text"
            value={campaignSettings.objective}
            onChange={(e) => setCampaignSettings({...campaignSettings, objective: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Conversion Goals (转化目标)
          </label>
          <input
            type="text"
            value={campaignSettings.conversionGoals}
            onChange={(e) => setCampaignSettings({...campaignSettings, conversionGoals: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Campaign Type (广告系列类型)
          </label>
          <input
            type="text"
            value={campaignSettings.campaignType}
            onChange={(e) => setCampaignSettings({...campaignSettings, campaignType: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Bidding Strategy (出价策略)
          </label>
          <input
            type="text"
            value={campaignSettings.biddingStrategy}
            onChange={(e) => setCampaignSettings({...campaignSettings, biddingStrategy: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Maximum CPC Bid Limit (最大CPC出价)
          </label>
          <input
            type="text"
            value={campaignSettings.maxCpcBidLimit}
            onChange={(e) => setCampaignSettings({...campaignSettings, maxCpcBidLimit: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
          <p className="mt-1 text-xs text-gray-500">默认: ¥1.2 或 US$0.17</p>
          {suggestedMaxCPC && (
            <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
              <strong>💡 建议最大CPC</strong>: {suggestedMaxCPC.currency === 'CNY' ? '¥' : '$'}{suggestedMaxCPC.formatted}
              <div className="text-blue-600 mt-0.5">
                根据产品价格 ({offer.productPrice}) × 佣金比例 ({offer.commissionPayout}) ÷ 50 计算
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Daily Budget (每日预算)
          </label>
          <input
            type="text"
            value={campaignSettings.dailyBudget}
            onChange={(e) => setCampaignSettings({...campaignSettings, dailyBudget: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
          <p className="mt-1 text-xs text-gray-500">默认: ¥100 或 US$100</p>
        </div>
      </div>

      {/* Keyword Suggestions Section */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-sm font-medium text-gray-900">关键词建议（可选）</h4>
            <p className="text-xs text-gray-500 mt-0.5">基于AI分析，为您推荐高价值关键词</p>
          </div>
          <button
            onClick={handleGetKeywordSuggestions}
            disabled={isLoadingKeywords}
            className="px-3 py-1.5 text-sm border border-indigo-600 text-indigo-600 rounded-md hover:bg-indigo-50 disabled:opacity-50"
          >
            {isLoadingKeywords ? '加载中...' : showKeywords ? '刷新关键词' : '获取关键词建议'}
          </button>
        </div>

        {showKeywords && keywordSuggestions.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-md p-3 bg-gray-50">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
              <span>已选中 {selectedKeywords.length} 个关键词</span>
              {selectedKeywords.length > 0 && (
                <button
                  onClick={() => setSelectedKeywords([])}
                  className="text-indigo-600 hover:text-indigo-800"
                >
                  清除选择
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              {keywordSuggestions.slice(0, 20).map((kw, index) => (
                <label
                  key={index}
                  className={`flex items-center justify-between p-2 border rounded cursor-pointer hover:bg-white ${
                    selectedKeywords.includes(kw.text)
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-center flex-1">
                    <input
                      type="checkbox"
                      checked={selectedKeywords.includes(kw.text)}
                      onChange={() => handleToggleKeyword(kw.text)}
                      className="h-4 w-4 text-indigo-600 rounded mr-2"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">{kw.text}</div>
                      <div className="flex items-center space-x-3 text-xs text-gray-500 mt-0.5">
                        <span>月搜索: {kw.avgMonthlySearchesFormatted}</span>
                        <span className={`px-1.5 py-0.5 rounded ${
                          kw.competition === 'LOW' ? 'bg-green-100 text-green-700' :
                          kw.competition === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          竞争: {kw.competition === 'LOW' ? '低' : kw.competition === 'MEDIUM' ? '中' : '高'}
                        </span>
                        <span>CPC: {kw.avgTopOfPageBid}</span>
                      </div>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {keywordSuggestions.length > 20 && (
              <p className="text-xs text-gray-500 text-center mt-2">
                显示前20个关键词，共{keywordSuggestions.length}个建议
              </p>
            )}
          </div>
        )}

        {showKeywords && keywordSuggestions.length === 0 && (
          <div className="text-sm text-gray-500 text-center py-4 border border-gray-200 rounded-md">
            未找到关键词建议，请尝试调整Offer信息或手动输入关键词
          </div>
        )}
      </div>

      <div className="flex justify-between pt-4">
        <button
          onClick={() => setCurrentStep(1)}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          上一步
        </button>
        <button
          onClick={handleGenerateCreatives}
          disabled={isGenerating}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {isGenerating ? '生成中...' : '生成广告创意'}
        </button>
      </div>
    </div>
  )

  const renderStep3 = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">广告创意预览与评分</h3>
      <p className="text-sm text-gray-600">
        AI已生成 {generatedVariants.length} 个广告变体，每个都经过质量评分（满分100分）
      </p>

      <div className="space-y-4 max-h-96 overflow-y-auto">
        {generatedVariants.map((variant, index) => (
          <div key={index} className="border border-gray-300 rounded-lg p-4 bg-white">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h4 className="font-medium text-gray-900">
                  广告变体 {index + 1} -
                  {variant.orientation === 'brand' ? ' 品牌导向' :
                   variant.orientation === 'product' ? ' 产品导向' : ' 促销导向'}
                </h4>
                <div className="flex items-center mt-1">
                  <span className="text-sm font-medium text-gray-700">质量评分: </span>
                  <span className={`ml-2 text-lg font-bold ${
                    variant.qualityScore && variant.qualityScore >= 90 ? 'text-green-600' :
                    variant.qualityScore && variant.qualityScore >= 80 ? 'text-blue-600' :
                    'text-yellow-600'
                  }`}>
                    {variant.qualityScore}/100
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleRegenerateVariant(index)}
                disabled={isGenerating}
                className="px-3 py-1 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {isGenerating ? '生成中...' : '重新生成'}
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-gray-700">标题1: </span>
                <span className="text-gray-900">{variant.headline1}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">标题2: </span>
                <span className="text-gray-900">{variant.headline2}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">标题3: </span>
                <span className="text-gray-900">{variant.headline3}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">描述1: </span>
                <span className="text-gray-900">{variant.description1}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">描述2: </span>
                <span className="text-gray-900">{variant.description2}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">摘录: </span>
                <span className="text-gray-900">{variant.callouts.join(', ')}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between pt-4">
        <button
          onClick={() => setCurrentStep(2)}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          上一步
        </button>
        <button
          onClick={() => setCurrentStep(4)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
        >
          下一步
        </button>
      </div>
    </div>
  )

  const renderStep4 = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">确认并发布</h3>
      <p className="text-sm text-gray-600">
        请确认以下信息无误后，点击"立即发布"创建Google Ads广告
      </p>

      <div className="bg-gray-50 p-4 rounded-lg space-y-3">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium text-gray-700">Offer名称: </span>
            <span className="text-gray-900">{offer.offerName}</span>
          </div>
          <div>
            <span className="font-medium text-gray-700">品牌: </span>
            <span className="text-gray-900">{offer.brand}</span>
          </div>
          <div>
            <span className="font-medium text-gray-700">推广国家: </span>
            <span className="text-gray-900">{offer.targetCountry}</span>
          </div>
          <div>
            <span className="font-medium text-gray-700">推广语言: </span>
            <span className="text-gray-900">{offer.targetLanguage}</span>
          </div>
          <div>
            <span className="font-medium text-gray-700">广告变体数: </span>
            <span className="text-gray-900">{numVariants}</span>
          </div>
          <div>
            <span className="font-medium text-gray-700">每日预算: </span>
            <span className="text-gray-900">{campaignSettings.dailyBudget}</span>
          </div>
          <div>
            <span className="font-medium text-gray-700">出价策略: </span>
            <span className="text-gray-900">{campaignSettings.biddingStrategy}</span>
          </div>
          <div>
            <span className="font-medium text-gray-700">最大CPC: </span>
            <span className="text-gray-900">{campaignSettings.maxCpcBidLimit}</span>
          </div>
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
        <div className="flex">
          <svg className="h-5 w-5 text-yellow-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-yellow-800">重要提示</h3>
            <div className="mt-2 text-sm text-yellow-700">
              <p>发布后广告将立即在Google Ads平台上线并开始投放，请确保：</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Google Ads账号已正确关联</li>
                <li>账号余额充足</li>
                <li>广告内容符合Google Ads政策</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <button
          onClick={() => setCurrentStep(3)}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          上一步
        </button>
        <button
          onClick={handleLaunchAds}
          className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium"
        >
          立即发布
        </button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
          onClick={onClose}
        />

        {/* Modal panel */}
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
          <div className="bg-white px-6 pt-6 pb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900">
                一键上广告 - {offer.offerName}
              </h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {renderStepIndicator()}

            <div className="mt-6">
              {currentStep === 1 && renderStep1()}
              {currentStep === 2 && renderStep2()}
              {currentStep === 3 && renderStep3()}
              {currentStep === 4 && renderStep4()}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
