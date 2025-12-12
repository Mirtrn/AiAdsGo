import { NextRequest, NextResponse } from 'next/server'
import { getDailyUsageStats, getUsageTrend, checkQuotaLimit } from '@/lib/google-ads-api-tracker'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'

/**
 * GET /api/dashboard/api-quota
 * 获取Google Ads API配额使用情况
 *
 * 🔧 修复(2025-12-12): 独立账号模式 - 每个用户只能查看自己的API使用统计
 * - 如果用户配置了自己的Google Ads API凭证 → 显示该用户的API使用统计
 * - 如果用户未配置凭证 → 返回空数据，不再回退到管理员数据
 */
export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const days = parseInt(searchParams.get('days') || '7', 10)
    const currentUserId = parseInt(userId, 10)

    // 检查用户是否配置了自己的Google Ads API凭证
    const userCredentials = await getGoogleAdsCredentials(currentUserId)

    // 🔧 修复(2025-12-12): 独立账号模式 - 不再回退到管理员数据
    if (!userCredentials) {
      return NextResponse.json({
        success: true,
        data: {
          today: {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            avgResponseTimeMs: 0
          },
          trend: [],
          quotaCheck: {
            isOverLimit: false,
            isNearLimit: false,
            usage: 0,
            limit: 0
          },
          recommendations: ['ℹ️ 您尚未配置 Google Ads API 凭证，请先在设置页面完成配置'],
          hasCredentials: false
        }
      })
    }

    // 获取今天的使用统计
    const todayStats = await getDailyUsageStats(currentUserId)

    // 获取最近N天的趋势
    const trend = await getUsageTrend(currentUserId, days)

    // 检查配额限制
    const quotaCheck = await checkQuotaLimit(currentUserId, 0.8)

    return NextResponse.json({
      success: true,
      data: {
        today: todayStats,
        trend,
        quotaCheck,
        recommendations: generateRecommendations(todayStats, quotaCheck),
        hasCredentials: true
      }
    })
  } catch (error: any) {
    console.error('获取API配额统计失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取API配额统计失败',
      },
      { status: 500 }
    )
  }
}

/**
 * 根据使用情况生成建议
 */
function generateRecommendations(stats: any, check: any): string[] {
  const recommendations: string[] = []

  if (check.isOverLimit) {
    recommendations.push('⚠️ 已超出每日配额限制，请明天再试或联系技术支持提升配额')
  } else if (check.isNearLimit) {
    recommendations.push('⚠️ 接近每日配额限制，请谨慎使用API操作')
  }

  // 改进：只有当样本量足够大（>=5次）且失败率超过20%时才提示
  // 避免小样本量时的误报警
  if (stats.totalOperations >= 5 && stats.failedOperations > stats.totalOperations * 0.2) {
    recommendations.push('💡 失败操作较多，建议检查API调用参数和权限')
  }

  if (stats.avgResponseTimeMs && stats.avgResponseTimeMs > 2000) {
    recommendations.push('💡 平均响应时间较长，建议使用批量操作或优化查询')
  }

  // 不再添加"API使用正常，配额充足"文案
  // 如果没有任何警告或建议，返回空数组（不显示Alert组件）

  return recommendations
}
