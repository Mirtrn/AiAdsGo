import { getDatabase } from './db'
import type { GeneratedAdCreativeData } from './ad-creative'
import { creativeCache, generateCreativeCacheKey } from './cache'
import { getKeywordSearchVolumes } from './keyword-planner'

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

## 要求
请生成一组完整的Google Ads响应式搜索广告创意，包括：

1. **Headlines** (15个)
   - 每个不超过30个字符
   - 包含品牌名、产品特性、优惠信息、行动号召等多种类型
   - 至少3个包含数字或百分比
   - 至少2个包含紧迫感（如"限时"、"今日"）
   - 确保多样性，避免重复

2. **Descriptions** (4个)
   - 每个不超过90个字符
   - 详细描述产品优势和独特卖点
   - 至少2个包含明确的行动号召（CTA）
   - 突出价值主张和用户利益

3. **Keywords** (10-15个)
   - 与产品高度相关的关键词
   - 包括品牌词、产品词、功能词
   - 考虑长尾关键词

4. **Callouts** (可选，4-6个)
   - 每个不超过25个字符
   - 突出产品特点和服务优势
   - 如：免费配送、24小时客服、质保N年等

5. **Sitelinks** (可选，4个)
   - 每个包含：text（不超过25字符）、url、description（不超过35字符）
   - 链接到产品相关页面（如：产品详情、优惠活动、客户评价、购买指南）

## 输出格式
请严格按照以下JSON格式输出（不要包含markdown代码块标记）：

{
  "headlines": ["headline1", "headline2", ...],
  "descriptions": ["desc1", "desc2", ...],
  "keywords": ["keyword1", "keyword2", ...],
  "callouts": ["callout1", "callout2", ...],
  "sitelinks": [
    {"text": "站点链接1", "url": "/path1", "description": "描述1"},
    {"text": "站点链接2", "url": "/path2", "description": "描述2"}
  ],
  "theme": "广告主题概括",
  "explanation": "创意说明（100字以内）"
}

注意：
- 所有文案使用${offer.target_language || 'English'}语言
- Headlines和Descriptions要符合Google Ads的字符限制
- 确保文案专业、吸引人、符合广告规范
- 避免过度营销或误导性表述
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
      maxOutputTokens: 4096,
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

    // 验证字符长度
    const invalidHeadlines = data.headlines.filter((h: string) => h.length > 30)
    if (invalidHeadlines.length > 0) {
      console.warn(`警告: ${invalidHeadlines.length}个headline超过30字符限制`)
      // 截断过长的headlines
      data.headlines = data.headlines.map((h: string) => h.substring(0, 30))
    }

    const invalidDescriptions = data.descriptions.filter((d: string) => d.length > 90)
    if (invalidDescriptions.length > 0) {
      console.warn(`警告: ${invalidDescriptions.length}个description超过90字符限制`)
      // 截断过长的descriptions
      data.descriptions = data.descriptions.map((d: string) => d.substring(0, 90))
    }

    return {
      headlines: data.headlines,
      descriptions: data.descriptions,
      keywords: data.keywords,
      callouts: data.callouts,
      sitelinks: data.sitelinks,
      theme: data.theme || '通用广告',
      explanation: data.explanation || '基于产品信息生成的广告创意'
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

  // 获取AI配置（用户配置优先）
  const aiConfig = await getAIConfig(userId)

  if (!aiConfig.type) {
    throw new Error('AI配置未设置。请前往设置页面配置Vertex AI或Gemini API。')
  }

  // 构建Prompt
  const prompt = buildAdCreativePrompt(
    offer,
    options?.theme,
    options?.referencePerformance
  )

  // 调用AI生成
  let result: GeneratedAdCreativeData
  let aiModel: string

  if (aiConfig.type === 'vertex-ai' && aiConfig.vertexAI) {
    console.log('🤖 使用Vertex AI生成广告创意...')
    result = await generateWithVertexAI(aiConfig.vertexAI, prompt)
    aiModel = `vertex-ai:${aiConfig.vertexAI.model}`
  } else if (aiConfig.type === 'gemini-api' && aiConfig.geminiAPI) {
    console.log('🤖 使用Gemini API生成广告创意...')
    result = await generateWithGeminiAPI(aiConfig.geminiAPI, prompt)
    aiModel = `gemini-api:${aiConfig.geminiAPI.model}`
  } else {
    throw new Error('AI配置无效')
  }

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
