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
import { updateTaskAfterSwap, recordSwapHistory, setTaskError, type UrlSwapErrorType } from '@/lib/url-swap'
import type { UrlSwapTaskData } from '@/lib/url-swap-types'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import { updateCampaignFinalUrlSuffix } from '@/lib/google-ads-api'

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

/**
 * 导出任务数据类型（供index.ts使用）
 */
export type { UrlSwapTaskData }

/**
 * 执行换链接任务
 */
export async function executeUrlSwapTask(
  task: Task<UrlSwapTaskData>
): Promise<{ success: boolean; changed: boolean }> {
  const { taskId, offerId, affiliateLink, targetCountry, googleCustomerId, googleCampaignId, currentFinalUrl, currentFinalUrlSuffix } = task.data

  console.log(`[url-swap-executor] 开始执行任务: ${taskId}, offer: ${offerId}`)

  try {
    // 1. 解析推广链接（禁用缓存，确保获取最新URL）
    console.log(`[url-swap-executor] 解析推广链接: ${affiliateLink}`)
    const resolved = await resolveAffiliateLink(affiliateLink, {
      targetCountry,
      skipCache: true  // 换链任务必须禁用缓存
    })

    console.log(`[url-swap-executor] 解析结果: finalUrl=${resolved.finalUrl}, suffix=${resolved.finalUrlSuffix}`)

    // 2. 对比是否发生变化
    const urlChanged = resolved.finalUrl !== currentFinalUrl ||
                       resolved.finalUrlSuffix !== currentFinalUrlSuffix

    if (!urlChanged) {
      // URL未变化，只更新统计（不算作URL变化）
      console.log(`[url-swap-executor] URL未变化: ${taskId}`)
      await updateTaskStats(taskId, false, false)
      return { success: true, changed: false }
    }

    console.log(`[url-swap-executor] 检测到URL变化: ${taskId}`)

    // 3. 验证域名一致性（防止盗链）
    if (currentFinalUrl) {
      const validation = validateUrlDomainChange(currentFinalUrl, resolved.finalUrl)
      if (!validation.valid) {
        console.error(`[url-swap-executor] 域名变更警告: ${taskId} - ${validation.error}`)
        await setTaskError(taskId, validation.error!)
        return { success: false, changed: false }
      }
    }

    // 4. 调用Google Ads API更新（如有配置）
    if (googleCustomerId && googleCampaignId) {
      console.log(`[url-swap-executor] 更新Google Ads: customer=${googleCustomerId}, campaign=${googleCampaignId}`)

      let adsApiError: Error | null = null

      try {
        // 获取用户认证信息
        const credentials = await getGoogleAdsCredentials(task.userId)
        const auth = await getUserAuthType(task.userId)

        // 查询服务账号配置（如果使用服务账号模式）
        const db = await getDatabase()
        const serviceAccount = await db.queryOne(`
          SELECT id FROM google_ads_service_accounts
          WHERE user_id = ? AND is_active = true
          ORDER BY created_at DESC LIMIT 1
        `, [task.userId]) as { id: string } | undefined

        if ((!credentials || !credentials.refresh_token) && !serviceAccount) {
          throw new Error('OAuth refresh token或服务账号配置缺失，请重新授权或配置服务账号')
        }

        const refreshToken = credentials?.refresh_token || ''

        // 调用Google Ads API更新Final URL Suffix
        await updateCampaignFinalUrlSuffix({
          customerId: googleCustomerId,
          refreshToken,
          campaignId: googleCampaignId,
          finalUrlSuffix: resolved.finalUrlSuffix,
          userId: task.userId,
          authType: auth.authType,
          serviceAccountId: auth.serviceAccountId,
        })

        console.log(`[url-swap-executor] Google Ads更新成功: ${taskId}`)
      } catch (adsError: any) {
        console.error(`[url-swap-executor] Google Ads更新失败: ${taskId}`, adsError.message)
        adsApiError = new Error(`Google Ads API调用失败: ${adsError.message}`)
      }

      // 如果Ads API失败，抛出错误让外层catch处理
      if (adsApiError) {
        throw adsApiError
      }
    }

    // 5. 记录换链历史
    await recordSwapHistory(taskId, {
      swapped_at: new Date().toISOString(),
      previous_final_url: currentFinalUrl || '',
      previous_final_url_suffix: currentFinalUrlSuffix || '',
      new_final_url: resolved.finalUrl,
      new_final_url_suffix: resolved.finalUrlSuffix,
      success: true
    })

    // 6. 更新任务状态
    await updateTaskAfterSwap(taskId, resolved.finalUrl, resolved.finalUrlSuffix)

    console.log(`[url-swap-executor] 换链成功: ${taskId}`)
    return { success: true, changed: true }

  } catch (error: any) {
    console.error(`[url-swap-executor] 执行失败: ${taskId}`, error.message)

    // 检测错误类型
    let errorType: UrlSwapErrorType = 'other'
    let enhancedMessage = error.message

    // 检测推广链接解析失败
    if (
      error.message.includes('resolve') ||
      error.message.includes('affiliate') ||
      error.message.includes('无法访问') ||
      error.message.includes('Failed to fetch') ||
      error.message.includes('timeout') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('network')
    ) {
      errorType = 'link_resolution'
      enhancedMessage = `推广链接解析失败: ${error.message}`
    }
    // 检测Google Ads API失败
    else if (
      error.message.includes('Google Ads') ||
      error.message.includes('google_ads') ||
      error.message.includes('campaign') ||
      error.message.includes('Customer') ||
      error.message.includes('authentication') ||
      error.message.includes('authorization') ||
      error.message.includes('OAuth') ||
      error.message.includes('refresh_token') ||
      error.message.includes('quota') ||
      error.message.includes('API')
    ) {
      errorType = 'google_ads_api'
      enhancedMessage = `Google Ads API调用失败: ${error.message}`
    }

    // 记录错误历史
    await recordSwapHistory(taskId, {
      swapped_at: new Date().toISOString(),
      previous_final_url: currentFinalUrl || '',
      previous_final_url_suffix: currentFinalUrlSuffix || '',
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
