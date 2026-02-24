import { describe, expect, it } from 'vitest'
import { __testUtils } from '@/lib/openclaw/strategy-recommendations'

const now = Date.now()

function makeCampaign(overrides: Record<string, any> = {}) {
  return {
    id: 101,
    campaign_name: 'Dreo_US_3653',
    campaign_id: '1234567890',
    google_campaign_id: '1234567890',
    max_cpc: 1.2,
    budget_amount: 10,
    budget_type: 'DAILY',
    created_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
    published_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
    offer_id: 88,
    ad_creative_id: null,
    product_price: '$200',
    commission_payout: '20%',
    target_country: 'US',
    brand: 'Dreo',
    category: 'air conditioner',
    product_name: 'Portable AC',
    ...overrides,
  }
}

describe('openclaw strategy recommendations rules', () => {
  it('uses recommended CPC formula (product_price * commission_rate / 50) and supports lowering', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({
        max_cpc: 1.2,
        created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        published_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      })],
      perf7dByCampaign: new Map([[101, { impressions: 1200, clicks: 120, cost: 144 }]]),
      perfTotalByCampaign: new Map([[101, { impressions: 2000, clicks: 180, cost: 216 }]]),
      commissionByCampaign: new Map([[101, 42]]),
      keywordsByCampaign: new Map([[101, new Set(['dreo'])]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const cpcRec = drafts.find((item) => item.recommendationType === 'adjust_cpc')
    expect(cpcRec).toBeTruthy()
    expect(cpcRec?.data.recommendedCpc).toBe(0.8)
    expect(cpcRec?.data.cpcAdjustmentDirection).toBe('lower')
    expect(cpcRec?.data.snapshotHash).toBeTruthy()
    expect((cpcRec?.data.estimatedCostSaving || 0)).toBeGreaterThan(0)
    expect(cpcRec?.data.impactWindowDays).toBe(7)
    expect(cpcRec?.data.impactConfidence).toBe('high')
    expect(String(cpcRec?.data.impactConfidenceReason || '')).toContain('样本：曝光')
  })

  it('marks <=3 day campaigns with zero commission as lag protected', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({
        id: 102,
        max_cpc: 1.2,
        created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        published_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      })],
      perf7dByCampaign: new Map([[102, { impressions: 300, clicks: 30, cost: 36 }]]),
      perfTotalByCampaign: new Map([[102, { impressions: 300, clicks: 30, cost: 36 }]]),
      commissionByCampaign: new Map(),
      keywordsByCampaign: new Map([[102, new Set(['dreo'])]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const cpcRec = drafts.find((item) => item.recommendationType === 'adjust_cpc')
    expect(cpcRec).toBeTruthy()
    expect(cpcRec?.data.commissionLagProtected).toBe(true)
    expect(cpcRec?.data.impactConfidence).toBe('low')
  })

  it('includes offline recommendation when runDays > 7 and no impressions/clicks', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({ id: 103, max_cpc: 0.6 })],
      perf7dByCampaign: new Map([[103, { impressions: 0, clicks: 0, cost: 12 }]]),
      perfTotalByCampaign: new Map([[103, { impressions: 0, clicks: 0, cost: 35 }]]),
      commissionByCampaign: new Map(),
      keywordsByCampaign: new Map([[103, new Set(['dreo'])]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const offlineRec = drafts.find((item) => item.recommendationType === 'offline_campaign')
    expect(offlineRec).toBeTruthy()
    expect(offlineRec?.data.ruleCode).toBe('offline_over7d_zero_impression')
    expect(drafts.some((item) => item.recommendationType === 'adjust_cpc')).toBe(false)
    expect(drafts.some((item) => item.recommendationType === 'expand_keywords')).toBe(false)
  })

  it('includes offline recommendation when runDays > 7 and CTR < 5%', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({ id: 104, max_cpc: 0.6 })],
      perf7dByCampaign: new Map([[104, { impressions: 200, clicks: 8, cost: 16 }]]),
      perfTotalByCampaign: new Map([[104, { impressions: 200, clicks: 8, cost: 16 }]]),
      commissionByCampaign: new Map([[104, 12]]),
      keywordsByCampaign: new Map([[104, new Set(['dreo'])]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const offlineRec = drafts.find((item) => item.recommendationType === 'offline_campaign')
    expect(offlineRec).toBeTruthy()
    expect(offlineRec?.data.ruleCode).toBe('offline_over7d_low_ctr')
  })

  it('does not offline campaign by low CTR when sample size is insufficient', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({ id: 111, max_cpc: 0.6 })],
      perf7dByCampaign: new Map([[111, { impressions: 20, clicks: 0, cost: 1 }]]),
      perfTotalByCampaign: new Map([[111, { impressions: 20, clicks: 0, cost: 1 }]]),
      commissionByCampaign: new Map([[111, 1]]),
      keywordsByCampaign: new Map([[111, new Set(['dreo'])]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const offlineRec = drafts.find((item) => item.recommendationType === 'offline_campaign')
    expect(offlineRec).toBeFalsy()
  })

  it('includes offline recommendation when runDays > 7 and ROAS < 0.5', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({ id: 107, max_cpc: 0.6 })],
      perf7dByCampaign: new Map([[107, { impressions: 1200, clicks: 120, cost: 110 }]]),
      perfTotalByCampaign: new Map([[107, { impressions: 1200, clicks: 120, cost: 220 }]]),
      commissionByCampaign: new Map([[107, 60]]), // ROAS = 0.27
      keywordsByCampaign: new Map([[107, new Set(['dreo', 'portable ac'])]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const offlineRec = drafts.find((item) => item.recommendationType === 'offline_campaign')
    expect(offlineRec).toBeTruthy()
    expect(offlineRec?.data.ruleCode).toBe('offline_over7d_low_roas')
  })

  it('includes offline recommendation for lower-value duplicate campaigns of same offer', () => {
    const campaigns = [
      makeCampaign({
        id: 201,
        campaign_name: 'Renpho_3709_A',
        offer_id: 9901,
        max_cpc: 0.6,
      }),
      makeCampaign({
        id: 202,
        campaign_name: 'Renpho_3709_B',
        offer_id: 9901,
        max_cpc: 0.6,
      }),
    ]

    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns,
      perf7dByCampaign: new Map([
        [201, { impressions: 1200, clicks: 120, cost: 60 }],
        [202, { impressions: 900, clicks: 60, cost: 40 }],
      ]),
      perfTotalByCampaign: new Map([
        [201, { impressions: 1200, clicks: 120, cost: 60 }],
        [202, { impressions: 900, clicks: 60, cost: 40 }],
      ]),
      commissionByCampaign: new Map([
        [201, 75], // roas=1.25
        [202, 28], // roas=0.7
      ]),
      keywordsByCampaign: new Map([
        [201, new Set(['renpho scale'])],
        [202, new Set(['renpho scale'])],
      ]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const duplicateOfflineRec = drafts.find((item) => item.campaignId === 202 && item.recommendationType === 'offline_campaign')
    expect(duplicateOfflineRec).toBeTruthy()
    expect(duplicateOfflineRec?.data.ruleCode).toBe('offline_duplicate_offer_campaign')

    const winnerOfflineRec = drafts.find((item) => item.campaignId === 201 && item.recommendationType === 'offline_campaign')
    expect(winnerOfflineRec).toBeFalsy()
  })

  it('builds keyword expansion plan with explicit match types', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({
        id: 105,
        max_cpc: 0.8,
        product_price: '$150',
        commission_payout: '10%',
        created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        published_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      })],
      perf7dByCampaign: new Map([[105, { impressions: 120, clicks: 10, cost: 8 }]]),
      perfTotalByCampaign: new Map([[105, { impressions: 120, clicks: 10, cost: 8 }]]),
      commissionByCampaign: new Map(),
      keywordsByCampaign: new Map([[105, new Set(['dreo'])]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const expandRec = drafts.find((item) => item.recommendationType === 'expand_keywords')
    expect(expandRec).toBeTruthy()
    expect((expandRec?.data.keywordPlan || []).length).toBeGreaterThanOrEqual(20)
    expect((expandRec?.data.keywordPlan || []).length).toBeLessThanOrEqual(30)
    expect((expandRec?.data.keywordPlan || []).every((kw) => ['BROAD', 'PHRASE', 'EXACT'].includes(kw.matchType))).toBe(true)
  })

  it('falls back to campaign_config keywords when keyword inventory is empty', () => {
    const fallbackKeywords = Array.from({ length: 12 }, (_, index) => ({
      text: `fallback keyword ${index + 1}`,
      matchType: 'PHRASE',
    }))

    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({
        id: 112,
        created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        published_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        campaign_config: JSON.stringify({
          keywords: fallbackKeywords,
        }),
      })],
      perf7dByCampaign: new Map([[112, { impressions: 80, clicks: 6, cost: 4 }]]),
      perfTotalByCampaign: new Map([[112, { impressions: 80, clicks: 6, cost: 4 }]]),
      commissionByCampaign: new Map(),
      keywordsByCampaign: new Map(),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const expandRec = drafts.find((item) => item.recommendationType === 'expand_keywords')
    expect(expandRec).toBeTruthy()
    expect(expandRec?.data.keywordCoverageCount).toBe(12)
    expect(expandRec?.summary).toContain('当前关键词 12 个')
  })

  it('generates negative keyword recommendations from hard-negative search terms', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({
        id: 109,
        created_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
        published_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
      })],
      perf7dByCampaign: new Map([[109, { impressions: 900, clicks: 90, cost: 62 }]]),
      perfTotalByCampaign: new Map([[109, { impressions: 1400, clicks: 130, cost: 95 }]]),
      commissionByCampaign: new Map([[109, 20]]),
      keywordsByCampaign: new Map([[109, new Set(['dreo', 'portable ac'])]]),
      keywordInventoryByCampaign: new Map([[
        109,
        [
          { text: 'dreo', matchType: 'EXACT', isNegative: false },
        ],
      ]]),
      searchTermsByCampaign: new Map([[
        109,
        [
          { searchTerm: 'dreo manual download', impressions: 50, clicks: 6, conversions: 0, cost: 5.8 },
          { searchTerm: 'dreo jobs', impressions: 30, clicks: 4, conversions: 0, cost: 3.2 },
        ],
      ]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const negativeRec = drafts.find((item) => item.recommendationType === 'add_negative_keywords')
    expect(negativeRec).toBeTruthy()
    expect((negativeRec?.data.negativeKeywordPlan || []).length).toBeGreaterThan(0)
    expect((negativeRec?.data.negativeKeywordPlan || []).every((kw) => kw.matchType === 'EXACT')).toBe(true)
  })

  it('generates match type optimization recommendation for broad keywords with cost', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({
        id: 110,
        created_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
        published_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
      })],
      perf7dByCampaign: new Map([[110, { impressions: 980, clicks: 88, cost: 58 }]]),
      perfTotalByCampaign: new Map([[110, { impressions: 1600, clicks: 148, cost: 102 }]]),
      commissionByCampaign: new Map([[110, 22]]),
      keywordsByCampaign: new Map([[110, new Set(['dreo'])]]),
      keywordInventoryByCampaign: new Map([[
        110,
        [
          { text: 'dreo', matchType: 'BROAD', isNegative: false },
        ],
      ]]),
      searchTermsByCampaign: new Map([[
        110,
        [
          { searchTerm: 'dreo', impressions: 200, clicks: 26, conversions: 0, cost: 14.2 },
        ],
      ]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const matchRec = drafts.find((item) => item.recommendationType === 'optimize_match_type')
    expect(matchRec).toBeTruthy()
    const first = (matchRec?.data.matchTypePlan || [])[0]
    expect(first?.text.toLowerCase()).toBe('dreo')
    expect(first?.currentMatchType).toBe('BROAD')
    expect(['PHRASE', 'EXACT']).toContain(first?.recommendedMatchType)
    expect(matchRec?.data.matchTypeReplaceMode).toBe('pause_existing')
  })

  it('skips recommendation generation when same campaign+type is in cooldown window', () => {
    const nowMs = Date.now()
    const cooldownMap = new Map<string, number>([
      ['101:adjust_cpc', nowMs + 2 * 24 * 60 * 60 * 1000],
    ])

    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({
        max_cpc: 1.2,
        created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        published_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      })],
      perf7dByCampaign: new Map([[101, { impressions: 1200, clicks: 120, cost: 144 }]]),
      perfTotalByCampaign: new Map([[101, { impressions: 2000, clicks: 180, cost: 216 }]]),
      commissionByCampaign: new Map([[101, 42]]),
      keywordsByCampaign: new Map([[101, new Set(['dreo'])]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
      cooldownUntilByKey: cooldownMap,
      nowMs,
    })

    expect(drafts.some((item) => item.recommendationType === 'adjust_cpc')).toBe(false)
  })

  it('generates budget adjustment recommendation for high-value campaigns', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({
        id: 108,
        max_cpc: 0.35,
        budget_amount: 10,
      })],
      perf7dByCampaign: new Map([[108, { impressions: 900, clicks: 95, cost: 32 }]]),
      perfTotalByCampaign: new Map([[108, { impressions: 900, clicks: 95, cost: 32 }]]),
      commissionByCampaign: new Map([[108, 40]]), // ROAS = 1.25
      keywordsByCampaign: new Map([[108, new Set(['dreo', 'portable ac deals'])]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    const budgetRec = drafts.find((item) => item.recommendationType === 'adjust_budget')
    expect(budgetRec).toBeTruthy()
    expect(budgetRec?.data.recommendedBudget).toBeGreaterThan(10)
    expect(budgetRec?.data.budgetAdjustmentDirection).toBe('increase')
  })

  it('does not generate CPC recommendation when google campaign id is missing', () => {
    const drafts = __testUtils.buildRecommendationDrafts({
      campaigns: [makeCampaign({
        id: 106,
        google_campaign_id: null,
        campaign_id: null,
        max_cpc: 1.2,
      })],
      perf7dByCampaign: new Map([[106, { impressions: 800, clicks: 80, cost: 96 }]]),
      perfTotalByCampaign: new Map([[106, { impressions: 1200, clicks: 120, cost: 144 }]]),
      commissionByCampaign: new Map([[106, 20]]),
      keywordsByCampaign: new Map([[106, new Set(['dreo'])]]),
      keywordIdeasByOffer: new Map(),
      creativeById: new Map(),
    })

    expect(drafts.some((item) => item.recommendationType === 'adjust_cpc')).toBe(false)
  })

  it('builds deterministic execute task id by recommendationId + snapshotHash', () => {
    const taskId = __testUtils.buildDeterministicRecommendationExecuteTaskId({
      recommendationId: 'rec-abc_123',
      snapshotHash: 'aa11bb22cc33',
    })

    expect(taskId).toBe('openclaw-strategy-exec-rec-abc_123-aa11bb22cc33')
  })

  it('treats keyword execution partial failures as failure', () => {
    expect(() => __testUtils.assertRecommendationActionResult({
      recommendationType: 'expand_keywords',
      response: {
        success: true,
        failures: [{ keyword: 'bad keyword' }],
      },
    })).toThrow('执行存在失败项')
  })

  it('treats offline queued response as incomplete execution', () => {
    expect(() => __testUtils.assertRecommendationActionResult({
      recommendationType: 'offline_campaign',
      response: {
        success: true,
        googleAds: {
          queued: true,
        },
      },
    })).toThrow('异步处理中')
  })

  it('treats offline planned/actual mismatch as failure', () => {
    expect(() => __testUtils.assertRecommendationActionResult({
      recommendationType: 'offline_campaign',
      response: {
        success: true,
        googleAds: {
          queued: false,
          action: 'REMOVE',
          planned: 1,
          removed: 0,
          failed: 0,
        },
      },
    })).toThrow('执行不完整')
  })
})
