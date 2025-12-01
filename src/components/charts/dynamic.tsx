/**
 * ⚡ P0性能优化: 图表组件动态导入
 * 使用Next.js dynamic import实现按需加载，减少首屏JS体积
 * Recharts库约200KB，懒加载可显著提升首屏性能
 */
import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

// 加载中的骨架屏组件
const ChartSkeleton = () => (
  <Skeleton className="h-[400px] w-full" />
)

// 动态导入图表组件，禁用SSR（图表通常需要浏览器API）
export const ROIChartDynamic = dynamic(
  () => import('../ROIChart'),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

export const BudgetChartDynamic = dynamic(
  () => import('../BudgetChart'),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

export const CampaignComparisonDynamic = dynamic(
  () => import('../CampaignComparison'),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

export const ScoreRadarChartDynamic = dynamic(
  () => import('./ScoreRadarChart'),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

export const TrendChartDynamic = dynamic(
  () => import('./TrendChart'),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

export const PerformanceTrendsDynamic = dynamic(
  () => import('../dashboard/PerformanceTrends'),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)
