import { getOpenclawSettingsMap, parseBoolean, parseJsonArray, parseNumber } from '@/lib/openclaw/settings'

export type OpenclawStrategyConfig = {
  enabled: boolean
  cron: string
  maxOffersPerRun: number
  defaultBudget: number
  maxCpc: number
  minCpc: number
  dailyBudgetCap: number
  dailySpendCap: number
  targetRoas: number
  adsAccountIds?: number[]
  enableAutoPublish: boolean
  enableAutoPause: boolean
  enableAutoAdjustCpc: boolean
  allowAffiliateFetch: boolean
  dryRun: boolean
}

export async function getOpenclawStrategyConfig(userId: number): Promise<OpenclawStrategyConfig> {
  const settingMap = await getOpenclawSettingsMap(userId)

  const adsAccountIds = parseJsonArray(settingMap.openclaw_strategy_ads_account_ids)
    ?.map((entry) => Number(entry))
    .filter((value) => Number.isFinite(value)) as number[] | undefined

  return {
    enabled: parseBoolean(settingMap.openclaw_strategy_enabled, false),
    cron: (settingMap.openclaw_strategy_cron || '0 9 * * *').trim(),
    maxOffersPerRun: parseNumber(settingMap.openclaw_strategy_max_offers_per_run, 3) || 3,
    defaultBudget: parseNumber(settingMap.openclaw_strategy_default_budget, 20) || 20,
    maxCpc: parseNumber(settingMap.openclaw_strategy_max_cpc, 1.2) || 1.2,
    minCpc: parseNumber(settingMap.openclaw_strategy_min_cpc, 0.1) || 0.1,
    dailyBudgetCap: parseNumber(settingMap.openclaw_strategy_daily_budget_cap, 1000) || 1000,
    dailySpendCap: parseNumber(settingMap.openclaw_strategy_daily_spend_cap, 100) || 100,
    targetRoas: parseNumber(settingMap.openclaw_strategy_target_roas, 1) || 1,
    adsAccountIds: adsAccountIds && adsAccountIds.length > 0 ? adsAccountIds : undefined,
    enableAutoPublish: parseBoolean(settingMap.openclaw_strategy_enable_auto_publish, true),
    enableAutoPause: parseBoolean(settingMap.openclaw_strategy_enable_auto_pause, true),
    enableAutoAdjustCpc: parseBoolean(settingMap.openclaw_strategy_enable_auto_adjust_cpc, true),
    allowAffiliateFetch: parseBoolean(settingMap.openclaw_strategy_allow_affiliate_fetch, true),
    dryRun: parseBoolean(settingMap.openclaw_strategy_dry_run, false),
  }
}
