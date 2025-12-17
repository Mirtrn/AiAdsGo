/**
 * 关键词系统常量统一管理
 * 遵循KISS原则：单一职责，避免重复，清晰命名
 */

/**
 * 销售平台白名单（不应被当作竞品过滤）
 * 这些词表示销售渠道，包含这些词的关键词通常是高意图购买词
 * 例如："argus 3 pro amazon" 中的 amazon 是购买渠道，不是竞品
 */
export const PLATFORMS = [
  'amazon', 'ebay', 'walmart', 'target', 'bestbuy', 'homedepot', 'lowes',
  'aliexpress', 'alibaba', 'etsy', 'newegg', 'costco', 'samsclub'
] as const

/**
 * 已知竞品品牌列表（用于竞品词过滤）
 * 注意：销售平台（如amazon）已从此列表移除
 */
export const BRAND_PATTERNS = [
  // 安防/摄像头
  'ring', 'arlo', 'nest', 'wyze', 'blink', 'eufy', 'lorex', 'swann', 'hikvision', 'dahua',
  'adt', 'simplisafe', 'vivint', 'frontpoint', 'abode', 'cove', 'scout',
  // 智能家居
  'alexa', 'google assistant', 'homekit', 'ifttt', 'smartthings',
  // 电商/品牌相关
  'shopify', 'woocommerce', 'bigcommerce', 'magento',
  // 通用科技品牌
  'microsoft', 'amazon', 'google', 'apple', 'samsung', 'philips', 'hue',
  'lutron', 'ecobee', 'tplink', 'kasa', 'nanoleaf', 'meross',
  // 其他相关
  'xiaomi', 'mijia', 'tuya', 'smart life'
] as const

/**
 * 默认配置常量
 */
export const DEFAULTS = {
  /** 默认最小搜索量阈值 */
  minSearchVolume: 100,

  /** 默认最大关键词数量 */
  maxKeywords: 5000,

  /** 智能过滤的最小期望关键词数 */
  minKeywordsTarget: 15,

  /** 智能过滤的最大尝试次数 */
  maxFilterAttempts: 4,

  /** Redis缓存TTL（天） */
  cacheTtlDays: 7
} as const

/**
 * 智能过滤阈值级别
 * 用于自适应调整搜索量门槛，保留更多有价值的关键词
 */
export const THRESHOLD_LEVELS = [500, 100, 10, 1] as const

/**
 * 关键词意图分类（用于桶分类）
 */
export const INTENT_BUCKETS = {
  BRAND: 'A',      // 品牌相关
  SCENARIO: 'B',   // 使用场景
  FEATURE: 'C'     // 功能特性
} as const

/**
 * 匹配类型
 */
export const MATCH_TYPES = {
  EXACT: 'exact',
  PHRASE: 'phrase',
  BROAD: 'broad'
} as const

/**
 * 关键词来源类型
 */
export const SOURCES = {
  SCRAPED: 'SCRAPED',
  EXPANDED: 'EXPANDED',
  AI_GENERATED: 'AI_GENERATED',
  SEED: 'SEED'
} as const

/**
 * 类型导出（用于TypeScript）
 */
export type Platform = typeof PLATFORMS[number]
export type BrandPattern = typeof BRAND_PATTERNS[number]
export type ThresholdLevel = typeof THRESHOLD_LEVELS[number]
export type IntentBucket = typeof INTENT_BUCKETS[keyof typeof INTENT_BUCKETS]
export type MatchType = typeof MATCH_TYPES[keyof typeof MATCH_TYPES]
export type Source = typeof SOURCES[keyof typeof SOURCES]
