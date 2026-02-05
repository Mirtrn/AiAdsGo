import type { Task } from '../types'
import { getDatabase } from '@/lib/db'
import { fetchAutoadsJson } from '@/lib/openclaw/autoads-client'
import { getOpenclawStrategyConfig } from '@/lib/openclaw/strategy-config'
import { createStrategyRun, recordStrategyAction, updateStrategyAction, updateStrategyRun } from '@/lib/openclaw/strategy-store'
import { fetchPartnerboostAssociates, fetchPartnerboostLinkByAsin } from '@/lib/openclaw/affiliate'
import { generateNamingScheme } from '@/lib/naming-convention'
import { recordOpenclawAction } from '@/lib/openclaw/action-logs'

export type OpenclawStrategyTaskData = {
  userId: number
  mode?: string
  trigger?: string
}

type AsinItemRow = {
  id: number
  input_id: number | null
  asin: string | null
  country_code: string | null
  price: string | null
  brand: string | null
  title: string | null
  affiliate_link: string | null
  product_url: string | null
  priority: number | null
  status: string
  offer_id: number | null
  error_message: string | null
  data_json: string | null
}

type AdsAccount = {
  id: number
  customer_id?: string
  currency?: string
}

type CreativeRow = {
  id: number
  keywords?: any
  keywordsWithVolume?: any
  negativeKeywords?: any
  creationStatus?: string | null
  finalUrlSuffix?: string | null
}

const DEFAULT_TIMEZONE = process.env.TZ || 'Asia/Shanghai'

function formatLocalDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mergeJson(existing: string | null | undefined, patch: Record<string, any>): string {
  const base = parseJson<Record<string, any>>(existing, {})
  return JSON.stringify({ ...base, ...patch })
}

function normalizeKeywords(input: any, fallback: string[]): Array<{ text: string; matchType: string }> {
  const keywords: Array<{ text: string; matchType: string }> = []
  const pushKeyword = (text: string, matchType?: string) => {
    const cleaned = text.trim()
    if (!cleaned) return
    const normalizedMatch = String(matchType || '').toUpperCase()
    const validMatch = ['EXACT', 'PHRASE', 'BROAD', 'BROAD_MATCH_MODIFIER'].includes(normalizedMatch)
      ? normalizedMatch
      : (keywords.length === 0 ? 'EXACT' : 'PHRASE')
    keywords.push({ text: cleaned, matchType: validMatch })
  }

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === 'string') {
        pushKeyword(entry)
      } else if (entry && typeof entry === 'object') {
        const text = entry.text || entry.keyword
        if (typeof text === 'string') {
          pushKeyword(text, entry.matchType)
        }
      }
    }
  }

  if (keywords.length === 0) {
    fallback.forEach((kw, idx) => {
      if (!kw) return
      keywords.push({ text: kw, matchType: idx === 0 ? 'EXACT' : 'PHRASE' })
    })
  }

  return keywords
}

function normalizeNegativeKeywords(input: any): string[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((value) => Boolean(value))
}

async function updateAsinItem(params: {
  userId: number
  itemId: number
  status?: string
  offerId?: number | null
  errorMessage?: string | null
  dataPatch?: Record<string, any>
}) {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const fields: string[] = []
  const values: any[] = []

  if (params.status) {
    fields.push('status = ?')
    values.push(params.status)
  }
  if (params.offerId !== undefined) {
    fields.push('offer_id = ?')
    values.push(params.offerId)
  }
  if (params.errorMessage !== undefined) {
    fields.push('error_message = ?')
    values.push(params.errorMessage)
  }

  if (params.dataPatch) {
    const existing = await db.queryOne<{ data_json: string | null }>(
      'SELECT data_json FROM openclaw_asin_items WHERE id = ? AND user_id = ?',
      [params.itemId, params.userId]
    )
    fields.push('data_json = ?')
    values.push(mergeJson(existing?.data_json, params.dataPatch))
  }

  if (fields.length === 0) return

  await db.exec(
    `UPDATE openclaw_asin_items SET ${fields.join(', ')}, updated_at = ${nowFunc} WHERE id = ? AND user_id = ?`,
    [...values, params.itemId, params.userId]
  )
}

async function waitForOfferExtraction(userId: number, taskId: string, timeoutMs = 120000): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await fetchAutoadsJson<any>({
      userId,
      path: `/api/offers/extract/status/${taskId}`,
    })
    if (status.status === 'completed') {
      const offerId = status.result?.offerId
      return offerId ? Number(offerId) : null
    }
    if (status.status === 'failed') {
      throw new Error(status.error?.message || 'Offer提取失败')
    }
    await sleep(5000)
  }
  return null
}

async function waitForCreativeTask(userId: number, taskId: string, timeoutMs = 120000): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await fetchAutoadsJson<any>({
      userId,
      path: `/api/creative-tasks/${taskId}`,
    })
    if (status.status === 'completed') {
      const creativeId = status.result?.creative?.id
      return creativeId ? Number(creativeId) : null
    }
    if (status.status === 'failed') {
      throw new Error(status.error || '创意生成失败')
    }
    await sleep(5000)
  }
  return null
}

async function ensureAffiliateLink(userId: number, item: AsinItemRow): Promise<string | null> {
  if (item.affiliate_link) return item.affiliate_link
  if (!item.asin) return null
  const link = await fetchPartnerboostLinkByAsin({
    userId,
    asin: item.asin,
    countryCode: item.country_code,
  })
  return link?.link || null
}

async function loadActiveAdsAccounts(userId: number): Promise<AdsAccount[]> {
  const response = await fetchAutoadsJson<any>({
    userId,
    path: '/api/google-ads-accounts',
    query: { activeOnly: true },
  })
  return response?.accounts || []
}

async function fetchOffer(userId: number, offerId: number): Promise<any> {
  const response = await fetchAutoadsJson<any>({
    userId,
    path: `/api/offers/${offerId}`,
  })
  return response?.offer
}

async function fetchCreatives(userId: number, offerId: number): Promise<CreativeRow[]> {
  const response = await fetchAutoadsJson<any>({
    userId,
    path: '/api/ad-creatives',
    query: { offer_id: offerId },
  })
  return response?.creatives || []
}

async function selectCreative(userId: number, offerId: number): Promise<CreativeRow | null> {
  const creatives = await fetchCreatives(userId, offerId)
  if (!creatives || creatives.length === 0) return null
  const preferred = creatives.find((c: any) => c.creationStatus !== 'failed') || creatives[0]
  return preferred ? {
    id: preferred.id,
    keywords: preferred.keywords,
    keywordsWithVolume: preferred.keywordsWithVolume,
    negativeKeywords: preferred.negativeKeywords,
    creationStatus: preferred.creationStatus,
    finalUrlSuffix: preferred.finalUrlSuffix,
  } : null
}

async function pauseConflictingCampaigns(params: {
  userId: number
  campaigns: any[]
  targetBrand: string
  allowPause: boolean
  runId: string
}) {
  const conflicts = params.campaigns.filter((campaign: any) => {
    const brand = String(campaign.offerBrand || '').trim().toLowerCase()
    const target = params.targetBrand.trim().toLowerCase()
    return brand && target && brand !== target && campaign.status === 'ENABLED'
  })
  if (conflicts.length === 0) return { paused: 0, skipped: 0 }
  if (!params.allowPause) return { paused: 0, skipped: conflicts.length }

  let paused = 0
  for (const campaign of conflicts) {
    const actionId = await recordStrategyAction({
      runId: params.runId,
      userId: params.userId,
      actionType: 'pause_campaign',
      targetType: 'campaign',
      targetId: String(campaign.id),
      requestJson: JSON.stringify({ status: 'PAUSED' }),
    })
    try {
      await fetchAutoadsJson({
        userId: params.userId,
        path: `/api/campaigns/${campaign.id}/toggle-status`,
        method: 'PUT',
        body: { status: 'PAUSED' },
      })
      await updateStrategyAction({ actionId, status: 'success' })
      await recordOpenclawAction({
        userId: params.userId,
        channel: 'strategy',
        action: 'PUT /api/campaigns/:id/toggle-status',
        targetType: 'campaign',
        targetId: String(campaign.id),
        requestBody: JSON.stringify({ status: 'PAUSED' }),
        status: 'success',
      })
      paused += 1
    } catch (error: any) {
      await updateStrategyAction({
        actionId,
        status: 'failed',
        errorMessage: error?.message || '暂停失败',
      })
    }
  }
  return { paused, skipped: conflicts.length - paused }
}

export async function executeOpenclawStrategy(
  task: Task<OpenclawStrategyTaskData>
): Promise<{ success: boolean; runId?: string; skipped?: boolean }> {
  const userId = task.data?.userId || task.userId
  const config = await getOpenclawStrategyConfig(userId)
  const runDate = formatLocalDate(new Date())

  const runId = await createStrategyRun({
    userId,
    mode: task.data?.mode || 'auto',
    runDate,
    configJson: JSON.stringify(config),
  })

  const db = await getDatabase()
  const nowIso = new Date().toISOString()

  if (!config.enabled && task.data?.mode !== 'manual') {
    await updateStrategyRun({
      runId,
      status: 'skipped',
      statsJson: JSON.stringify({ reason: 'strategy_disabled' }),
      completedAt: nowIso,
    })
    return { success: true, runId, skipped: true }
  }

  const running = await db.queryOne<{ id: string }>(
    `SELECT id FROM openclaw_strategy_runs WHERE user_id = ? AND status = 'running' LIMIT 1`,
    [userId]
  )
  if (running) {
    await updateStrategyRun({
      runId,
      status: 'skipped',
      errorMessage: '已有运行中的策略',
      completedAt: nowIso,
    })
    return { success: true, runId, skipped: true }
  }

  await updateStrategyRun({
    runId,
    status: 'running',
    startedAt: nowIso,
  })

  const stats: Record<string, any> = {
    offersConsidered: 0,
    offersCreated: 0,
    creativesGenerated: 0,
    campaignsPublished: 0,
    campaignsPaused: 0,
    skipped: 0,
  }

  try {
    const budgetActionId = await recordStrategyAction({
      runId,
      userId,
      actionType: 'budget_check',
    })
    let budgetSummary: any = null
    try {
      const budget = await fetchAutoadsJson<any>({
        userId,
        path: '/api/analytics/budget',
        query: { start_date: runDate, end_date: runDate },
      })
      budgetSummary = budget?.data?.overall || null
      await updateStrategyAction({
        actionId: budgetActionId,
        status: 'success',
        responseJson: JSON.stringify(budgetSummary),
      })
    } catch (error: any) {
      await updateStrategyAction({
        actionId: budgetActionId,
        status: 'failed',
        errorMessage: error?.message || '预算查询失败',
      })
    }

    const totalSpent = Number(budgetSummary?.totalSpent || 0)
    let totalBudget = Number(budgetSummary?.totalBudget || 0)
    stats.dailySpent = totalSpent
    stats.dailyBudget = totalBudget

    if (totalSpent >= config.dailySpendCap) {
      await updateStrategyRun({
        runId,
        status: 'completed',
        statsJson: JSON.stringify({ ...stats, reason: 'daily_spend_cap' }),
        completedAt: new Date().toISOString(),
      })
      return { success: true, runId }
    }

    const accounts = await loadActiveAdsAccounts(userId)
    const filteredAccounts = config.adsAccountIds && config.adsAccountIds.length > 0
      ? accounts.filter(account => config.adsAccountIds!.includes(Number(account.id)))
      : accounts

    if (filteredAccounts.length === 0) {
      await updateStrategyRun({
        runId,
        status: 'completed',
        statsJson: JSON.stringify({ ...stats, reason: 'no_ads_accounts' }),
        completedAt: new Date().toISOString(),
      })
      return { success: true, runId }
    }

    const performance = await fetchAutoadsJson<any>({
      userId,
      path: '/api/campaigns/performance',
      query: { daysBack: 7 },
    }).catch(() => null)
    const campaigns = performance?.campaigns || []

    if (config.enableAutoAdjustCpc && campaigns.length > 0) {
      const candidates = campaigns
        .filter((campaign: any) => campaign.status === 'ENABLED' && campaign.googleCampaignId)
        .sort((a: any, b: any) => (b.performance?.costUsd || 0) - (a.performance?.costUsd || 0))
        .slice(0, 5)

      for (const campaign of candidates) {
        const actionId = await recordStrategyAction({
          runId,
          userId,
          actionType: 'adjust_cpc',
          targetType: 'campaign',
          targetId: String(campaign.id),
        })
        try {
          const roi = await fetchAutoadsJson<any>({
            userId,
            path: '/api/analytics/roi',
            query: { start_date: runDate, end_date: runDate, campaign_id: campaign.id },
          })
          const overall = roi?.data?.overall || {}
          const cost = Number(overall.totalCost || 0)
          const revenue = Number(overall.totalRevenue || 0)
          const roas = cost > 0 ? revenue / cost : 0
          const newCpc = roas >= config.targetRoas
            ? config.maxCpc
            : config.minCpc

          await fetchAutoadsJson({
            userId,
            path: `/api/campaigns/${campaign.googleCampaignId}/update-cpc`,
            method: 'PUT',
            body: { newCpc },
          })

          await updateStrategyAction({
            actionId,
            status: 'success',
            responseJson: JSON.stringify({ roas, newCpc }),
          })

          stats.cpcAdjusted = (stats.cpcAdjusted || 0) + 1
        } catch (error: any) {
          await updateStrategyAction({
            actionId,
            status: 'failed',
            errorMessage: error?.message || 'CPC调整失败',
          })
        }
      }
    }

    const items = await db.query<AsinItemRow>(
      `
        SELECT id, input_id, asin, country_code, price, brand, title, affiliate_link, product_url, priority, status, offer_id, error_message, data_json
        FROM openclaw_asin_items
        WHERE user_id = ?
          AND status IN ('pending', 'offer_pending', 'offer_created', 'creative_pending', 'creative_ready')
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
      `,
      [userId, config.maxOffersPerRun]
    )

    if (!items || items.length === 0) {
      if (config.allowAffiliateFetch) {
        const actionId = await recordStrategyAction({
          runId,
          userId,
          actionType: 'affiliate_discovery',
        })
        try {
          const associates = await fetchPartnerboostAssociates(userId)
          const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
          for (const item of associates.slice(0, config.maxOffersPerRun)) {
            await db.exec(
              `INSERT INTO openclaw_asin_items
               (user_id, asin, country_code, brand, priority, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ${nowFunc}, ${nowFunc})`,
              [
                userId,
                item.asin,
                item.region || 'US',
                item.brand_name || null,
                0,
                'partnerboost',
              ]
            )
          }
          await updateStrategyAction({
            actionId,
            status: 'success',
            responseJson: JSON.stringify({ inserted: Math.min(associates.length, config.maxOffersPerRun) }),
          })
        } catch (error: any) {
          await updateStrategyAction({
            actionId,
            status: 'failed',
            errorMessage: error?.message || '联盟平台获取失败',
          })
        }
      }

      await updateStrategyRun({
        runId,
        status: 'completed',
        statsJson: JSON.stringify({ ...stats, reason: 'no_asin_items' }),
        completedAt: new Date().toISOString(),
      })
      return { success: true, runId }
    }

    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx]
      stats.offersConsidered += 1
      const account = filteredAccounts[idx % filteredAccounts.length]
      const itemData = parseJson<Record<string, any>>(item.data_json, {})

      await updateAsinItem({ userId, itemId: item.id, status: 'processing' })

      let offerId = item.offer_id
      let affiliateLink: string | null = null
      if (!offerId && itemData.offer_task_id) {
        try {
          const status = await fetchAutoadsJson<any>({
            userId,
            path: `/api/offers/extract/status/${itemData.offer_task_id}`,
          })
          if (status.status === 'completed' && status.result?.offerId) {
            offerId = Number(status.result.offerId)
            await updateAsinItem({
              userId,
              itemId: item.id,
              offerId,
              status: 'offer_created',
            })
          } else if (status.status === 'failed') {
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'failed',
              errorMessage: status.error?.message || 'Offer提取失败',
            })
            stats.skipped += 1
            continue
          } else {
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'offer_pending',
            })
            stats.skipped += 1
            continue
          }
        } catch (error: any) {
          await updateAsinItem({
            userId,
            itemId: item.id,
            status: 'offer_pending',
            errorMessage: error?.message || 'Offer提取查询失败',
          })
          stats.skipped += 1
          continue
        }
      }

      if (!offerId) {
        affiliateLink = config.allowAffiliateFetch ? await ensureAffiliateLink(userId, item) : item.affiliate_link
        if (affiliateLink) {
          const actionId = await recordStrategyAction({
            runId,
            userId,
            actionType: 'create_offer_extract',
            targetType: 'asin',
            targetId: item.asin || String(item.id),
            requestJson: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: item.country_code || 'US',
            }),
          })

          try {
            const extractRes = await fetchAutoadsJson<any>({
              userId,
              path: '/api/offers/extract',
              method: 'POST',
              body: {
                affiliate_link: affiliateLink,
                target_country: item.country_code || 'US',
                product_price: item.price || undefined,
              },
            })
            await updateStrategyAction({
              actionId,
              status: 'success',
              responseJson: JSON.stringify(extractRes),
            })

            await recordOpenclawAction({
              userId,
              channel: 'strategy',
              action: 'POST /api/offers/extract',
              targetType: 'asin',
              targetId: item.asin || String(item.id),
              requestBody: JSON.stringify({ affiliate_link: affiliateLink, target_country: item.country_code || 'US' }),
              status: 'success',
            })

            const taskId = extractRes?.taskId
            if (taskId) {
              const extractedOfferId = await waitForOfferExtraction(userId, taskId)
              if (extractedOfferId) {
                offerId = extractedOfferId
                stats.offersCreated += 1
                await updateAsinItem({
                  userId,
                  itemId: item.id,
                  offerId,
                  status: 'offer_created',
                  dataPatch: { offer_task_id: taskId },
                })
              } else {
                await updateAsinItem({
                  userId,
                  itemId: item.id,
                  status: 'offer_pending',
                  dataPatch: { offer_task_id: taskId },
                })
                stats.skipped += 1
                continue
              }
            }
          } catch (error: any) {
            await updateStrategyAction({
              actionId,
              status: 'failed',
              errorMessage: error?.message || 'Offer提取失败',
            })
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'failed',
              errorMessage: error?.message || 'Offer提取失败',
            })
            stats.skipped += 1
            continue
          }
        } else if (item.product_url) {
          const actionId = await recordStrategyAction({
            runId,
            userId,
            actionType: 'create_offer',
            targetType: 'asin',
            targetId: item.asin || String(item.id),
          })
          try {
            const createRes = await fetchAutoadsJson<any>({
              userId,
              path: '/api/offers',
              method: 'POST',
              body: {
                url: item.product_url,
                brand: item.brand || undefined,
                target_country: item.country_code || 'US',
                affiliate_link: affiliateLink || undefined,
                product_price: item.price || undefined,
              },
            })
            offerId = createRes?.offer?.id
            await updateStrategyAction({
              actionId,
              status: 'success',
              responseJson: JSON.stringify(createRes),
            })
            if (offerId) {
              stats.offersCreated += 1
              await updateAsinItem({
                userId,
                itemId: item.id,
                offerId,
                status: 'offer_created',
              })
            }
          } catch (error: any) {
            await updateStrategyAction({
              actionId,
              status: 'failed',
              errorMessage: error?.message || 'Offer创建失败',
            })
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'failed',
              errorMessage: error?.message || 'Offer创建失败',
            })
            stats.skipped += 1
            continue
          }
        } else {
          await updateAsinItem({
            userId,
            itemId: item.id,
            status: 'failed',
            errorMessage: '缺少affiliate_link或product_url',
          })
          stats.skipped += 1
          continue
        }
      }

      if (!offerId) {
        stats.skipped += 1
        continue
      }

      const offer = await fetchOffer(userId, offerId)
      if (!offer) {
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'failed',
          errorMessage: 'Offer不存在',
        })
        stats.skipped += 1
        continue
      }

      if ((!offer.brand || offer.brand === 'Unknown') && item.brand) {
        try {
          await fetchAutoadsJson({
            userId,
            path: `/api/offers/${offerId}`,
            method: 'PUT',
            body: { brand: item.brand },
          })
        } catch (error) {
          // ignore
        }
      }

      let creativeId = itemData.creative_id ? Number(itemData.creative_id) : null
      let creative = creativeId ? { id: creativeId } as CreativeRow : null
      if (!creativeId && itemData.creative_task_id) {
        try {
          const maybeCreativeId = await waitForCreativeTask(userId, itemData.creative_task_id, 60000)
          if (maybeCreativeId) {
            creativeId = maybeCreativeId
            creative = { id: creativeId }
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'creative_ready',
              dataPatch: { creative_id: creativeId, creative_task_id: itemData.creative_task_id },
            })
          } else {
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'creative_pending',
              dataPatch: { creative_task_id: itemData.creative_task_id },
            })
            stats.skipped += 1
            continue
          }
        } catch (error: any) {
          await updateAsinItem({
            userId,
            itemId: item.id,
            status: 'creative_pending',
            errorMessage: error?.message || '创意任务等待失败',
          })
          stats.skipped += 1
          continue
        }
      }

      if (!creativeId) {
        creative = await selectCreative(userId, offerId)
        if (creative) {
          creativeId = creative.id
        } else {
          const actionId = await recordStrategyAction({
            runId,
            userId,
            actionType: 'generate_creative',
            targetType: 'offer',
            targetId: String(offerId),
          })
          try {
            const createRes = await fetchAutoadsJson<any>({
              userId,
              path: `/api/offers/${offerId}/generate-creatives-queue`,
              method: 'POST',
              body: { maxRetries: 3 },
            })
            const taskId = createRes?.taskId
            await updateStrategyAction({
              actionId,
              status: 'success',
              responseJson: JSON.stringify(createRes),
            })

            if (taskId) {
              const generatedId = await waitForCreativeTask(userId, taskId)
              if (generatedId) {
                creativeId = generatedId
                stats.creativesGenerated += 1
                await updateAsinItem({
                  userId,
                  itemId: item.id,
                  status: 'creative_ready',
                  dataPatch: { creative_id: creativeId, creative_task_id: taskId },
                })
              } else {
                await updateAsinItem({
                  userId,
                  itemId: item.id,
                  status: 'creative_pending',
                  dataPatch: { creative_task_id: taskId },
                })
                stats.skipped += 1
                continue
              }
            }
          } catch (error: any) {
            await updateStrategyAction({
              actionId,
              status: 'failed',
              errorMessage: error?.message || '创意生成失败',
            })
            await updateAsinItem({
              userId,
              itemId: item.id,
              status: 'failed',
              errorMessage: error?.message || '创意生成失败',
            })
            stats.skipped += 1
            continue
          }
        }
      }

      if (!creativeId) {
        stats.skipped += 1
        continue
      }

      if (!config.enableAutoPublish || config.dryRun) {
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'creative_ready',
          dataPatch: { creative_id: creativeId, dry_run: config.dryRun },
        })
        stats.skipped += 1
        continue
      }

      const offerBrand = String(offer.brand || item.brand || '').trim()
      const accountCampaigns = campaigns.filter((c: any) => Number(c.googleAdsAccountId) === Number(account.id))
      const pauseResult = await pauseConflictingCampaigns({
        userId,
        campaigns: accountCampaigns,
        targetBrand: offerBrand,
        allowPause: config.enableAutoPause,
        runId,
      })
      stats.campaignsPaused += pauseResult.paused
      if (pauseResult.skipped > 0 && !config.enableAutoPause) {
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'creative_ready',
          errorMessage: '品牌冲突，已跳过',
        })
        stats.skipped += 1
        continue
      }

      if (totalBudget + config.defaultBudget > config.dailyBudgetCap) {
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'creative_ready',
          errorMessage: '预算上限限制，已跳过',
        })
        stats.skipped += 1
        continue
      }

      const naming = generateNamingScheme({
        offer: {
          id: offer.id,
          brand: offer.brand || item.brand || 'Brand',
          offerName: offer.offerName || undefined,
          category: offer.category || undefined,
        },
        config: {
          targetCountry: offer.targetCountry || 'US',
          budgetAmount: config.defaultBudget,
          budgetType: 'DAILY',
          biddingStrategy: 'MAXIMIZE_CLICKS',
          maxCpcBid: config.maxCpc,
        },
      })

      const creativeDetails = creative || await selectCreative(userId, offerId)
      const keywordsWithVolume = parseJson<any[]>(creativeDetails?.keywordsWithVolume, [])
      const keywordsRaw = parseJson<any[]>(creativeDetails?.keywords, [])
      const negativeKeywordsRaw = parseJson<any[]>(creativeDetails?.negativeKeywords, [])
      const fallbackKeywords = [offer.brand, offer.offerName].filter((v) => typeof v === 'string' && v.trim()) as string[]

      const campaignConfig = {
        campaignName: naming.campaignName,
        adGroupName: naming.adGroupName,
        budgetAmount: config.defaultBudget,
        budgetType: 'DAILY',
        targetCountry: offer.targetCountry || 'US',
        targetLanguage: offer.targetLanguage || 'en',
        biddingStrategy: 'MAXIMIZE_CLICKS',
        marketingObjective: 'WEB_TRAFFIC',
        finalUrlSuffix: offer.finalUrlSuffix || creativeDetails?.finalUrlSuffix || '',
        maxCpcBid: Math.max(config.minCpc, Math.min(config.maxCpc, config.maxCpc)),
        keywords: normalizeKeywords(
          keywordsWithVolume.length > 0 ? keywordsWithVolume : keywordsRaw,
          fallbackKeywords
        ),
        negativeKeywords: normalizeNegativeKeywords(negativeKeywordsRaw),
      }

      const publishActionId = await recordStrategyAction({
        runId,
        userId,
        actionType: 'publish_campaign',
        targetType: 'offer',
        targetId: String(offerId),
        requestJson: JSON.stringify({
          offerId,
          adCreativeId: creativeId,
          googleAdsAccountId: account.id,
          campaignConfig,
        }),
      })

      try {
        const publishRes = await fetchAutoadsJson<any>({
          userId,
          path: '/api/campaigns/publish',
          method: 'POST',
          body: {
            offerId,
            adCreativeId: creativeId,
            googleAdsAccountId: account.id,
            campaignConfig,
            pauseOldCampaigns: false,
            enableCampaignImmediately: true,
            enableSmartOptimization: false,
          },
        })

        await updateStrategyAction({
          actionId: publishActionId,
          status: 'success',
          responseJson: JSON.stringify(publishRes),
        })
        await recordOpenclawAction({
          userId,
          channel: 'strategy',
          action: 'POST /api/campaigns/publish',
          targetType: 'offer',
          targetId: String(offerId),
          requestBody: JSON.stringify({ offerId, adCreativeId: creativeId, googleAdsAccountId: account.id }),
          status: 'success',
        })

        stats.campaignsPublished += 1
        totalBudget += config.defaultBudget
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'published',
          dataPatch: {
            creative_id: creativeId,
            publish_result: publishRes,
          },
        })
      } catch (error: any) {
        await updateStrategyAction({
          actionId: publishActionId,
          status: 'failed',
          errorMessage: error?.message || '发布失败',
        })
        await updateAsinItem({
          userId,
          itemId: item.id,
          status: 'failed',
          errorMessage: error?.message || '发布失败',
        })
        stats.skipped += 1
        continue
      }
    }

    await updateStrategyRun({
      runId,
      status: 'completed',
      statsJson: JSON.stringify(stats),
      completedAt: new Date().toISOString(),
    })

    return { success: true, runId }
  } catch (error: any) {
    await updateStrategyRun({
      runId,
      status: 'failed',
      errorMessage: error?.message || '策略执行失败',
      statsJson: JSON.stringify(stats),
      completedAt: new Date().toISOString(),
    })
    return { success: false, runId }
  }
}
