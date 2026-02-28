import { NextRequest } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { generateAdCreative } from '@/lib/ad-creative-gen'
import { createAdCreative, type GeneratedAdCreativeData } from '@/lib/ad-creative'
import {
  CREATIVE_BRAND_KEYWORD_RESERVE,
  CREATIVE_KEYWORD_MAX_COUNT,
  selectCreativeKeywords,
} from '@/lib/creative-keyword-selection'
import { getSearchTermFeedbackHints } from '@/lib/search-term-feedback-hints'
import {
  evaluateCreativeAdStrength,
  type ComprehensiveAdStrengthResult
} from '@/lib/scoring'
import { isControllerOpen } from '@/lib/sse-helper'
import {
  evaluateRsaQualityGate,
  type RetryFailureType
} from '@/lib/rsa-quality-gate'

/**
 * POST /api/offers/:id/generate-creatives-stream
 * 流式生成广告创意，通过SSE返回进度
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params

  // 从中间件注入的请求头中获取用户ID
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const body = await request.json()
  const {
    maxRetries = 3,
    targetRating = 'EXCELLENT'
  } = body
  const forcePublishRequested = body?.forcePublish === true || body?.force_publish === true
  const parsedOfferId = parseInt(id, 10)
  const parsedUserId = parseInt(userId, 10)

  // 验证Offer存在
  const offer = await findOfferById(parsedOfferId, parsedUserId)
  if (!offer) {
    return new Response(JSON.stringify({ error: 'Offer不存在或无权访问' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (offer.scrape_status === 'failed') {
    return new Response(JSON.stringify({ error: 'Offer信息抓取失败，请重新抓取' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  let searchTermFeedbackHints: {
    hardNegativeTerms?: string[]
    softSuppressTerms?: string[]
  } | undefined
  try {
    const hints = await getSearchTermFeedbackHints({
      offerId: parsedOfferId,
      userId: parsedUserId
    })
    searchTermFeedbackHints = {
      hardNegativeTerms: hints.hardNegativeTerms,
      softSuppressTerms: hints.softSuppressTerms
    }
    console.log(
      `🔁 [SSE] 搜索词反馈已加载: hard=${hints.hardNegativeTerms.length}, soft=${hints.softSuppressTerms.length}, rows=${hints.sourceRows}`
    )
  } catch (hintError: any) {
    console.warn(`⚠️ [SSE] 搜索词反馈读取失败，继续默认生成: ${hintError?.message || 'unknown error'}`)
  }

  // 创建SSE流
  const encoder = new TextEncoder()
  const MINIMUM_SCORE = 70
  const stream = new ReadableStream({
    async start(controller) {
      // 🔥 安全的enqueue封装 - 处理竞态条件
      const safeEnqueue = (data: string): boolean => {
        try {
          if (!isControllerOpen(controller)) {
            return false
          }
          controller.enqueue(encoder.encode(data))
          return true
        } catch (error: any) {
          // 捕获 "Controller is already closed" 错误
          if (error?.code === 'ERR_INVALID_STATE' || error?.message?.includes('closed')) {
            console.warn('SSE Controller closed during enqueue (client disconnected)')
          } else {
            console.error('SSE enqueue error:', error)
          }
          return false
        }
      }

      // 发送进度更新的helper函数
      const sendProgress = (step: string, progress: number, message: string, details?: any) => {
        const data = JSON.stringify({ type: 'progress', step, progress, message, details })
        if (!safeEnqueue(`data: ${data}\n\n`)) {
          console.warn('SSE Controller already closed, skipping progress:', step)
        }
      }

      // 发送完成结果
      const sendResult = (data: any) => {
        if (!safeEnqueue(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`)) {
          console.warn('SSE Controller already closed, skipping result')
        }
      }

      // 发送错误
      const sendError = (error: string, details?: any) => {
        if (!safeEnqueue(`data: ${JSON.stringify({ type: 'error', error, details })}\n\n`)) {
          console.warn('SSE Controller already closed, skipping error')
        }
      }

      // 耗时统计
      const timings: Record<string, number> = {}
      const startTimer = (name: string) => {
        timings[`${name}_start`] = Date.now()
      }
      const endTimer = (name: string): number => {
        const start = timings[`${name}_start`]
        if (start) {
          const elapsed = Date.now() - start
          timings[name] = elapsed
          return elapsed
        }
        return 0
      }

      try {
        const totalStartTime = Date.now()
        sendProgress('init', 5, '正在初始化生成任务...')
        if (forcePublishRequested) {
          sendProgress('compat_notice', 6, 'generate-creatives-stream 接口不再支持 forcePublish，参数已忽略')
        }

        let bestCreative: GeneratedAdCreativeData | null = null
        let bestEvaluation: ComprehensiveAdStrengthResult | null = null
        let bestGateDecision: ReturnType<typeof evaluateRsaQualityGate> | null = null
        let attempts = 0
        let retryHistory: Array<{
          attempt: number
          rating: string
          score: number
          gatePassed: boolean
          failureType: RetryFailureType | null
          gateReasons: string[]
          suggestions: string[]
        }> = []

        let usedKeywords: string[] = []
        const brandKeywords = [offer.brand.toLowerCase()]
        let retryFailureType: RetryFailureType | undefined

        while (attempts < maxRetries) {
          attempts++
          const attemptBaseProgress = 10 + (attempts - 1) * 25 // 每次尝试占25%进度

          sendProgress('generating', attemptBaseProgress,
            `第${attempts}次生成: AI正在创作广告文案...`,
            { attempt: attempts, maxRetries }
          )

          // 1. 生成创意
          startTimer(`generate_${attempts}`)
          const creative = await generateAdCreative(
            parsedOfferId,
            parsedUserId,
            {
              skipCache: attempts > 1,
              excludeKeywords: attempts > 1 ? usedKeywords : undefined,
              retryFailureType,
              searchTermFeedbackHints
            }
          )
          const prioritizedKeywords = selectCreativeKeywords({
            keywords: creative.keywords,
            keywordsWithVolume: creative.keywordsWithVolume as any,
            brandName: offer.brand || '',
            maxKeywords: CREATIVE_KEYWORD_MAX_COUNT,
            brandReserve: CREATIVE_BRAND_KEYWORD_RESERVE,
          })
          creative.keywords = prioritizedKeywords.keywords
          creative.keywordsWithVolume = prioritizedKeywords.keywordsWithVolume as any
          const generateTime = endTimer(`generate_${attempts}`)

          sendProgress('evaluating', attemptBaseProgress + 10,
            `第${attempts}次生成: 评估创意质量... (生成耗时 ${(generateTime / 1000).toFixed(1)}s)`,
            { attempt: attempts, generateTime }
          )

          // 2. 检查metadata
          const hasMetadata = creative.headlinesWithMetadata && creative.descriptionsWithMetadata
          if (!hasMetadata) {
            const headlinesWithMetadata = creative.headlines.map(text => ({ text, length: text.length }))
            const descriptionsWithMetadata = creative.descriptions.map(text => ({ text, length: text.length }))
            creative.headlinesWithMetadata = headlinesWithMetadata
            creative.descriptionsWithMetadata = descriptionsWithMetadata
          }

          // 3. 评估Ad Strength
          startTimer(`evaluate_${attempts}`)
          const evaluation = await evaluateCreativeAdStrength(
            creative.headlinesWithMetadata!,
            creative.descriptionsWithMetadata!,
            creative.keywords,
            {
              brandName: offer.brand,
              targetCountry: offer.target_country || 'US',
              targetLanguage: offer.target_language || 'en',
              userId: parsedUserId
            }
          )
          const gateDecision = evaluateRsaQualityGate(evaluation, MINIMUM_SCORE)
          const evaluateTime = endTimer(`evaluate_${attempts}`)

          sendProgress('evaluated', attemptBaseProgress + 18,
            `第${attempts}次生成: ${evaluation.finalRating} (${evaluation.finalScore}分) gate=${gateDecision.passed ? 'PASS' : 'BLOCK'} [评估 ${(evaluateTime / 1000).toFixed(1)}s]`,
            {
              attempt: attempts,
              rating: evaluation.finalRating,
              score: evaluation.finalScore,
              gatePassed: gateDecision.passed,
              failureType: gateDecision.failureType,
              generateTime,
              evaluateTime
            }
          )

          retryHistory.push({
            attempt: attempts,
            rating: evaluation.finalRating,
            score: evaluation.finalScore,
            gatePassed: gateDecision.passed,
            failureType: gateDecision.failureType,
            gateReasons: gateDecision.reasons,
            suggestions: evaluation.combinedSuggestions
          })

          // 更新最佳结果
          const currentPassed = gateDecision.passed
          const bestPassed = bestGateDecision?.passed ?? false
          if (
            !bestEvaluation ||
            (currentPassed && !bestPassed) ||
            (currentPassed === bestPassed && evaluation.finalScore > bestEvaluation.finalScore)
          ) {
            bestCreative = creative
            bestEvaluation = evaluation
            bestGateDecision = gateDecision
          }

          // 收集已使用关键词
          if (creative.keywords && creative.keywords.length > 0) {
            const nonBrandKeywords = creative.keywords.filter(kw => {
              const kwLower = kw.toLowerCase()
              return !brandKeywords.some(brand => kwLower.includes(brand) || brand.includes(kwLower))
            })
            usedKeywords = Array.from(new Set([...usedKeywords, ...nonBrandKeywords]))
          }

          // 检查是否达到目标
          if (evaluation.finalRating === targetRating && gateDecision.passed) {
            sendProgress('target_reached', attemptBaseProgress + 20,
              `达到目标评级 ${targetRating} 且通过质量门禁！`,
              {
                rating: evaluation.finalRating,
                score: evaluation.finalScore,
                gatePassed: gateDecision.passed
              }
            )
            break
          }

          if (attempts < maxRetries) {
            retryFailureType = gateDecision.failureType || 'format_fail'
            sendProgress('retry_prepare', attemptBaseProgress + 20,
              `未达到${targetRating}，准备第${attempts + 1}次优化...`,
              {
                currentRating: evaluation.finalRating,
                gatePassed: gateDecision.passed,
                failureType: retryFailureType,
                gateReasons: gateDecision.reasons.slice(0, 2),
                suggestions: evaluation.combinedSuggestions.slice(0, 3)
              }
            )
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }

        // 检查最终结果
        if (!bestCreative || !bestEvaluation) {
          sendError('生成创意失败')
          controller.close()
          return
        }
        const finalGateDecision = bestGateDecision || evaluateRsaQualityGate(bestEvaluation, MINIMUM_SCORE)

        if (!finalGateDecision.passed) {
          sendProgress('quality_warning', 84,
            'RSA质量门禁未通过，已保存为告警结果，最终以发布阶段 Launch Score 为准',
            {
              failureType: finalGateDecision.failureType,
              gateReasons: finalGateDecision.reasons
            }
          )
        }

        sendProgress('saving', 85, '正在保存创意到数据库...')

        // 保存到数据库
        startTimer('save')
        const savedCreative = await createAdCreative(parsedUserId, parsedOfferId, {
          headlines: bestCreative.headlines,
          descriptions: bestCreative.descriptions,
          keywords: bestCreative.keywords,
          keywordsWithVolume: bestCreative.keywordsWithVolume,
          negativeKeywords: bestCreative.negativeKeywords,  // 🎯 新增：传入否定关键词
          callouts: bestCreative.callouts,
          sitelinks: bestCreative.sitelinks,
          theme: bestCreative.theme,
          explanation: bestCreative.explanation,
          final_url: offer.final_url || offer.url,
          final_url_suffix: offer.final_url_suffix || undefined,
          score: bestEvaluation.finalScore,
          score_breakdown: {
            relevance: bestEvaluation.localEvaluation.dimensions.relevance.score,
            quality: bestEvaluation.localEvaluation.dimensions.quality.score,
            engagement: bestEvaluation.localEvaluation.dimensions.completeness.score,
            diversity: bestEvaluation.localEvaluation.dimensions.diversity.score,
            clarity: bestEvaluation.localEvaluation.dimensions.compliance.score,
            brandSearchVolume: bestEvaluation.localEvaluation.dimensions.brandSearchVolume.score,
            competitivePositioning: bestEvaluation.localEvaluation.dimensions.competitivePositioning.score
          },
          generation_round: attempts,
          ai_model: bestCreative.ai_model // 传入实际使用的AI模型
        })
        const saveTime = endTimer('save')

        const launchScoreTime = 0  // 不再计算Launch Score
        const totalTime = Date.now() - totalStartTime

        sendProgress('complete', 100, `生成完成！总耗时 ${(totalTime / 1000).toFixed(1)}s`)

        // 发送最终结果
        sendResult({
          success: true,
          forcePublish: false,
          forcedPublish: false,
          qualityGateBypassed: false,
          forcePublishIgnored: forcePublishRequested,
          finalPublishDecision: {
            status: 'PENDING_LAUNCH_SCORE_CHECK',
            stage: 'campaign_publish',
            hardBlockSource: 'launch_score'
          },
          qualityGate: {
            passed: finalGateDecision.passed,
            warning: !finalGateDecision.passed,
            reasons: finalGateDecision.reasons,
            failureType: finalGateDecision.failureType,
            rsaQualityGate: bestEvaluation.rsaQualityGate
          },
          creative: {
            id: savedCreative.id,
            headlines: bestCreative.headlines,
            descriptions: bestCreative.descriptions,
            keywords: bestCreative.keywords,
            keywordsWithVolume: bestCreative.keywordsWithVolume,
            negativeKeywords: bestCreative.negativeKeywords,  // 🎯 新增：返回否定关键词
            callouts: bestCreative.callouts,
            sitelinks: bestCreative.sitelinks,
            theme: bestCreative.theme,
            explanation: bestCreative.explanation,
            headlinesWithMetadata: bestCreative.headlinesWithMetadata,
            descriptionsWithMetadata: bestCreative.descriptionsWithMetadata,
            qualityMetrics: bestCreative.qualityMetrics
          },
          adStrength: {
            rating: bestEvaluation.finalRating,
            score: bestEvaluation.finalScore,
            isExcellent: bestEvaluation.finalRating === 'EXCELLENT',
            rsaQualityGate: bestEvaluation.rsaQualityGate,
            dimensions: bestEvaluation.localEvaluation.dimensions,
            suggestions: bestEvaluation.combinedSuggestions
          },
          optimization: {
            attempts,
            targetRating,
            achieved: bestEvaluation.finalRating === targetRating && finalGateDecision.passed,
            qualityGatePassed: finalGateDecision.passed,
            history: retryHistory
          },
          offer: {
            id: offer.id,
            brand: offer.brand,
            url: offer.url,
            affiliateLink: offer.affiliate_link
          }
        })

      } catch (error: any) {
        console.error('生成创意失败:', error)
        sendError(error.message || '生成创意失败')
      } finally {
        // 只有在控制器仍然打开时才关闭
        if (isControllerOpen(controller)) {
          controller.close()
        }
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
}
