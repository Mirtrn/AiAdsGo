import type { Task } from '@/lib/queue/types'
import { getDatabase } from '@/lib/db'
import { nowFunc } from '@/lib/db-helpers'
import { fetchAutoadsAsUser } from '@/lib/openclaw/autoads-client'
import { recordOpenclawAction } from '@/lib/openclaw/action-logs'
import { buildEffectiveCreative } from '@/lib/campaign-publish/effective-creative'
import { resolveTaskCampaignKeywords } from '@/lib/campaign-publish/task-keyword-fallback'
import { inferNegativeKeywordMatchType, normalizeMatchType } from '@/lib/campaign-publish/negative-keyword-match-type'
import { normalizeCampaignPublishCampaignConfig } from '@/lib/openclaw/commands/payload-policy'

export type OpenclawCommandTaskData = {
  runId: string
  userId: number
  trigger?: 'direct' | 'confirm' | 'retry'
}

const MAX_BODY_LENGTH = 20000

function truncateBody(value: string | null | undefined): string | null {
  if (!value) return null
  return value.length > MAX_BODY_LENGTH ? `${value.slice(0, MAX_BODY_LENGTH)}...` : value
}

function parseJsonObject(value: string | null | undefined): Record<string, any> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>
    }
  } catch {
    // ignore
  }
  return undefined
}

function parseJsonAny(value: string | null | undefined): any {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const CLICK_FARM_PUBLISH_LOOKBACK_MS = 6 * 60 * 60 * 1000
const MAX_INT32 = 2147483647

const WEB_DEFAULT_DAILY_BUDGET_BY_CURRENCY: Record<string, number> = {
  USD: 10,
  CNY: 70,
  EUR: 10,
  GBP: 8,
  JPY: 1500,
  KRW: 13000,
  AUD: 15,
  CAD: 14,
  HKD: 78,
  TWD: 315,
  SGD: 13,
  INR: 830,
}

const WEB_DEFAULT_CPC_BY_CURRENCY: Record<string, number> = {
  USD: 0.17,
  CNY: 1.2,
  EUR: 0.16,
  GBP: 0.13,
  JPY: 25,
  KRW: 220,
  AUD: 0.26,
  CAD: 0.24,
  HKD: 1.3,
  TWD: 5.4,
  SGD: 0.23,
  INR: 14,
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.floor(parsed)
  return normalized > 0 ? normalized : null
}

function toSafePositiveInt32(value: unknown): number | null {
  const normalized = toPositiveInteger(value)
  if (!normalized) return null
  return normalized <= MAX_INT32 ? normalized : null
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveNumber(value: unknown): boolean {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
}

function normalizeCurrencyCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function getWebDefaultDailyBudget(currency: unknown): number {
  return WEB_DEFAULT_DAILY_BUDGET_BY_CURRENCY[normalizeCurrencyCode(currency)] || 10
}

function getWebDefaultCpc(currency: unknown): number {
  return WEB_DEFAULT_CPC_BY_CURRENCY[normalizeCurrencyCode(currency)] || 0.17
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        const candidate = typeof obj.text === 'string' ? obj.text : (typeof obj.keyword === 'string' ? obj.keyword : '')
        return candidate.trim()
      }
      return ''
    })
    .filter((item) => item.length > 0)
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function buildWebDefaultKeywords(params: {
  keywordsWithVolume: unknown
  keywords: unknown
}): Array<Record<string, any>> {
  const candidateKeywordsWithVolume = parseJsonArray(params.keywordsWithVolume)
  const candidateKeywords = parseJsonArray(params.keywords)
  const source = candidateKeywordsWithVolume.length > 0 ? candidateKeywordsWithVolume : candidateKeywords
  if (source.length === 0) return []

  const validMatchTypes = new Set(['EXACT', 'PHRASE', 'BROAD', 'BROAD_MATCH_MODIFIER'])
  const normalizedKeywords: Array<Record<string, any>> = []
  const dedupe = new Set<string>()

  source.forEach((entry, index) => {
    let text = ''
    let matchType = ''
    let searchVolume: unknown
    let lowTopPageBid: unknown
    let highTopPageBid: unknown

    if (typeof entry === 'string') {
      text = entry.trim()
    } else if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>
      const textCandidate = typeof obj.keyword === 'string' ? obj.keyword : (typeof obj.text === 'string' ? obj.text : '')
      text = textCandidate.trim()
      matchType = typeof obj.matchType === 'string' ? obj.matchType.trim().toUpperCase() : ''
      searchVolume = obj.searchVolume
      lowTopPageBid = obj.lowTopPageBid
      highTopPageBid = obj.highTopPageBid
    }

    if (!text) return
    const dedupeKey = text.toLowerCase()
    if (dedupe.has(dedupeKey)) return
    dedupe.add(dedupeKey)

    const normalizedMatchType = validMatchTypes.has(matchType) ? matchType : (index === 0 ? 'EXACT' : 'PHRASE')
    const normalizedEntry: Record<string, any> = {
      text,
      matchType: normalizedMatchType,
    }

    if (isPositiveNumber(searchVolume)) normalizedEntry.searchVolume = Number(searchVolume)
    if (isPositiveNumber(lowTopPageBid)) normalizedEntry.lowTopPageBid = Number(lowTopPageBid)
    if (isPositiveNumber(highTopPageBid)) normalizedEntry.highTopPageBid = Number(highTopPageBid)

    normalizedKeywords.push(normalizedEntry)
  })

  return normalizedKeywords
}

function buildWebDefaultNegativeKeywords(value: unknown): string[] {
  const dedupe = new Set<string>()
  const normalized: string[] = []

  for (const keyword of ensureStringArray(parseJsonArray(value))) {
    const key = keyword.toLowerCase()
    if (dedupe.has(key)) continue
    dedupe.add(key)
    normalized.push(keyword)
  }

  return normalized
}

function buildDefaultNegativeKeywordMatchTypeMap(keywords: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  keywords.forEach((keyword) => {
    map[keyword] = inferNegativeKeywordMatchType(keyword)
  })
  return map
}

function buildNormalizedNegativeKeywordMatchTypeMap(params: {
  keywords: string[]
  currentMap: unknown
}): Record<string, string> {
  const sourceMap = isPlainObject(params.currentMap)
    ? (params.currentMap as Record<string, unknown>)
    : {}

  const normalizedMap: Record<string, string> = {}
  params.keywords.forEach((keyword) => {
    const candidate = sourceMap[keyword]
      ?? sourceMap[keyword.toLowerCase()]
      ?? sourceMap[keyword.toUpperCase()]
    const normalized = normalizeMatchType(typeof candidate === 'string' ? candidate : null)
    normalizedMap[keyword] = normalized || inferNegativeKeywordMatchType(keyword)
  })

  return normalizedMap
}

async function resolvePublishOfferContext(params: {
  db: any
  userId: number
  offerId: number | null
}): Promise<{ url: string; targetCountry: string; targetLanguage: string } | null> {
  if (!params.offerId) return null

  const row = await params.db.queryOne<{
    url: string | null
    target_country: string | null
    target_language: string | null
  }>(
    `SELECT url, target_country, target_language
     FROM offers
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [params.offerId, params.userId]
  )

  if (!row) return null
  return {
    url: typeof row.url === 'string' ? row.url : '',
    targetCountry: typeof row.target_country === 'string' ? row.target_country : '',
    targetLanguage: typeof row.target_language === 'string' ? row.target_language : '',
  }
}

async function resolvePublishAccountCurrency(params: {
  db: any
  userId: number
  rawAccountId: unknown
}): Promise<string | null> {
  const raw = String(params.rawAccountId ?? '').trim().replace(/\s+/g, '')
  if (!raw) return null

  const accountId = toSafePositiveInt32(raw)
  const notDeletedCondition = params.db.type === 'postgres'
    ? '(is_deleted = false OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  if (accountId) {
    const byId = await params.db.queryOne<{ currency: string | null }>(
      `SELECT currency
       FROM google_ads_accounts
       WHERE id = ? AND user_id = ? AND ${notDeletedCondition}
       LIMIT 1`,
      [accountId, params.userId]
    )
    if (byId?.currency) {
      return byId.currency
    }
  }

  const customerId = raw.replace(/-/g, '')
  if (!customerId) return null

  const byCustomerId = await params.db.queryOne<{ currency: string | null }>(
    `SELECT currency
     FROM google_ads_accounts
     WHERE customer_id = ? AND user_id = ? AND ${notDeletedCondition}
     LIMIT 1`,
    [customerId, params.userId]
  )

  return byCustomerId?.currency || null
}

function isCampaignPublishCommand(method: string, path: string): boolean {
  return method.toUpperCase() === 'POST' && path === '/api/campaigns/publish'
}

async function hydrateCampaignPublishRequestBody(params: {
  db: any
  userId: number
  method: string
  path: string
  body: unknown
}): Promise<{ body: unknown; hydrated: boolean }> {
  if (!isCampaignPublishCommand(params.method, params.path)) {
    return { body: params.body, hydrated: false }
  }

  if (!isPlainObject(params.body)) {
    return { body: params.body, hydrated: false }
  }

  const body = params.body as Record<string, any>
  const campaignConfigRaw = body.campaignConfig ?? body.campaign_config
  const normalizedCampaignConfig = normalizeCampaignPublishCampaignConfig(campaignConfigRaw)
  if (!normalizedCampaignConfig) {
    return { body: params.body, hydrated: false }
  }

  const campaignConfig = normalizedCampaignConfig
  const normalizedBody: Record<string, any> = {
    ...body,
    campaignConfig,
  }
  if (Object.prototype.hasOwnProperty.call(body, 'campaign_config')) {
    normalizedBody.campaign_config = campaignConfig
  }

  const offerId = toPositiveInteger(normalizedBody.offerId ?? normalizedBody.offer_id)
  const adCreativeId = toPositiveInteger(normalizedBody.adCreativeId ?? normalizedBody.ad_creative_id)
  const rawGoogleAdsAccountId = normalizedBody.googleAdsAccountId ?? normalizedBody.google_ads_account_id

  const [offerContext, accountCurrency] = await Promise.all([
    resolvePublishOfferContext({
      db: params.db,
      userId: params.userId,
      offerId,
    }),
    resolvePublishAccountCurrency({
      db: params.db,
      userId: params.userId,
      rawAccountId: rawGoogleAdsAccountId,
    }),
  ])

  const creative = (offerId && adCreativeId)
    ? await params.db.queryOne<{
        id: number
        keywords: unknown
        keywords_with_volume: unknown
        negative_keywords: unknown
        final_url: string | null
        final_url_suffix: string | null
      }>(
        `SELECT id, keywords, keywords_with_volume, negative_keywords, final_url, final_url_suffix
         FROM ad_creatives
         WHERE id = ? AND offer_id = ? AND user_id = ?
         LIMIT 1`,
        [adCreativeId, offerId, params.userId]
      )
    : null

  const hydratedCampaignConfig: Record<string, any> = {
    ...campaignConfig,
  }

  if (!isPositiveNumber(hydratedCampaignConfig.budgetAmount)) {
    hydratedCampaignConfig.budgetAmount = getWebDefaultDailyBudget(accountCurrency)
  }

  if (!isNonEmptyString(hydratedCampaignConfig.budgetType)) {
    hydratedCampaignConfig.budgetType = 'DAILY'
  }

  if (!isNonEmptyString(hydratedCampaignConfig.targetCountry)) {
    hydratedCampaignConfig.targetCountry = offerContext?.targetCountry || 'US'
  }

  if (!isNonEmptyString(hydratedCampaignConfig.targetLanguage)) {
    hydratedCampaignConfig.targetLanguage = offerContext?.targetLanguage || 'en'
  }

  if (!isNonEmptyString(hydratedCampaignConfig.biddingStrategy)) {
    hydratedCampaignConfig.biddingStrategy = 'MAXIMIZE_CLICKS'
  }

  if (!isNonEmptyString(hydratedCampaignConfig.marketingObjective)) {
    hydratedCampaignConfig.marketingObjective = 'WEB_TRAFFIC'
  }

  if (!isPositiveNumber(hydratedCampaignConfig.maxCpcBid)) {
    hydratedCampaignConfig.maxCpcBid = getWebDefaultCpc(accountCurrency)
  }

  if (!isNonEmptyString(hydratedCampaignConfig.finalUrlSuffix)) {
    hydratedCampaignConfig.finalUrlSuffix = isNonEmptyString(creative?.final_url_suffix)
      ? String(creative?.final_url_suffix).trim()
      : ''
  }

  const finalUrlCandidate = isNonEmptyString(creative?.final_url)
    ? String(creative?.final_url).trim()
    : (isNonEmptyString(offerContext?.url) ? String(offerContext?.url).trim() : '')
  if ((!Array.isArray(hydratedCampaignConfig.finalUrls) || hydratedCampaignConfig.finalUrls.length === 0) && finalUrlCandidate) {
    hydratedCampaignConfig.finalUrls = [finalUrlCandidate]
  }

  const defaultKeywords = creative
    ? buildWebDefaultKeywords({
        keywordsWithVolume: creative.keywords_with_volume,
        keywords: creative.keywords,
      })
    : []
  const defaultNegativeKeywords = creative
    ? buildWebDefaultNegativeKeywords(creative.negative_keywords)
    : []

  const configuredNegativeKeywords =
    hydratedCampaignConfig.negativeKeywords !== undefined
      ? hydratedCampaignConfig.negativeKeywords
      : hydratedCampaignConfig.negative_keywords

  const effectiveCreative = buildEffectiveCreative({
    dbCreative: {
      headlines: [],
      descriptions: [],
      keywords: creative?.keywords || [],
      negativeKeywords: creative?.negative_keywords || [],
      callouts: [],
      sitelinks: [],
      finalUrl: finalUrlCandidate || '',
      finalUrlSuffix: creative?.final_url_suffix || null,
    },
    campaignConfig: hydratedCampaignConfig,
    offerUrlFallback: offerContext?.url || undefined,
  })

  const resolvedKeywordConfig = resolveTaskCampaignKeywords({
    configuredKeywords: hydratedCampaignConfig.keywords,
    configuredNegativeKeywords,
    fallbackKeywords: defaultKeywords.length > 0 ? defaultKeywords : effectiveCreative.keywords,
    fallbackNegativeKeywords: defaultNegativeKeywords.length > 0 ? defaultNegativeKeywords : effectiveCreative.negativeKeywords,
  })

  if (resolvedKeywordConfig.usedKeywordFallback) {
    hydratedCampaignConfig.keywords = resolvedKeywordConfig.keywords
  }

  if (resolvedKeywordConfig.usedNegativeKeywordFallback) {
    hydratedCampaignConfig.negativeKeywords = resolvedKeywordConfig.negativeKeywords
  }

  const normalizedNegativeKeywords = ensureStringArray(hydratedCampaignConfig.negativeKeywords)
  if (normalizedNegativeKeywords.length > 0) {
    hydratedCampaignConfig.negativeKeywords = normalizedNegativeKeywords
    hydratedCampaignConfig.negativeKeywordMatchType = buildNormalizedNegativeKeywordMatchTypeMap({
      keywords: normalizedNegativeKeywords,
      currentMap:
        hydratedCampaignConfig.negativeKeywordMatchType
        ?? hydratedCampaignConfig.negativeKeywordsMatchType
        ?? buildDefaultNegativeKeywordMatchTypeMap(normalizedNegativeKeywords),
    })
  }

  const hydratedBody: Record<string, any> = {
    ...normalizedBody,
    campaignConfig: hydratedCampaignConfig,
  }

  if (Object.prototype.hasOwnProperty.call(normalizedBody, 'campaign_config')) {
    hydratedBody.campaign_config = hydratedCampaignConfig
  }

  if (process.env.NODE_ENV !== 'test') {
    console.log(
      `[OpenClawCommand] 补齐campaign.publish默认参数: offerId=${offerId || '-'}, adCreativeId=${adCreativeId || '-'}, currency=${normalizeCurrencyCode(accountCurrency) || 'USD'}, keywords=${resolvedKeywordConfig.keywords.length}, negativeKeywords=${resolvedKeywordConfig.negativeKeywords.length}`
    )
  }

  return {
    body: hydratedBody,
    hydrated: true,
  }
}

function extractOfferIdFromClickFarmBody(body: unknown): number | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null
  }

  const payload = body as Record<string, unknown>
  return toPositiveInteger(payload.offer_id ?? payload.offerId)
}

async function hasEnabledCampaignForOffer(params: {
  db: any
  userId: number
  offerId: number
}): Promise<boolean> {
  const notDeletedCondition = params.db.type === 'postgres'
    ? '(is_deleted = false OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  const row = await params.db.queryOne(
    `SELECT id
     FROM campaigns
     WHERE user_id = ?
       AND offer_id = ?
       AND status = 'ENABLED'
       AND ${notDeletedCondition}
     ORDER BY updated_at DESC
     LIMIT 1`,
    [params.userId, params.offerId]
  )

  return Boolean(row?.id)
}

async function hasRecentSuccessfulPublishForOffer(params: {
  db: any
  userId: number
  offerId: number
}): Promise<boolean> {
  const rows = await params.db.query(
    `SELECT request_body_json, completed_at
     FROM openclaw_command_runs
     WHERE user_id = ?
       AND request_method = 'POST'
       AND request_path = '/api/campaigns/publish'
       AND status = 'completed'
       AND response_status >= 200
       AND response_status < 300
     ORDER BY completed_at DESC
     LIMIT 30`,
    [params.userId]
  )

  const now = Date.now()
  for (const row of rows) {
    const completedAt = row.completed_at ? new Date(row.completed_at).getTime() : NaN
    if (!Number.isFinite(completedAt) || now - completedAt > CLICK_FARM_PUBLISH_LOOKBACK_MS) {
      continue
    }

    const requestBody = parseJsonAny(row.request_body_json || null)
    const publishOfferId = toPositiveInteger(requestBody?.offerId ?? requestBody?.offer_id)
    if (publishOfferId === params.offerId) {
      return true
    }
  }

  return false
}

async function assertClickFarmTaskPrerequisites(params: {
  db: any
  userId: number
  method: string
  path: string
  requestBody: unknown
}): Promise<void> {
  if (params.method !== 'POST' || params.path !== '/api/click-farm/tasks') {
    return
  }

  const offerId = extractOfferIdFromClickFarmBody(params.requestBody)
  if (!offerId) {
    throw new Error('click-farm.create 缺少 offer_id，无法校验发布前置条件')
  }

  const hasEnabledCampaign = await hasEnabledCampaignForOffer({
    db: params.db,
    userId: params.userId,
    offerId,
  })
  if (hasEnabledCampaign) {
    return
  }

  const hasRecentPublish = await hasRecentSuccessfulPublishForOffer({
    db: params.db,
    userId: params.userId,
    offerId,
  })
  if (hasRecentPublish) {
    return
  }

  throw new Error(`补点击前置校验失败：Offer ${offerId} 缺少可用Campaign，请先成功发布广告`)
}

function deriveTarget(path: string): { targetType?: string; targetId?: string } {
  const cleanPath = (path || '').split('?')[0]
  const parts = cleanPath.split('/').filter(Boolean)
  if (parts.length < 2 || parts[0] !== 'api') {
    return {}
  }

  return {
    targetType: parts[1],
    targetId: parts[2],
  }
}

function buildUpstreamError(status: number, body: string | null): Error {
  const text = body ? body.slice(0, 300) : 'unknown error'
  return new Error(`AutoAds API error (${status}): ${text}`)
}

export async function executeOpenclawCommandTask(task: Task<OpenclawCommandTaskData>) {
  const data = task.data
  if (!data?.runId || !data?.userId) {
    throw new Error('任务参数不完整')
  }

  const db = await getDatabase()
  const nowSql = nowFunc(db.type)

  const run = await db.queryOne<{
    id: string
    user_id: number
    channel: string | null
    sender_id: string | null
    request_method: string
    request_path: string
    request_query_json: string | null
    request_body_json: string | null
    risk_level: string
    status: string
    confirm_required: number | boolean
  }>(
    `SELECT
       id,
       user_id,
       channel,
       sender_id,
       request_method,
       request_path,
       request_query_json,
       request_body_json,
       risk_level,
       status,
       confirm_required
     FROM openclaw_command_runs
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [data.runId, data.userId]
  )

  if (!run) {
    throw new Error(`OpenClaw command run not found: ${data.runId}`)
  }

  if (run.status === 'completed' || run.status === 'canceled' || run.status === 'expired') {
    return {
      success: true,
      skipped: true,
      reason: run.status,
      runId: data.runId,
    }
  }

  await db.exec(
    `UPDATE openclaw_command_runs
     SET status = 'running',
         started_at = COALESCE(started_at, ${nowSql}),
         error_message = NULL,
         updated_at = ${nowSql}
     WHERE id = ? AND user_id = ?`,
    [data.runId, data.userId]
  )

  const requestQuery = parseJsonObject(run.request_query_json)
  let requestBody = parseJsonAny(run.request_body_json)
  const hydratedPayload = await hydrateCampaignPublishRequestBody({
    db,
    userId: data.userId,
    method: run.request_method,
    path: run.request_path,
    body: requestBody,
  })
  requestBody = hydratedPayload.body

  const requestBodyForAudit = requestBody === undefined ? null : JSON.stringify(requestBody)
  if (hydratedPayload.hydrated && requestBodyForAudit !== run.request_body_json) {
    await db.exec(
      `UPDATE openclaw_command_runs
       SET request_body_json = ?,
           updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [requestBodyForAudit, data.runId, data.userId]
    )
  }

  const requestPayload = {
    method: run.request_method,
    path: run.request_path,
    query: requestQuery,
    body: requestBody,
  }

  await db.exec(
    `INSERT INTO openclaw_command_steps
     (run_id, step_index, action_type, request_json, status, created_at, updated_at)
     VALUES (?, 0, 'proxy', ?, 'running', ${nowSql}, ${nowSql})
     ON CONFLICT(run_id, step_index)
     DO UPDATE SET
       action_type = excluded.action_type,
       request_json = excluded.request_json,
       status = 'running',
       error_message = NULL,
       updated_at = ${nowSql}`,
    [data.runId, JSON.stringify(requestPayload)]
  )

  const confirm = await db.queryOne<{ status: string }>(
    'SELECT status FROM openclaw_command_confirms WHERE run_id = ? LIMIT 1',
    [data.runId]
  )
  const confirmStatus = confirm?.status || (((run.confirm_required as any) === 1 || (run.confirm_required as any) === true) ? 'required' : 'not_required')

  const startedAt = Date.now()
  let responseStatus: number | null = null
  let responseBody: string | null = null
  let latencyMs = 0

  const action = `${run.request_method} ${run.request_path}`
  const { targetType, targetId } = deriveTarget(run.request_path)

  try {
    await assertClickFarmTaskPrerequisites({
      db,
      userId: data.userId,
      method: run.request_method,
      path: run.request_path,
      requestBody,
    })

    const upstream = await fetchAutoadsAsUser({
      userId: data.userId,
      path: run.request_path,
      method: run.request_method,
      query: requestQuery,
      body: requestBody,
      headers: {
        Accept: 'application/json',
      },
    })

    responseStatus = upstream.status
    responseBody = truncateBody(await upstream.text())
    latencyMs = Date.now() - startedAt

    if (!upstream.ok) {
      throw buildUpstreamError(upstream.status, responseBody)
    }

    await db.exec(
      `UPDATE openclaw_command_steps
       SET status = 'success',
           response_json = ?,
           latency_ms = ?,
           error_message = NULL,
           updated_at = ${nowSql}
       WHERE run_id = ? AND step_index = 0`,
      [responseBody, latencyMs, data.runId]
    )

    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'completed',
           response_status = ?,
           response_body = ?,
           error_message = NULL,
           completed_at = ${nowSql},
           updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [responseStatus, responseBody, data.runId, data.userId]
    )

    await recordOpenclawAction({
      userId: data.userId,
      channel: run.channel,
      senderId: run.sender_id,
      action,
      targetType,
      targetId,
      requestBody: requestBodyForAudit,
      responseBody,
      status: 'success',
      runId: data.runId,
      riskLevel: run.risk_level,
      confirmStatus,
      latencyMs,
    })

    return {
      success: true,
      runId: data.runId,
      responseStatus,
      latencyMs,
    }
  } catch (error: any) {
    latencyMs = latencyMs || Date.now() - startedAt
    const message = error?.message || 'OpenClaw command execution failed'

    await db.exec(
      `UPDATE openclaw_command_steps
       SET status = 'failed',
           response_json = ?,
           latency_ms = ?,
           error_message = ?,
           updated_at = ${nowSql}
       WHERE run_id = ? AND step_index = 0`,
      [responseBody, latencyMs, message, data.runId]
    )

    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'failed',
           response_status = ?,
           response_body = ?,
           error_message = ?,
           completed_at = ${nowSql},
           updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [responseStatus, responseBody, message, data.runId, data.userId]
    )

    await recordOpenclawAction({
      userId: data.userId,
      channel: run.channel,
      senderId: run.sender_id,
      action,
      targetType,
      targetId,
      requestBody: requestBodyForAudit,
      responseBody,
      status: 'error',
      errorMessage: message,
      runId: data.runId,
      riskLevel: run.risk_level,
      confirmStatus,
      latencyMs,
    })

    throw error
  }
}
