/**
 * 🔥 创意生成器提示构建模块
 * 从 ad-creative-generator.ts 拆分出来
 *
 * 职责: 构建 AI 提示、格式化关键词、变量注入
 * 遵循 KISS 原则: 清晰的结构，易于维护
 */

import type { PromptVariables, GenerateAdCreativeOptions } from './creative-types'
import { loadPrompt } from '../prompt-loader'

/**
 * 加载提示模板
 * 从数据库或文件加载提示模板
 */
async function loadPromptTemplate(): Promise<string> {
  try {
    // 尝试从数据库加载
    const template = await loadPrompt('ad_creative_generation')
    return template
  } catch (error) {
    console.warn('[loadPromptTemplate] 从数据库加载失败，使用默认模板')

    // 返回默认模板
    return `
你是一个专业的广告创意生成专家。请根据以下信息生成吸引人的广告创意。

产品信息：
- 产品名称：{offer_title}
- 产品类别：{offer_category}
- 产品特性：{product_features}
- 目标受众：{target_audience}
- 品牌名称：{brand_name}

关键词信息：
{extracted_keywords_section}
{ai_keywords_section}

请生成：
1. 5个吸引人的标题（每个不超过30个字符）
2. 2个详细的描述（每个90-100个字符）

要求：
- 突出产品优势和卖点
- 包含相关关键词
- 语言生动有吸引力
- 符合广告政策
    `.trim()
  }
}

/**
 * 注入变量到模板
 * 将变量值替换到模板中
 */
function injectVariables(template: string, variables: PromptVariables): string {
  let result = template

  // 替换所有变量
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{${key}}`
    result = result.replace(new RegExp(placeholder, 'g'), value || '')
  })

  return result
}

/**
 * 格式化关键词为文本
 * 将关键词数组转换为提示文本
 */
function formatKeywordsSection(title: string, keywords: string[]): string {
  if (!keywords || keywords.length === 0) {
    return ''
  }

  return `\n**${title}**:\n${keywords.slice(0, 20).join(', ')}\n`
}

/**
 * 🎯 构建完整提示
 * 整合所有数据源生成 AI 提示
 */
export async function buildPrompt(
  variables: PromptVariables,
  options: GenerateAdCreativeOptions
): Promise<string> {
  console.log('[buildPrompt] 开始构建提示')

  // 1. 加载模板
  const template = await loadPromptTemplate()
  console.log('[buildPrompt] 模板加载完成')

  // 2. 注入变量
  const prompt = injectVariables(template, variables)
  console.log('[buildPrompt] 变量注入完成')

  // 3. 添加主题特定指导（如果有）
  if (options.theme) {
    const themeSection = `\n\n**主题指导**: ${options.theme}\n请确保创意符合此主题。`
    console.log(`[buildPrompt] 添加主题指导: ${options.theme}`)
    return prompt + themeSection
  }

  console.log('[buildPrompt] 提示构建完成')
  return prompt
}

/**
 * 🎯 构建批量生成提示
 * 为批量生成创建优化的提示
 */
export async function buildBatchPrompt(
  variables: PromptVariables,
  count: number,
  options: GenerateAdCreativeOptions
): Promise<string> {
  const basePrompt = await buildPrompt(variables, options)

  const batchSection = `\n\n**批量生成要求**:
- 请生成 ${count} 个不同的创意变化
- 每个创意应该有独特的角度和卖点
- 避免使用相同的词汇和表达
- 保持整体风格一致但内容多样化

请为每个创意编号（1-${count}）并分别生成标题和描述。`

  return basePrompt + batchSection
}

/**
 * 🎯 构建综合创意提示
 * 为综合创意（使用多个桶）生成提示
 */
export async function buildSyntheticPrompt(
  variables: PromptVariables,
  options: GenerateAdCreativeOptions
): Promise<string> {
  const basePrompt = await buildPrompt(variables, options)

  const syntheticSection = `\n\n**综合创意要求**:
- 这是一个综合创意，需要融合多个角度
- 结合品牌、场景和功能三个维度
- 创造一个全面而有吸引力的广告
- 关键词应该自然融入文案中

请生成一个综合性但完整的广告创意。`

  return basePrompt + syntheticSection
}
