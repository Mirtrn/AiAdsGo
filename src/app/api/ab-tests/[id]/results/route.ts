import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * 计算Z检验的P值（双尾检验）
 */
function calculatePValue(z: number): number {
  // 使用标准正态分布的累积分布函数近似
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const sign = z < 0 ? -1 : 1
  z = Math.abs(z) / Math.sqrt(2.0)

  const t = 1.0 / (1.0 + p * z)
  const erf = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-z * z)

  return (1.0 - sign * erf) / 2.0
}

/**
 * 计算两个比例的Z分数和置信区间
 */
function calculateZTest(
  conversions1: number,
  total1: number,
  conversions2: number,
  total2: number,
  confidenceLevel: number = 0.95
) {
  if (total1 === 0 || total2 === 0) {
    return null
  }

  const p1 = conversions1 / total1
  const p2 = conversions2 / total2

  // 合并比例
  const pPool = (conversions1 + conversions2) / (total1 + total2)

  // 标准误差
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / total1 + 1 / total2))

  if (se === 0) {
    return null
  }

  // Z分数
  const z = (p1 - p2) / se

  // P值（双尾检验）
  const pValue = 2 * calculatePValue(-Math.abs(z))

  // 置信区间
  const zCritical = confidenceLevel === 0.95 ? 1.96 : confidenceLevel === 0.99 ? 2.576 : 1.645
  const ciMargin = zCritical * Math.sqrt((p1 * (1 - p1)) / total1)

  return {
    z,
    pValue,
    confidenceLower: Math.max(0, p1 - ciMargin),
    confidenceUpper: Math.min(1, p1 + ciMargin),
    isSignificant: pValue < (1 - confidenceLevel),
  }
}

/**
 * GET /api/ab-tests/[id]/results
 * 获取A/B测试结果和统计分析
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const testId = parseInt(params.id)
    const db = getDatabase()

    // 获取测试信息
    const test = db.prepare(`
      SELECT * FROM ab_tests WHERE id = ? AND user_id = ?
    `).get(testId, authResult.user.userId) as any

    if (!test) {
      return NextResponse.json(
        { error: 'A/B测试不存在或无权访问' },
        { status: 404 }
      )
    }

    // 获取所有变体
    const variants = db.prepare(`
      SELECT
        atv.*,
        ac.headline_1,
        ac.headline_2,
        ac.headline_3,
        ac.description_1,
        ac.description_2
      FROM ab_test_variants atv
      LEFT JOIN ad_creatives ac ON atv.ad_creative_id = ac.id
      WHERE atv.ab_test_id = ?
    `).all(testId) as any[]

    // 为每个变体聚合性能数据
    const variantsWithPerformance = variants.map((variant) => {
      // 从campaign_performance聚合数据
      // 注意：这里假设ad_creative和campaign有关联
      const performance = db.prepare(`
        SELECT
          COALESCE(SUM(cp.impressions), 0) as impressions,
          COALESCE(SUM(cp.clicks), 0) as clicks,
          COALESCE(SUM(cp.conversions), 0) as conversions,
          COALESCE(SUM(cp.cost), 0) as cost
        FROM campaign_performance cp
        INNER JOIN campaigns c ON cp.campaign_id = c.id
        WHERE c.user_id = ?
          AND c.offer_id = ?
          AND cp.date >= COALESCE(?, '1970-01-01')
          AND cp.date <= COALESCE(?, '2099-12-31')
      `).get(authResult.user!.userId, test.offer_id, test.start_date, test.end_date || new Date().toISOString()) as any

      // 计算指标
      const ctr = performance.impressions > 0 ? performance.clicks / performance.impressions : 0
      const conversionRate = performance.clicks > 0 ? performance.conversions / performance.clicks : 0
      const cpa = performance.conversions > 0 ? performance.cost / performance.conversions : 0

      return {
        ...variant,
        performance: {
          impressions: performance.impressions,
          clicks: performance.clicks,
          conversions: performance.conversions,
          cost: performance.cost,
          ctr: parseFloat((ctr * 100).toFixed(2)),
          conversionRate: parseFloat((conversionRate * 100).toFixed(2)),
          cpa: parseFloat(cpa.toFixed(2)),
        },
      }
    })

    // 找到对照组
    const controlVariant = variantsWithPerformance.find((v) => v.is_control === 1)

    if (!controlVariant) {
      return NextResponse.json({
        success: true,
        test,
        variants: variantsWithPerformance,
        analysis: {
          hasEnoughData: false,
          message: '未找到对照组',
        },
      })
    }

    // 对每个非对照组变体进行统计检验
    const variantsWithStatistics = variantsWithPerformance.map((variant) => {
      if (variant.is_control === 1) {
        return {
          ...variant,
          statistics: {
            vsControl: null,
            isWinner: false,
          },
        }
      }

      const controlPerf = controlVariant.performance
      const variantPerf = variant.performance

      // 使用转化率进行Z检验
      const zTest = calculateZTest(
        controlPerf.conversions,
        controlPerf.clicks,
        variantPerf.conversions,
        variantPerf.clicks,
        test.confidence_level || 0.95
      )

      if (!zTest) {
        return {
          ...variant,
          statistics: {
            vsControl: null,
            isWinner: false,
            message: '数据不足，无法进行统计检验',
          },
        }
      }

      // 判断是否为获胜变体
      const isWinner =
        zTest.isSignificant &&
        variantPerf.conversionRate > controlPerf.conversionRate &&
        variantPerf.clicks >= test.min_sample_size

      return {
        ...variant,
        statistics: {
          vsControl: {
            zScore: parseFloat(zTest.z.toFixed(4)),
            pValue: parseFloat(zTest.pValue.toFixed(4)),
            isSignificant: zTest.isSignificant,
            confidenceLower: parseFloat((zTest.confidenceLower * 100).toFixed(2)),
            confidenceUpper: parseFloat((zTest.confidenceUpper * 100).toFixed(2)),
            lift: parseFloat(
              (((variantPerf.conversionRate - controlPerf.conversionRate) / controlPerf.conversionRate) *
                100).toFixed(2)
            ),
          },
          isWinner,
        },
      }
    })

    // 找出获胜变体
    const winnerVariants = variantsWithStatistics.filter((v) => v.statistics?.isWinner)
    const winner = winnerVariants.length > 0 ? winnerVariants[0] : null

    // 检查是否有足够的数据
    const totalClicks = variantsWithPerformance.reduce((sum, v) => sum + v.performance.clicks, 0)
    const hasEnoughData = totalClicks >= test.min_sample_size * variants.length

    return NextResponse.json({
      success: true,
      test,
      variants: variantsWithStatistics,
      analysis: {
        hasEnoughData,
        totalImpressions: variantsWithPerformance.reduce(
          (sum, v) => sum + v.performance.impressions,
          0
        ),
        totalClicks,
        totalConversions: variantsWithPerformance.reduce(
          (sum, v) => sum + v.performance.conversions,
          0
        ),
        totalCost: variantsWithPerformance.reduce((sum, v) => sum + v.performance.cost, 0),
        winner: winner
          ? {
              variantId: winner.id,
              variantName: winner.variant_name,
              lift: winner.statistics.vsControl.lift,
              pValue: winner.statistics.vsControl.pValue,
            }
          : null,
        recommendation: winner
          ? `变体 ${winner.variant_name} 在统计上显著优于对照组，提升 ${winner.statistics.vsControl.lift}%`
          : hasEnoughData
          ? '暂无统计显著的获胜变体，建议继续测试'
          : `需要更多数据（当前: ${totalClicks}，目标: ${test.min_sample_size * variants.length}）`,
      },
    })
  } catch (error: any) {
    console.error('获取A/B测试结果失败:', error)
    return NextResponse.json(
      { error: '获取A/B测试结果失败', message: error.message },
      { status: 500 }
    )
  }
}
