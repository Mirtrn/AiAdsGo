'use client'

/**
 * 新版Offer创建流程（多步骤）
 * 步骤1: 用户输入（推广链接+国家+可选参数）
 * 步骤2: 自动提取（Final URL + 品牌名称）
 * 步骤3: 用户确认（可修正品牌名称）
 */

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'

interface CreateOfferModalV2Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const countries = [
  { code: 'US', name: '美国 (US)' },
  { code: 'GB', name: '英国 (GB)' },
  { code: 'CA', name: '加拿大 (CA)' },
  { code: 'AU', name: '澳大利亚 (AU)' },
  { code: 'DE', name: '德国 (DE)' },
  { code: 'FR', name: '法国 (FR)' },
  { code: 'ES', name: '西班牙 (ES)' },
  { code: 'IT', name: '意大利 (IT)' },
  { code: 'NL', name: '荷兰 (NL)' },
  { code: 'SE', name: '瑞典 (SE)' },
  { code: 'NO', name: '挪威 (NO)' },
  { code: 'DK', name: '丹麦 (DK)' },
  { code: 'FI', name: '芬兰 (FI)' },
  { code: 'PL', name: '波兰 (PL)' },
  { code: 'JP', name: '日本 (JP)' },
  { code: 'CN', name: '中国 (CN)' },
  { code: 'KR', name: '韩国 (KR)' },
  { code: 'IN', name: '印度 (IN)' },
  { code: 'TH', name: '泰国 (TH)' },
  { code: 'VN', name: '越南 (VN)' },
  { code: 'MX', name: '墨西哥 (MX)' },
  { code: 'BR', name: '巴西 (BR)' },
]

type Step = 'input' | 'extracting' | 'confirm'

interface ExtractedData {
  finalUrl: string
  finalUrlSuffix: string
  brand: string | null
  productDescription: string | null
  targetLanguage: string
  redirectCount: number
  resolveMethod: string
}

export default function CreateOfferModalV2({
  open,
  onOpenChange,
  onSuccess,
}: CreateOfferModalV2Props) {
  const [currentStep, setCurrentStep] = useState<Step>('input')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 步骤1：用户输入
  const [affiliateLink, setAffiliateLink] = useState('')
  const [targetCountry, setTargetCountry] = useState('US')
  const [productPrice, setProductPrice] = useState('')
  const [commissionPayout, setCommissionPayout] = useState('')

  // 步骤2：自动提取的数据
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null)

  // 步骤3：用户可修正的字段
  const [brandName, setBrandName] = useState('')

  // ========== 步骤1: 提交用户输入，开始自动提取 ==========
  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    setCurrentStep('extracting')

    try {
      const response = await fetch('/api/offers/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          affiliate_link: affiliateLink,
          target_country: targetCountry,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '自动提取失败')
      }

      // 保存提取的数据
      setExtractedData(result.data)
      setBrandName(result.data.brand || '') // 预填品牌名称

      // 进入确认步骤
      setCurrentStep('confirm')
    } catch (err: any) {
      setError(err.message || '自动提取失败，请稍后重试')
      setCurrentStep('input') // 失败后返回输入步骤
    } finally {
      setLoading(false)
    }
  }

  // ========== 步骤3: 用户确认后创建Offer ==========
  const handleCreate = async () => {
    setError('')
    setLoading(true)

    try {
      if (!extractedData) {
        throw new Error('缺少提取的数据')
      }

      // 品牌名称必填
      if (!brandName.trim()) {
        throw new Error('品牌名称不能为空')
      }

      const response = await fetch('/api/offers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          affiliate_link: affiliateLink,
          brand: brandName.trim(),
          target_country: targetCountry,
          url: extractedData.finalUrl,
          final_url_suffix: extractedData.finalUrlSuffix,
          product_price: productPrice || undefined,
          commission_payout: commissionPayout || undefined,
          // 传递提取的数据（用于后续数据抓取）
          brand_description: extractedData.productDescription,
          target_language: extractedData.targetLanguage,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '创建Offer失败')
      }

      // 成功后重置表单并关闭弹窗
      resetForm()
      onOpenChange(false)
      if (onSuccess) onSuccess()
    } catch (err: any) {
      setError(err.message || '创建Offer失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setAffiliateLink('')
    setTargetCountry('US')
    setProductPrice('')
    setCommissionPayout('')
    setBrandName('')
    setExtractedData(null)
    setCurrentStep('input')
    setError('')
  }

  const handleClose = () => {
    if (!loading) {
      resetForm()
      onOpenChange(false)
    }
  }

  const handleBack = () => {
    setCurrentStep('input')
    setExtractedData(null)
    setError('')
  }

  // ========== 渲染不同步骤 ==========
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建Offer</DialogTitle>
          <DialogDescription>
            {currentStep === 'input' && '输入推广链接和国家，系统将自动提取Offer信息'}
            {currentStep === 'extracting' && '正在自动提取Offer信息...'}
            {currentStep === 'confirm' && '确认自动提取的信息，可修正品牌名称'}
          </DialogDescription>
        </DialogHeader>

        {/* 错误提示 */}
        {error && (
          <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {/* ========== 步骤1: 用户输入 ========== */}
        {currentStep === 'input' && (
          <form onSubmit={handleExtract} className="space-y-4 py-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="affiliateLink">
                  推广链接 <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="affiliateLink"
                  type="url"
                  value={affiliateLink}
                  onChange={(e) => setAffiliateLink(e.target.value)}
                  placeholder="https://pboost.me/example"
                  required
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">
                  您的Affiliate推广链接，系统将自动解析最终落地页
                </p>
              </div>

              <div>
                <Label htmlFor="targetCountry">
                  推广国家 <span className="text-red-500">*</span>
                </Label>
                <Select value={targetCountry} onValueChange={setTargetCountry} required>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="选择国家" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {countries.map((country) => (
                      <SelectItem key={country.code} value={country.code}>
                        {country.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 可选字段 */}
              <div className="pt-4 border-t border-slate-200 space-y-4">
                <p className="text-sm font-medium text-slate-700">可选信息（用于CPC计算）</p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="productPrice">产品价格</Label>
                    <Input
                      id="productPrice"
                      type="text"
                      value={productPrice}
                      onChange={(e) => setProductPrice(e.target.value)}
                      placeholder="$99.99"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="commissionPayout">佣金比例</Label>
                    <Input
                      id="commissionPayout"
                      type="text"
                      value={commissionPayout}
                      onChange={(e) => setCommissionPayout(e.target.value)}
                      placeholder="10%"
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 pt-4">
              <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
                取消
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    提取中...
                  </>
                ) : (
                  '下一步：自动提取'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* ========== 步骤2: 自动提取中 ========== */}
        {currentStep === 'extracting' && (
          <div className="py-12 text-center space-y-4">
            <Loader2 className="w-12 h-12 mx-auto text-blue-600 animate-spin" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">正在自动提取Offer信息</h3>
              <p className="text-sm text-gray-600 mt-2">
                系统正在解析推广链接，识别品牌名称...
              </p>
              <p className="text-xs text-gray-500 mt-1">这可能需要10-30秒，请耐心等待</p>
            </div>
          </div>
        )}

        {/* ========== 步骤3: 用户确认 ========== */}
        {currentStep === 'confirm' && extractedData && (
          <div className="space-y-4 py-4">
            {/* 成功提示 */}
            <div className="bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded text-sm flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">自动提取成功！</p>
                <p className="text-xs mt-1">
                  经过 {extractedData.redirectCount} 次重定向，已成功解析Offer信息
                </p>
              </div>
            </div>

            {/* 自动提取的数据展示 */}
            <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
              <h4 className="font-semibold text-sm text-gray-900">自动提取的信息</h4>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Final URL:</span>
                  <a
                    href={extractedData.finalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline flex items-center gap-1 max-w-xs truncate"
                    title={extractedData.finalUrl}
                  >
                    {extractedData.finalUrl}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">推广语言:</span>
                  <span className="font-mono text-gray-900">{extractedData.targetLanguage}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">解析方式:</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {extractedData.resolveMethod}
                  </Badge>
                </div>
              </div>
            </div>

            {/* 品牌名称（可修正） */}
            <div>
              <Label htmlFor="brandName">
                品牌名称 <span className="text-red-500">*</span>
                {extractedData.brand && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    AI自动识别
                  </Badge>
                )}
              </Label>
              <Input
                id="brandName"
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="请输入或修正品牌名称"
                required
                className="mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">
                {extractedData.brand
                  ? '系统已自动识别品牌名称，请检查是否正确'
                  : '系统未能识别品牌名称，请手动输入'}
              </p>
            </div>

            <DialogFooter className="gap-2 pt-4">
              <Button type="button" variant="outline" onClick={handleBack} disabled={loading}>
                返回修改
              </Button>
              <Button onClick={handleCreate} disabled={loading || !brandName.trim()}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    创建中...
                  </>
                ) : (
                  '确认创建Offer'
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
