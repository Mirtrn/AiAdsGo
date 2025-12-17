import { getDatabase } from './db'

/**
 * Prompt缓存接口
 */
interface PromptCacheEntry {
  content: string
  timestamp: number
  version: string
}

/**
 * Prompt缓存（内存缓存，5分钟过期）
 */
const promptCache = new Map<string, PromptCacheEntry>()
const CACHE_TTL = 5 * 60 * 1000 // 5分钟

/**
 * 检查缓存是否过期
 */
function isExpired(entry: PromptCacheEntry): boolean {
  return Date.now() - entry.timestamp > CACHE_TTL
}

/**
 * 清除过期缓存
 */
function clearExpiredCache(): void {
  const now = Date.now()
  for (const [key, entry] of promptCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      promptCache.delete(key)
    }
  }
}

// 每分钟清理一次过期缓存
setInterval(clearExpiredCache, 60 * 1000)

/**
 * 从数据库加载激活的Prompt内容
 *
 * @param promptId - Prompt ID (如 'launch_score_evaluation')
 * @returns Prompt模板字符串
 * @throws Error 如果找不到激活的prompt版本
 *
 * @example
 * const prompt = await loadPrompt('launch_score_evaluation')
 * const finalPrompt = prompt.replace('{{offer.brand}}', offer.brand)
 */
export async function loadPrompt(promptId: string): Promise<string> {
  // 1. 检查缓存
  const cached = promptCache.get(promptId)
  if (cached && !isExpired(cached)) {
    console.log(`✅ Prompt cache hit: ${promptId} (v${cached.version})`)
    return cached.content
  }

  // 2. 从数据库加载active版本
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性修复: is_active在PostgreSQL中是BOOLEAN类型
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

  const prompt = await db.queryOne<{
    prompt_content: string | Buffer
    version: string
    name: string
  }>(
    `SELECT prompt_content, version, name
     FROM prompt_versions
     WHERE prompt_id = ? AND ${isActiveCondition}`,
    [promptId]
  )

  if (!prompt) {
    throw new Error(`找不到激活的Prompt版本: ${promptId}`)
  }

  // 3. 处理Buffer类型（SQLite可能返回Buffer）
  const content = typeof prompt.prompt_content === 'string'
    ? prompt.prompt_content
    : prompt.prompt_content.toString('utf-8')

  // 4. 缓存并返回
  promptCache.set(promptId, {
    content,
    timestamp: Date.now(),
    version: prompt.version
  })

  console.log(`📦 Loaded prompt from database: ${prompt.name} (${promptId} v${prompt.version})`)

  return content
}

/**
 * 清除指定prompt的缓存（用于版本更新后强制重新加载）
 */
export function clearPromptCache(promptId?: string): void {
  if (promptId) {
    promptCache.delete(promptId)
    console.log(`🗑️ Cleared cache for prompt: ${promptId}`)
  } else {
    promptCache.clear()
    console.log(`🗑️ Cleared all prompt cache`)
  }
}

/**
 * 获取缓存统计信息
 */
export function getPromptCacheStats(): {
  size: number
  entries: Array<{ promptId: string; version: string; age: number }>
} {
  const now = Date.now()
  const entries = Array.from(promptCache.entries()).map(([promptId, entry]) => ({
    promptId,
    version: entry.version,
    age: Math.floor((now - entry.timestamp) / 1000) // 秒
  }))

  return {
    size: promptCache.size,
    entries
  }
}

/**
 * 模板变量插值工具函数
 *
 * @param template - 包含 {{variable}} 占位符的模板字符串
 * @param variables - 变量对象，支持嵌套属性 (如 { offer: { brand: 'Sony' } })
 * @returns 插值后的字符串
 *
 * @example
 * const result = interpolateTemplate(
 *   'Brand: {{offer.brand}}, Price: {{offer.price}}',
 *   { offer: { brand: 'Sony', price: '$299' } }
 * )
 * // result: 'Brand: Sony, Price: $299'
 */
export function interpolateTemplate(template: string, variables: Record<string, any>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = path.split('.').reduce((obj: any, key: string) => obj?.[key], variables)
    return value !== undefined ? String(value) : match
  })
}
