import { NextRequest } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { generateAdCreative } from '@/lib/ad-creative-generator'
import { createAdCreative, type GeneratedAdCreativeData } from '@/lib/ad-creative'
import {
  evaluateCreativeAdStrength,
  type ComprehensiveAdStrengthResult,
  calculateLaunchScore
} from '@/lib/scoring'

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

  // 验证Offer存在
  const offer = await findOfferById(parseInt(id, 10), parseInt(userId, 10))
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

  // 创建SSE流
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // 发送进度更新的helper函数
      const sendProgress = (step: string, progress: number, message: string, details?: any) => {
        const data = JSON.stringify({ type: 'progress', step, progress, message, details })
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      }

      // 发送完成结果
      const sendResult = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`))
      }

      // 发送错误
      const sendError = (error: string, details?: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error, details })}\n\n`))
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

        let bestCreative: GeneratedAdCreativeData | null = null
        let bestEvaluation: ComprehensiveAdStrengthResult | null = null
        let attempts = 0
        let retryHistory: Array<{
          attempt: number
          rating: string
          score: number
          suggestions: string[]
        }> = []

        let usedKeywords: string[] = []
        const brandKeywords = [offer.brand.toLowerCase()]

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
            parseInt(id, 10),
            parseInt(userId, 10),
            {
              skipCache: attempts > 1,
              excludeKeywords: attempts > 1 ? usedKeywords : undefined
            }
          )
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
              userId: parseInt(userId, 10)
            }
          )
          const evaluateTime = endTimer(`evaluate_${attempts}`)

          sendProgress('evaluated', attemptBaseProgress + 18,
            `第${attempts}次生成: ${evaluation.finalRating} (${evaluation.finalScore}分) [评估 ${(evaluateTime / 1000).toFixed(1)}s]`,
            {
              attempt: attempts,
              rating: evaluation.finalRating,
              score: evaluation.finalScore,
              generateTime,
              evaluateTime
            }
          )

          retryHistory.push({
            attempt: attempts,
            rating: evaluation.finalRating,
            score: evaluation.finalScore,
            suggestions: evaluation.combinedSuggestions
          })

          // 更新最佳结果
          if (!bestEvaluation || evaluation.finalScore > bestEvaluation.finalScore) {
            bestCreative = creative
            bestEvaluation = evaluation
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
          if (evaluation.finalRating === targetRating) {
            sendProgress('target_reached', attemptBaseProgress + 20,
              `达到目标评级 ${targetRating}！`,
              { rating: evaluation.finalRating, score: evaluation.finalScore }
            )
            break
          }

          if (attempts < maxRetries) {
            sendProgress('retry_prepare', attemptBaseProgress + 20,
              `未达到${targetRating}，准备第${attempts + 1}次优化...`,
              {
                currentRating: evaluation.finalRating,
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

        // 质量门检查
        const MINIMUM_SCORE = 70
        if (bestEvaluation.finalScore < MINIMUM_SCORE) {
          sendError(`创意质量未达标（${bestEvaluation.finalScore}分）`, {
            currentScore: bestEvaluation.finalScore,
            currentRating: bestEvaluation.finalRating,
            minimumScore: MINIMUM_SCORE,
            suggestions: bestEvaluation.combinedSuggestions.slice(0, 10)
          })
          controller.close()
          return
        }

        sendProgress('saving', 85, '正在保存创意到数据库...')

        // 保存到数据库
        startTimer('save')
        const savedCreative = await createAdCreative(parseInt(userId, 10), parseInt(id, 10), {
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
            clarity: bestEvaluation.localEvaluation.dimensions.compliance.score
          },
          generation_round: attempts,
          ai_model: bestCreative.ai_model // 传入实际使用的AI模型
        })
        const saveTime = endTimer('save')

        sendProgress('launch_score', 92, `正在计算投放评分... (保存耗时 ${(saveTime / 1000).toFixed(1)}s)`)

        // 计算Launch Score
        startTimer('launch_score')
        const launchScore = await calculateLaunchScore(
          offer,
          savedCreative,
          parseInt(userId, 10)
        )
        const launchScoreTime = endTimer('launch_score')
        const totalTime = Date.now() - totalStartTime

        sendProgress('complete', 100, `生成完成！总耗时 ${(totalTime / 1000).toFixed(1)}s`)

        // 发送最终结果
        sendResult({
          success: true,
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
            dimensions: bestEvaluation.localEvaluation.dimensions,
            suggestions: bestEvaluation.combinedSuggestions
          },
          optimization: {
            attempts,
            targetRating,
            achieved: bestEvaluation.finalRating === targetRating,
            history: retryHistory
          },
          offer: {
            id: offer.id,
            brand: offer.brand,
            url: offer.url,
            affiliateLink: offer.affiliate_link
          },
          launchScore: {
            score: launchScore.totalScore,
            analysis: launchScore.analysis,
            recommendations: launchScore.recommendations
          }
        })

      } catch (error: any) {
        console.error('生成创意失败:', error)
        sendError(error.message || '生成创意失败')
      } finally {
        controller.close()
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
