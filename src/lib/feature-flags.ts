/**
 * 功能开关和灰度发布控制
 *
 * 用于安全地部署新功能优化，支持基于用户ID的分流
 */

/**
 * 竞品压缩优化灰度发布
 *
 * 策略：基于用户ID哈希值进行确定性分流
 * - 同一用户始终分配到同一组（一致性）
 * - 灰度比例可动态调整
 * - 零破坏性：压缩已通过A/B测试验证（96.3%质量相关性）
 *
 * @param userId 用户ID
 * @param rolloutPercentage 灰度比例（0-100）
 * @returns true=启用压缩，false=使用原始格式
 */
export function isCompetitorCompressionEnabled(
  userId: number,
  rolloutPercentage: number = 10  // 默认10%灰度
): boolean {
  // 简单哈希函数：用户ID对100取模
  const bucket = userId % 100

  // 灰度逻辑：bucket < rolloutPercentage 的用户启用压缩
  return bucket < rolloutPercentage
}

/**
 * 竞品分析缓存灰度发布
 *
 * 策略：3天TTL缓存，基于用户ID分流
 * - 竞品数据变化慢，缓存安全
 * - 节省约30% API调用
 *
 * @param userId 用户ID
 * @param rolloutPercentage 灰度比例（0-100）
 * @returns true=启用缓存，false=实时分析
 */
export function isCompetitorCacheEnabled(
  userId: number,
  rolloutPercentage: number = 50  // 默认50%灰度
): boolean {
  const bucket = userId % 100
  return bucket < rolloutPercentage
}

/**
 * 获取当前功能开关配置
 *
 * 中心化管理所有灰度发布参数，便于监控和调整
 */
export const FEATURE_FLAGS = {
  // 竞品压缩优化
  competitorCompression: {
    enabled: true,          // 全局开关
    rolloutPercentage: 100, // 🟢 100%全量部署（A/B测试已验证96.3%质量）
    description: 'Token优化：竞品数据压缩（45% token减少，96.3%质量验证）',
    deployedAt: '2025-11-30',
  },

  // 竞品分析缓存
  competitorCache: {
    enabled: true,
    rolloutPercentage: 50,
    cacheTTL: 3 * 24 * 60 * 60 * 1000,  // 3天（毫秒）
    description: 'Token优化：竞品分析结果缓存（30%调用减少）',
  },

  // 模型降级（待实施）
  flashModelForSimpleTasks: {
    enabled: false,  // 未启用，需先A/B测试
    rolloutPercentage: 0,
    description: 'Token优化：简单任务使用Flash模型（5x成本降低）',
    tasks: ['detectLanguage', 'parseMultiLangDigit'],
  },

  // 结构化JSON输出（待实施）
  structuredJsonOutput: {
    enabled: false,
    rolloutPercentage: 0,
    description: 'Token优化：强制JSON schema约束（减少后处理开销）',
  },
} as const

/**
 * 记录功能开关决策日志（用于监控和调试）
 *
 * @param feature 功能名称
 * @param userId 用户ID
 * @param enabled 是否启用
 */
export function logFeatureFlag(
  feature: string,
  userId: number,
  enabled: boolean
): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`🚦 Feature Flag: ${feature} | User ${userId} | ${enabled ? '✅ Enabled' : '❌ Disabled'}`)
  }
}
