/**
 * 换链接任务执行器
 * src/lib/queue/executors/url-swap-executor.ts
 *
 * 功能：执行换链接任务
 * - 解析推广链接（禁用缓存）
 * - 检测URL变化
 * - 更新Google Ads（如有变化）
 * - 记录历史
 */

import type { Task } from '../types'
import { resolveAffiliateLink } from '@/lib/url-resolver-enhanced'
import {
  updateTaskAfterManualAdvance,
  updateTaskAfterSwap,
  recordSwapHistory,
  setTaskError,
  getUrlSwapTaskTargets,
  markUrlSwapTargetSuccess,
  markUrlSwapTargetFailure,
  type UrlSwapErrorType
} from '@/lib/url-swap'
import type { UrlSwapTaskData, UrlSwapTaskTarget } from '@/lib/url-swap-types'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import { updateCampaignFinalUrlSuffix } from '@/lib/google-ads-api'
import { formatGoogleAdsApiError } from '@/lib/google-ads-api-error'
import { initializeProxyPool } from '@/lib/offer-utils'

/**
 * URL域名验证
 */
function validateUrlDomainChange(oldUrl: string, newUrl: string): {
  valid: boolean;
  error?: string;
} {
  try {
    const oldDomain = new URL(oldUrl).hostname
    const newDomain = new URL(newUrl).hostname

    if (oldDomain !== newDomain) {
      return {
        valid: false,
        error: `域名变更警告: ${oldDomain} → ${newDomain}，请确认为正常换链`
      }
    }

    return { valid: true }
  } catch (error) {
    return { valid: true } // URL解析失败时，允许继续
  }
}

function isOAuthInvalidGrantError(message: string): boolean {
  return (
    message.includes('invalid_grant') ||
    message.includes('Token has been expired') ||
    message.includes('Token has been revoked') ||
    message.includes('Token has been expired or revoked')
  )
}

function formatGoogleAdsError(error: unknown): string {
  const responseData = (error as any)?.response?.data
  const formatted = formatGoogleAdsApiError(responseData ?? error)
  if (formatted && formatted !== 'Google Ads API error') return formatted
  return formatGoogleAdsApiError(error)
}

function shouldRetryTargetOnSameSuffix(target: UrlSwapTaskTarget): boolean {
  return Boolean(target.last_error) || (target.consecutive_failures ?? 0) > 0
}

async function updateTargetsFinalUrlSuffix(params: {
  targets: UrlSwapTaskTarget[]
  finalUrlSuffix: string
  userId: number
  refreshToken: string
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ successCount: number; failureCount: number; failures: string[] }> {
  const failures: string[] = []
  let successCount = 0
  let failureCount = 0

  let forcedAuthType: 'oauth' | 'service_account' | null = null

  for (const target of params.targets) {
    const attemptAuthType = forcedAuthType ?? params.authType
    try {
      try {
        await updateCampaignFinalUrlSuffix({
          customerId: target.google_customer_id,
          refreshToken: attemptAuthType === 'oauth' ? params.refreshToken : '',
          campaignId: target.google_campaign_id,
          finalUrlSuffix: params.finalUrlSuffix,
          userId: params.userId,
          authType: attemptAuthType,
          serviceAccountId: attemptAuthType === 'service_account' ? params.serviceAccountId : undefined,
        })
      } catch (firstError: any) {
        const message = firstError?.message || String(firstError)
        if (attemptAuthType === 'oauth' && isOAuthInvalidGrantError(message) && params.serviceAccountId) {
          await updateCampaignFinalUrlSuffix({
            customerId: target.google_customer_id,
            refreshToken: '',
            campaignId: target.google_campaign_id,
            finalUrlSuffix: params.finalUrlSuffix,
            userId: params.userId,
            authType: 'service_account',
            serviceAccountId: params.serviceAccountId,
          })
          forcedAuthType = 'service_account'
        } else {
          throw firstError
        }
      }

      if (target.id) {
        await markUrlSwapTargetSuccess(target.id)
      }
      successCount += 1
    } catch (error: any) {
      const message = formatGoogleAdsError(error)
      failures.push(message)
      failureCount += 1
      if (target.id) {
        await markUrlSwapTargetFailure(target.id, message)
      }
    }
  }

  return { successCount, failureCount, failures }
}

/**
 * 导出任务数据类型（供index.ts使用）
 */
export type { UrlSwapTaskData }

function parseStringArrayJson(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.trim())
  }
  if (typeof input !== 'string' || !input.trim()) return []
  try {
    const parsed = JSON.parse(input)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.trim())
  } catch {
    return []
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/**
 * 执行换链接任务
 */
export async function executeUrlSwapTask(
  task: Task<UrlSwapTaskData>
): Promise<{ success: boolean; changed: boolean }> {
  const { taskId, offerId, affiliateLink, targetCountry, googleCustomerId, googleCampaignId, currentFinalUrl, currentFinalUrlSuffix } = task.data

  console.log(`[url-swap-executor] 开始执行任务: ${taskId}, offer: ${offerId}`)

  let effectiveCurrentFinalUrl: string | null = currentFinalUrl
  let effectiveCurrentFinalUrlSuffix: string | null = currentFinalUrlSuffix

  try {
    // 读取任务最新配置（用于方式二/以及避免队列数据过期）
    const db = await getDatabase()
    const taskRow = await db.queryOne<any>(`
      SELECT
        status,
        is_deleted,
        swap_mode,
        manual_affiliate_links,
        manual_suffix_cursor,
        current_final_url,
        current_final_url_suffix,
        google_customer_id,
        google_campaign_id
      FROM url_swap_tasks
      WHERE id = ?
    `, [taskId])

    if (!taskRow) {
      throw new Error('任务不存在或已被删除')
    }

    const status = String(taskRow.status || '').toLowerCase()
    const isDeleted = taskRow.is_deleted === true || Number(taskRow.is_deleted) === 1
    if (isDeleted || status !== 'enabled') {
      console.log(`[url-swap-executor] 跳过执行: taskId=${taskId}, status=${status || 'unknown'}, isDeleted=${isDeleted}`)
      return { success: false, changed: false }
    }

    const swapMode = taskRow.swap_mode === 'manual' ? 'manual' : 'auto'
    const effectiveCustomerId = (taskRow.google_customer_id ?? googleCustomerId) as string | null
    const effectiveCampaignId = (taskRow.google_campaign_id ?? googleCampaignId) as string | null
    effectiveCurrentFinalUrl = (typeof taskRow.current_final_url === 'string' ? taskRow.current_final_url : currentFinalUrl) as string | null
    effectiveCurrentFinalUrlSuffix = (typeof taskRow.current_final_url_suffix === 'string' ? taskRow.current_final_url_suffix : currentFinalUrlSuffix) as string | null

    const activeTargets = await getUrlSwapTaskTargets(taskId, task.userId, { status: 'active' })
    const fallbackTargets: UrlSwapTaskTarget[] = (!activeTargets.length && effectiveCustomerId && effectiveCampaignId)
      ? [{
          id: '',
          task_id: taskId,
          offer_id: offerId,
          google_ads_account_id: 0,
          google_customer_id: effectiveCustomerId,
          google_campaign_id: effectiveCampaignId,
          status: 'active',
          consecutive_failures: 0,
          last_success_at: null,
          last_error: null,
          created_at: '',
          updated_at: ''
        }]
      : []
    const taskTargets = activeTargets.length > 0 ? activeTargets : fallbackTargets

    // =========================
    // 方式二：手动轮询推广链接列表
    // =========================
    if (swapMode === 'manual') {
      const manualAffiliateLinks = parseStringArrayJson(taskRow.manual_affiliate_links)
      if (manualAffiliateLinks.length === 0) {
        throw new Error('方式二未配置推广链接列表，请在任务设置中添加至少 1 个')
      }

      const cursorRaw = taskRow.manual_suffix_cursor
      const cursor = typeof cursorRaw === 'number' ? cursorRaw : parseInt(String(cursorRaw ?? '0'), 10)
      const safeCursor = Number.isFinite(cursor) && cursor >= 0 ? cursor : 0

      const selectedLink = manualAffiliateLinks[safeCursor % manualAffiliateLinks.length]
      const nextCursor = (safeCursor + 1) % manualAffiliateLinks.length

      if (!isHttpUrl(selectedLink)) {
        throw new Error('推广链接格式错误（需http/https），请重新配置方式二列表')
      }

      const currentUrlFromDb = typeof taskRow.current_final_url === 'string' ? taskRow.current_final_url : ''
      const currentSuffixFromDb = typeof taskRow.current_final_url_suffix === 'string' ? taskRow.current_final_url_suffix : ''

      // 确保代理池已按该用户的设置加载
      await initializeProxyPool(task.userId, targetCountry)

      console.log(`[url-swap-executor]（manual）解析推广链接: ${selectedLink}`)
      const resolved = await resolveAffiliateLink(selectedLink, {
        targetCountry,
        skipCache: true
      })

      const urlChanged = resolved.finalUrl !== currentUrlFromDb ||
                         resolved.finalUrlSuffix !== currentSuffixFromDb

      if (!taskTargets.length) {
        const message =
          '缺少 Customer ID 或 Campaign ID，无法更新 Google Ads Final URL suffix。\n' +
          '请在换链任务中填写正确的 Customer/Campaign ID（或先完成Campaign发布并关联到Offer），然后重新启用任务。'

        await recordSwapHistory(taskId, {
          swapped_at: new Date().toISOString(),
          previous_final_url: currentUrlFromDb,
          previous_final_url_suffix: currentSuffixFromDb,
          new_final_url: resolved.finalUrl,
          new_final_url_suffix: resolved.finalUrlSuffix,
          success: false,
          error_message: message
        })

        await updateTaskStats(taskId, false, false)
        await setTaskError(taskId, message, 'google_ads_api')
        return { success: false, changed: false }
      }

      if (urlChanged && currentUrlFromDb) {
        const validation = validateUrlDomainChange(currentUrlFromDb, resolved.finalUrl)
        if (!validation.valid) {
          console.error(`[url-swap-executor] 域名变更警告: ${taskId} - ${validation.error}`)
          await setTaskError(taskId, validation.error!)
          return { success: false, changed: false }
        }
      }

      const targetsToUpdate = urlChanged
        ? taskTargets
        : taskTargets.filter(shouldRetryTargetOnSameSuffix)

      let updateResult: { successCount: number; failureCount: number; failures: string[] } | null = null
      if (targetsToUpdate.length > 0) {
        console.log(`[url-swap-executor]（manual）更新Google Ads目标数: ${targetsToUpdate.length}`)

        let adsApiError: Error | null = null

        try {
          const credentials = await getGoogleAdsCredentials(task.userId)
          const auth = await getUserAuthType(task.userId)

          const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
          const serviceAccount = await db.queryOne(`
            SELECT id FROM google_ads_service_accounts
            WHERE user_id = ? AND ${isActiveCondition}
            ORDER BY created_at DESC LIMIT 1
          `, [task.userId]) as { id: string } | undefined

          if ((!credentials || !credentials.refresh_token) && !serviceAccount) {
            throw new Error('OAuth refresh token或服务账号配置缺失，请重新授权或配置服务账号')
          }

          const refreshToken = credentials?.refresh_token || ''

          updateResult = await updateTargetsFinalUrlSuffix({
            targets: targetsToUpdate,
            finalUrlSuffix: resolved.finalUrlSuffix,
            userId: task.userId,
            refreshToken,
            authType: auth.authType,
            serviceAccountId: auth.authType === 'service_account' ? auth.serviceAccountId : (serviceAccount?.id ?? auth.serviceAccountId)
          })
        } catch (adsError: any) {
          const message = formatGoogleAdsError(adsError)
          adsApiError = message.includes('Google Ads') ? new Error(message) : new Error(`Google Ads API调用失败: ${message}`)
        }

        if (adsApiError) {
          throw adsApiError
        }
      }

      if (urlChanged) {
        const hasSuccess = (updateResult?.successCount ?? 0) > 0
        if (targetsToUpdate.length > 0 && !hasSuccess) {
          throw new Error('Google Ads 更新失败（所有目标均未更新成功）')
        }
        await recordSwapHistory(taskId, {
          swapped_at: new Date().toISOString(),
          previous_final_url: currentUrlFromDb,
          previous_final_url_suffix: currentSuffixFromDb,
          new_final_url: resolved.finalUrl,
          new_final_url_suffix: resolved.finalUrlSuffix,
          success: true
        })

        await updateTaskAfterSwap(taskId, resolved.finalUrl, resolved.finalUrlSuffix, { manualSuffixCursor: nextCursor })
      } else {
        const hasUpdates = targetsToUpdate.length > 0
        const hasSuccess = (updateResult?.successCount ?? 0) > 0
        if (hasUpdates && !hasSuccess) {
          throw new Error('Google Ads 更新失败（所有目标均未更新成功）')
        }
        await updateTaskAfterManualAdvance(taskId, nextCursor)
      }

      console.log(`[url-swap-executor]（manual）换链执行完成: ${taskId}, changed=${urlChanged}`)
      return { success: true, changed: urlChanged }
    }

    // =========================
    // 方式一：自动解析推广链接
    // =========================
    if (!taskTargets.length) {
      const message =
        '缺少 Customer ID 或 Campaign ID，无法更新 Google Ads Final URL suffix。\n' +
        '请在换链任务中填写正确的 Customer/Campaign ID（或先完成Campaign发布并关联到Offer），然后重新启用任务。'

      await recordSwapHistory(taskId, {
        swapped_at: new Date().toISOString(),
        previous_final_url: effectiveCurrentFinalUrl || '',
        previous_final_url_suffix: effectiveCurrentFinalUrlSuffix || '',
        new_final_url: '',
        new_final_url_suffix: '',
        success: false,
        error_message: message
      })

      await updateTaskStats(taskId, false, false)
      await setTaskError(taskId, message, 'google_ads_api')
      return { success: false, changed: false }
    }

    // 确保代理池已按该用户的设置加载（executor 运行在队列进程中，不能假设已初始化）
    await initializeProxyPool(task.userId, targetCountry)

    // 1. 解析推广链接（禁用缓存，确保获取最新URL）
    console.log(`[url-swap-executor] 解析推广链接: ${affiliateLink}`)
    const resolved = await resolveAffiliateLink(affiliateLink, {
      targetCountry,
      skipCache: true  // 换链任务必须禁用缓存
    })

    console.log(`[url-swap-executor] 解析结果: finalUrl=${resolved.finalUrl}, suffix=${resolved.finalUrlSuffix}`)

    // 2. 对比是否发生变化
    const urlChanged = resolved.finalUrl !== effectiveCurrentFinalUrl ||
                       resolved.finalUrlSuffix !== effectiveCurrentFinalUrlSuffix

    if (!urlChanged) {
      const retryTargets = taskTargets.filter(shouldRetryTargetOnSameSuffix)
      if (retryTargets.length === 0) {
        // URL未变化，只更新统计（不算作URL变化）
        console.log(`[url-swap-executor] URL未变化: ${taskId}`)
        await updateTaskStats(taskId, true, false)
        return { success: true, changed: false }
      }

      console.log(`[url-swap-executor] URL未变化，尝试重试失败目标: ${retryTargets.length}`)
      let retryResult: { successCount: number; failureCount: number; failures: string[] } | null = null
      try {
        const credentials = await getGoogleAdsCredentials(task.userId)
        const auth = await getUserAuthType(task.userId)

        const db = await getDatabase()
        const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
        const serviceAccount = await db.queryOne(`
          SELECT id FROM google_ads_service_accounts
          WHERE user_id = ? AND ${isActiveCondition}
          ORDER BY created_at DESC LIMIT 1
        `, [task.userId]) as { id: string } | undefined

        if ((!credentials || !credentials.refresh_token) && !serviceAccount) {
          throw new Error('OAuth refresh token或服务账号配置缺失，请重新授权或配置服务账号')
        }

        const refreshToken = credentials?.refresh_token || ''

        retryResult = await updateTargetsFinalUrlSuffix({
          targets: retryTargets,
          finalUrlSuffix: resolved.finalUrlSuffix,
          userId: task.userId,
          refreshToken,
          authType: auth.authType,
          serviceAccountId: auth.authType === 'service_account' ? auth.serviceAccountId : (serviceAccount?.id ?? auth.serviceAccountId)
        })
      } catch (adsError: any) {
        const message = formatGoogleAdsError(adsError)
        throw new Error(message.includes('Google Ads') ? message : `Google Ads API调用失败: ${message}`)
      }

      const hasSuccess = (retryResult?.successCount ?? 0) > 0
      if (!hasSuccess) {
        throw new Error('Google Ads 更新失败（所有目标均未更新成功）')
      }

      await updateTaskStats(taskId, true, false)
      return { success: true, changed: false }
    }

    console.log(`[url-swap-executor] 检测到URL变化: ${taskId}`)

    // 3. 验证域名一致性（防止盗链）
    if (effectiveCurrentFinalUrl) {
      const validation = validateUrlDomainChange(effectiveCurrentFinalUrl, resolved.finalUrl)
      if (!validation.valid) {
        console.error(`[url-swap-executor] 域名变更警告: ${taskId} - ${validation.error}`)
        await setTaskError(taskId, validation.error!)
        return { success: false, changed: false }
      }
    }

    // 4. 调用Google Ads API更新（多目标）
    const targetsToUpdate = taskTargets
    let updateResult: { successCount: number; failureCount: number; failures: string[] } | null = null

    if (targetsToUpdate.length > 0) {
      console.log(`[url-swap-executor] 更新Google Ads目标数: ${targetsToUpdate.length}`)

      try {
        // 获取用户认证信息
        const credentials = await getGoogleAdsCredentials(task.userId)
        const auth = await getUserAuthType(task.userId)

        // 查询服务账号配置（如果使用服务账号模式）
        const db = await getDatabase()
        const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
        const serviceAccount = await db.queryOne(`
          SELECT id FROM google_ads_service_accounts
          WHERE user_id = ? AND ${isActiveCondition}
          ORDER BY created_at DESC LIMIT 1
        `, [task.userId]) as { id: string } | undefined

        if ((!credentials || !credentials.refresh_token) && !serviceAccount) {
          throw new Error('OAuth refresh token或服务账号配置缺失，请重新授权或配置服务账号')
        }

        const refreshToken = credentials?.refresh_token || ''

        updateResult = await updateTargetsFinalUrlSuffix({
          targets: targetsToUpdate,
          finalUrlSuffix: resolved.finalUrlSuffix,
          userId: task.userId,
          refreshToken,
          authType: auth.authType,
          serviceAccountId: auth.authType === 'service_account' ? auth.serviceAccountId : (serviceAccount?.id ?? auth.serviceAccountId)
        })

        console.log(`[url-swap-executor] Google Ads更新完成: ${taskId}`)
      } catch (adsError: any) {
        const message = formatGoogleAdsError(adsError)
        console.error(`[url-swap-executor] Google Ads更新失败: ${taskId}`, message)
        throw new Error(message.includes('Google Ads') ? message : `Google Ads API调用失败: ${message}`)
      }
    }

    const hasSuccess = (updateResult?.successCount ?? 0) > 0
    if (targetsToUpdate.length > 0 && !hasSuccess) {
      throw new Error('Google Ads 更新失败（所有目标均未更新成功）')
    }

    // 5. 记录换链历史
    await recordSwapHistory(taskId, {
      swapped_at: new Date().toISOString(),
      previous_final_url: effectiveCurrentFinalUrl || '',
      previous_final_url_suffix: effectiveCurrentFinalUrlSuffix || '',
      new_final_url: resolved.finalUrl,
      new_final_url_suffix: resolved.finalUrlSuffix,
      success: true
    })

    // 6. 更新任务状态
    await updateTaskAfterSwap(taskId, resolved.finalUrl, resolved.finalUrlSuffix)

    console.log(`[url-swap-executor] 换链成功: ${taskId}`)
    return { success: true, changed: true }

  } catch (error: any) {
    const rawMessage = error?.message || String(error)
    console.error(`[url-swap-executor] 执行失败: ${taskId}`, rawMessage)

    // 检测错误类型
    let errorType: UrlSwapErrorType = 'other'
    let enhancedMessage = rawMessage

    // 检测推广链接解析失败
    if (
      rawMessage.includes('resolve') ||
      rawMessage.includes('affiliate') ||
      rawMessage.includes('推广链接格式') ||
      rawMessage.includes('无法访问') ||
      rawMessage.includes('Failed to fetch') ||
      rawMessage.includes('timeout') ||
      rawMessage.includes('ENOTFOUND') ||
      rawMessage.includes('ECONNREFUSED') ||
      rawMessage.includes('network')
    ) {
      errorType = 'link_resolution'
      enhancedMessage = `推广链接解析失败: ${rawMessage}`
    }
    // 检测Google Ads API失败
    else if (
      rawMessage.includes('Google Ads') ||
      rawMessage.includes('google_ads') ||
      rawMessage.includes('campaign') ||
      rawMessage.includes('Customer') ||
      rawMessage.includes('authentication') ||
      rawMessage.includes('authorization') ||
      rawMessage.includes('OAuth') ||
      rawMessage.includes('refresh_token') ||
      rawMessage.includes('quota') ||
      rawMessage.includes('API')
    ) {
      errorType = 'google_ads_api'
      const formattedMessage = formatGoogleAdsError(error)
      const message = formattedMessage && formattedMessage !== 'Google Ads API error'
        ? formattedMessage
        : rawMessage
      if (isOAuthInvalidGrantError(rawMessage)) {
        enhancedMessage =
          `Google OAuth 授权已过期或被撤销（invalid_grant），无法更新 Google Ads。\n` +
          `请前往设置页面重新授权，然后重新启用该任务。\n\n` +
          `错误详情: ${message}`
      } else {
        enhancedMessage = message.startsWith('Google Ads') ? message : `Google Ads API调用失败: ${message}`
      }
    }

    // 记录错误历史
    await recordSwapHistory(taskId, {
      swapped_at: new Date().toISOString(),
      previous_final_url: effectiveCurrentFinalUrl || '',
      previous_final_url_suffix: effectiveCurrentFinalUrlSuffix || '',
      new_final_url: '',
      new_final_url_suffix: '',
      success: false,
      error_message: enhancedMessage
    })

    // 更新失败统计
    await updateTaskStats(taskId, false, false)

    // 设置错误状态（带错误类型分类）
    await setTaskError(taskId, enhancedMessage, errorType)

    return { success: false, changed: false }
  }
}

/**
 * 更新任务统计
 */
async function updateTaskStats(
  taskId: string,
  success: boolean,
  changed: boolean
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  if (success) {
    await db.exec(`
      UPDATE url_swap_tasks
      SET total_swaps = total_swaps + 1,
          ${changed ? 'url_changed_count = url_changed_count + 1,' : ''}
          success_swaps = success_swaps + 1,
          consecutive_failures = 0,
          error_message = NULL,
          error_at = NULL,
          updated_at = ?
      WHERE id = ?
    `, [now, taskId])
  } else {
    await db.exec(`
      UPDATE url_swap_tasks
      SET total_swaps = total_swaps + 1,
          failed_swaps = failed_swaps + 1,
          updated_at = ?
      WHERE id = ?
    `, [now, taskId])
  }
}
