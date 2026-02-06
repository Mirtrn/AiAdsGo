import { describe, expect, it } from 'vitest'

import { calculateNextCpc, deriveAdaptiveStrategyConfig, deriveFailureGuardConfig, rankAsinItemsForExecution, scoreAsinItemForExecution, shouldTreatCampaignAsConflict } from '@/lib/queue/executors/openclaw-strategy-executor'
import { normalizeOpenclawStrategyConfig, type OpenclawStrategyConfig } from '@/lib/openclaw/strategy-config'

function baseConfig(): OpenclawStrategyConfig {
  return {
    enabled: true,
    cron: '0 9 * * *',
    maxOffersPerRun: 3,
    defaultBudget: 20,
    maxCpc: 1.2,
    minCpc: 0.1,
    dailyBudgetCap: 1000,
    dailySpendCap: 100,
    targetRoas: 1,
    adsAccountIds: [1],
    priorityAsins: undefined,
    enableAutoPublish: true,
    enableAutoPause: true,
    enableAutoAdjustCpc: true,
    allowAffiliateFetch: true,
    enforceAutoadsOnly: true,
    dryRun: false,
  }
}

describe('openclaw strategy adaptive helpers', () => {
  it('calculateNextCpc 会在高ROAS时上调并受上限约束', () => {
    const next = calculateNextCpc({
      roas: 2,
      currentCpc: 1,
      minCpc: 0.1,
      maxCpc: 1.05,
      targetRoas: 1,
    })

    expect(next).toBe(1.05)
  })

  it('calculateNextCpc 会在低ROAS时下调并受下限约束', () => {
    const next = calculateNextCpc({
      roas: 0.2,
      currentCpc: 0.12,
      minCpc: 0.1,
      maxCpc: 1.2,
      targetRoas: 1,
    })

    expect(next).toBe(0.1)
  })

  it('normalizeOpenclawStrategyConfig 会强制执行预算与CPC约束', () => {
    const normalized = normalizeOpenclawStrategyConfig({
      ...baseConfig(),
      maxOffersPerRun: 0,
      defaultBudget: 999,
      dailyBudgetCap: 5000,
      dailySpendCap: 300,
      minCpc: 2,
      maxCpc: 0.5,
      targetRoas: 0,
      adsAccountIds: [1, 1, 0, -5],
      priorityAsins: ['b0test1234', 'B0TEST1234', 'bad asin'],
    })

    expect(normalized.maxOffersPerRun).toBe(1)
    expect(normalized.dailyBudgetCap).toBe(1000)
    expect(normalized.dailySpendCap).toBe(100)
    expect(normalized.defaultBudget).toBe(100)
    expect(normalized.minCpc).toBe(2)
    expect(normalized.maxCpc).toBe(2)
    expect(normalized.targetRoas).toBe(0.1)
    expect(normalized.adsAccountIds).toEqual([1])
    expect(normalized.priorityAsins).toEqual(['B0TEST1234'])
  })

  it('normalizeOpenclawStrategyConfig 会保留AutoAds强制开关', () => {
    const normalized = normalizeOpenclawStrategyConfig({
      ...baseConfig(),
      enforceAutoadsOnly: false,
    })

    expect(normalized.enforceAutoadsOnly).toBe(false)
  })

  it('scoreAsinItemForExecution 会偏好高成功率样本', () => {
    const bullish = scoreAsinItemForExecution({
      priority: 1,
      outcome: { published: 6, failed: 1, lastStatus: 'published' },
    })
    const bearish = scoreAsinItemForExecution({
      priority: 1,
      outcome: { published: 1, failed: 6, lastStatus: 'failed' },
    })

    expect(bullish).toBeGreaterThan(bearish)
  })

  it('scoreAsinItemForExecution 会为优先ASIN提供加分', () => {
    const normal = scoreAsinItemForExecution({
      priority: 1,
      outcome: { published: 2, failed: 1, lastStatus: 'published' },
      isPreferred: false,
    })
    const preferred = scoreAsinItemForExecution({
      priority: 1,
      outcome: { published: 2, failed: 1, lastStatus: 'published' },
      isPreferred: true,
    })

    expect(preferred).toBeGreaterThan(normal)
  })

  it('rankAsinItemsForExecution 会基于历史表现重排同优先级候选', () => {
    const items = [
      {
        id: 1,
        asin: 'A-1',
        brand: 'BrandA',
        priority: 1,
      },
      {
        id: 2,
        asin: 'B-1',
        brand: 'BrandB',
        priority: 1,
      },
    ] as any

    const ranked = rankAsinItemsForExecution(items, {
      byAsin: new Map([
        ['A-1', { published: 5, failed: 1, lastStatus: 'published' }],
        ['B-1', { published: 0, failed: 4, lastStatus: 'failed' }],
      ]),
      byBrand: new Map(),
    })

    expect(ranked[0].item.id).toBe(1)
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    expect(ranked[0].signalSource).toBe('asin')
  })

  it('rankAsinItemsForExecution 会优先选择指定ASIN列表', () => {
    const items = [
      {
        id: 10,
        asin: 'PREFERRED-1',
        brand: 'BrandC',
        priority: 0,
      },
      {
        id: 11,
        asin: 'NORMAL-1',
        brand: 'BrandC',
        priority: 2,
      },
    ] as any

    const ranked = rankAsinItemsForExecution(items, {
      byAsin: new Map(),
      byBrand: new Map(),
    }, {
      priorityAsins: ['preferred-1'],
    })

    expect(ranked[0].item.asin).toBe('PREFERRED-1')
    expect(ranked[0].isPreferred).toBe(true)
  })

  it('shouldTreatCampaignAsConflict 会将未知品牌视为冲突', () => {
    const decision = shouldTreatCampaignAsConflict({
      campaignStatus: 'ENABLED',
      campaignBrand: '',
      targetBrand: 'BrandA',
    })

    expect(decision.conflict).toBe(true)
    expect(decision.unknownBrand).toBe(true)
  })

  it('shouldTreatCampaignAsConflict 会识别同品牌不冲突', () => {
    const decision = shouldTreatCampaignAsConflict({
      campaignStatus: 'ENABLED',
      campaignBrand: 'BrandA',
      targetBrand: 'BrandA',
    })

    expect(decision.conflict).toBe(false)
    expect(decision.unknownBrand).toBe(false)
  })

  it('deriveAdaptiveStrategyConfig 在高盈利样本下扩张', () => {
    const cfg = baseConfig()
    const { effectiveConfig, insight } = deriveAdaptiveStrategyConfig({
      config: cfg,
      knowledgeRows: [
        { summary_json: { roi: { totalCost: 20, totalRevenue: 30 } }, notes: null },
        { summary_json: { roi: { totalCost: 20, totalRevenue: 26 } }, notes: null },
        { summary_json: { roi: { totalCost: 20, totalRevenue: 24 } }, notes: null },
      ],
    })

    expect(insight.adjustment).toBe('expand')
    expect(effectiveConfig.maxOffersPerRun).toBe(4)
    expect(effectiveConfig.defaultBudget).toBe(22)
    expect(effectiveConfig.maxCpc).toBe(1.26)
  })

  it('deriveAdaptiveStrategyConfig 在低ROAS样本下收缩', () => {
    const cfg = baseConfig()
    const { effectiveConfig, insight } = deriveAdaptiveStrategyConfig({
      config: cfg,
      knowledgeRows: [
        { summary_json: { roi: { totalCost: 20, totalRevenue: 8 } }, notes: null },
        { summary_json: { roi: { totalCost: 20, totalRevenue: 10 } }, notes: null },
        { summary_json: { roi: { totalCost: 20, totalRevenue: 12 } }, notes: null },
      ],
    })

    expect(insight.adjustment).toBe('defensive')
    expect(effectiveConfig.maxOffersPerRun).toBe(2)
    expect(effectiveConfig.defaultBudget).toBe(16)
    expect(effectiveConfig.maxCpc).toBe(1.08)
  })

  it('deriveFailureGuardConfig 在高失败率下进入强防守', () => {
    const cfg = baseConfig()
    const { effectiveConfig, insight } = deriveFailureGuardConfig({
      config: cfg,
      runStats: [
        { publishSuccess: 0, publishFailed: 2, reason: 'publish_failure_stop_loss' },
        { publishSuccess: 1, publishFailed: 3, reason: 'publish_failure_stop_loss' },
      ],
    })

    expect(insight.guardLevel).toBe('strong')
    expect(insight.publishFailureRate).toBe(0.83)
    expect(effectiveConfig.maxOffersPerRun).toBe(1)
    expect(effectiveConfig.defaultBudget).toBe(15)
    expect(effectiveConfig.maxCpc).toBe(1.02)
  })

  it('deriveFailureGuardConfig 在样本不足时保持不变', () => {
    const cfg = baseConfig()
    const { effectiveConfig, insight } = deriveFailureGuardConfig({
      config: cfg,
      runStats: [{ publishSuccess: 1, publishFailed: 0, reason: null }],
    })

    expect(insight.guardLevel).toBe('insufficient_data')
    expect(effectiveConfig.maxOffersPerRun).toBe(cfg.maxOffersPerRun)
    expect(effectiveConfig.defaultBudget).toBe(cfg.defaultBudget)
    expect(effectiveConfig.maxCpc).toBe(cfg.maxCpc)
  })
})
