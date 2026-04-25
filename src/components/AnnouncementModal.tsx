'use client'

/**
 * AnnouncementModal — 公告强制阅读弹窗
 * - 不可点遮罩关闭
 * - 必须点「我已知晓」才能关闭
 * - 多条公告时逐条显示（全部确认后关闭）
 */

import { useState } from 'react'
import { Megaphone, AlertTriangle, Wrench, Info } from 'lucide-react'

interface Announcement {
  id: string
  title: string
  content: string
  type: string
  scheduled_at: string | null
  expires_at: string | null
  created_at: string
}

interface AnnouncementModalProps {
  announcements: Announcement[]
  onAllRead: () => void
}

function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

const TYPE_CONFIG = {
  info: {
    icon: Info,
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    header: 'bg-blue-600',
    iconColor: 'text-blue-600',
    badge: 'bg-blue-100 text-blue-700',
    label: '系统通知',
    btnClass: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-yellow-50',
    border: 'border-yellow-300',
    header: 'bg-yellow-500',
    iconColor: 'text-yellow-500',
    badge: 'bg-yellow-100 text-yellow-700',
    label: '重要通知',
    btnClass: 'bg-yellow-500 hover:bg-yellow-600 focus:ring-yellow-400',
  },
  maintenance: {
    icon: Wrench,
    bg: 'bg-red-50',
    border: 'border-red-300',
    header: 'bg-red-600',
    iconColor: 'text-red-600',
    badge: 'bg-red-100 text-red-700',
    label: '维护通知',
    btnClass: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
  },
}

export default function AnnouncementModal({ announcements, onAllRead }: AnnouncementModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [confirming, setConfirming] = useState(false)

  if (announcements.length === 0) return null

  const current = announcements[currentIndex]
  const cfg = TYPE_CONFIG[current.type as keyof typeof TYPE_CONFIG] || TYPE_CONFIG.info
  const Icon = cfg.icon
  const total = announcements.length
  const isLast = currentIndex === total - 1

  const handleConfirm = async () => {
    if (confirming) return
    setConfirming(true)
    try {
      await fetch('/api/announcements/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ announcementId: current.id }),
      })
    } catch (e) {
      // 网络错误时静默处理，不阻塞用户操作
    }

    if (isLast) {
      onAllRead()
    } else {
      setCurrentIndex(i => i + 1)
      setConfirming(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 遮罩 — 不可点击关闭 */}
      <div className="absolute inset-0 bg-black/60" />

      {/* 弹窗 */}
      <div
        className={`relative w-full max-w-lg mx-4 rounded-2xl border-2 ${cfg.border} ${cfg.bg} shadow-2xl overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-title"
      >
        {/* 顶部色条 */}
        <div className={`${cfg.header} h-1.5 w-full`} />

        <div className="p-6">
          {/* 头部 */}
          <div className="flex items-start gap-3 mb-4">
            <div className={`mt-0.5 shrink-0 ${cfg.iconColor}`}>
              <Icon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badge}`}>
                  {cfg.label}
                </span>
                {total > 1 && (
                  <span className="text-xs text-gray-400">
                    {currentIndex + 1} / {total}
                  </span>
                )}
              </div>
              <h2
                id="announcement-title"
                className="mt-1.5 text-lg font-semibold text-gray-900 leading-snug"
              >
                {current.title}
              </h2>
            </div>
          </div>

          {/* 内容 */}
          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto rounded-lg bg-white/70 p-3 border border-gray-100">
            {current.content}
          </div>

          {/* 维护时间提示 */}
          {current.scheduled_at && (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              <Wrench className="w-3.5 h-3.5 shrink-0" />
              <span>预计维护时间：{formatDateTime(current.scheduled_at)}</span>
            </div>
          )}

          {/* 发布时间 */}
          <p className="mt-3 text-xs text-gray-400 text-right">
            发布时间：{formatDateTime(current.created_at)}
          </p>

          {/* 确认按钮 */}
          <div className="mt-5 flex justify-end">
            <button
              onClick={handleConfirm}
              disabled={confirming}
              className={`inline-flex items-center justify-center px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 ${cfg.btnClass}`}
            >
              {confirming ? '处理中...' : isLast ? '我已知晓，关闭' : `我已知晓（下一条 ${currentIndex + 2}/${total}）`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
