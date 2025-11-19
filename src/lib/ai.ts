import { generateContent } from './gemini-axios'

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

    // 需求12：使用Gemini 2.5 Pro稳定版模型（带代理支持 + 自动降级）
    const text = await generateContent({
      model: 'gemini-2.5-pro',
      prompt,
      temperature: 0.7,
      maxOutputTokens: 2048,
    })

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
 * 生成广告创意（支持从历史创意学习）
 * 增强版：支持广告导向（brand/product/promo）和更丰富的广告元素
 * P0-2优化：集成品牌真实服务验证
 */
export async function generateAdCreatives(
  productInfo: {
    brand: string
    brandDescription: string
    uniqueSellingPoints: string
    productHighlights: string
    targetAudience: string
    targetCountry: string
    websiteUrl?: string // P0-2: 用于提取真实服务
  },
  options?: {
    userId?: number
    orientation?: 'brand' | 'product' | 'promo'
    validateServices?: boolean // P0-2: 是否验证服务真实性
  }
): Promise<{
  headlines: string[]
  descriptions: string[]
  callouts: string[]
  sitelinks: Array<{ title: string; description?: string }>
  usedLearning: boolean
  servicesValidated?: boolean // P0-2: 是否进行了服务验证
  validationResults?: { validCallouts: string[]; invalidCallouts: string[] } // P0-2: 验证结果
}> {
  try {
    // P1-3优化：为三种广告导向创建差异化Prompt模板
    const orientationConfig = {
      brand: {
        guidance: '重点突出品牌知名度、品牌价值和信任度',
        headlineStrategy: '标题应强调品牌名称、品牌历史、品牌荣誉、官方认证等信任要素',
        descriptionStrategy: '描述应突出品牌故事、品牌承诺、品牌优势、行业地位等建立信任的内容',
        calloutStrategy: '宣传信息应体现品牌权威性，如"官方旗舰店"、"行业领先"、"百万用户信赖"、"品牌保障"等',
        sitelinkStrategy: '附加链接应引导至品牌介绍、品牌历史、客户评价、品牌承诺等建立信任的页面',
        examples: {
          headline: '${productInfo.brand}官方旗舰店 | 品质保证',
          callout: '官方认证、品牌保障、行业领先、百万用户'
        }
      },
      product: {
        guidance: '重点突出产品功能、特性和差异化优势',
        headlineStrategy: '标题应强调产品功能、技术参数、独特特性、产品优势等具体卖点',
        descriptionStrategy: '描述应详细说明产品特性、使用场景、技术优势、与竞品的差异化等',
        calloutStrategy: '宣传信息应体现产品特性，如"高性能"、"智能控制"、"长续航"、"轻薄便携"等',
        sitelinkStrategy: '附加链接应引导至产品详情、技术规格、使用指南、产品对比等功能介绍页面',
        examples: {
          headline: '${productInfo.productHighlights}的最佳选择',
          callout: '高性能、智能化、长续航、轻薄设计'
        }
      },
      promo: {
        guidance: '重点突出优惠、折扣和限时促销信息',
        headlineStrategy: '标题应强调折扣力度、限时优惠、促销活动、赠品福利等吸引点击的元素',
        descriptionStrategy: '描述应详细说明优惠详情、活动时间、优惠条件、额外福利等促销信息',
        calloutStrategy: '宣传信息应体现促销吸引力，如"限时折扣"、"满减优惠"、"免费赠品"、"新客专享"等',
        sitelinkStrategy: '附加链接应引导至促销活动页、优惠券领取、限时特价、会员专享等优惠页面',
        examples: {
          headline: '限时优惠！立享8折 | ${productInfo.brand}',
          callout: '限时折扣、满减优惠、免费赠品、新客专享'
        }
      }
    }

    const currentOrientation = options?.orientation || 'brand'
    const config = orientationConfig[currentOrientation]
    const guidance = config.guidance

    // P0-2: 提取品牌真实服务（如果提供了websiteUrl且开启验证）
    let realServices: string[] = []
    let servicesValidated = false

    if (options?.validateServices && productInfo.websiteUrl) {
      try {
        const { extractBrandServices, servicesToWhitelist, generateCalloutSuggestions, generateSitelinkSuggestions } =
          await import('./brand-services-extractor')

        const services = await extractBrandServices(
          productInfo.websiteUrl,
          productInfo.targetCountry
        )

        realServices = servicesToWhitelist(services)
        servicesValidated = realServices.length > 0

        console.log(`✅ 提取到${realServices.length}个真实服务:`, realServices)
      } catch (error) {
        console.warn('提取品牌服务失败，使用通用生成:', error)
        // 继续使用通用生成，不中断流程
      }
    }

    // P1-3优化：根据广告导向生成差异化Prompt
    let basePrompt = `你是一个专业的Google Ads广告文案撰写专家。请根据以下产品信息，生成高质量的Google搜索广告文案。

## 产品信息
品牌名称: ${productInfo.brand}
品牌描述: ${productInfo.brandDescription}
独特卖点: ${productInfo.uniqueSellingPoints}
产品亮点: ${productInfo.productHighlights}
目标受众: ${productInfo.targetAudience}
目标国家: ${productInfo.targetCountry}

## 广告导向（P1-3优化）
类型: ${currentOrientation === 'brand' ? '品牌导向' : currentOrientation === 'product' ? '产品导向' : '促销导向'}
策略: ${guidance}

### 标题策略
${config.headlineStrategy}

### 描述策略
${config.descriptionStrategy}

### 宣传信息策略
${config.calloutStrategy}

### 附加链接策略
${config.sitelinkStrategy}

### 参考示例
${currentOrientation === 'brand' ? `
标题示例: "${productInfo.brand}官方旗舰店 | 品质保证"
宣传信息示例: "官方认证、品牌保障、行业领先、百万用户信赖"
` : currentOrientation === 'product' ? `
标题示例: "${productInfo.productHighlights} | 专业之选"
宣传信息示例: "高性能、智能化、长续航、轻薄设计"
` : `
标题示例: "限时优惠！立享8折 | ${productInfo.brand}"
宣传信息示例: "限时折扣、满减优惠、免费赠品、新客专享"
`}

## 输出格式
请以JSON格式返回完整的广告创意元素：
{
  "headlines": [
    "标题1（最多30个字符）",
    "标题2（最多30个字符）",
    "标题3（最多30个字符）"
  ],
  "descriptions": [
    "描述1（最多90个字符）",
    "描述2（最多90个字符）"
  ],
  "callouts": [
    "宣传信息1（最多25个字符）",
    "宣传信息2（最多25个字符）",
    "宣传信息3（最多25个字符）",
    "宣传信息4（最多25个字符）"
  ],
  "sitelinks": [
    { "title": "链接文字1（最多25个字符）", "description": "链接描述1（最多35个字符）" },
    { "title": "链接文字2（最多25个字符）", "description": "链接描述2（最多35个字符）" },
    { "title": "链接文字3（最多25个字符）", "description": "链接描述3（最多35个字符）" },
    { "title": "链接文字4（最多25个字符）", "description": "链接描述4（最多35个字符）" }
  ]
}

## 质量要求
1. 标题必须在30个字符以内
2. 描述必须在90个字符以内
3. 宣传信息（Callouts）每条最多25个字符，必须基于品牌描述和产品亮点中的真实信息
4. 附加链接（Sitelinks）标题最多25个字符，描述最多35个字符，必须基于真实的品牌信息
5. 突出产品的独特价值和优势
6. 使用吸引人的行动号召语
7. 严格遵守上述${currentOrientation === 'brand' ? '品牌导向' : currentOrientation === 'product' ? '产品导向' : '促销导向'}策略
8. 符合Google Ads政策
9. 只返回JSON，不要其他文字
10. Callouts和Sitelinks必须真实可信，不要编造不存在的服务或承诺`

    // P0-2: 如果提取到真实服务，添加白名单约束
    if (realServices.length > 0) {
      basePrompt += `

## ⚠️ 重要：真实服务白名单（必须遵守）

我们从品牌官网提取到以下真实服务和承诺，生成的Callouts和Sitelinks必须基于这些真实信息：

可用服务列表：${realServices.join(', ')}

要求：
1. Callouts必须从上述真实服务中选择，不要编造不存在的服务
2. Sitelinks的描述也要基于这些真实服务
3. 如果某个服务不在列表中，绝对不要使用
4. 可以使用同义词或简化表达，但核心承诺必须真实`
    }

    let usedLearning = false

    // 如果提供userId，使用历史创意学习优化Prompt
    if (options?.userId) {
      try {
        const { getUserOptimizedPrompt } = await import('./creative-learning')
        const optimizedPrompt = getUserOptimizedPrompt(options.userId, basePrompt)
        if (optimizedPrompt !== basePrompt) {
          basePrompt = optimizedPrompt
          usedLearning = true
        }
      } catch (learningError) {
        console.warn('创意学习模块加载失败，使用基础Prompt:', learningError)
        // 继续使用基础Prompt
      }
    }

    // 需求12：使用Gemini 2.5 Pro实验版模型（带代理支持 + 自动降级）
    const text = await generateContent({
      model: 'gemini-2.5-pro',
      prompt: basePrompt,
      temperature: 0.7,
      maxOutputTokens: 2048,
    })

    // 提取JSON内容
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回格式错误，未找到JSON')
    }

    const creatives = JSON.parse(jsonMatch[0])

    // P0-2: 验证生成的Callouts（如果开启了服务验证）
    let validationResults
    let finalCallouts = creatives.callouts || []

    if (servicesValidated && realServices.length > 0) {
      const { validateAgainstWhitelist } = await import('./brand-services-extractor')
      const validation = validateAgainstWhitelist(finalCallouts, realServices)

      validationResults = {
        validCallouts: validation.valid,
        invalidCallouts: validation.invalid
      }

      // 如果有无效的callout，记录警告（但不阻止流程）
      if (validation.invalid.length > 0) {
        console.warn('⚠️ 发现无法验证的Callouts:', validation.invalid)
        // 可以选择过滤掉无效callouts，或保留（这里保留，让用户决定）
      }

      console.log('✅ Callouts验证通过:', validation.valid)
    }

    return {
      headlines: creatives.headlines || [],
      descriptions: creatives.descriptions || [],
      callouts: finalCallouts,
      sitelinks: creatives.sitelinks || [],
      usedLearning,
      servicesValidated,
      validationResults
    }
  } catch (error: any) {
    console.error('生成广告创意失败:', error)
    throw new Error(`生成广告创意失败: ${error.message}`)
  }
}
