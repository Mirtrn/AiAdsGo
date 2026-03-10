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
  AD_CREATIVE_MAX_AUTO_RETRIES,
  AD_CREATIVE_REQUIRED_MIN_SCORE,
  evaluateCreativeForQuality,
  runCreativeGenerationQualityLoop
} from '@/lib/ad-creative-quality-loop'
import { isControllerOpen } from '@/lib/sse-helper'

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
    maxRetries = AD_CREATIVE_MAX_AUTO_RETRIES,
    targetRating: requestedTargetRating = 'GOOD'
  } = body
  const forcePublishRequested = body?.forcePublish === true || body?.force_publish === true
  const parsedOfferId = parseInt(id, 10)
  const parsedUserId = parseInt(userId, 10)
  const normalizedMaxRetries = Math.max(
    0,
    Math.min(
      AD_CREATIVE_MAX_AUTO_RETRIES,
      Number.isFinite(Number(maxRetries)) ? Math.floor(Number(maxRetries)) : AD_CREATIVE_MAX_AUTO_RETRIES
    )
  )
  const enforcedTargetRating = 'GOOD'

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
  const offerAny = offer as any

  let searchTermFeedbackHints: {
    hardNegativeTerms?: string[]
    softSuppressTerms?: string[]
    highPerformingTerms?: string[]
  } | undefined
  try {
    const hints = await getSearchTermFeedbackHints({
      offerId: parsedOfferId,
      userId: parsedUserId
    })
    searchTermFeedbackHints = {
      hardNegativeTerms: hints.hardNegativeTerms,
      softSuppressTerms: hints.softSuppressTerms,
      highPerformingTerms: hints.highPerformingTerms
    }
    console.log(
      `🔁 [SSE] 搜索词反馈已加载: high=${hints.highPerformingTerms.length}, hard=${hints.hardNegativeTerms.length}, soft=${hints.softSuppressTerms.length}, rows=${hints.sourceRows}`
    )
  } catch (hintError: any) {
    console.warn(`⚠️ [SSE] 搜索词反馈读取失败，继续默认生成: ${hintError?.message || 'unknown error'}`)
  }

  // 创建SSE流
  const encoder = new TextEncoder()
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
        if (String(requestedTargetRating || '').toUpperCase() !== enforcedTargetRating) {
          sendProgress('compat_notice', 7, `targetRating=${requestedTargetRating} 已忽略，统一使用 GOOD`)
        }

        let usedKeywords: string[] = []
        const brandKeywords = [String(offer.brand || '').toLowerCase()].filter(Boolean)
        const generateDurations = new Map<number, number>()

        const generationResult = await runCreativeGenerationQualityLoop<GeneratedAdCreativeData>({
          maxRetries: normalizedMaxRetries,
          delayMs: 1000,
          generate: async ({ attempt, retryFailureType }) => {
            const attemptBaseProgress = 10 + (attempt - 1) * 25
            sendProgress('generating', attemptBaseProgress,
              `第${attempt}次生成: AI正在创作广告文案...`,
              { attempt, maxRetries: normalizedMaxRetries }
            )

            startTimer(`generate_${attempt}`)
            const creative = await generateAdCreative(
              parsedOfferId,
              parsedUserId,
              {
                skipCache: attempt > 1,
                excludeKeywords: attempt > 1 ? usedKeywords : undefined,
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
            const generateTime = endTimer(`generate_${attempt}`)
            generateDurations.set(attempt, generateTime)

            sendProgress('evaluating', attemptBaseProgress + 10,
              `第${attempt}次生成: 评估创意质量... (生成耗时 ${(generateTime / 1000).toFixed(1)}s)`,
              { attempt, generateTime }
            )

            if (creative.keywords && creative.keywords.length > 0) {
              const nonBrandKeywords = creative.keywords.filter(kw => {
                const kwLower = kw.toLowerCase()
                return !brandKeywords.some(brand => kwLower.includes(brand) || brand.includes(kwLower))
              })
              usedKeywords = Array.from(new Set([...usedKeywords, ...nonBrandKeywords]))
            }

            return creative
          },
          evaluate: async (creative, { attempt }) => {
            startTimer(`evaluate_${attempt}`)
            const evaluation = await evaluateCreativeForQuality({
              creative,
              minimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
              adStrengthContext: {
                brandName: offer.brand,
                targetCountry: offer.target_country || 'US',
                targetLanguage: offer.target_language || 'en',
                userId: parsedUserId
              },
              ruleContext: {
                brandName: offer.brand,
                category: offer.category,
                productName: offer.product_name || offerAny.product_title || offerAny.name,
                productTitle: offerAny.product_title || offerAny.title,
                productDescription: offer.brand_description,
                uniqueSellingPoints: offer.unique_selling_points || offer.product_highlights,
                keywords: creative.keywords,
                targetLanguage: offer.target_language || 'en',
                bucket: null
              }
            })
            const evaluateTime = endTimer(`evaluate_${attempt}`)
            const attemptBaseProgress = 10 + (attempt - 1) * 25
            const generateTime = generateDurations.get(attempt) || 0

            sendProgress('evaluated', attemptBaseProgress + 18,
              `第${attempt}次生成: ${evaluation.adStrength.finalRating} (${evaluation.adStrength.finalScore}分) gate=${evaluation.passed ? 'PASS' : 'BLOCK'} [评估 ${(evaluateTime / 1000).toFixed(1)}s]`,
              {
                attempt,
                rating: evaluation.adStrength.finalRating,
                score: evaluation.adStrength.finalScore,
                gatePassed: evaluation.passed,
                failureType: evaluation.failureType,
                generateTime,
                evaluateTime,
                reasons: evaluation.reasons.slice(0, 3)
              }
            )

            if (evaluation.passed) {
              sendProgress('target_reached', attemptBaseProgress + 20,
                '达到目标评级 GOOD 且通过质量门禁！',
                {
                  rating: evaluation.adStrength.finalRating,
                  score: evaluation.adStrength.finalScore,
                  gatePassed: true
                }
              )
            } else if (attempt <= normalizedMaxRetries) {
              sendProgress('retry_prepare', attemptBaseProgress + 20,
                `未达到GOOD，准备第${attempt + 1}次优化...`,
                {
                  currentRating: evaluation.adStrength.finalRating,
                  gatePassed: false,
                  failureType: evaluation.failureType,
                  gateReasons: evaluation.reasons.slice(0, 2),
                  suggestions: evaluation.adStrength.combinedSuggestions.slice(0, 3)
                }
              )
            }

            return evaluation
          }
        })

        const attempts = generationResult.attempts
        const bestCreative = generationResult.selectedCreative
        const selectedEvaluation = generationResult.selectedEvaluation
        const bestEvaluation = selectedEvaluation.adStrength
        const finalGateDecision = selectedEvaluation.rsaGate
        const finalRuleGateDecision = selectedEvaluation.ruleGate
        const qualityPassed = selectedEvaluation.passed
        const retryHistory = generationResult.history.map(item => ({
          ...item,
          gatePassed: item.passed,
          gateReasons: item.reasons
        }))

        if (!qualityPassed) {
          sendProgress('quality_warning', 84,
            '未达 GOOD 阈值，已保存重试中表现最佳的创意',
            {
              failureType: selectedEvaluation.failureType,
              gateReasons: selectedEvaluation.reasons
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
        endTimer('save')
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
            passed: qualityPassed,
            warning: !qualityPassed,
            reasons: selectedEvaluation.reasons,
            failureType: selectedEvaluation.failureType,
            rsaGatePassed: finalGateDecision.passed,
            ruleGatePassed: finalRuleGateDecision.passed,
            rsaQualityGate: bestEvaluation.rsaQualityGate,
            ruleGate: finalRuleGateDecision
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
            targetRating: enforcedTargetRating,
            achieved: qualityPassed,
            qualityGatePassed: qualityPassed,
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
