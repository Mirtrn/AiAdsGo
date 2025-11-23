/**
 * Bonus Score API
 * 获取广告创意的加分数据
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCreativePerformance, getUserBonusStats } from '@/lib/bonus-score-calculator'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const adCreativeId = parseInt(id)

    if (isNaN(adCreativeId)) {
      return NextResponse.json({ error: 'Invalid ad creative ID' }, { status: 400 })
    }

    const performanceData = await getCreativePerformance(adCreativeId)

    if (!performanceData) {
      return NextResponse.json({
        hasData: false,
        message: 'No performance data available yet. Bonus score requires at least 100 clicks.',
        bonusScore: 0,
        breakdown: null
      })
    }

    return NextResponse.json({
      hasData: true,
      bonusScore: performanceData.bonusScore.totalBonus,
      breakdown: performanceData.bonusScore.breakdown,
      minClicksReached: performanceData.bonusScore.minClicksReached,
      industryCode: performanceData.bonusScore.industryCode,
      industryLabel: performanceData.bonusScore.industryLabel,
      performance: performanceData.performance,
      syncDate: performanceData.syncDate
    })
  } catch (error) {
    console.error('Get bonus score error:', error)
    return NextResponse.json(
      { error: 'Failed to get bonus score' },
      { status: 500 }
    )
  }
}
