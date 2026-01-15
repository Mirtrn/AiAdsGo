'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { showError, showSuccess } from '@/lib/toast-utils'

interface AdjustCampaignCpcDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  googleCampaignId: string
  campaignName: string
}

export default function AdjustCampaignCpcDialog(props: AdjustCampaignCpcDialogProps) {
  const { open, onOpenChange, googleCampaignId, campaignName } = props

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currency, setCurrency] = useState('USD')
  const [biddingStrategyType, setBiddingStrategyType] = useState<string>('UNKNOWN')
  const [currentCpc, setCurrentCpc] = useState<number | null>(null)
  const [newCpcValue, setNewCpcValue] = useState<string>('')

  const currentCpcDisplay = useMemo(() => {
    if (currentCpc === null || !(currentCpc > 0)) return '(未知)'
    return `${currency} ${currentCpc.toFixed(2)}`
  }, [currency, currentCpc])

  const load = async () => {
    if (!googleCampaignId) return
    try {
      setLoading(true)
      const response = await fetch(`/api/campaigns/${googleCampaignId}/cpc`, { credentials: 'include' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || data?.message || '获取当前CPC失败')

      setCurrency(data.currency || 'USD')
      setBiddingStrategyType(data.biddingStrategyType || 'UNKNOWN')

      const nextCurrent = typeof data.currentCpc === 'number' ? data.currentCpc : null
      setCurrentCpc(nextCurrent)
      setNewCpcValue(nextCurrent !== null && nextCurrent > 0 ? nextCurrent.toFixed(2) : '')
    } catch (e: any) {
      showError('获取当前CPC失败', e?.message || String(e))
      setCurrentCpc(null)
      setNewCpcValue('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, googleCampaignId])

  const applyPercent = (percent: number) => {
    if (currentCpc === null || !(currentCpc > 0)) return
    const next = Math.max(0.01, currentCpc * (1 + percent))
    setNewCpcValue(next.toFixed(2))
  }

  const save = async () => {
    try {
      const parsed = Number.parseFloat(newCpcValue)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        showError('无效CPC', '请输入有效的CPC数值')
        return
      }

      setSaving(true)
      const response = await fetch(`/api/campaigns/${googleCampaignId}/update-cpc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newCpc: parsed }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || data?.message || '更新CPC失败')

      showSuccess('CPC已更新', `${campaignName} → ${currency} ${parsed.toFixed(2)}`)
      onOpenChange(false)
    } catch (e: any) {
      showError('更新CPC失败', e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>调整CPC - {campaignName}</DialogTitle>
          <DialogDescription>支持输入绝对值CPC，或一键按比例填充（-20%/-10%/+10%/+20%/+50%/+100%）。</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          <div className="text-xs text-muted-foreground">
            竞价策略: <span className="text-foreground">{biddingStrategyType}</span>
          </div>

          <div className="text-sm text-muted-foreground">
            当前CPC: <span className="font-medium text-foreground">{loading ? '加载中…' : currentCpcDisplay}</span>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">更新后CPC</div>
            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground w-20">{currency}</div>
              <Input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={newCpcValue}
                onChange={(e) => setNewCpcValue(e.target.value)}
                placeholder="0.00"
                disabled={loading || saving}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => applyPercent(-0.2)} disabled={loading || saving || !(currentCpc && currentCpc > 0)}>
                -20%
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyPercent(-0.1)} disabled={loading || saving || !(currentCpc && currentCpc > 0)}>
                -10%
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyPercent(0.1)} disabled={loading || saving || !(currentCpc && currentCpc > 0)}>
                +10%
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyPercent(0.2)} disabled={loading || saving || !(currentCpc && currentCpc > 0)}>
                +20%
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyPercent(0.5)} disabled={loading || saving || !(currentCpc && currentCpc > 0)}>
                +50%
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyPercent(1)} disabled={loading || saving || !(currentCpc && currentCpc > 0)}>
                +100%
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 border-t pt-3 flex-wrap">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button type="button" onClick={save} disabled={saving || loading}>
            {saving ? '更新中…' : '更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
