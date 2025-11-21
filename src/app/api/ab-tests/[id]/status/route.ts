import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { createError, AppError } from '@/lib/errors'

/**
 * GET /api/ab-tests/[id]/status
 *
 * 获取A/B测试实时状态和优化进度
 *
 * Response:
 * {
 *   test: { id, name, mode, dimension, status, start_date, end_date },
 *   progress: {
 *     total_samples: number,
 *     min_samples_required: number,
 *     completion_percentage: number,
 *     estimated_completion_date: string
 *   },
 *   current_leader: {
 *     variant_name: string,
 *     confidence: number,
 *     improvement_vs_control: number
 *   },
 *   variants: [{
 *     variant_name: string,
 *     campaign_id: number,
 *     traffic_allocation: number,
 *     metrics: { impressions, clicks, ctr, conversions, cpa }
 *   }],
 *   warnings: [{ type, message, severity }]
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 1. 验证认证
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      const error = createError.unauthorized()
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const userId = authResult.user.userId
    const testId = parseInt(params.id)

    const db = getDatabase()

    // 2. 获取测试基本信息
    const test = db.prepare(`
      SELECT
        id,
        test_name,
        test_mode,
        test_dimension,
        status,
        start_date,
        end_date,
        min_sample_size,
        confidence_level,
        winner_variant_id,
        statistical_confidence,
        created_at
      FROM ab_tests
      WHERE id = ? AND user_id = ?
    `).get(testId, userId) as any

    if (!test) {
      const error = createError.testNotFound({ testId })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 3. 获取变体性能数据
    const variants = db.prepare(`
      SELECT
        v.id,
        v.variant_name,
        v.variant_label,
        v.ad_creative_id,
        v.traffic_allocation,
        v.is_control,
        v.impressions,
        v.clicks,
        v.conversions,
        v.cost,
        v.ctr,
        v.conversion_rate,
        v.cpa,
        v.confidence_interval_lower,
        v.confidence_interval_upper,
        v.p_value,
        c.id as campaign_id,
        c.campaign_name,
        c.status as campaign_status
      FROM ab_test_variants v
      LEFT JOIN campaigns c ON c.ab_test_id = v.ab_test_id AND c.ad_creative_id = v.ad_creative_id
      WHERE v.ab_test_id = ?
      ORDER BY v.is_control DESC, v.variant_name ASC
    `).all(testId) as any[]

    // 4. 计算总样本量和进度
    const totalSamples = variants.reduce((sum, v) => sum + (v.clicks || 0), 0)
    const completionPercentage = Math.min(100, (totalSamples / test.min_sample_size) * 100)

    // 估算完成时间（基于当前速度）
    let estimatedCompletionDate: string | null = null
    if (test.status === 'running' && totalSamples > 0) {
      const startTime = new Date(test.start_date || test.created_at).getTime()
      const now = Date.now()
      const elapsed = now - startTime
      const samplesPerMs = totalSamples / elapsed

      if (samplesPerMs > 0 && totalSamples < test.min_sample_size) {
        const remainingSamples = test.min_sample_size - totalSamples
        const remainingMs = remainingSamples / samplesPerMs
        estimatedCompletionDate = new Date(now + remainingMs).toISOString()
      }
    }

    // 5. 找出当前领先变体（支持creative和strategy维度）
    let currentLeader: any = null
    if (variants.length > 0) {
      let sorted: any[]
      let best: any
      let control: any
      let improvement: number

      if (test.test_dimension === 'creative') {
        // 创意测试：按CTR排序（越高越好）
        sorted = [...variants].sort((a, b) => (b.ctr || 0) - (a.ctr || 0))
        best = sorted[0]
        control = variants.find(v => v.is_control === 1) || sorted[1]

        improvement = control && control.ctr > 0
          ? ((best.ctr - control.ctr) / control.ctr) * 100
          : 0

        currentLeader = {
          variant_name: best.variant_name,
          variant_label: best.variant_label,
          confidence: test.statistical_confidence || (1 - (best.p_value || 1)),
          improvement_vs_control: improvement,
          ctr: best.ctr,
          is_significant: best.p_value ? best.p_value < (1 - test.confidence_level) : false
        }
      } else {
        // 策略测试：按CPC排序（越低越好）
        const withClicks = variants.filter(v => (v.clicks || 0) > 0)
        sorted = [...withClicks].sort((a, b) => {
          const cpcA = (a.cost || 0) / (a.clicks || 1)
          const cpcB = (b.cost || 0) / (b.clicks || 1)
          return cpcA - cpcB
        })

        if (sorted.length > 0) {
          best = sorted[0]
          control = variants.find(v => v.is_control === 1) || sorted[1]

          const bestCPC = (best.cost || 0) / (best.clicks || 1)
          const controlCPC = control ? (control.cost || 0) / (control.clicks || 1) : 0

          improvement = controlCPC > 0
            ? ((bestCPC - controlCPC) / controlCPC) * 100
            : 0

          currentLeader = {
            variant_name: best.variant_name,
            variant_label: best.variant_label,
            confidence: test.statistical_confidence || (1 - (best.p_value || 1)),
            improvement_vs_control: improvement,
            cpc: bestCPC,
            is_significant: best.p_value ? best.p_value < (1 - test.confidence_level) : false
          }
        }
      }
    }

    // 6. 生成警告
    const warnings: any[] = []

    // 警告1：曝光不足
    const totalImpressions = variants.reduce((sum, v) => sum + (v.impressions || 0), 0)
    const startTime = new Date(test.start_date || test.created_at).getTime()
    const hoursRunning = (Date.now() - startTime) / (1000 * 60 * 60)

    if (hoursRunning >= 24 && totalImpressions < test.min_sample_size * 0.1) {
      warnings.push({
        type: 'low_traffic',
        message: `测试运行${hoursRunning.toFixed(0)}小时但曝光量仅${totalImpressions}次，可能CPC设置过低`,
        severity: 'high',
        action: 'suggest_increase_cpc'
      })
    }

    // 警告2：无点击
    if (hoursRunning >= 48 && totalSamples === 0) {
      warnings.push({
        type: 'no_clicks',
        message: `测试运行${hoursRunning.toFixed(0)}小时但无任何点击，建议检查创意质量`,
        severity: 'critical',
        action: 'review_creative'
      })
    }

    // 警告3：测试即将超期
    if (test.end_date) {
      const endTime = new Date(test.end_date).getTime()
      const timeRemaining = endTime - Date.now()
      const hoursRemaining = timeRemaining / (1000 * 60 * 60)

      if (hoursRemaining < 24 && hoursRemaining > 0 && totalSamples < test.min_sample_size) {
        warnings.push({
          type: 'time_running_out',
          message: `测试将在${hoursRemaining.toFixed(0)}小时后结束，但样本量不足`,
          severity: 'medium',
          action: 'extend_test_period'
        })
      }
    }

    // 警告4：变体性能相似，难以判断胜出
    if (variants.length >= 2) {
      const sorted = [...variants].sort((a, b) => (b.ctr || 0) - (a.ctr || 0))
      const first = sorted[0]
      const second = sorted[1]

      if (first.ctr > 0 && second.ctr > 0) {
        const diff = Math.abs(first.ctr - second.ctr) / first.ctr
        if (diff < 0.05 && totalSamples >= test.min_sample_size * 0.5) {
          warnings.push({
            type: 'similar_performance',
            message: '变体性能差异小于5%，可能需要更多样本才能判断',
            severity: 'low',
            action: 'increase_sample_size'
          })
        }
      }
    }

    // 7. 返回完整状态
    return NextResponse.json({
      test: {
        id: test.id,
        name: test.test_name,
        mode: test.test_mode,
        dimension: test.test_dimension,
        status: test.status,
        start_date: test.start_date,
        end_date: test.end_date,
        created_at: test.created_at
      },
      progress: {
        total_samples: totalSamples,
        min_samples_required: test.min_sample_size,
        completion_percentage: completionPercentage,
        estimated_completion_date: estimatedCompletionDate,
        hours_running: hoursRunning
      },
      current_leader: currentLeader,
      variants: variants.map(v => {
        const cpc = (v.clicks || 0) > 0 ? (v.cost || 0) / (v.clicks || 1) : 0
        return {
          variant_name: v.variant_name,
          variant_label: v.variant_label,
          campaign_id: v.campaign_id,
          campaign_name: v.campaign_name,
          campaign_status: v.campaign_status,
          traffic_allocation: v.traffic_allocation,
          is_control: v.is_control === 1,
          metrics: {
            impressions: v.impressions || 0,
            clicks: v.clicks || 0,
            ctr: v.ctr || 0,
            conversions: v.conversions || 0,
            cpc: cpc,
            cost: v.cost || 0
          },
          statistics: {
            confidence_interval_lower: v.confidence_interval_lower,
            confidence_interval_upper: v.confidence_interval_upper,
            p_value: v.p_value
          }
        }
      }),
      warnings,
      is_complete: test.status === 'completed',
      winner_variant_id: test.winner_variant_id
    })

  } catch (error: any) {
    console.error('Get AB test status error:', error)

    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const appError = createError.internalError({
      operation: 'get_ab_test_status',
      originalError: error.message
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
  }
}
