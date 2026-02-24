import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/json-field'

export type AffiliatePlatform = 'partnerboost' | 'yeahpromos'

export type AffiliateCommissionRawEntry = {
  platform: AffiliatePlatform
  reportDate: string
  commission: number
  currency?: string | null
  sourceOrderId?: string | null
  sourceMid?: string | null
  sourceAsin?: string | null
  sourceLink?: string | null
  sourceLinkId?: string | null
  raw?: unknown
}

export type AffiliateCommissionAttributionResult = {
  reportDate: string
  totalCommission: number
  attributedCommission: number
  unattributedCommission: number
  attributedOffers: number
  attributedCampaigns: number
  writtenRows: number
}

type CampaignWeightRow = {
  campaign_id: number
  offer_id: number
  conversions: number
  clicks: number
  cost: number
}

type AttributionRow = {
  userId: number
  reportDate: string
  platform: AffiliatePlatform
  sourceOrderId: string | null
  sourceMid: string | null
  sourceAsin: string | null
  offerId: number | null
  campaignId: number | null
  commissionAmount: number
  currency: string
  rawPayload: unknown
}

type CampaignWeight = {
  campaignId: number
  weight: number
}

function roundTo(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const ATTRIBUTION_EPSILON = 0.0001

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

function normalizeAsin(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  const normalized = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!normalized) return null
  return normalized.length > 10 ? normalized.slice(0, 10) : normalized
}

function normalizeMidForPlatform(platform: AffiliatePlatform, value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  return platform === 'partnerboost' ? text.toLowerCase() : text
}

function extractAsinFromUrlLike(value: unknown): string | null {
  const raw = normalizeText(value)
  if (!raw) return null

  const candidates = [raw]
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded && decoded !== raw) candidates.push(decoded)
    } catch {
      // ignore malformed percent-encoding
    }
  }

  const patterns = [
    /\/dp\/([A-Za-z0-9]{10})(?=[/?#&]|$)/i,
    /\/gp\/product\/([A-Za-z0-9]{10})(?=[/?#&]|$)/i,
    /[?&#]asin=([A-Za-z0-9]{10})(?=[&#]|$)/i,
  ]

  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const matched = candidate.match(pattern)
      if (!matched?.[1]) continue
      const asin = normalizeAsin(matched[1])
      if (asin) return asin
    }
  }

  return null
}

function extractPartnerboostLinkId(value: unknown): string | null {
  const raw = normalizeText(value)
  if (!raw) return null

  const candidates = [raw]
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded && decoded !== raw) candidates.push(decoded)
    } catch {
      // ignore malformed percent-encoding
    }
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate)
      const key = Array.from(url.searchParams.keys())
        .find((item) => item.toLowerCase() === 'aa_adgroupid')
      if (key) {
        const value = normalizeText(url.searchParams.get(key))
        if (value) return value
      }
    } catch {
      // ignore invalid urls
    }

    const matched = candidate.match(/[?&#]aa_adgroupid=([^&#]+)/i)
    if (matched?.[1]) {
      const value = normalizeText(matched[1])
      if (value) return value
    }
  }

  return null
}

const IN_CLAUSE_CHUNK_SIZE = 300

function chunkArray<T>(items: T[], chunkSize = IN_CLAUSE_CHUNK_SIZE): T[][] {
  if (items.length === 0) return []
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

function formatLocalYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function isHistoricalReportDate(reportDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return false
  }
  return reportDate < formatLocalYmd(new Date())
}

type ExistingAttributionSummaryRow = {
  written_rows: number | string | null
  attributed_commission: number | string | null
  attributed_offers: number | string | null
  attributed_campaigns: number | string | null
}

async function queryExistingAttributionSummary(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
  totalCommission: number
}): Promise<AffiliateCommissionAttributionResult | null> {
  const row = await params.db.queryOne<ExistingAttributionSummaryRow>(
    `
      SELECT
        COUNT(*) AS written_rows,
        COALESCE(SUM(commission_amount), 0) AS attributed_commission,
        COUNT(DISTINCT offer_id) AS attributed_offers,
        COUNT(DISTINCT campaign_id) AS attributed_campaigns
      FROM affiliate_commission_attributions
      WHERE user_id = ? AND report_date = ?
    `,
    [params.userId, params.reportDate]
  )

  const writtenRows = Number(row?.written_rows) || 0
  if (writtenRows <= 0) {
    return null
  }

  const attributedCommission = roundTo(Number(row?.attributed_commission) || 0)
  const effectiveTotalCommission = roundTo(
    Math.max(Number(params.totalCommission) || 0, attributedCommission)
  )

  return {
    reportDate: params.reportDate,
    totalCommission: effectiveTotalCommission,
    attributedCommission,
    unattributedCommission: roundTo(
      Math.max(0, effectiveTotalCommission - attributedCommission)
    ),
    attributedOffers: Number(row?.attributed_offers) || 0,
    attributedCampaigns: Number(row?.attributed_campaigns) || 0,
    writtenRows,
  }
}

function buildWeightedShares(total: number, weights: number[]): number[] {
  if (!Number.isFinite(total) || total <= 0 || weights.length === 0) {
    return weights.map(() => 0)
  }

  const positiveWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const sumWeights = positiveWeights.reduce((sum, item) => sum + item, 0)

  if (sumWeights <= 0) {
    const even = roundTo(total / weights.length)
    const shares = weights.map(() => even)
    const diff = roundTo(total - shares.reduce((sum, item) => sum + item, 0))
    if (shares.length > 0) {
      shares[shares.length - 1] = roundTo(shares[shares.length - 1] + diff)
    }
    return shares
  }

  const shares = positiveWeights.map((w) => roundTo((total * w) / sumWeights))
  const diff = roundTo(total - shares.reduce((sum, item) => sum + item, 0))
  if (shares.length > 0) {
    shares[shares.length - 1] = roundTo(shares[shares.length - 1] + diff)
  }
  return shares
}

function aggregateOfferWeight(campaigns: CampaignWeight[]): number {
  if (!Array.isArray(campaigns) || campaigns.length === 0) return 1
  const sum = campaigns.reduce(
    (acc, item) => acc + Math.max(0, Number(item.weight) || 0),
    0
  )
  return sum > 0 ? sum : 1
}

async function queryProductIdentifierRows(params: {
  userId: number
  platform: AffiliatePlatform
  mids: string[]
  asins: string[]
}): Promise<Array<{ id: number; mid: string | null; asin: string | null }>> {
  const db = await getDatabase()

  const mids = Array.from(
    new Set(
      params.mids
        .map((mid) => normalizeMidForPlatform(params.platform, mid))
        .filter((mid): mid is string => Boolean(mid))
    )
  )
  const asins = Array.from(new Set(params.asins.filter(Boolean)))

  if (mids.length === 0 && asins.length === 0) {
    return []
  }

  if ((mids.length + asins.length) > 2000) {
    return db.query<{ id: number; mid: string | null; asin: string | null }>(
      `
        SELECT id, mid, asin
        FROM affiliate_products
        WHERE user_id = ?
          AND platform = ?
      `,
      [params.userId, params.platform]
    )
  }

  const rows: Array<{ id: number; mid: string | null; asin: string | null }> = []
  const seen = new Set<number>()
  const midChunks = mids.length > 0 ? chunkArray(mids) : [[]]
  const asinChunks = asins.length > 0 ? chunkArray(asins) : [[]]

  for (const midChunk of midChunks) {
    for (const asinChunk of asinChunks) {
      const conditions: string[] = []
      const queryParams: Array<number | string> = [params.userId, params.platform]

      if (midChunk.length > 0) {
        if (params.platform === 'partnerboost') {
          conditions.push(`LOWER(COALESCE(mid, '')) IN (${midChunk.map(() => '?').join(', ')})`)
        } else {
          conditions.push(`mid IN (${midChunk.map(() => '?').join(', ')})`)
        }
        queryParams.push(...midChunk)
      }

      if (asinChunk.length > 0) {
        conditions.push(`UPPER(COALESCE(asin, '')) IN (${asinChunk.map(() => '?').join(', ')})`)
        queryParams.push(...asinChunk)
      }

      if (conditions.length === 0) {
        continue
      }

      const chunkRows = await db.query<{ id: number; mid: string | null; asin: string | null }>(
        `
          SELECT id, mid, asin
          FROM affiliate_products
          WHERE user_id = ?
            AND platform = ?
            AND (${conditions.join(' OR ')})
        `,
        queryParams
      )

      for (const row of chunkRows) {
        const id = Number(row.id)
        if (!Number.isFinite(id) || seen.has(id)) continue
        seen.add(id)
        rows.push(row)
      }
    }
  }

  return rows
}

async function queryPartnerboostProductIdsByLinkIds(params: {
  userId: number
  linkIds: string[]
}): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>()
  const linkIds = Array.from(
    new Set(
      params.linkIds
        .map((item) => normalizeText(item))
        .filter((item): item is string => Boolean(item))
    )
  )
  if (linkIds.length === 0) return result

  const normalizedLinkIds = linkIds.map((item) => item.toLowerCase())
  const linkIdSet = new Set(normalizedLinkIds)
  const db = await getDatabase()
  const rowSeen = new Set<number>()

  for (const linkIdChunk of chunkArray(normalizedLinkIds, 80)) {
    const conditions = linkIdChunk.map(
      () => `(
        LOWER(COALESCE(promo_link, '')) LIKE ? OR LOWER(COALESCE(short_promo_link, '')) LIKE ?
        OR LOWER(COALESCE(promo_link, '')) LIKE ? OR LOWER(COALESCE(short_promo_link, '')) LIKE ?
      )`
    )
    const queryParams: Array<number | string> = [params.userId]
    for (const linkId of linkIdChunk) {
      const rawPattern = `%aa_adgroupid=${linkId}%`
      const encodedPattern = `%aa_adgroupid%3d${linkId}%`
      queryParams.push(rawPattern, rawPattern, encodedPattern, encodedPattern)
    }

    const rows = await db.query<{
      id: number
      promo_link: string | null
      short_promo_link: string | null
    }>(
      `
        SELECT id, promo_link, short_promo_link
        FROM affiliate_products
        WHERE user_id = ?
          AND platform = 'partnerboost'
          AND (${conditions.join(' OR ')})
      `,
      queryParams
    )

    for (const row of rows) {
      const productId = Number(row.id)
      if (!Number.isFinite(productId) || rowSeen.has(productId)) continue
      rowSeen.add(productId)

      const candidateLinkIds = new Set<string>()
      const promoLinkId = extractPartnerboostLinkId(row.promo_link)
      const shortLinkId = extractPartnerboostLinkId(row.short_promo_link)
      if (promoLinkId) candidateLinkIds.add(promoLinkId)
      if (shortLinkId) candidateLinkIds.add(shortLinkId)

      for (const linkId of candidateLinkIds) {
        const normalizedLinkId = linkId.toLowerCase()
        if (!linkIdSet.has(normalizedLinkId)) continue
        const existing = result.get(normalizedLinkId) || []
        if (!existing.includes(productId)) {
          existing.push(productId)
          result.set(normalizedLinkId, existing)
        }
      }
    }
  }

  return result
}

async function queryOfferLinksByProductIds(userId: number, productIds: number[]): Promise<Map<number, number[]>> {
  const linksByProduct = new Map<number, number[]>()
  if (productIds.length === 0) return linksByProduct

  const db = await getDatabase()
  for (const productIdChunk of chunkArray(productIds)) {
    const rows = await db.query<{ product_id: number; offer_id: number }>(
      `
        SELECT product_id, offer_id
        FROM affiliate_product_offer_links
        WHERE user_id = ?
          AND product_id IN (${productIdChunk.map(() => '?').join(', ')})
      `,
      [userId, ...productIdChunk]
    )

    for (const row of rows) {
      const productId = Number(row.product_id)
      const offerId = Number(row.offer_id)
      if (!Number.isFinite(productId) || !Number.isFinite(offerId)) continue

      const existing = linksByProduct.get(productId) || []
      if (!existing.includes(offerId)) {
        existing.push(offerId)
        linksByProduct.set(productId, existing)
      }
    }
  }

  return linksByProduct
}

async function queryActiveOfferIdsByAsins(params: {
  userId: number
  asins: string[]
}): Promise<Map<string, number[]>> {
  const linksByAsin = new Map<string, number[]>()
  const requestedAsins = Array.from(
    new Set(
      params.asins
        .map((asin) => normalizeAsin(asin))
        .filter((asin): asin is string => Boolean(asin))
    )
  )

  if (requestedAsins.length === 0) {
    return linksByAsin
  }

  const requestedAsinSet = new Set(requestedAsins)
  const db = await getDatabase()
  const offerNotDeletedCondition = db.type === 'postgres'
    ? '(is_deleted = false OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  const rows = await db.query<{
    id: number
    url: string | null
    final_url: string | null
    affiliate_link: string | null
  }>(
    `
      SELECT id, url, final_url, affiliate_link
      FROM offers
      WHERE user_id = ?
        AND ${offerNotDeletedCondition}
    `,
    [params.userId]
  )

  for (const row of rows) {
    const offerId = Number(row.id)
    if (!Number.isFinite(offerId)) continue

    const asinCandidates = new Set<string>()
    const urlAsin = extractAsinFromUrlLike(row.url)
    const finalUrlAsin = extractAsinFromUrlLike(row.final_url)
    const affiliateLinkAsin = extractAsinFromUrlLike(row.affiliate_link)

    if (urlAsin) asinCandidates.add(urlAsin)
    if (finalUrlAsin) asinCandidates.add(finalUrlAsin)
    if (affiliateLinkAsin) asinCandidates.add(affiliateLinkAsin)

    for (const asin of asinCandidates) {
      if (!requestedAsinSet.has(asin)) continue
      const existing = linksByAsin.get(asin) || []
      if (!existing.includes(offerId)) {
        existing.push(offerId)
        linksByAsin.set(asin, existing)
      }
    }
  }

  return linksByAsin
}

async function queryActiveOfferIdsByPartnerboostLinkIds(params: {
  userId: number
  linkIds: string[]
}): Promise<Map<string, number[]>> {
  const linksByLinkId = new Map<string, number[]>()
  const requestedLinkIds = Array.from(
    new Set(
      params.linkIds
        .map((item) => normalizeText(item)?.toLowerCase())
        .filter((item): item is string => Boolean(item))
    )
  )

  if (requestedLinkIds.length === 0) {
    return linksByLinkId
  }

  const requestedLinkIdSet = new Set(requestedLinkIds)
  const db = await getDatabase()
  const offerNotDeletedCondition = db.type === 'postgres'
    ? '(is_deleted = false OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  const rows = await db.query<{
    id: number
    url: string | null
    final_url: string | null
    affiliate_link: string | null
  }>(
    `
      SELECT id, url, final_url, affiliate_link
      FROM offers
      WHERE user_id = ?
        AND ${offerNotDeletedCondition}
    `,
    [params.userId]
  )

  for (const row of rows) {
    const offerId = Number(row.id)
    if (!Number.isFinite(offerId)) continue

    const linkIdCandidates = new Set<string>()
    const urlLinkId = extractPartnerboostLinkId(row.url)?.toLowerCase()
    const finalUrlLinkId = extractPartnerboostLinkId(row.final_url)?.toLowerCase()
    const affiliateLinkId = extractPartnerboostLinkId(row.affiliate_link)?.toLowerCase()

    if (urlLinkId) linkIdCandidates.add(urlLinkId)
    if (finalUrlLinkId) linkIdCandidates.add(finalUrlLinkId)
    if (affiliateLinkId) linkIdCandidates.add(affiliateLinkId)

    for (const linkId of linkIdCandidates) {
      if (!requestedLinkIdSet.has(linkId)) continue
      const existing = linksByLinkId.get(linkId) || []
      if (!existing.includes(offerId)) {
        existing.push(offerId)
        linksByLinkId.set(linkId, existing)
      }
    }
  }

  return linksByLinkId
}

async function queryCampaignWeights(params: {
  userId: number
  reportDate: string
  offerIds: number[]
}): Promise<Map<number, CampaignWeight[]>> {
  const result = new Map<number, CampaignWeight[]>()
  if (params.offerIds.length === 0) return result

  const db = await getDatabase()
  const grouped = new Map<number, CampaignWeightRow[]>()
  const campaignNotDeletedCondition = db.type === 'postgres'
    ? '(c.is_deleted = false OR c.is_deleted IS NULL)'
    : '(c.is_deleted = 0 OR c.is_deleted IS NULL)'

  for (const offerIdChunk of chunkArray(params.offerIds)) {
    const rows = await db.query<CampaignWeightRow>(
      `
        SELECT
          c.id AS campaign_id,
          c.offer_id AS offer_id,
          COALESCE(cp.conversions, 0) AS conversions,
          COALESCE(cp.clicks, 0) AS clicks,
          COALESCE(cp.cost, 0) AS cost
        FROM campaigns c
        LEFT JOIN campaign_performance cp
          ON cp.campaign_id = c.id
         AND cp.date = ?
        WHERE c.user_id = ?
          AND c.offer_id IN (${offerIdChunk.map(() => '?').join(', ')})
          AND ${campaignNotDeletedCondition}
      `,
      [params.reportDate, params.userId, ...offerIdChunk]
    )

    for (const row of rows) {
      const offerId = Number(row.offer_id)
      const campaignId = Number(row.campaign_id)
      if (!Number.isFinite(offerId) || !Number.isFinite(campaignId)) continue

      const existing = grouped.get(offerId) || []
      existing.push({
        campaign_id: campaignId,
        offer_id: offerId,
        conversions: Number(row.conversions) || 0,
        clicks: Number(row.clicks) || 0,
        cost: Number(row.cost) || 0,
      })
      grouped.set(offerId, existing)
    }
  }

  for (const [offerId, campaignRows] of grouped.entries()) {
    const conversionsSum = campaignRows.reduce((sum, row) => sum + Math.max(0, Number(row.conversions) || 0), 0)
    const clicksSum = campaignRows.reduce((sum, row) => sum + Math.max(0, Number(row.clicks) || 0), 0)
    const costSum = campaignRows.reduce((sum, row) => sum + Math.max(0, Number(row.cost) || 0), 0)

    const weights = campaignRows.map((row) => {
      if (conversionsSum > 0) return Math.max(0, Number(row.conversions) || 0)
      if (clicksSum > 0) return Math.max(0, Number(row.clicks) || 0)
      if (costSum > 0) return Math.max(0, Number(row.cost) || 0)
      return 1
    })

    result.set(
      offerId,
      campaignRows.map((row, index) => ({
        campaignId: row.campaign_id,
        weight: weights[index],
      }))
    )
  }

  return result
}

export async function persistAffiliateCommissionAttributions(params: {
  userId: number
  reportDate: string
  entries: AffiliateCommissionRawEntry[]
  replaceExisting: boolean
  lockHistorical?: boolean
}): Promise<AffiliateCommissionAttributionResult> {
  const db = await getDatabase()

  const normalizedEntries = params.entries
    .map((entry) => {
      const commission = roundTo(Number(entry.commission) || 0)
      if (commission <= 0) return null

      const sourceLink = normalizeText(entry.sourceLink)
      const sourceLinkId = entry.platform === 'partnerboost'
        ? (normalizeText(entry.sourceLinkId)?.toLowerCase() || extractPartnerboostLinkId(sourceLink)?.toLowerCase() || null)
        : null

      return {
        platform: entry.platform,
        reportDate: normalizeText(entry.reportDate) || params.reportDate,
        commission,
        currency: normalizeText(entry.currency)?.toUpperCase() || 'USD',
        sourceOrderId: normalizeText(entry.sourceOrderId),
        sourceMid: normalizeMidForPlatform(entry.platform, entry.sourceMid),
        sourceAsin: normalizeAsin(entry.sourceAsin),
        sourceLink,
        sourceLinkId,
        raw: entry.raw,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  const totalCommission = roundTo(
    normalizedEntries.reduce((sum, entry) => sum + entry.commission, 0)
  )

  if (params.lockHistorical && isHistoricalReportDate(params.reportDate)) {
    const existingSummary = await queryExistingAttributionSummary({
      db,
      userId: params.userId,
      reportDate: params.reportDate,
      totalCommission,
    })

    if (existingSummary) {
      // Historical lock should prevent accidental overwrite, but when existing rows are only
      // partially attributed and today's fetched total is higher, we should allow recompute.
      const shouldKeepExisting =
        totalCommission <= 0
        || existingSummary.attributedCommission + ATTRIBUTION_EPSILON >= totalCommission
      if (shouldKeepExisting) {
        return existingSummary
      }
    }
  }

  if (!params.replaceExisting) {
    return {
      reportDate: params.reportDate,
      totalCommission,
      attributedCommission: 0,
      unattributedCommission: totalCommission,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0,
    }
  }

  if (normalizedEntries.length === 0) {
    await db.exec(
      `DELETE FROM affiliate_commission_attributions WHERE user_id = ? AND report_date = ?`,
      [params.userId, params.reportDate]
    )

    return {
      reportDate: params.reportDate,
      totalCommission: 0,
      attributedCommission: 0,
      unattributedCommission: 0,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0,
    }
  }

  const midsByPlatform = new Map<AffiliatePlatform, string[]>()
  const asinsByPlatform = new Map<AffiliatePlatform, string[]>()
  const linkIdsByPlatform = new Map<AffiliatePlatform, string[]>()

  for (const entry of normalizedEntries) {
    if (entry.sourceMid) {
      const list = midsByPlatform.get(entry.platform) || []
      if (!list.includes(entry.sourceMid)) {
        list.push(entry.sourceMid)
        midsByPlatform.set(entry.platform, list)
      }
    }

    if (entry.sourceAsin) {
      const list = asinsByPlatform.get(entry.platform) || []
      if (!list.includes(entry.sourceAsin)) {
        list.push(entry.sourceAsin)
        asinsByPlatform.set(entry.platform, list)
      }
    }

    if (entry.sourceLinkId) {
      const list = linkIdsByPlatform.get(entry.platform) || []
      if (!list.includes(entry.sourceLinkId)) {
        list.push(entry.sourceLinkId)
        linkIdsByPlatform.set(entry.platform, list)
      }
    }
  }

  const productIdsByPlatformMid = new Map<string, number[]>()
  const productIdsByPlatformAsin = new Map<string, number[]>()
  const productIdsByPlatformLinkId = new Map<string, number[]>()
  const allProductIds = new Set<number>()

  for (const platform of ['partnerboost', 'yeahpromos'] as AffiliatePlatform[]) {
    const mids = midsByPlatform.get(platform) || []
    const asins = asinsByPlatform.get(platform) || []

    const productRows = await queryProductIdentifierRows({
      userId: params.userId,
      platform,
      mids,
      asins,
    })

    for (const row of productRows) {
      const productId = Number(row.id)
      if (!Number.isFinite(productId)) continue
      allProductIds.add(productId)

      const mid = normalizeMidForPlatform(platform, row.mid)
      if (mid) {
        const key = `${platform}|mid|${mid}`
        const existing = productIdsByPlatformMid.get(key) || []
        if (!existing.includes(productId)) {
          existing.push(productId)
          productIdsByPlatformMid.set(key, existing)
        }
      }

      const asin = normalizeAsin(row.asin)
      if (asin) {
        const key = `${platform}|asin|${asin}`
        const existing = productIdsByPlatformAsin.get(key) || []
        if (!existing.includes(productId)) {
          existing.push(productId)
          productIdsByPlatformAsin.set(key, existing)
        }
      }
    }
  }

  const partnerboostLinkIdMap = await queryPartnerboostProductIdsByLinkIds({
    userId: params.userId,
    linkIds: linkIdsByPlatform.get('partnerboost') || [],
  })
  for (const [linkId, productIds] of partnerboostLinkIdMap.entries()) {
    const key = `partnerboost|linkid|${linkId}`
    productIdsByPlatformLinkId.set(key, productIds)
    for (const productId of productIds) {
      allProductIds.add(productId)
    }
  }

  const offerLinksByProduct = await queryOfferLinksByProductIds(
    params.userId,
    Array.from(allProductIds)
  )

  const allOfferIds = new Set<number>()
  for (const offerIds of offerLinksByProduct.values()) {
    for (const offerId of offerIds) {
      allOfferIds.add(offerId)
    }
  }

  const fallbackOfferIdsByAsin = await queryActiveOfferIdsByAsins({
    userId: params.userId,
    asins: normalizedEntries
      .map((entry) => entry.sourceAsin)
      .filter((asin): asin is string => Boolean(asin)),
  })
  const fallbackOfferIdsByPartnerboostLinkId = await queryActiveOfferIdsByPartnerboostLinkIds({
    userId: params.userId,
    linkIds: normalizedEntries
      .filter((entry) => entry.platform === 'partnerboost')
      .map((entry) => entry.sourceLinkId)
      .filter((linkId): linkId is string => Boolean(linkId)),
  })
  for (const offerIds of fallbackOfferIdsByAsin.values()) {
    for (const offerId of offerIds) {
      allOfferIds.add(offerId)
    }
  }
  for (const offerIds of fallbackOfferIdsByPartnerboostLinkId.values()) {
    for (const offerId of offerIds) {
      allOfferIds.add(offerId)
    }
  }

  const campaignWeightsByOffer = await queryCampaignWeights({
    userId: params.userId,
    reportDate: params.reportDate,
    offerIds: Array.from(allOfferIds),
  })

  const rowsToInsert: AttributionRow[] = []
  const inferredOfferLinkKeys = new Set<string>()
  const attributedOfferIds = new Set<number>()
  const attributedCampaignIds = new Set<number>()
  let attributedCommission = 0

  for (const entry of normalizedEntries) {
    const matchedProductIds = new Set<number>()
    const matchedProductIdsFromAsin = new Set<number>()
    const matchedProductIdsFromLinkId = new Set<number>()

    if (entry.sourceLinkId) {
      const key = `${entry.platform}|linkid|${entry.sourceLinkId}`
      for (const productId of productIdsByPlatformLinkId.get(key) || []) {
        matchedProductIdsFromLinkId.add(productId)
      }
    }

    const hasPartnerboostLinkHit = entry.platform === 'partnerboost' && matchedProductIdsFromLinkId.size > 0

    if (hasPartnerboostLinkHit) {
      for (const productId of matchedProductIdsFromLinkId) {
        matchedProductIds.add(productId)
      }
    }

    if (!hasPartnerboostLinkHit && entry.sourceMid) {
      const key = `${entry.platform}|mid|${entry.sourceMid}`
      for (const productId of productIdsByPlatformMid.get(key) || []) {
        matchedProductIds.add(productId)
      }
    }

    if (!hasPartnerboostLinkHit && entry.sourceAsin) {
      const key = `${entry.platform}|asin|${entry.sourceAsin}`
      for (const productId of productIdsByPlatformAsin.get(key) || []) {
        matchedProductIds.add(productId)
        matchedProductIdsFromAsin.add(productId)
      }
    }

    if (!hasPartnerboostLinkHit && entry.sourceLinkId) {
      const key = `${entry.platform}|linkid|${entry.sourceLinkId}`
      for (const productId of productIdsByPlatformLinkId.get(key) || []) {
        matchedProductIds.add(productId)
      }
    }

    const matchedOfferIds = new Set<number>()
    const explicitMatchedOfferIds = new Set<number>()
    for (const productId of matchedProductIds) {
      for (const offerId of offerLinksByProduct.get(productId) || []) {
        matchedOfferIds.add(offerId)
        explicitMatchedOfferIds.add(offerId)
      }
    }

    const fallbackMatchedOfferIds = new Set<number>()
    const shouldApplyAsinFallback = Boolean(entry.sourceAsin) && !hasPartnerboostLinkHit
    if (shouldApplyAsinFallback && entry.sourceAsin) {
      for (const offerId of fallbackOfferIdsByAsin.get(entry.sourceAsin) || []) {
        matchedOfferIds.add(offerId)
        fallbackMatchedOfferIds.add(offerId)
      }
    }

    const shouldApplyLinkIdFallback =
      !hasPartnerboostLinkHit
      && entry.platform === 'partnerboost'
      && Boolean(entry.sourceLinkId)
    if (shouldApplyLinkIdFallback && entry.sourceLinkId) {
      for (const offerId of fallbackOfferIdsByPartnerboostLinkId.get(entry.sourceLinkId) || []) {
        matchedOfferIds.add(offerId)
        explicitMatchedOfferIds.add(offerId)
      }
    }

    if (fallbackMatchedOfferIds.size > 0 && matchedProductIdsFromAsin.size > 0) {
      for (const productId of matchedProductIdsFromAsin) {
        const currentLinkedOfferIds = offerLinksByProduct.get(productId) || []
        for (const offerId of fallbackMatchedOfferIds) {
          if (currentLinkedOfferIds.includes(offerId)) continue
          inferredOfferLinkKeys.add(`${productId}:${offerId}`)
          currentLinkedOfferIds.push(offerId)
          offerLinksByProduct.set(productId, currentLinkedOfferIds)
          explicitMatchedOfferIds.add(offerId)
        }
      }
    }

    const offerIds = Array.from(matchedOfferIds)
    if (offerIds.length === 0) {
      continue
    }

    const offerWeights = offerIds.map((offerId) => {
      const baseWeight = aggregateOfferWeight(campaignWeightsByOffer.get(offerId) || [])
      return explicitMatchedOfferIds.has(offerId) ? baseWeight * 2 : baseWeight
    })

    const offerShares = buildWeightedShares(
      entry.commission,
      offerWeights
    )

    offerIds.forEach((offerId, offerIndex) => {
      const offerAmount = offerShares[offerIndex] || 0
      if (offerAmount <= 0) return

      attributedOfferIds.add(offerId)

      const campaigns = campaignWeightsByOffer.get(offerId) || []
      if (campaigns.length === 0) {
        rowsToInsert.push({
          userId: params.userId,
          reportDate: params.reportDate,
          platform: entry.platform,
          sourceOrderId: entry.sourceOrderId,
          sourceMid: entry.sourceMid,
          sourceAsin: entry.sourceAsin,
          offerId,
          campaignId: null,
          commissionAmount: offerAmount,
          currency: entry.currency,
          rawPayload: toDbJsonObjectField(entry.raw ?? null, db.type, null),
        })
        attributedCommission = roundTo(attributedCommission + offerAmount)
        return
      }

      const campaignShares = buildWeightedShares(
        offerAmount,
        campaigns.map((campaign) => campaign.weight)
      )

      campaigns.forEach((campaign, campaignIndex) => {
        const campaignAmount = campaignShares[campaignIndex] || 0
        if (campaignAmount <= 0) return

        attributedCampaignIds.add(campaign.campaignId)

        rowsToInsert.push({
          userId: params.userId,
          reportDate: params.reportDate,
          platform: entry.platform,
          sourceOrderId: entry.sourceOrderId,
          sourceMid: entry.sourceMid,
          sourceAsin: entry.sourceAsin,
          offerId,
          campaignId: campaign.campaignId,
          commissionAmount: campaignAmount,
          currency: entry.currency,
          rawPayload: toDbJsonObjectField(entry.raw ?? null, db.type, null),
        })
        attributedCommission = roundTo(attributedCommission + campaignAmount)
      })
    })
  }

  await db.transaction(async () => {
    await db.exec(
      `DELETE FROM affiliate_commission_attributions WHERE user_id = ? AND report_date = ?`,
      [params.userId, params.reportDate]
    )

    for (const key of inferredOfferLinkKeys) {
      const [productIdRaw, offerIdRaw] = key.split(':')
      const productId = Number(productIdRaw)
      const offerId = Number(offerIdRaw)
      if (!Number.isFinite(productId) || !Number.isFinite(offerId)) continue
      await db.exec(
        `
          INSERT INTO affiliate_product_offer_links (user_id, product_id, offer_id, created_via)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id, product_id, offer_id) DO NOTHING
        `,
        [params.userId, productId, offerId, 'asin_fallback']
      )
    }

    for (const row of rowsToInsert) {
      await db.exec(
        `
          INSERT INTO affiliate_commission_attributions
            (user_id, report_date, platform, source_order_id, source_mid, source_asin, offer_id, campaign_id, commission_amount, currency, raw_payload)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          row.userId,
          row.reportDate,
          row.platform,
          row.sourceOrderId,
          row.sourceMid,
          row.sourceAsin,
          row.offerId,
          row.campaignId,
          row.commissionAmount,
          row.currency,
          row.rawPayload,
        ]
      )
    }
  })

  const normalizedAttributedCommission = roundTo(
    rowsToInsert.reduce((sum, row) => sum + (Number(row.commissionAmount) || 0), 0)
  )
  const normalizedUnattributedCommission = roundTo(
    Math.max(0, totalCommission - normalizedAttributedCommission)
  )

  return {
    reportDate: params.reportDate,
    totalCommission,
    attributedCommission: normalizedAttributedCommission,
    unattributedCommission: normalizedUnattributedCommission,
    attributedOffers: attributedOfferIds.size,
    attributedCampaigns: attributedCampaignIds.size,
    writtenRows: rowsToInsert.length,
  }
}
