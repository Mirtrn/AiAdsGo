import { NextRequest, NextResponse } from 'next/server'
import { findLaunchScoresByOfferId, parseLaunchScoreAnalysis } from '@/lib/launch-scores'

/**
 * GET /api/offers/[id]/launch-score/history
 * 获取Offer的历史Launch Score记录
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = request.headers.get('x-user-id')

    if (!userId) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    const offerId = parseInt(params.id, 10)

    if (isNaN(offerId)) {
      return NextResponse.json(
        { error: 'Offer ID无效' },
        { status: 400 }
      )
    }

    // 获取所有历史评分
    const scores = findLaunchScoresByOfferId(offerId, parseInt(userId, 10))

    // 转换为前端需要的格式
    const history = scores.map(score => {
      const analysis = parseLaunchScoreAnalysis(score)

      return {
        id: score.id,
        totalScore: score.totalScore,
        calculatedAt: score.calculatedAt,
        dimensions: {
          keyword: score.keywordScore,
          marketFit: score.marketFitScore,
          landingPage: score.landingPageScore,
          budget: score.budgetScore,
          content: score.contentScore,
        },
        // 完整分析数据（用于详细对比）
        analysis: {
          keywordAnalysis: analysis.keywordAnalysis,
          marketFitAnalysis: analysis.marketFitAnalysis,
          landingPageAnalysis: analysis.landingPageAnalysis,
          budgetAnalysis: analysis.budgetAnalysis,
          contentAnalysis: analysis.contentAnalysis,
          overallRecommendations: analysis.overallRecommendations,
        }
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        offerId,
        total: history.length,
        history,
      }
    })

  } catch (error: any) {
    console.error('获取历史评分失败:', error)
    return NextResponse.json(
      { error: error.message || '获取历史评分失败' },
      { status: 500 }
    )
  }
}
