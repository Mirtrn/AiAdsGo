'use client'

/**
 * One-Click Ad Launch Page - 一键上广告
 *
 * 四步流程：
 * 1. 生成广告创意并评分
 * 2. 配置广告系列参数
 * 3. 关联Google Ads账号
 * 4. 发布广告
 */

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Stepper, type Step } from '@/components/ui/stepper'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { showError } from '@/lib/toast-utils'
import Step1CreativeGeneration from './steps/Step1CreativeGeneration'
import Step2CampaignConfig from './steps/Step2CampaignConfig'
import Step3AccountLinking from './steps/Step3AccountLinking'
import Step4PublishSummary from './steps/Step4PublishSummary'

// 定义步骤
const STEPS: Step[] = [
  { id: 1, label: '生成创意', description: 'AI生成广告创意' },
  { id: 2, label: '配置广告', description: '设置广告系列参数' },
  { id: 3, label: '关联账号', description: '绑定Google Ads' },
  { id: 4, label: '发布上线', description: '确认并发布' }
]

interface Offer {
  id: number
  url: string
  brand: string
  category: string | null
  offerName: string | null
  targetCountry: string
  targetLanguage: string | null
  scrape_status: string
  enhanced_data?: any
}

interface SelectedCreative {
  id: number
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  callouts?: string[]
  sitelinks?: Array<{
    text: string
    url: string
    description?: string
  }>
  final_url: string
  final_url_suffix?: string
  score: number
  score_breakdown: {
    relevance: number
    quality: number
    engagement: number
    diversity: number
    clarity: number
  }
  theme: string
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

interface GoogleAdsAccount {
  id: number
  customer_id: string
  account_name?: string
  is_active: boolean
}

export default function LaunchAdPage() {
  const router = useRouter()
  const params = useParams()
  const offerId = parseInt((params?.id as string) || '0')

  const [currentStep, setCurrentStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [offer, setOffer] = useState<Offer | null>(null)

  // Step data
  const [selectedCreative, setSelectedCreative] = useState<SelectedCreative | null>(null)
  const [campaignConfig, setCampaignConfig] = useState<CampaignConfig | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<GoogleAdsAccount | null>(null)

  // Navigation state
  const [canProceed, setCanProceed] = useState(false)

  useEffect(() => {
    fetchOffer()
  }, [offerId])

  const fetchOffer = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/offers/${offerId}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('获取Offer失败')
      }

      const data = await response.json()

      // 检查抓取状态
      if (data.offer.scrape_status !== 'completed') {
        showError('无法生成广告', '请先完成网页抓取后再生成广告创意')
        router.push('/offers')
        return
      }

      setOffer(data.offer)
    } catch (error: any) {
      showError('加载失败', error.message)
      router.push('/offers')
    } finally {
      setLoading(false)
    }
  }

  const handleNext = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1)
      setCanProceed(false)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
      // Re-enable proceed for previous step
      setCanProceed(true)
    }
  }

  const handleCreativeSelected = (creative: SelectedCreative) => {
    setSelectedCreative(creative)
    setCanProceed(true)
  }

  const handleCampaignConfigured = (config: CampaignConfig) => {
    setCampaignConfig(config)
    setCanProceed(true)
  }

  const handleAccountLinked = (account: GoogleAdsAccount) => {
    setSelectedAccount(account)
    setCanProceed(true)
  }

  const handlePublishComplete = () => {
    router.push(`/offers/${offerId}`)
  }

  if (loading || !offer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/offers')}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                返回Offers
              </Button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">一键上广告</h1>
                <p className="text-sm text-gray-500">
                  {offer.offerName || offer.brand} · {offer.targetCountry}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Stepper */}
        <Card className="mb-8">
          <CardContent className="pt-8 pb-6">
            <Stepper steps={STEPS} currentStep={currentStep} />
          </CardContent>
        </Card>

        {/* Step Content */}
        <div className="mb-6">
          {currentStep === 1 && (
            <Step1CreativeGeneration
              offer={offer}
              onCreativeSelected={handleCreativeSelected}
              selectedCreative={selectedCreative}
            />
          )}

          {currentStep === 2 && (
            <Step2CampaignConfig
              offer={offer}
              selectedCreative={selectedCreative!}
              onConfigured={handleCampaignConfigured}
              initialConfig={campaignConfig}
            />
          )}

          {currentStep === 3 && (
            <Step3AccountLinking
              offer={offer}
              onAccountLinked={handleAccountLinked}
              selectedAccount={selectedAccount}
            />
          )}

          {currentStep === 4 && (
            <Step4PublishSummary
              offer={offer}
              selectedCreative={selectedCreative!}
              campaignConfig={campaignConfig!}
              selectedAccount={selectedAccount!}
              onPublishComplete={handlePublishComplete}
            />
          )}
        </div>

        {/* Navigation Buttons */}
        {currentStep < 4 && (
          <Card>
            <CardContent className="py-4">
              <div className="flex justify-between items-center">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={currentStep === 1}
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  上一步
                </Button>

                <Button
                  onClick={handleNext}
                  disabled={!canProceed}
                >
                  下一步
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
