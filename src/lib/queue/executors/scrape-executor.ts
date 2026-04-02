/**
 * Scrape 任务执行器
 *
 * 负责执行网页抓取任务，包括：
 * - 推广链接解析
 * - 网页抓取（Amazon Store/Product/独立站）
 * - AI分析
 * - 评论分析
 * - 竞品分析
 * - 广告元素提取
 *
 * 代理配置：
 * - 从用户设置中获取代理（基于 offer 的 target_country）
 * - 代理URL保存在 task.proxyConfig.originalUrl 中
 */

import type { Task, TaskExecutor } from '../types'
import { analyzeProxyError } from './proxy-error-handler'

/**
 * Scrape 任务数据接口
 */
export interface ScrapeTaskData {
  offerId: number
  url: string
  brand?: string
  target_country: string  // offer 的推广国家
  priority?: number       // 1-10，数字越大优先级越高（兼容旧系统）
}

/**
 * 创建 Scrape 任务执行器
 */
export function createScrapeExecutor(): TaskExecutor<ScrapeTaskData> {
  return async (task: Task<ScrapeTaskData>) => {
    const { offerId, url, brand } = task.data
    const userId = task.userId

    console.log(`🔍 [ScrapeExecutor] 开始抓取任务: Offer #${offerId}, URL: ${url}`)
    console.log(`   用户: ${userId}, 国家: ${task.data.target_country}`)

    // 获取代理URL（如果有配置）
    const proxyUrl = task.proxyConfig?.originalUrl
    if (proxyUrl) {
      console.log(`   代理: ${task.proxyConfig?.country || 'default'}`)
    } else {
      console.log(`   代理: 未配置`)
    }

    try {
      // 动态导入抓取核心模块（避免循环依赖）
      const { performScrapeAndAnalysis } = await import('@/lib/offer-scraping-core')

      // 执行抓取和分析
      // performScrapeAndAnalysis 内部会处理所有抓取逻辑
      // 包括：URL解析、网页抓取、AI分析、评论分析、竞品分析等
      await performScrapeAndAnalysis(offerId, userId, url, brand || '')

      console.log(`✅ [ScrapeExecutor] 抓取任务完成: Offer #${offerId}`)

      // 🤖 抓取完成后自动触发 Bucket A 广告创意生成（静默，不影响抓取结果）
      autoTriggerCreativeGeneration(offerId, userId).catch((err) => {
        console.warn(`⚠️ [ScrapeExecutor] 自动触发创意生成失败（不影响抓取结果）: Offer #${offerId}`, err?.message || err)
      })
    } catch (error: any) {
      const errorAnalysis = analyzeProxyError(error)
      const errorMessage = errorAnalysis.isProxyError
        ? errorAnalysis.enhancedMessage
        : error.message

      console.error(`❌ [ScrapeExecutor] 抓取任务失败: Offer #${offerId}`, errorMessage)

      // 更新 offer 状态为失败
      try {
        const { updateOfferScrapeStatus } = await import('@/lib/offers')
        await updateOfferScrapeStatus(offerId, userId, 'failed', errorMessage)
      } catch (updateError) {
        console.error(`   更新状态失败:`, updateError)
      }

      throw error
    }
  }
}

/**
 * 抓取完成后自动触发 Bucket A 广告创意生成
 *
 * 触发条件（全部满足才入队）：
 * 1. Bucket A 在 ad_creatives 表中无现有创意（未删除）
 * 2. creative_tasks 表中无 pending/running 状态的任务（针对该 offer）
 * 3. 用户 Google Ads 配置完整（缺失则跳过，不报错）
 *
 * 任何条件不满足均静默跳过，不抛出异常。
 */
async function autoTriggerCreativeGeneration(offerId: number, userId: number): Promise<void> {
  console.log(`🤖 [ScrapeExecutor] 检查是否需要自动生成 Bucket A 创意: Offer #${offerId}`)

  // 动态导入，避免循环依赖
  const { getDatabase } = await import('@/lib/db')
  const { getQueueManager } = await import('@/lib/queue')
  const { getUserAuthType } = await import('@/lib/google-ads-oauth')
  const { getGoogleAdsConfig } = await import('@/lib/keyword-planner')
  const { AD_CREATIVE_MAX_AUTO_RETRIES } = await import('@/lib/ad-creative-quality-loop')

  const db = getDatabase()
  const isDeletedCheck = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'

  // 检查 1：Bucket A 是否已有创意
  const existingBucketA = await db.query<{ id: number }>(
    `SELECT id FROM ad_creatives
     WHERE offer_id = ? AND user_id = ? AND keyword_bucket IN ('A') AND ${isDeletedCheck}
     LIMIT 1`,
    [offerId, userId]
  )
  if (existingBucketA.length > 0) {
    console.log(`⏭️ [ScrapeExecutor] Bucket A 已存在创意，跳过自动生成: Offer #${offerId}`)
    return
  }

  // 检查 2：是否已有 pending/running 的创意任务
  const activeTasks = await db.query<{ id: string }>(
    `SELECT id FROM creative_tasks
     WHERE offer_id = ? AND user_id = ? AND status IN ('pending', 'running')
     LIMIT 1`,
    [offerId, userId]
  )
  if (activeTasks.length > 0) {
    console.log(`⏭️ [ScrapeExecutor] 已有进行中的创意任务，跳过自动生成: Offer #${offerId}, TaskId: ${activeTasks[0].id}`)
    return
  }

  // 检查 3：Google Ads 配置是否完整
  try {
    const auth = await getUserAuthType(userId)
    const googleAdsConfig = await getGoogleAdsConfig(userId, auth.authType, auth.serviceAccountId)
    const isConfigComplete = auth.authType === 'service_account'
      ? !!(googleAdsConfig?.developerToken && googleAdsConfig?.customerId)
      : !!(googleAdsConfig?.developerToken && googleAdsConfig?.refreshToken && googleAdsConfig?.customerId)

    if (!isConfigComplete) {
      console.warn(`⏭️ [ScrapeExecutor] Google Ads 配置不完整，跳过自动生成创意: Offer #${offerId}, 用户 #${userId}`)
      return
    }
  } catch (configError: any) {
    console.warn(`⏭️ [ScrapeExecutor] 检查 Google Ads 配置时出错，跳过自动生成: ${configError?.message || configError}`)
    return
  }

  // 所有条件通过，插入 creative_tasks 记录并入队
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const taskId = crypto.randomUUID()
  const targetRating = 'GOOD'
  const maxRetries = AD_CREATIVE_MAX_AUTO_RETRIES

  await db.exec(
    `INSERT INTO creative_tasks (
      id, user_id, offer_id, status, stage, progress, message,
      max_retries, target_rating, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', 'init', 0, '抓取完成后自动生成...', ?, ?, ${nowFunc}, ${nowFunc})`,
    [taskId, userId, offerId, maxRetries, targetRating]
  )

  const queue = getQueueManager()
  await queue.enqueue(
    'ad-creative',
    {
      offerId,
      maxRetries,
      targetRating,
      synthetic: false,
      bucket: 'A',
    },
    userId,
    {
      priority: 'normal',  // 自动生成使用普通优先级，不抢占手动任务
      taskId,
      maxRetries: 0,       // 禁用队列重试，由执行器内部控制多轮生成
    }
  )

  console.log(`🚀 [ScrapeExecutor] 已自动触发 Bucket A 创意生成入队: Offer #${offerId}, TaskId: ${taskId}`)
}

/**
 * 将旧的优先级数字（1-10）转换为新的优先级枚举
 *
 * 旧系统: 1-10，数字越大优先级越高
 * 新系统: 'high' | 'normal' | 'low'
 *
 * 转换规则:
 * - 8-10 → 'high'
 * - 4-7  → 'normal'
 * - 1-3  → 'low'
 */
export function convertPriorityToEnum(priority?: number): 'high' | 'normal' | 'low' {
  if (!priority) return 'normal'
  if (priority >= 8) return 'high'
  if (priority >= 4) return 'normal'
  return 'low'
}
