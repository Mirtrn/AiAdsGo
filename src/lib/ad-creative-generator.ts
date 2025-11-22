import { getDatabase } from './db'
import type {
  GeneratedAdCreativeData,
  HeadlineAsset,
  DescriptionAsset,
  QualityMetrics
} from './ad-creative'
import { creativeCache, generateCreativeCacheKey } from './cache'
import { getKeywordSearchVolumes } from './keyword-planner'
import { generateContent, getGeminiMode } from './gemini'

// Keyword with search volume data
export interface KeywordWithVolume {
  keyword: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
}

/**
 * AI广告创意生成器
 * 优先使用Vertex AI，其次使用Gemini API
 */

interface AIConfig {
  type: 'vertex-ai' | 'gemini-api' | null
  vertexAI?: {
    projectId: string
    location: string
    model: string
  }
  geminiAPI?: {
    apiKey: string
    model: string
  }
}

/**
 * 获取AI配置（从settings表）
 * 优先级：用户配置 > 全局配置
 */
async function getAIConfig(userId?: number): Promise<AIConfig> {
  const db = getDatabase()

  // 1. 先尝试获取用户特定配置（优先级最高）
  let userSettings: Record<string, string> = {}
  if (userId) {
    const userRows = db.prepare(`
      SELECT config_key, config_value FROM system_settings
      WHERE user_id = ? AND config_key IN (
        'vertex_ai_model', 'gcp_project_id', 'gcp_location',
        'gemini_api_key', 'gemini_model', 'use_vertex_ai'
      )
    `).all(userId) as Array<{ config_key: string; config_value: string }>

    userSettings = userRows.reduce((acc, { config_key, config_value }) => {
      acc[config_key] = config_value
      return acc
    }, {} as Record<string, string>)
  }

  // 2. 获取全局配置（作为备选）
  const globalRows = db.prepare(`
    SELECT config_key, config_value FROM system_settings
    WHERE user_id IS NULL AND config_key IN (
      'VERTEX_AI_PROJECT_ID', 'VERTEX_AI_LOCATION', 'VERTEX_AI_MODEL',
      'GEMINI_API_KEY', 'GEMINI_MODEL'
    )
  `).all() as Array<{ config_key: string; config_value: string }>

  const globalSettings = globalRows.reduce((acc, { config_key, config_value }) => {
    acc[config_key] = config_value
    return acc
  }, {} as Record<string, string>)

  // 3. 检查用户是否配置了使用Vertex AI
  const useVertexAI = userSettings['use_vertex_ai'] === 'true'

  // 4. 合并配置：用户配置优先
  const projectId = userSettings['gcp_project_id'] || globalSettings['VERTEX_AI_PROJECT_ID']
  const location = userSettings['gcp_location'] || globalSettings['VERTEX_AI_LOCATION']
  // 关键：用户的vertex_ai_model或gemini_model优先于全局VERTEX_AI_MODEL
  const model = userSettings['vertex_ai_model'] || userSettings['gemini_model'] || globalSettings['VERTEX_AI_MODEL']

  // 5. 检查Vertex AI配置（用户设置use_vertex_ai=true时优先）
  if (useVertexAI && projectId && location && model) {
    console.log(`🤖 使用Vertex AI: 项目=${projectId}, 区域=${location}, 模型=${model}`)
    return {
      type: 'vertex-ai',
      vertexAI: {
        projectId,
        location,
        model
      }
    }
  }

  // 6. 检查Gemini API配置
  const apiKey = userSettings['gemini_api_key'] || globalSettings['GEMINI_API_KEY']
  const geminiModel = userSettings['gemini_model'] || globalSettings['GEMINI_MODEL']

  if (apiKey && geminiModel) {
    console.log(`🤖 使用Gemini API: 模型=${geminiModel}`)
    return {
      type: 'gemini-api',
      geminiAPI: {
        apiKey,
        model: geminiModel
      }
    }
  }

  return { type: null }
}

/**
 * 生成广告创意的Prompt
 */
function buildAdCreativePrompt(
  offer: any,
  theme?: string,
  referencePerformance?: any
): string {
  let prompt = `你是一个专业的Google Ads广告文案创作专家。请根据以下产品信息生成高质量的广告创意。

## 产品信息
品牌: ${offer.brand}
类别: ${offer.category || '未分类'}
品牌描述: ${offer.brand_description || '无'}
独特卖点: ${offer.unique_selling_points || '无'}
产品亮点: ${offer.product_highlights || '无'}
目标受众: ${offer.target_audience || '无'}
推广国家: ${offer.target_country}
推广语言: ${offer.target_language || 'English'}
`

  // 如果有增强数据，添加到prompt中
  if (offer.pricing) {
    try {
      const pricing = JSON.parse(offer.pricing)
      prompt += `\n价格信息: ${JSON.stringify(pricing, null, 2)}`
    } catch {}
  }

  if (offer.reviews) {
    try {
      const reviews = JSON.parse(offer.reviews)
      prompt += `\n用户评价: ${JSON.stringify(reviews, null, 2)}`
    } catch {}
  }

  if (offer.promotions) {
    try {
      const promotions = JSON.parse(offer.promotions)
      prompt += `\n促销信息: ${JSON.stringify(promotions, null, 2)}`
    } catch {}
  }

  if (offer.competitive_edges) {
    try {
      const edges = JSON.parse(offer.competitive_edges)
      prompt += `\n竞争优势: ${JSON.stringify(edges, null, 2)}`
    } catch {}
  }

  if (theme) {
    prompt += `\n\n## 广告主题\n${theme}`
  }

  if (referencePerformance) {
    prompt += `\n\n## 历史表现数据参考\n`
    if (referencePerformance.best_headlines) {
      prompt += `表现优秀的Headlines: ${referencePerformance.best_headlines.join(', ')}\n`
    }
    if (referencePerformance.best_descriptions) {
      prompt += `表现优秀的Descriptions: ${referencePerformance.best_descriptions.join(', ')}\n`
    }
    if (referencePerformance.top_keywords) {
      prompt += `高效关键词: ${referencePerformance.top_keywords.join(', ')}\n`
    }
  }

  prompt += `

## Google Ads Ad Strength优化要求（目标：EXCELLENT级别）

### 核心标准
响应式搜索广告的Ad Strength评级直接影响广告效果。EXCELLENT级别要求：
- ✅ 15个高度差异化的Headlines
- ✅ 4个价值导向的Descriptions
- ✅ 资产类型均衡分布
- ✅ 长度梯度合理
- ✅ 关键词自然融入

---

### 1. Headlines要求（必须15个，分5大类型）

#### 类型分布（确保覆盖5种）
- **品牌认知类（3个）**：建立品牌可信度
  - 示例："${offer.brand} Official Store"、"Trusted by 50,000+ Customers"、"#1 ${offer.category}"

- **产品特性类（4个）**：突出核心价值
  - 示例："Premium Quality ${offer.category}"、"Advanced [关键特性] Technology"、"All-in-One Solution"

- **优惠促销类（3个，必含数字/百分比）**：刺激购买
  - 示例："Save up to 40% Off"、"$50 Off Your First Order"、"Buy 2 Get 1 Free"

- **行动召唤类（3个）**：驱动转化
  - 示例："Shop Now & Save"、"Get Yours Today"、"Order Online in Minutes"

- **紧迫感类（2个）**：创造FOMO
  - 示例："Limited Time Offer"、"Only 10 Left in Stock"、"Ends Tonight at Midnight"

#### 长度分布（优化展示效果）
- 短标题（10-20字符）：5个 - 移动端优化
- 中标题（20-25字符）：5个 - 桌面端平衡
- 长标题（25-30字符）：5个 - 信息最大化

#### 质量要求
- ✓ 每个标题≤30字符（严格限制）
- ✓ 15个标题文本相似度<20%（避免重复）
- ✓ 至少5个包含目标关键词
- ✓ 至少3个包含具体数字或百分比
- ✓ 至少2个体现紧迫感

---

### 2. Descriptions要求（必须4个，分2大类型）

#### 类型分布
- **价值主张类（2个）**：回答"为什么选择我们？"
  - 详细说明独特卖点、竞争优势、用户利益
  - 示例："Discover premium ${offer.category} with free shipping, 24/7 support, and 30-day money-back guarantee."

- **行动召唤类（2个）**：明确CTA + 立即利益
  - 驱动转化行动，强调即时价值
  - 示例："Shop now and save up to 40%! Free delivery on all orders. Limited time offer - order today!"

#### 质量要求
- ✓ 每个描述≤90字符（严格限制）
- ✓ 至少2个包含强CTA动词（Shop, Buy, Get, Order, Discover, Try）
- ✓ 突出3个以上用户利益点
- ✓ 自然融入关键词

---

### 3. Keywords要求（10-15个）
- 品牌词（1-2个）：包含品牌名
- 产品词（4-6个）：核心产品类别
- 功能词（2-3个）：关键特性
- 长尾词（3-5个）：细分场景

---

### 4. Callouts要求（可选，4-6个）
- 每个≤25字符
- 突出服务优势：Free Shipping, 24/7 Support, Money-Back Guarantee, Same-Day Delivery等

---

### 5. Sitelinks要求（可选，4个）
- text≤25字符, description≤35字符
- 链接到相关页面：Product Details, Special Offers, Customer Reviews, Buying Guide

---

## 禁用词清单（避免违反Google Ads政策）
- ❌ 绝对化词汇："100%", "最佳", "第一", "保证", "必须"
- ❌ 夸大表述："奇迹", "魔法", "神奇", "完美"
- ❌ 医疗声明：未经验证的健康效果
- ❌ 重复标点："!!!", "???", "..."
- ❌ 全大写滥用：不超过1个单词

---

## 输出格式（带资产标注，便于评分）
请严格按照以下JSON格式输出（不要包含markdown代码块标记）：

{
  "headlines": [
    {
      "text": "Save 40% on Premium Laptops",
      "type": "promo",
      "length": 29,
      "keywords": ["laptops"],
      "hasNumber": true,
      "hasUrgency": false
    },
    {
      "text": "Limited Time Offer",
      "type": "urgency",
      "length": 18,
      "keywords": [],
      "hasNumber": false,
      "hasUrgency": true
    }
    // ... 共15个
  ],
  "descriptions": [
    {
      "text": "Shop our collection of high-performance laptops. Free shipping & 2-year warranty. Order today!",
      "type": "cta",
      "length": 89,
      "hasCTA": true,
      "keywords": ["laptops", "warranty"]
    }
    // ... 共4个
  ],
  "keywords": ["laptop", "premium laptop", "gaming laptop", ...],
  "callouts": ["Free Shipping", "24/7 Support", "2-Year Warranty", ...],
  "sitelinks": [
    {"text": "Shop Laptops", "url": "/laptops", "description": "Browse our full laptop collection"}
  ],
  "theme": "Premium laptop sales with warranty and support",
  "explanation": "Emphasis on quality, value, and customer service with strong urgency elements.",
  "quality_metrics": {
    "headline_diversity_score": 95,
    "keyword_relevance_score": 90,
    "estimated_ad_strength": "EXCELLENT"
  }
}

---

## 重要提示
- 所有文案使用${offer.target_language || 'English'}语言
- Headlines和Descriptions必须符合字符限制（超限将被拒登）
- 确保15个Headlines分布在5种类型且长度梯度合理
- 文本差异化≥80%，避免相似重复
- 自然融入关键词，避免堆砌
- 专业、吸引人、符合广告规范
`

  return prompt
}

/**
 * 使用Vertex AI生成广告创意
 */
async function generateWithVertexAI(
  config: NonNullable<AIConfig['vertexAI']>,
  prompt: string
): Promise<GeneratedAdCreativeData> {
  const { VertexAI } = await import('@google-cloud/vertexai')

  const vertexAI = new VertexAI({
    project: config.projectId,
    location: config.location,
  })

  const model = vertexAI.getGenerativeModel({
    model: config.model,
  })

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 8192,  // 增加以容纳完整创意
    },
  })

  const response = result.response
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text || ''

  // 调试信息：检查响应是否被截断
  const finishReason = response.candidates?.[0]?.finishReason
  console.log(`🔍 Vertex AI finishReason: ${finishReason}`)
  if (finishReason === 'MAX_TOKENS') {
    console.warn('⚠️ 响应因达到token上限而被截断!')
  }

  return parseAIResponse(text)
}

/**
 * 使用Gemini API生成广告创意
 */
async function generateWithGeminiAPI(
  config: NonNullable<AIConfig['geminiAPI']>,
  prompt: string
): Promise<GeneratedAdCreativeData> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')

  const genAI = new GoogleGenerativeAI(config.apiKey)
  const model = genAI.getGenerativeModel({ model: config.model })

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 2048,
    },
  })

  const response = result.response
  const text = response.text()

  return parseAIResponse(text)
}

/**
 * 解析AI响应
 */
function parseAIResponse(text: string): GeneratedAdCreativeData {
  console.log('🔍 AI原始响应长度:', text.length)
  console.log('🔍 AI原始响应前500字符:', text.substring(0, 500))

  // 移除可能的markdown代码块标记
  let jsonText = text.trim()
  jsonText = jsonText.replace(/^```json\n?/, '')
  jsonText = jsonText.replace(/^```\n?/, '')
  jsonText = jsonText.replace(/\n?```$/, '')
  jsonText = jsonText.trim()

  console.log('🔍 清理markdown后长度:', jsonText.length)
  console.log('🔍 清理markdown后前200字符:', jsonText.substring(0, 200))

  // 尝试提取JSON对象（如果AI在JSON前后加了其他文本）
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    jsonText = jsonMatch[0]
    console.log('✅ 成功提取JSON对象，长度:', jsonText.length)
  } else {
    console.warn('⚠️ 未能通过正则提取JSON对象')
  }

  // 修复常见的JSON格式错误
  // 1. 移除尾部逗号（数组和对象中）
  jsonText = jsonText.replace(/,\s*([}\]])/g, '$1')
  // 2. 修复智能引号（替换为标准ASCII引号）
  jsonText = jsonText.replace(/[""]/g, '"')  // 花引号 " " → 直引号 "
  jsonText = jsonText.replace(/['']/g, "'")  // 花单引号 ' ' → 直单引号 '
  // 注意：不再替换换行符和所有单引号，以保留JSON中的撇号和格式

  console.log('🔍 修复后JSON前200字符:', jsonText.substring(0, 200))

  // 临时调试：将JSON写入stderr以便检查
  console.error('🐛 JSON前1000字符:', jsonText.substring(0, 1000))
  console.error('🐛 JSON后500字符:', jsonText.substring(Math.max(0, jsonText.length - 500)))

  try {
    const data = JSON.parse(jsonText)

    // 验证必需字段
    if (!data.headlines || !Array.isArray(data.headlines) || data.headlines.length < 3) {
      throw new Error('Headlines格式无效或数量不足')
    }

    if (!data.descriptions || !Array.isArray(data.descriptions) || data.descriptions.length < 2) {
      throw new Error('Descriptions格式无效或数量不足')
    }

    if (!data.keywords || !Array.isArray(data.keywords)) {
      throw new Error('Keywords格式无效')
    }

    // 处理headlines格式（支持新旧格式）
    let headlinesArray: string[]
    let headlinesWithMetadata: HeadlineAsset[] | undefined

    // 检测格式：第一个元素是string还是object
    const isNewFormat = data.headlines.length > 0 && typeof data.headlines[0] === 'object'

    if (isNewFormat) {
      // 新格式：对象数组（带metadata）
      headlinesWithMetadata = data.headlines as HeadlineAsset[]
      headlinesArray = headlinesWithMetadata.map(h => h.text)
      console.log('✅ 检测到新格式headlines（带metadata）')
    } else {
      // 旧格式：字符串数组
      headlinesArray = data.headlines as string[]
      console.log('✅ 检测到旧格式headlines（字符串数组）')
    }

    // 处理descriptions格式
    let descriptionsArray: string[]
    let descriptionsWithMetadata: DescriptionAsset[] | undefined

    const isDescNewFormat = data.descriptions.length > 0 && typeof data.descriptions[0] === 'object'

    if (isDescNewFormat) {
      descriptionsWithMetadata = data.descriptions as DescriptionAsset[]
      descriptionsArray = descriptionsWithMetadata.map(d => d.text)
      console.log('✅ 检测到新格式descriptions（带metadata）')
    } else {
      descriptionsArray = data.descriptions as string[]
      console.log('✅ 检测到旧格式descriptions（字符串数组）')
    }

    // 验证字符长度
    const invalidHeadlines = headlinesArray.filter((h: string) => h.length > 30)
    if (invalidHeadlines.length > 0) {
      console.warn(`警告: ${invalidHeadlines.length}个headline超过30字符限制`)
      // 截断过长的headlines
      headlinesArray = headlinesArray.map((h: string) => h.substring(0, 30))

      // 同步更新metadata中的text
      if (headlinesWithMetadata) {
        headlinesWithMetadata = headlinesWithMetadata.map(h => ({
          ...h,
          text: h.text.substring(0, 30),
          length: Math.min(h.length || h.text.length, 30)
        }))
      }
    }

    const invalidDescriptions = descriptionsArray.filter((d: string) => d.length > 90)
    if (invalidDescriptions.length > 0) {
      console.warn(`警告: ${invalidDescriptions.length}个description超过90字符限制`)
      // 截断过长的descriptions
      descriptionsArray = descriptionsArray.map((d: string) => d.substring(0, 90))

      // 同步更新metadata中的text
      if (descriptionsWithMetadata) {
        descriptionsWithMetadata = descriptionsWithMetadata.map(d => ({
          ...d,
          text: d.text.substring(0, 90),
          length: Math.min(d.length || d.text.length, 90)
        }))
      }
    }

    // 解析quality_metrics（如果存在）
    const qualityMetrics = data.quality_metrics ? {
      headline_diversity_score: data.quality_metrics.headline_diversity_score,
      keyword_relevance_score: data.quality_metrics.keyword_relevance_score,
      estimated_ad_strength: data.quality_metrics.estimated_ad_strength
    } : undefined

    if (qualityMetrics) {
      console.log('📊 Ad Strength预估:', qualityMetrics.estimated_ad_strength)
      console.log('📊 Headline多样性:', qualityMetrics.headline_diversity_score)
      console.log('📊 关键词相关性:', qualityMetrics.keyword_relevance_score)
    }

    return {
      // 核心字段（向后兼容）
      headlines: headlinesArray,
      descriptions: descriptionsArray,
      keywords: data.keywords,
      callouts: data.callouts,
      sitelinks: data.sitelinks,
      theme: data.theme || '通用广告',
      explanation: data.explanation || '基于产品信息生成的广告创意',

      // 新增字段（可选）
      headlinesWithMetadata,
      descriptionsWithMetadata,
      qualityMetrics
    }
  } catch (error) {
    console.error('解析AI响应失败:', error)
    console.error('原始响应:', jsonText)
    throw new Error(`AI响应解析失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
}

/**
 * 主函数：生成广告创意（带缓存）
 */
export async function generateAdCreative(
  offerId: number,
  userId?: number,
  options?: {
    theme?: string
    referencePerformance?: any
    skipCache?: boolean
  }
): Promise<GeneratedAdCreativeData & { ai_model: string }> {
  // 生成缓存键
  const cacheKey = generateCreativeCacheKey(offerId, options)

  // 检查缓存（除非显式跳过）
  if (!options?.skipCache) {
    const cached = creativeCache.get(cacheKey)
    if (cached) {
      console.log('✅ 使用缓存的广告创意')
      console.log(`   - Cache Key: ${cacheKey}`)
      console.log(`   - Headlines: ${cached.headlines.length}个`)
      console.log(`   - Descriptions: ${cached.descriptions.length}个`)
      return cached
    }
  }

  const db = getDatabase()

  // 获取Offer数据
  const offer = db.prepare(`
    SELECT * FROM offers WHERE id = ?
  `).get(offerId)

  if (!offer) {
    throw new Error('Offer不存在')
  }

  // 构建Prompt
  const prompt = buildAdCreativePrompt(
    offer,
    options?.theme,
    options?.referencePerformance
  )

  // 使用统一AI入口（优先Vertex AI，自动降级到Gemini API）
  if (!userId) {
    throw new Error('生成广告创意需要用户ID，请确保已登录')
  }
  const aiMode = getGeminiMode(userId)
  console.log(`🤖 使用统一AI入口生成广告创意 (${aiMode})...`)

  const responseText = await generateContent({
    model: 'gemini-2.5-pro',
    prompt,
    temperature: 0.9,
    maxOutputTokens: 8192,  // 增加以容纳完整创意（15 headlines + 4 descriptions + keywords + callouts + sitelinks）
  }, userId)

  // 解析AI响应
  const result: GeneratedAdCreativeData = parseAIResponse(responseText)
  const aiModel = `${aiMode}:gemini-2.5-pro`

  console.log('✅ 广告创意生成成功')
  console.log(`   - Headlines: ${result.headlines.length}个`)
  console.log(`   - Descriptions: ${result.descriptions.length}个`)
  console.log(`   - Keywords: ${result.keywords.length}个`)

  // Enrich keywords with search volume data
  let keywordsWithVolume: KeywordWithVolume[] = []
  try {
    const country = (offer as { target_country?: string }).target_country || 'US'
    // Extract language from target_language or default to 'en'
    const lang = ((offer as { target_language?: string }).target_language || 'English').toLowerCase().substring(0, 2)
    const language = lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : lang === 'es' ? 'es' : 'en'

    console.log(`🔍 获取关键词搜索量: ${result.keywords.length}个关键词, 国家=${country}, 语言=${language}`)
    const volumes = await getKeywordSearchVolumes(result.keywords, country, language)

    keywordsWithVolume = volumes.map(v => ({
      keyword: v.keyword,
      searchVolume: v.avgMonthlySearches,
      competition: v.competition,
      competitionIndex: v.competitionIndex
    }))
    console.log(`✅ 关键词搜索量获取完成`)
  } catch (error) {
    console.warn('⚠️ 获取关键词搜索量失败，使用默认值:', error)
    keywordsWithVolume = result.keywords.map(kw => ({ keyword: kw, searchVolume: 0 }))
  }

  // 修正 sitelinks URL 为真实的 offer URL
  if (result.sitelinks && result.sitelinks.length > 0) {
    const offerUrl = (offer as { url?: string }).url
    if (offerUrl) {
      result.sitelinks = result.sitelinks.map(link => {
        let url = link.url || ''

        // 如果是相对路径或localhost路径，转换为offer的真实URL
        if (url.startsWith('/') || url.includes('localhost')) {
          // 从相对路径中提取路径部分
          const path = url.replace(/^https?:\/\/[^\/]+/, '').replace(/^\//, '')

          // 构建完整URL
          const parsedOfferUrl = new URL(offerUrl)
          if (path) {
            // 如果有路径，拼接到offer URL
            url = `${parsedOfferUrl.origin}/${path}`
          } else {
            // 否则直接使用offer URL
            url = offerUrl
          }
        }

        return {
          ...link,
          url
        }
      })

      console.log(`🔗 修正 ${result.sitelinks.length} 个附加链接URL`)
    }
  }

  const fullResult = {
    ...result,
    keywordsWithVolume,
    ai_model: aiModel
  }

  // 缓存结果（1小时TTL）
  creativeCache.set(cacheKey, fullResult)
  console.log(`💾 已缓存广告创意: ${cacheKey}`)

  return fullResult
}

/**
 * 并行生成多个广告创意（优化延迟）
 *
 * @param offerId Offer ID
 * @param count 生成数量（1-3个）
 * @param options 生成选项
 * @returns 生成的创意数组
 */
export async function generateAdCreativesBatch(
  offerId: number,
  userId?: number,
  count: number = 3,
  options?: {
    theme?: string
    referencePerformance?: any
    skipCache?: boolean
  }
): Promise<Array<GeneratedAdCreativeData & { ai_model: string }>> {
  // 限制数量在1-3之间
  const validCount = Math.max(1, Math.min(3, count))

  console.log(`🎨 并行生成 ${validCount} 个广告创意...`)

  // 为每个创意生成不同的主题变体（如果没有指定主题）
  const themes = options?.theme
    ? [options.theme]
    : ['通用广告', '促销活动', '品牌故事']

  // 创建并行生成任务
  const tasks = Array.from({ length: validCount }, (_, index) => {
    const taskOptions = {
      ...options,
      theme: themes[index % themes.length],
      skipCache: options?.skipCache || false
    }

    return generateAdCreative(offerId, userId, taskOptions)
  })

  // 并行执行所有任务
  const startTime = Date.now()
  const results = await Promise.all(tasks)
  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(`✅ ${validCount} 个广告创意生成完成，耗时 ${duration}秒`)
  console.log(`   平均每个: ${(parseFloat(duration) / validCount).toFixed(2)}秒`)

  return results
}
