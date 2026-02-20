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

function roundTo(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

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

async function queryProductIdentifierRows(params: {
  userId: number
  platform: AffiliatePlatform
  mids: string[]
  asins: string[]
}): Promise<Array<{ id: number; mid: string | null; asin: string | null }>> {
  const db = await getDatabase()

  const mids = Array.from(new Set(params.mids.filter(Boolean)))
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
        conditions.push(`mid IN (${midChunk.map(() => '?').join(', ')})`)
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

async function queryCampaignWeights(params: {
  userId: number
  reportDate: string
  offerIds: number[]
}): Promise<Map<number, Array<{ campaignId: number; weight: number }>>> {
  const result = new Map<number, Array<{ campaignId: number; weight: number }>>()
  if (params.offerIds.length === 0) return result

  const db = await getDatabase()
  const grouped = new Map<number, CampaignWeightRow[]>()

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

      return {
        platform: entry.platform,
        reportDate: normalizeText(entry.reportDate) || params.reportDate,
        commission,
        currency: normalizeText(entry.currency)?.toUpperCase() || 'USD',
        sourceOrderId: normalizeText(entry.sourceOrderId),
        sourceMid: normalizeText(entry.sourceMid),
        sourceAsin: normalizeAsin(entry.sourceAsin),
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
      return existingSummary
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
  }

  const productIdsByPlatformMid = new Map<string, number[]>()
  const productIdsByPlatformAsin = new Map<string, number[]>()
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

      const mid = normalizeText(row.mid)
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

  const campaignWeightsByOffer = await queryCampaignWeights({
    userId: params.userId,
    reportDate: params.reportDate,
    offerIds: Array.from(allOfferIds),
  })

  const rowsToInsert: AttributionRow[] = []
  const attributedOfferIds = new Set<number>()
  const attributedCampaignIds = new Set<number>()
  let attributedCommission = 0

  for (const entry of normalizedEntries) {
    const matchedProductIds = new Set<number>()

    if (entry.sourceMid) {
      const key = `${entry.platform}|mid|${entry.sourceMid}`
      for (const productId of productIdsByPlatformMid.get(key) || []) {
        matchedProductIds.add(productId)
      }
    }

    if (entry.sourceAsin) {
      const key = `${entry.platform}|asin|${entry.sourceAsin}`
      for (const productId of productIdsByPlatformAsin.get(key) || []) {
        matchedProductIds.add(productId)
      }
    }

    const matchedOfferIds = new Set<number>()
    for (const productId of matchedProductIds) {
      for (const offerId of offerLinksByProduct.get(productId) || []) {
        matchedOfferIds.add(offerId)
      }
    }

    const offerIds = Array.from(matchedOfferIds)
    if (offerIds.length === 0) {
      continue
    }

    const offerShares = buildWeightedShares(
      entry.commission,
      offerIds.map(() => 1)
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
