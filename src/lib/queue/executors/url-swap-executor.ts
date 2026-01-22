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
import { updateTaskAfterManualAdvance, updateTaskAfterSwap, recordSwapHistory, setTaskError, type UrlSwapErrorType } from '@/lib/url-swap'
import type { UrlSwapTaskData } from '@/lib/url-swap-types'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import { updateCampaignFinalUrlSuffix } from '@/lib/google-ads-api'
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
        swap_mode,
        manual_final_url_suffixes,
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

    const swapMode = taskRow.swap_mode === 'manual' ? 'manual' : 'auto'
    const effectiveCustomerId = (taskRow.google_customer_id ?? googleCustomerId) as string | null
    const effectiveCampaignId = (taskRow.google_campaign_id ?? googleCampaignId) as string | null
    effectiveCurrentFinalUrl = (typeof taskRow.current_final_url === 'string' ? taskRow.current_final_url : currentFinalUrl) as string | null
    effectiveCurrentFinalUrlSuffix = (typeof taskRow.current_final_url_suffix === 'string' ? taskRow.current_final_url_suffix : currentFinalUrlSuffix) as string | null

    // =========================
    // 方式二：手动轮询推广链接列表（兼容suffix列表）
    // =========================
    if (swapMode === 'manual') {
      const manualEntries = parseStringArrayJson(taskRow.manual_final_url_suffixes)
      if (manualEntries.length === 0) {
        throw new Error('方式二未配置推广链接列表，请在任务设置中添加至少 1 个')
      }

      const cursorRaw = taskRow.manual_suffix_cursor
      const cursor = typeof cursorRaw === 'number' ? cursorRaw : parseInt(String(cursorRaw ?? '0'), 10)
      const safeCursor = Number.isFinite(cursor) && cursor >= 0 ? cursor : 0

      const selectedEntry = manualEntries[safeCursor % manualEntries.length]
      const nextCursor = (safeCursor + 1) % manualEntries.length

      const currentUrlFromDb = typeof taskRow.current_final_url === 'string' ? taskRow.current_final_url : ''
      const currentSuffixFromDb = typeof taskRow.current_final_url_suffix === 'string' ? taskRow.current_final_url_suffix : ''

      // 新模式：推广链接列表 → 解析得到Final URL/Suffix
      if (isHttpUrl(selectedEntry)) {
        // 确保代理池已按该用户的设置加载
        await initializeProxyPool(task.userId, targetCountry)

        console.log(`[url-swap-executor]（manual）解析推广链接: ${selectedEntry}`)
        const resolved = await resolveAffiliateLink(selectedEntry, {
          targetCountry,
          skipCache: true
        })

        const urlChanged = resolved.finalUrl !== currentUrlFromDb ||
                           resolved.finalUrlSuffix !== currentSuffixFromDb

        if (!effectiveCustomerId || !effectiveCampaignId) {
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

        if (urlChanged) {
          console.log(`[url-swap-executor]（manual）更新Google Ads: customer=${effectiveCustomerId}, campaign=${effectiveCampaignId}`)

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

            try {
              await updateCampaignFinalUrlSuffix({
                customerId: effectiveCustomerId,
                refreshToken,
                campaignId: effectiveCampaignId,
                finalUrlSuffix: resolved.finalUrlSuffix,
                userId: task.userId,
                authType: auth.authType,
                serviceAccountId: auth.serviceAccountId,
              })
            } catch (firstError: any) {
              const message = firstError?.message || String(firstError)
              if (auth.authType === 'oauth' && isOAuthInvalidGrantError(message) && serviceAccount?.id) {
                console.warn(`[url-swap-executor] OAuth refresh token无效，降级使用服务账号执行: ${serviceAccount.id}`)
                await updateCampaignFinalUrlSuffix({
                  customerId: effectiveCustomerId,
                  refreshToken: '',
                  campaignId: effectiveCampaignId,
                  finalUrlSuffix: resolved.finalUrlSuffix,
                  userId: task.userId,
                  authType: 'service_account',
                  serviceAccountId: serviceAccount.id,
                })
              } else {
                throw firstError
              }
            }
          } catch (adsError: any) {
            const message = adsError?.message || String(adsError)
            adsApiError = message.includes('Google Ads') ? new Error(message) : new Error(`Google Ads API调用失败: ${message}`)
          }

          if (adsApiError) {
            throw adsApiError
          }
        }

        if (urlChanged) {
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
          await updateTaskAfterManualAdvance(taskId, nextCursor)
        }

        console.log(`[url-swap-executor]（manual）换链执行完成: ${taskId}, changed=${urlChanged}`)
        return { success: true, changed: urlChanged }
      }

      // 旧模式：suffix列表轮询（兼容历史配置）
      const selectedSuffix = selectedEntry.replace(/^\?/, '').trim()
      if (!selectedSuffix) {
        throw new Error('方式二配置的Final URL suffix为空，请检查列表内容')
      }

      if (!effectiveCustomerId || !effectiveCampaignId) {
        const message =
          '缺少 Customer ID 或 Campaign ID，无法更新 Google Ads Final URL suffix。\n' +
          '请在换链任务中填写正确的 Customer/Campaign ID（或先完成Campaign发布并关联到Offer），然后重新启用任务。'

        await recordSwapHistory(taskId, {
          swapped_at: new Date().toISOString(),
          previous_final_url: currentUrlFromDb,
          previous_final_url_suffix: currentSuffixFromDb,
          new_final_url: currentUrlFromDb,
          new_final_url_suffix: selectedSuffix,
          success: false,
          error_message: message
        })

        await updateTaskStats(taskId, false, false)
        await setTaskError(taskId, message, 'google_ads_api')
        return { success: false, changed: false }
      }

      const suffixChanged = selectedSuffix !== currentSuffixFromDb

      if (suffixChanged) {
        console.log(`[url-swap-executor]（manual）更新Google Ads: customer=${effectiveCustomerId}, campaign=${effectiveCampaignId}`)

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

          try {
            await updateCampaignFinalUrlSuffix({
              customerId: effectiveCustomerId,
              refreshToken,
              campaignId: effectiveCampaignId,
              finalUrlSuffix: selectedSuffix,
              userId: task.userId,
              authType: auth.authType,
              serviceAccountId: auth.serviceAccountId,
            })
          } catch (firstError: any) {
            const message = firstError?.message || String(firstError)
            if (auth.authType === 'oauth' && isOAuthInvalidGrantError(message) && serviceAccount?.id) {
              console.warn(`[url-swap-executor] OAuth refresh token无效，降级使用服务账号执行: ${serviceAccount.id}`)
              await updateCampaignFinalUrlSuffix({
                customerId: effectiveCustomerId,
                refreshToken: '',
                campaignId: effectiveCampaignId,
                finalUrlSuffix: selectedSuffix,
                userId: task.userId,
                authType: 'service_account',
                serviceAccountId: serviceAccount.id,
              })
            } else {
              throw firstError
            }
          }
        } catch (adsError: any) {
          const message = adsError?.message || String(adsError)
          adsApiError = message.includes('Google Ads') ? new Error(message) : new Error(`Google Ads API调用失败: ${message}`)
        }

        if (adsApiError) {
          throw adsApiError
        }
      }

      if (suffixChanged) {
        await recordSwapHistory(taskId, {
          swapped_at: new Date().toISOString(),
          previous_final_url: currentUrlFromDb,
          previous_final_url_suffix: currentSuffixFromDb,
          new_final_url: currentUrlFromDb,
          new_final_url_suffix: selectedSuffix,
          success: true
        })

        await updateTaskAfterSwap(taskId, null, selectedSuffix, { manualSuffixCursor: nextCursor })
      } else {
        await updateTaskAfterManualAdvance(taskId, nextCursor)
      }

      console.log(`[url-swap-executor]（manual）换链执行完成: ${taskId}, changed=${suffixChanged}`)
      return { success: true, changed: suffixChanged }
    }

    // =========================
    // 方式一：自动解析推广链接
    // =========================
    if (!effectiveCustomerId || !effectiveCampaignId) {
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
      // URL未变化，只更新统计（不算作URL变化）
      console.log(`[url-swap-executor] URL未变化: ${taskId}`)
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

    // 4. 调用Google Ads API更新
    if (effectiveCustomerId && effectiveCampaignId) {
      console.log(`[url-swap-executor] 更新Google Ads: customer=${effectiveCustomerId}, campaign=${effectiveCampaignId}`)

      let adsApiError: Error | null = null

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

        // 调用Google Ads API更新Final URL Suffix
        try {
          await updateCampaignFinalUrlSuffix({
            customerId: effectiveCustomerId,
            refreshToken,
            campaignId: effectiveCampaignId,
            finalUrlSuffix: resolved.finalUrlSuffix,
            userId: task.userId,
            authType: auth.authType,
            serviceAccountId: auth.serviceAccountId,
          })
        } catch (firstError: any) {
          // OAuth refresh token 失效时，如果用户已配置服务账号，自动降级使用服务账号执行
          const message = firstError?.message || String(firstError)
          if (auth.authType === 'oauth' && isOAuthInvalidGrantError(message) && serviceAccount?.id) {
            console.warn(`[url-swap-executor] OAuth refresh token无效，降级使用服务账号执行: ${serviceAccount.id}`)
            await updateCampaignFinalUrlSuffix({
              customerId: effectiveCustomerId,
              refreshToken: '',
              campaignId: effectiveCampaignId,
              finalUrlSuffix: resolved.finalUrlSuffix,
              userId: task.userId,
              authType: 'service_account',
              serviceAccountId: serviceAccount.id,
            })
          } else {
            throw firstError
          }
        }

        console.log(`[url-swap-executor] Google Ads更新成功: ${taskId}`)
      } catch (adsError: any) {
        console.error(`[url-swap-executor] Google Ads更新失败: ${taskId}`, adsError.message)
        const message = adsError?.message || String(adsError)
        adsApiError = message.includes('Google Ads') ? new Error(message) : new Error(`Google Ads API调用失败: ${message}`)
      }

      // 如果Ads API失败，抛出错误让外层catch处理
      if (adsApiError) {
        throw adsApiError
      }
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
      const message = error?.message || String(error)
      if (isOAuthInvalidGrantError(message)) {
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
