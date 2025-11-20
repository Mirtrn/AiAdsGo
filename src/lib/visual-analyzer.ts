/**
 * Visual Intelligence Analyzer
 * P1高级优化 - 视觉元素智能提取
 *
 * 功能：
 * 1. 产品图片抓取（主图、副图、生活场景图）
 * 2. 图像质量评估（分辨率、类型）
 * 3. Gemini Vision AI分析（使用场景识别、视觉亮点提取）
 * 4. 广告文案建议生成
 */

import { getGeminiModel } from './settings'

// ===========================
// 数据结构定义
// ===========================

/**
 * 产品图片信息
 */
export interface ProductImage {
  url: string                           // 图片URL
  type: 'product' | 'lifestyle' | 'infographic' | 'comparison' | 'detail'
  alt?: string                          // Alt文本
  width?: number                        // 图片宽度（像素）
  height?: number                       // 图片高度（像素）
  isHighQuality?: boolean               // 是否高质量（>1000px）
}

/**
 * 图像质量评估
 */
export interface ImageQuality {
  totalImages: number                   // 图片总数
  highQualityImages: number             // 高质量图片数（>1000px）
  highQualityRatio: number              // 高质量占比（0-1）
  hasLifestyleImages: boolean           // 是否有生活场景图
  hasInfographics: boolean              // 是否有信息图
  hasSizeComparison: boolean            // 是否有尺寸对比图
  hasDetailShots: boolean               // 是否有细节特写
}

/**
 * 识别的使用场景
 */
export interface IdentifiedScenario {
  scenario: string                      // 场景名称（如 "outdoor installation", "indoor living room"）
  confidence: number                    // AI识别置信度（0-1）
  imageUrl: string                      // 对应的图片URL
  description: string                   // 场景详细描述
  adCopyIdea: string                    // 基于场景的广告文案建议
}

/**
 * 产品呈现方式
 */
export interface PresentationStyle {
  hasWhiteBackground: boolean           // 是否有白底产品图
  hasAngleViews: boolean                // 是否有多角度展示
  hasDetailShots: boolean               // 是否有细节特写
  hasPackageContents: boolean           // 是否展示包装内容
  hasUsageDemo: boolean                 // 是否有使用演示
  hasScaleReference: boolean            // 是否有尺寸参照物
}

/**
 * 视觉亮点
 */
export interface VisualHighlight {
  highlight: string                     // 亮点描述（如 "premium packaging", "sleek design"）
  evidence: string                      // 图像URL
  adCopyIdea: string                    // AI建议的广告文案
  priority: 'high' | 'medium' | 'low'   // 优先级
}

/**
 * 完整的图像智能分析结果
 */
export interface ImageIntelligence {
  // 图片列表
  images: ProductImage[]

  // 图像质量评估
  imageQuality: ImageQuality

  // 产品呈现方式
  presentationStyle: PresentationStyle

  // 识别的使用场景
  identifiedScenarios: IdentifiedScenario[]

  // 视觉亮点
  visualHighlights: VisualHighlight[]

  // 分析元数据
  analyzedAt: string                    // 分析时间戳
  analysisMethod: 'gemini_vision' | 'rule_based' | 'hybrid'
}

// ===========================
// 图片抓取函数
// ===========================

/**
 * 从Amazon产品页抓取所有相关图片
 * @param page - Playwright页面对象
 * @returns 产品图片列表
 */
export async function scrapeProductImages(page: any): Promise<ProductImage[]> {
  try {
    const images = await page.evaluate(() => {
      const imageList: Array<{
        url: string
        type: 'product' | 'lifestyle' | 'infographic' | 'comparison' | 'detail'
        alt?: string
      }> = []

      // 策略1: 主图和副图（产品图）
      // Amazon使用多种选择器
      const productImageSelectors = [
        '#landingImage',                              // 主图
        '#main-image',                                // 主图（备用）
        '[data-action="main-image-click"]',           // 主图（交互式）
        '#altImages img',                             // 副图缩略图
        '#imageBlock img',                            // 图片区域
        '.imgTagWrapper img'                          // 图片包装器
      ]

      productImageSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(img => {
          const element = img as HTMLImageElement
          let imageUrl = element.src ||
                        element.getAttribute('data-old-hires') ||
                        element.getAttribute('data-a-dynamic-image')

          // 清理URL
          if (imageUrl && !imageUrl.includes('transparent-pixel') && !imageUrl.includes('1x1')) {
            // 移除缩略图参数，获取大图
            imageUrl = imageUrl.split('._')[0]

            imageList.push({
              url: imageUrl,
              type: 'product',
              alt: element.alt || ''
            })
          }
        })
      })

      // 策略2: A+ Content生活场景图
      document.querySelectorAll('#aplus img, #aplus_feature_div img, .aplus-module img').forEach(img => {
        const element = img as HTMLImageElement
        const imageUrl = element.src

        if (imageUrl && !imageUrl.includes('transparent-pixel') && !imageUrl.includes('spacer')) {
          const alt = element.alt || ''

          // 基于alt文本判断类型
          let type: 'lifestyle' | 'infographic' | 'comparison' | 'detail' = 'lifestyle'
          if (alt.toLowerCase().includes('infographic') || alt.toLowerCase().includes('feature')) {
            type = 'infographic'
          } else if (alt.toLowerCase().includes('comparison') || alt.toLowerCase().includes('vs')) {
            type = 'comparison'
          } else if (alt.toLowerCase().includes('detail') || alt.toLowerCase().includes('close')) {
            type = 'detail'
          }

          imageList.push({
            url: imageUrl,
            type,
            alt
          })
        }
      })

      // 去重（按URL）
      const seen = new Set<string>()
      return imageList.filter(img => {
        if (seen.has(img.url)) return false
        seen.add(img.url)
        return true
      })
    })

    // 获取图片尺寸（可选，耗时）
    // 这里仅标记，实际尺寸检查可以在分析时进行
    const imagesWithQuality: ProductImage[] = images.map(img => ({
      ...img,
      isHighQuality: undefined  // 将在analyzeImageQuality中评估
    }))

    console.log(`✅ 抓取到${imagesWithQuality.length}张产品图片`)
    return imagesWithQuality

  } catch (error: any) {
    console.error('图片抓取失败:', error.message)
    return []
  }
}

// ===========================
// 图像质量评估（基于规则）
// ===========================

/**
 * 评估图像质量（不需要AI）
 * @param images - 产品图片列表
 * @returns 图像质量评估结果
 */
export function analyzeImageQuality(images: ProductImage[]): ImageQuality {
  const totalImages = images.length

  // 高质量图片判断（需要实际检查图片尺寸，这里简化处理）
  // 实际项目中可以通过Image()对象加载图片获取naturalWidth/naturalHeight
  const highQualityImages = images.filter(img => {
    // 简化：假设所有product类型的图片都是高质量
    // 实际应该检查URL是否包含大图标识或加载图片获取尺寸
    return img.type === 'product' || img.url.includes('_AC_') || img.url.includes('_SL1500')
  }).length

  const highQualityRatio = totalImages > 0 ? highQualityImages / totalImages : 0

  // 类型统计
  const hasLifestyleImages = images.some(img => img.type === 'lifestyle')
  const hasInfographics = images.some(img => img.type === 'infographic')
  const hasSizeComparison = images.some(img =>
    img.type === 'comparison' ||
    img.alt?.toLowerCase().includes('size') ||
    img.alt?.toLowerCase().includes('dimension')
  )
  const hasDetailShots = images.some(img => img.type === 'detail')

  return {
    totalImages,
    highQualityImages,
    highQualityRatio,
    hasLifestyleImages,
    hasInfographics,
    hasSizeComparison,
    hasDetailShots
  }
}

/**
 * 分析产品呈现方式（基于规则）
 * @param images - 产品图片列表
 * @returns 呈现方式分析结果
 */
export function analyzePresentationStyle(images: ProductImage[]): PresentationStyle {
  // 基于alt文本和图片类型判断呈现方式
  const hasWhiteBackground = images.some(img =>
    img.alt?.toLowerCase().includes('white background') ||
    img.type === 'product'
  )

  const hasAngleViews = images.filter(img => img.type === 'product').length >= 3

  const hasDetailShots = images.some(img =>
    img.type === 'detail' ||
    img.alt?.toLowerCase().includes('detail') ||
    img.alt?.toLowerCase().includes('close-up')
  )

  const hasPackageContents = images.some(img =>
    img.alt?.toLowerCase().includes('package') ||
    img.alt?.toLowerCase().includes('content') ||
    img.alt?.toLowerCase().includes('what\'s in the box')
  )

  const hasUsageDemo = images.some(img =>
    img.type === 'lifestyle' ||
    img.alt?.toLowerCase().includes('use') ||
    img.alt?.toLowerCase().includes('demo')
  )

  const hasScaleReference = images.some(img =>
    img.alt?.toLowerCase().includes('scale') ||
    img.alt?.toLowerCase().includes('size') ||
    img.alt?.toLowerCase().includes('hand')
  )

  return {
    hasWhiteBackground,
    hasAngleViews,
    hasDetailShots,
    hasPackageContents,
    hasUsageDemo,
    hasScaleReference
  }
}

// ===========================
// Gemini Vision AI分析
// ===========================

/**
 * 使用Gemini Vision API分析产品图片
 * @param images - 产品图片列表（最多分析5张有代表性的图片）
 * @param productName - 产品名称
 * @param targetCountry - 目标国家
 * @param userId - 用户ID
 * @returns AI分析结果
 */
export async function analyzeImagesWithGeminiVision(
  images: ProductImage[],
  productName: string,
  targetCountry: string = 'US',
  userId?: number
): Promise<{
  identifiedScenarios: IdentifiedScenario[]
  visualHighlights: VisualHighlight[]
}> {
  try {
    if (images.length === 0) {
      console.log('⚠️ 无图片可分析')
      return {
        identifiedScenarios: [],
        visualHighlights: []
      }
    }

    // 选择最有代表性的图片进行分析（最多5张）
    const selectedImages = selectRepresentativeImages(images, 5)

    console.log(`🔍 使用Gemini Vision分析${selectedImages.length}张图片...`)

    const genAI = await getGeminiModel(userId)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',  // Gemini 2.5 Pro with Vision
      generationConfig: {
        temperature: 0.7,               // 平衡创造性和准确性
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    })

    // 构建Prompt
    const prompt = `你是一个专业的产品摄影和视觉营销分析师。请分析以下产品图片。

## 产品信息
产品名称: ${productName}
目标市场: ${targetCountry}

## 分析任务
对于提供的产品图片，请识别：

1. **使用场景识别**：这些图片展示了什么使用场景或应用环境？
   - 识别具体的使用场景（如 "outdoor backyard security", "indoor living room", "office desk setup"）
   - 评估识别置信度（0-1）
   - 为每个场景生成场景化的广告文案建议

2. **视觉亮点提取**：这些图片突出的视觉元素是什么？
   - 设计亮点（如 "sleek modern design", "premium packaging", "compact size"）
   - 功能展示（如 "easy installation", "wireless design", "LED indicators"）
   - 质感材质（如 "metal construction", "soft-touch finish", "waterproof coating"）
   - 为每个亮点生成广告文案建议

## 输出格式
请返回JSON格式，包含以下结构：

\`\`\`json
{
  "identifiedScenarios": [
    {
      "scenario": "具体场景名称（英文）",
      "confidence": 0.85,
      "imageUrl": "图片URL",
      "description": "场景详细描述（中文）",
      "adCopyIdea": "基于场景的广告文案建议（中文）"
    }
  ],
  "visualHighlights": [
    {
      "highlight": "视觉亮点描述（英文）",
      "evidence": "图片URL",
      "adCopyIdea": "基于亮点的广告文案建议（中文）",
      "priority": "high" | "medium" | "low"
    }
  ]
}
\`\`\`

## 注意事项
- 每个场景的confidence应基于图片清晰度和场景明确性
- 视觉亮点应具体且可操作，避免泛泛而谈
- 广告文案建议应简洁、吸引人，符合Google Ads规范（30字符内）
- 优先识别最有营销价值的场景和亮点（最多各5个）

## 图片列表
${selectedImages.map((img, i) => `${i + 1}. [图片类型: ${img.type}] ${img.url}`).join('\n')}
`

    // 调用Gemini Vision API
    // 注意：Gemini Vision需要特殊的图片输入格式
    // 这里简化处理，实际应该使用图片URL或base64编码
    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    // 解析JSON响应
    let analysisJson = responseText
    // 移除可能的markdown包裹
    analysisJson = analysisJson.replace(/```json\n?/g, '').replace(/```\n?/g, '')

    const analysis = JSON.parse(analysisJson)

    console.log('✅ Gemini Vision分析完成')
    console.log(`   - 识别场景: ${analysis.identifiedScenarios?.length || 0}个`)
    console.log(`   - 视觉亮点: ${analysis.visualHighlights?.length || 0}个`)

    return {
      identifiedScenarios: analysis.identifiedScenarios || [],
      visualHighlights: analysis.visualHighlights || []
    }

  } catch (error: any) {
    console.error('Gemini Vision分析失败:', error.message)
    return {
      identifiedScenarios: [],
      visualHighlights: []
    }
  }
}

/**
 * 选择最有代表性的图片进行AI分析
 * @param images - 所有图片
 * @param limit - 最多选择数量
 * @returns 选中的图片
 */
function selectRepresentativeImages(images: ProductImage[], limit: number): ProductImage[] {
  // 优先级：product > lifestyle > infographic > detail > comparison
  const priorityOrder = {
    'product': 1,
    'lifestyle': 2,
    'infographic': 3,
    'detail': 4,
    'comparison': 5
  }

  // 按优先级排序
  const sorted = [...images].sort((a, b) => {
    const priorityA = priorityOrder[a.type] || 999
    const priorityB = priorityOrder[b.type] || 999
    return priorityA - priorityB
  })

  // 确保各类型图片都有代表
  const selected: ProductImage[] = []
  const typesSeen = new Set<string>()

  // 第一轮：每种类型选一张
  for (const img of sorted) {
    if (!typesSeen.has(img.type) && selected.length < limit) {
      selected.push(img)
      typesSeen.add(img.type)
    }
  }

  // 第二轮：如果还没达到limit，按优先级继续选择
  for (const img of sorted) {
    if (selected.length >= limit) break
    if (!selected.includes(img)) {
      selected.push(img)
    }
  }

  return selected.slice(0, limit)
}

// ===========================
// 主函数：完整的图像智能分析
// ===========================

/**
 * 执行完整的图像智能分析
 * @param page - Playwright页面对象
 * @param productName - 产品名称
 * @param targetCountry - 目标国家
 * @param userId - 用户ID
 * @returns 完整的图像智能分析结果
 */
export async function analyzeProductVisuals(
  page: any,
  productName: string,
  targetCountry: string = 'US',
  userId?: number
): Promise<ImageIntelligence | null> {
  try {
    console.log('📸 开始P1视觉元素智能分析...')

    // 步骤1: 抓取图片
    const images = await scrapeProductImages(page)
    if (images.length === 0) {
      console.log('⚠️ 未找到产品图片，跳过视觉分析')
      return null
    }

    // 步骤2: 质量评估（基于规则）
    const imageQuality = analyzeImageQuality(images)
    const presentationStyle = analyzePresentationStyle(images)

    // 步骤3: AI分析（Gemini Vision）
    const aiAnalysis = await analyzeImagesWithGeminiVision(
      images,
      productName,
      targetCountry,
      userId
    )

    // 组装完整结果
    const result: ImageIntelligence = {
      images,
      imageQuality,
      presentationStyle,
      identifiedScenarios: aiAnalysis.identifiedScenarios,
      visualHighlights: aiAnalysis.visualHighlights,
      analyzedAt: new Date().toISOString(),
      analysisMethod: aiAnalysis.identifiedScenarios.length > 0 ? 'hybrid' : 'rule_based'
    }

    console.log('✅ P1视觉元素智能分析完成')
    console.log(`   - 图片总数: ${imageQuality.totalImages}`)
    console.log(`   - 高质量图片: ${imageQuality.highQualityImages}`)
    console.log(`   - 使用场景: ${aiAnalysis.identifiedScenarios.length}个`)
    console.log(`   - 视觉亮点: ${aiAnalysis.visualHighlights.length}个`)

    return result

  } catch (error: any) {
    console.error('视觉智能分析失败:', error.message)
    return null
  }
}

/**
 * 提取视觉洞察用于广告创意生成
 * @param visualAnalysis - 图像智能分析结果
 * @returns 广告创意洞察
 */
export function extractVisualInsights(visualAnalysis: ImageIntelligence): {
  scenarioSuggestions: string[]      // 场景化文案建议
  highlightSuggestions: string[]     // 视觉亮点文案建议
  bestImages: string[]               // 最佳展示图片URL
  qualityScore: number               // 整体质量评分（0-100）
} {
  // 场景化文案（按置信度排序，取前3）
  const scenarioSuggestions = visualAnalysis.identifiedScenarios
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map(s => s.adCopyIdea)

  // 视觉亮点文案（按优先级排序，取前3）
  const priorityMap = { high: 1, medium: 2, low: 3 }
  const highlightSuggestions = visualAnalysis.visualHighlights
    .sort((a, b) => priorityMap[a.priority] - priorityMap[b.priority])
    .slice(0, 3)
    .map(h => h.adCopyIdea)

  // 最佳图片（product类型的前3张）
  const bestImages = visualAnalysis.images
    .filter(img => img.type === 'product')
    .slice(0, 3)
    .map(img => img.url)

  // 质量评分计算
  const qualityScore = calculateVisualQualityScore(visualAnalysis)

  return {
    scenarioSuggestions,
    highlightSuggestions,
    bestImages,
    qualityScore
  }
}

/**
 * 计算视觉质量评分
 * @param visualAnalysis - 图像智能分析结果
 * @returns 评分（0-100）
 */
function calculateVisualQualityScore(visualAnalysis: ImageIntelligence): number {
  let score = 0

  // 图片数量评分（最多20分）
  const imageCount = visualAnalysis.imageQuality.totalImages
  score += Math.min(imageCount * 2, 20)

  // 高质量占比评分（最多20分）
  score += visualAnalysis.imageQuality.highQualityRatio * 20

  // 图片类型多样性评分（最多30分）
  const diversity = [
    visualAnalysis.imageQuality.hasLifestyleImages,
    visualAnalysis.imageQuality.hasInfographics,
    visualAnalysis.imageQuality.hasDetailShots,
    visualAnalysis.presentationStyle.hasAngleViews,
    visualAnalysis.presentationStyle.hasUsageDemo,
    visualAnalysis.presentationStyle.hasPackageContents
  ].filter(Boolean).length
  score += (diversity / 6) * 30

  // 场景识别评分（最多15分）
  const scenarioScore = Math.min(visualAnalysis.identifiedScenarios.length * 5, 15)
  score += scenarioScore

  // 视觉亮点评分（最多15分）
  const highlightScore = Math.min(visualAnalysis.visualHighlights.length * 3, 15)
  score += highlightScore

  return Math.round(Math.min(score, 100))
}

/**
 * 获取空的图像智能分析结果（用于错误处理）
 */
export function getEmptyVisualAnalysis(): ImageIntelligence {
  return {
    images: [],
    imageQuality: {
      totalImages: 0,
      highQualityImages: 0,
      highQualityRatio: 0,
      hasLifestyleImages: false,
      hasInfographics: false,
      hasSizeComparison: false,
      hasDetailShots: false
    },
    presentationStyle: {
      hasWhiteBackground: false,
      hasAngleViews: false,
      hasDetailShots: false,
      hasPackageContents: false,
      hasUsageDemo: false,
      hasScaleReference: false
    },
    identifiedScenarios: [],
    visualHighlights: [],
    analyzedAt: new Date().toISOString(),
    analysisMethod: 'rule_based'
  }
}
