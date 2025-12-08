/**
 * Ad Creative Generator - AI Configuration
 *
 * AI configuration management for Vertex AI and Gemini API
 * 优先级：用户配置 > 全局配置
 * 优先使用Vertex AI，其次使用Gemini API
 */

import { getDatabase } from '../db'
import type { AIConfig } from './types'

/**
 * 获取AI配置（从settings表）
 * 优先级：用户配置 > 全局配置
 */
export async function getAIConfig(userId?: number): Promise<AIConfig> {
  const db = await getDatabase()

  // 1. 先尝试获取用户特定配置（优先级最高）
  let userSettings: Record<string, string> = {}
  if (userId) {
    const userRows = await db.query(`
      SELECT key, value FROM system_settings
      WHERE user_id = ? AND key IN (
        'vertex_ai_model', 'gcp_project_id', 'gcp_location',
        'gemini_api_key', 'gemini_model', 'use_vertex_ai'
      )
    `, [userId]) as Array<{ key: string; value: string }>

    userSettings = userRows.reduce((acc, { key, value }) => {
      acc[key] = value
      return acc
    }, {} as Record<string, string>)
  }

  // 2. 获取全局配置（作为备选）
  const globalRows = await db.query(`
    SELECT key, value FROM system_settings
    WHERE user_id IS NULL AND key IN (
      'VERTEX_AI_PROJECT_ID', 'VERTEX_AI_LOCATION', 'VERTEX_AI_MODEL',
      'GEMINI_API_KEY', 'GEMINI_MODEL'
    )
  `, []) as Array<{ key: string; value: string }>

  const globalSettings = globalRows.reduce((acc, { key, value }) => {
    acc[key] = value
    return acc
  }, {} as Record<string, string >)

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
 * 获取语言指令 - 确保 AI 生成指定语言的内容
 */
export function getLanguageInstruction(targetLanguage: string): string {
  const lang = targetLanguage.toLowerCase()

  if (lang.includes('italian') || lang === 'it') {
    return `🔴 IMPORTANT: Generate ALL content in ITALIAN ONLY.
- Headlines: Italian
- Descriptions: Italian
- Keywords: Italian (e.g., "robot aspirapolvere", "aspirapolvere intelligente", not "robot vacuum")
- Callouts: Italian
- Sitelinks: Italian
Do NOT use English words or mix languages. Every single word must be in Italian.`
  } else if (lang.includes('spanish') || lang === 'es') {
    return `🔴 IMPORTANT: Generate ALL content in SPANISH ONLY.
- Headlines: Spanish
- Descriptions: Spanish
- Keywords: Spanish (e.g., "robot aspirador", "aspirador inteligente", not "robot vacuum")
- Callouts: Spanish
- Sitelinks: Spanish
Do NOT use English words or mix languages. Every single word must be in Spanish.`
  } else if (lang.includes('french') || lang === 'fr') {
    return `🔴 IMPORTANT: Generate ALL content in FRENCH ONLY.
- Headlines: French
- Descriptions: French
- Keywords: French (e.g., "robot aspirateur", "aspirateur intelligent", not "robot vacuum")
- Callouts: French
- Sitelinks: French
Do NOT use English words or mix languages. Every single word must be in French.`
  } else if (lang.includes('german') || lang === 'de') {
    return `🔴 IMPORTANT: Generate ALL content in GERMAN ONLY.
- Headlines: German
- Descriptions: German
- Keywords: German (e.g., "Staubsauger-Roboter", "intelligenter Staubsauger", not "robot vacuum")
- Callouts: German
- Sitelinks: German
Do NOT use English words or mix languages. Every single word must be in German.`
  } else if (lang.includes('portuguese') || lang === 'pt') {
    return `🔴 IMPORTANT: Generate ALL content in PORTUGUESE ONLY.
- Headlines: Portuguese
- Descriptions: Portuguese
- Keywords: Portuguese (e.g., "robô aspirador", "aspirador inteligente", not "robot vacuum")
- Callouts: Portuguese
- Sitelinks: Portuguese
Do NOT use English words or mix languages. Every single word must be in Portuguese.`
  } else if (lang.includes('japanese') || lang === 'ja') {
    return `🔴 IMPORTANT: Generate ALL content in JAPANESE ONLY.
- Headlines: Japanese
- Descriptions: Japanese
- Keywords: Japanese (e.g., "ロボット掃除機", "スマート掃除機", not "robot vacuum")
- Callouts: Japanese
- Sitelinks: Japanese
Do NOT use English words or mix languages. Every single word must be in Japanese.`
  } else if (lang.includes('korean') || lang === 'ko') {
    return `🔴 IMPORTANT: Generate ALL content in KOREAN ONLY.
- Headlines: Korean
- Descriptions: Korean
- Keywords: Korean (e.g., "로봇 청소기", "스마트 청소기", not "robot vacuum")
- Callouts: Korean
- Sitelinks: Korean
Do NOT use English words or mix languages. Every single word must be in Korean.`
  } else if (lang.includes('russian') || lang === 'ru') {
    return `🔴 IMPORTANT: Generate ALL content in RUSSIAN ONLY.
- Headlines: Russian
- Descriptions: Russian
- Keywords: Russian (e.g., "робот-пылесос", "умный пылесос", not "robot vacuum")
- Callouts: Russian
- Sitelinks: Russian
Do NOT use English words or mix languages. Every single word must be in Russian.`
  } else if (lang.includes('arabic') || lang === 'ar') {
    return `🔴 IMPORTANT: Generate ALL content in ARABIC ONLY.
- Headlines: Arabic
- Descriptions: Arabic
- Keywords: Arabic (e.g., "روبوت مكنسة", "مكنسة ذكية", not "robot vacuum")
- Callouts: Arabic
- Sitelinks: Arabic
Do NOT use English words or mix languages. Every single word must be in Arabic.`
  } else if (lang.includes('chinese') || lang === 'zh') {
    return `🔴 IMPORTANT: Generate ALL content in CHINESE ONLY.
- Headlines: Chinese
- Descriptions: Chinese
- Keywords: Chinese (e.g., "扫地机器人", "智能吸尘器", not "robot vacuum")
- Callouts: Chinese
- Sitelinks: Chinese
Do NOT use English words or mix languages. Every single word must be in Chinese.`
  } else if (lang.includes('swedish') || lang === 'sv') {
    return `🔴 IMPORTANT: Generate ALL content in SWEDISH ONLY.
- Headlines: Swedish
- Descriptions: Swedish
- Keywords: Swedish (e.g., "robotdammsugare", "smart dammsugare", not "robot vacuum")
- Callouts: Swedish
- Sitelinks: Swedish
Do NOT use English words or mix languages. Every single word must be in Swedish.`
  } else if (lang.includes('swiss german') || lang === 'de-ch') {
    return `🔴 IMPORTANT: Generate ALL content in SWISS GERMAN ONLY.
- Headlines: Swiss German
- Descriptions: Swiss German
- Keywords: Swiss German (e.g., "Roboter-Staubsauger", "intelligenter Staubsauger", not "robot vacuum")
- Callouts: Swiss German
- Sitelinks: Swiss German
Do NOT use English words or mix languages. Every single word must be in Swiss German.`
  }

  // Default to English
  return `Generate content in English.`
}
