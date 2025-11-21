'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { KPICards } from '@/components/dashboard/KPICards'
import { CampaignList } from '@/components/dashboard/CampaignList'
import { InsightsCard } from '@/components/dashboard/InsightsCard'
import { PerformanceTrends } from '@/components/dashboard/PerformanceTrends'
import RiskAlertPanel from '@/components/RiskAlertPanel'
import { QuickActions } from '@/components/dashboard/QuickActions' // P2-4: 快速操作
import { ABTestProgressCard } from '@/components/dashboard/ABTestProgressCard' // A/B测试进度

export default function DashboardPage() {
  const [days, setDays] = useState(7)

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-[1600px] mx-auto">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="page-title">仪表盘</h1>
            <p className="page-subtitle">查看您的广告系列表现概况</p>
          </div>

          {/* Global Date Range Picker */}
          <div className="flex items-center gap-2 bg-white p-1 rounded-lg border shadow-sm">
            {[7, 30, 90].map((d) => (
              <Button
                key={d}
                variant={days === d ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setDays(d)}
                className="h-8"
              >
                {d}天
              </Button>
            ))}
          </div>
        </div>

        {/* KPI Cards - Top Section */}
        <div className="mb-6">
          <KPICards days={days} />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Left Column (Main Content) - 75% width on XL screens */}
          <div className="xl:col-span-3 space-y-6">
            {/* Performance Trends */}
            <PerformanceTrends days={days} />

            {/* Campaign List */}
            <CampaignList />
          </div>

          {/* Right Column (Sidebar) - 25% width on XL screens */}
          <div className="xl:col-span-1 space-y-6">
            {/* Quick Actions */}
            <QuickActions />

            {/* Risk Alerts */}
            <RiskAlertPanel />

            {/* Insights */}
            <InsightsCard days={days} />

            {/* A/B Test Progress */}
            <ABTestProgressCard />
          </div>
        </div>
      </div>
    </div>
  )
}
