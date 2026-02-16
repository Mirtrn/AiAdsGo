import type { Task } from '@/lib/queue/types'
import { getDatabase } from '@/lib/db'
import { nowFunc } from '@/lib/db-helpers'
import { fetchAutoadsAsUser } from '@/lib/openclaw/autoads-client'
import { recordOpenclawAction } from '@/lib/openclaw/action-logs'
import { buildEffectiveCreative } from '@/lib/campaign-publish/effective-creative'
import { resolveTaskCampaignKeywords } from '@/lib/campaign-publish/task-keyword-fallback'
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

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.floor(parsed)
  return normalized > 0 ? normalized : null
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

  const configuredNegativeKeywords =
    campaignConfig.negativeKeywords !== undefined
      ? campaignConfig.negativeKeywords
      : campaignConfig.negative_keywords

  const probe = resolveTaskCampaignKeywords({
    configuredKeywords: campaignConfig.keywords,
    configuredNegativeKeywords,
    fallbackKeywords: [],
    fallbackNegativeKeywords: [],
  })

  if (!probe.usedKeywordFallback && !probe.usedNegativeKeywordFallback) {
    return { body: normalizedBody, hydrated: true }
  }

  const offerId = toPositiveInteger(normalizedBody.offerId ?? normalizedBody.offer_id)
  const adCreativeId = toPositiveInteger(normalizedBody.adCreativeId ?? normalizedBody.ad_creative_id)
  if (!offerId || !adCreativeId) {
    return { body: normalizedBody, hydrated: true }
  }

  const creative = await params.db.queryOne<{
    id: number
    keywords: unknown
    negative_keywords: unknown
  }>(
    `SELECT id, keywords, negative_keywords
     FROM ad_creatives
     WHERE id = ? AND offer_id = ? AND user_id = ?
     LIMIT 1`,
    [adCreativeId, offerId, params.userId]
  )

  if (!creative) {
    return { body: normalizedBody, hydrated: true }
  }

  const effectiveCreative = buildEffectiveCreative({
    dbCreative: {
      headlines: [],
      descriptions: [],
      keywords: creative.keywords,
      negativeKeywords: creative.negative_keywords,
      callouts: [],
      sitelinks: [],
      finalUrl: '',
      finalUrlSuffix: null,
    },
    campaignConfig,
  })

  const resolvedKeywordConfig = resolveTaskCampaignKeywords({
    configuredKeywords: campaignConfig.keywords,
    configuredNegativeKeywords,
    fallbackKeywords: effectiveCreative.keywords,
    fallbackNegativeKeywords: effectiveCreative.negativeKeywords,
  })

  if (!resolvedKeywordConfig.usedKeywordFallback && !resolvedKeywordConfig.usedNegativeKeywordFallback) {
    return { body: normalizedBody, hydrated: true }
  }

  const hydratedCampaignConfig: Record<string, any> = {
    ...campaignConfig,
  }

  if (resolvedKeywordConfig.usedKeywordFallback) {
    hydratedCampaignConfig.keywords = resolvedKeywordConfig.keywords
  }

  if (resolvedKeywordConfig.usedNegativeKeywordFallback) {
    hydratedCampaignConfig.negativeKeywords = resolvedKeywordConfig.negativeKeywords
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
      `[OpenClawCommand] 补齐campaign.publish参数: offerId=${offerId}, adCreativeId=${adCreativeId}, keywords=${resolvedKeywordConfig.keywords.length}, negativeKeywords=${resolvedKeywordConfig.negativeKeywords.length}`
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
