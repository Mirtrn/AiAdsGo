/**
 * 关键词系统常量统一管理
 * 遵循KISS原则：单一职责，避免重复，清晰命名
 */

/**
 * 销售平台和智能家居生态系统白名单（不应被当作竞品过滤）
 *
 * 包含两类：
 * 1. 销售平台：表示销售渠道的购买词（如 "argus 3 pro amazon"）
 * 2. 智能家居平台：表示兼容性/集成特性的功能词（如 "eufycam homekit"）
 * 3. 大型科技公司平台：表示兼容性或集成特性（如 "works with google", "apple certified"）
 *
 * 这些词不是竞品，而是产品特性或销售渠道，应该保留
 */
export const PLATFORMS = [
  // 销售平台
  'amazon', 'ebay', 'walmart', 'target', 'bestbuy', 'homedepot', 'lowes',
  'aliexpress', 'alibaba', 'etsy', 'newegg', 'costco', 'samsclub',
  // 智能家居生态系统平台（功能特性，非竞品）
  'alexa', 'google home', 'google assistant', 'homekit', 'apple homekit',
  'smartthings', 'ifttt', 'home assistant',
  // 大型科技公司（通常表示兼容性/集成）
  'google', 'apple', 'microsoft', 'amazon'
] as const

/**
 * 已知竞品品牌列表（用于竞品词过滤）
 *
 * 注意事项：
 * - 销售平台（如amazon）已从此列表移除 → 移至PLATFORMS白名单
 * - 智能家居平台（如homekit、alexa）已从此列表移除 → 移至PLATFORMS白名单
 * - 只保留真正的竞品品牌（提供类似产品的其他厂商）
 */
export const BRAND_PATTERNS = [
  // 安防/摄像头竞品品牌
  'ring', 'arlo', 'nest', 'wyze', 'blink', 'eufy', 'lorex', 'swann', 'hikvision', 'dahua',
  'adt', 'simplisafe', 'vivint', 'frontpoint', 'abode', 'cove', 'scout',
  // 电商平台相关
  'shopify', 'woocommerce', 'bigcommerce', 'magento',
  // 通用科技品牌（可能有竞品）
  'samsung', 'philips', 'hue', 'lutron', 'ecobee', 'tplink', 'kasa', 'nanoleaf', 'meross',
  // 其他智能家居品牌
  'xiaomi', 'mijia', 'tuya', 'smart life'
] as const

/**
 * 默认配置常量
 */
export const DEFAULTS = {
  /** 默认最小搜索量阈值 */
  minSearchVolume: 500,  // 🔥 2025-12-17: 从100提高到500，只保留高价值关键词

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
