'use client'

import { useState, useMemo } from 'react'
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

interface CreateOfferModalProps {
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

export default function CreateOfferModal({ open, onOpenChange, onSuccess }: CreateOfferModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 4个必填字段
  const [affiliateLink, setAffiliateLink] = useState('')
  const [brand, setBrand] = useState('')
  const [targetCountry, setTargetCountry] = useState('US')
  const [url, setUrl] = useState('')

  // 2个可选字段
  const [productPrice, setProductPrice] = useState('')
  const [commissionPayout, setCommissionPayout] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/offers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          affiliate_link: affiliateLink,
          brand,
          target_country: targetCountry,
          url,
          product_price: productPrice || undefined,
          commission_payout: commissionPayout || undefined,
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
    setBrand('')
    setTargetCountry('US')
    setUrl('')
    setProductPrice('')
    setCommissionPayout('')
    setError('')
  }

  const handleClose = () => {
    if (!loading) {
      resetForm()
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建Offer</DialogTitle>
          <DialogDescription>
            填写以下信息创建新的Offer。其他信息将自动生成。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {error && (
            <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          {/* 必填字段 */}
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
                placeholder="https://example.com/aff/12345"
                required
                className="mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">您的Affiliate推广链接</p>
            </div>

            <div>
              <Label htmlFor="brand">
                品牌名称 <span className="text-red-500">*</span>
              </Label>
              <Input
                id="brand"
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Nike, Apple, Amazon..."
                required
                className="mt-1"
              />
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

            <div>
              <Label htmlFor="url">
                商品/店铺URL <span className="text-red-500">*</span>
              </Label>
              <Input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/product/123"
                required
                className="mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">商品页面或店铺URL，用于抓取信息</p>
            </div>
          </div>

          {/* 可选字段 */}
          <div className="pt-4 border-t border-slate-200 space-y-4">
            <p className="text-sm font-medium text-slate-700">可选信息</p>

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
              <p className="text-xs text-slate-500 mt-1">用于计算建议CPC，如：$99.99</p>
            </div>

            <div>
              <Label htmlFor="commissionPayout">佣金比例</Label>
              <Input
                id="commissionPayout"
                type="text"
                value={commissionPayout}
                onChange={(e) => setCommissionPayout(e.target.value)}
                placeholder="10% 或 $10"
                className="mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">佣金比例或金额，如：10% 或 $10</p>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '创建中...' : '创建Offer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
