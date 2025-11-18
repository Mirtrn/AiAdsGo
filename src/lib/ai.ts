import { GoogleGenerativeAI } from '@google/generative-ai'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

export interface ProductInfo {
  brandDescription: string
  uniqueSellingPoints: string
  productHighlights: string
  targetAudience: string
  category?: string
}

/**
 * 使用Gemini AI分析网页内容，提取产品信息
 */
export async function analyzeProductPage(pageData: {
  url: string
  brand: string
  title: string
  description: string
  text: string
}): Promise<ProductInfo> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

    const prompt = `你是一个专业的产品分析师。请分析以下网页内容，提取关键的产品和品牌信息。

网页URL: ${pageData.url}
品牌名称: ${pageData.brand}
页面标题: ${pageData.title}
页面描述: ${pageData.description}

页面文本内容（前10000字符）:
${pageData.text}

请以JSON格式返回以下信息：
{
  "brandDescription": "品牌的整体描述和定位（100-200字，中文）",
  "uniqueSellingPoints": "产品的独特卖点和核心优势（3-5个要点，每个20-50字，中文）",
  "productHighlights": "产品的主要特性和功能亮点（3-5个要点，每个20-50字，中文）",
  "targetAudience": "目标受众群体的特征描述（50-100字，中文）",
  "category": "产品分类（如：安防监控、智能家居、电子产品等，中文）"
}

要求：
1. 所有内容必须使用中文
2. 提取真实的产品信息，不要编造
3. 如果某些信息在页面中找不到，使用合理的推断
4. 描述要专业、准确、简洁
5. 只返回JSON，不要其他文字`

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    // 提取JSON内容
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回格式错误，未找到JSON')
    }

    const productInfo = JSON.parse(jsonMatch[0]) as ProductInfo

    return {
      brandDescription: productInfo.brandDescription || '',
      uniqueSellingPoints: productInfo.uniqueSellingPoints || '',
      productHighlights: productInfo.productHighlights || '',
      targetAudience: productInfo.targetAudience || '',
      category: productInfo.category,
    }
  } catch (error: any) {
    console.error('AI分析失败:', error)
    throw new Error(`AI分析失败: ${error.message}`)
  }
}

/**
 * 生成广告创意（用于后续功能）
 */
export async function generateAdCreatives(productInfo: {
  brand: string
  brandDescription: string
  uniqueSellingPoints: string
  productHighlights: string
  targetAudience: string
  targetCountry: string
}): Promise<{
  headlines: string[]
  descriptions: string[]
}> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

    const prompt = `你是一个专业的Google Ads广告文案撰写专家。请根据以下产品信息，生成高质量的Google搜索广告文案。

品牌名称: ${productInfo.brand}
品牌描述: ${productInfo.brandDescription}
独特卖点: ${productInfo.uniqueSellingPoints}
产品亮点: ${productInfo.productHighlights}
目标受众: ${productInfo.targetAudience}
目标国家: ${productInfo.targetCountry}

请以JSON格式返回广告创意：
{
  "headlines": [
    "标题1（最多30个字符）",
    "标题2（最多30个字符）",
    "标题3（最多30个字符）"
  ],
  "descriptions": [
    "描述1（最多90个字符）",
    "描述2（最多90个字符）"
  ]
}

要求：
1. 标题必须在30个字符以内（包括中文和英文字符）
2. 描述必须在90个字符以内
3. 突出产品的独特价值和优势
4. 使用吸引人的行动号召语
5. 符合Google Ads政策
6. 只返回JSON，不要其他文字`

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    // 提取JSON内容
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回格式错误，未找到JSON')
    }

    const creatives = JSON.parse(jsonMatch[0])

    return {
      headlines: creatives.headlines || [],
      descriptions: creatives.descriptions || [],
    }
  } catch (error: any) {
    console.error('生成广告创意失败:', error)
    throw new Error(`生成广告创意失败: ${error.message}`)
  }
}
