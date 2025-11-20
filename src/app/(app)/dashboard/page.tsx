'use client'

import { KPICards } from '@/components/dashboard/KPICards'
import { CampaignList } from '@/components/dashboard/CampaignList'
import { InsightsCard } from '@/components/dashboard/InsightsCard'
import { PerformanceTrends } from '@/components/dashboard/PerformanceTrends'
import RiskAlertPanel from '@/components/RiskAlertPanel'
import { QuickActions } from '@/components/dashboard/QuickActions' // P2-4: 快速操作

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="page-title">仪表盘</h1>
          <p className="page-subtitle">查看您的广告系列表现概况</p>
        </div>

        {/* Risk Alert Panel */}
        <div className="mb-8" data-section="risk-alerts">
          <RiskAlertPanel />
        </div>

        {/* P2-4: Quick Actions - 快速操作入口 */}
        <div className="mb-8">
          <QuickActions />
        </div>

        {/* KPI Cards */}
        <div className="mb-8">
          <KPICards />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Campaign List */}
          <div className="lg:col-span-2">
            <CampaignList />
          </div>

          {/* Insights Card */}
          <div className="lg:col-span-1">
            <InsightsCard />
          </div>
        </div>

        {/* Performance Trends */}
        <div>
          <PerformanceTrends />
        </div>
      </div>
    </div>
  )
}
