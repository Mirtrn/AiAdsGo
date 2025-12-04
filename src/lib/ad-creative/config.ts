/**
 * ⚡ P0重构: AI配置管理模块
 * 从ad-creative-generator.ts拆分出AI配置相关逻辑
 */
import { getDatabase } from '../db'

export interface AIConfig {
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
export async function getAIConfig(userId?: number): Promise<AIConfig> {
  const db = await getDatabase()

  // 1. 先尝试获取用户特定配置（优先级最高）
  let userSettings: Record<string, string> = {}
  if (userId) {
    const userRows = await db.query(`
      SELECT config_key, config_value FROM system_settings
      WHERE user_id = ? AND config_key IN (
        'vertex_ai_model', 'gcp_project_id', 'gcp_location',
        'gemini_api_key', 'gemini_model', 'use_vertex_ai'
      )
    `, [userId]) as Array<{ config_key: string; config_value: string }>

    userSettings = userRows.reduce((acc, { config_key, config_value }) => {
      acc[config_key] = config_value
      return acc
    }, {} as Record<string, string>)
  }

  // 2. 获取全局配置（作为备选）
  const globalRows = await db.query(`
    SELECT config_key, config_value FROM system_settings
    WHERE user_id IS NULL AND config_key IN (
      'VERTEX_AI_PROJECT_ID', 'VERTEX_AI_LOCATION', 'VERTEX_AI_MODEL',
      'GEMINI_API_KEY', 'GEMINI_MODEL'
    )
  `) as Array<{ config_key: string; config_value: string }>

  const globalSettings = globalRows.reduce((acc, { config_key, config_value }) => {
    acc[config_key] = config_value
    return acc
  }, {} as Record<string, string>)

  // 3. 检查用户是否配置了使用Vertex AI
  const useVertexAI = userSettings['use_vertex_ai'] === 'true'

  // 4. 合并配置：用户配置优先
  const projectId = userSettings['gcp_project_id'] || globalSettings['VERTEX_AI_PROJECT_ID']
  const location = userSettings['gcp_location'] || globalSettings['VERTEX_AI_LOCATION']
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

  // 6. 检查Gemini API配置（无需use_vertex_ai标志）
  const geminiApiKey = userSettings['gemini_api_key'] || globalSettings['GEMINI_API_KEY']
  const geminiModel = userSettings['gemini_model'] || globalSettings['GEMINI_MODEL'] || 'gemini-2.5-flash'

  if (geminiApiKey) {
    console.log(`🤖 使用Gemini API: 模型=${geminiModel}`)
    return {
      type: 'gemini-api',
      geminiAPI: {
        apiKey: geminiApiKey,
        model: geminiModel
      }
    }
  }

  // 7. 无可用配置
  console.warn('⚠️ 未配置AI服务（Vertex AI 或 Gemini API），将无法生成广告创意')
  return { type: null }
}

/**
 * 获取目标语言的指令文本
 */
export function getLanguageInstruction(targetLanguage: string): string {
  const languageInstructions: Record<string, string> = {
    'English': 'Generate ad copy in English.',
    'Spanish': 'Genera el copy del anuncio en español.',
    'French': 'Générez le contenu publicitaire en français.',
    'German': 'Erstellen Sie den Werbetext auf Deutsch.',
    'Italian': 'Genera il testo pubblicitario in italiano.',
    'Portuguese': 'Gere o texto do anúncio em português.',
    'Dutch': 'Genereer de advertentietekst in het Nederlands.',
    'Polish': 'Wygeneruj treść reklamy po polsku.',
    'Russian': 'Создайте рекламный текст на русском языке.',
    'Japanese': '日本語で広告コピーを生成してください。',
    'Korean': '한국어로 광고 문구를 생성하십시오.',
    'Chinese (Simplified)': '请用简体中文生成广告文案。',
    'Chinese (Traditional)': '請用繁體中文生成廣告文案。',
    'Arabic': 'قم بإنشاء نص الإعلان باللغة العربية.',
    'Hindi': 'विज्ञापन प्रति हिंदी में उत्पन्न करें।',
    'Bengali': 'বাংলায় বিজ্ঞাপন কপি তৈরি করুন।',
    'Turkish': 'Reklam metnini Türkçe olarak oluşturun.',
    'Vietnamese': 'Tạo nội dung quảng cáo bằng tiếng Việt.',
    'Thai': 'สร้างเนื้อหาโฆษณาเป็นภาษาไทย',
    'Indonesian': 'Buat teks iklan dalam bahasa Indonesia.',
    'Malay': 'Hasilkan teks iklan dalam bahasa Melayu.',
    'Swedish': 'Generera annonseringstext på svenska.',
    'Danish': 'Generer annoncetekst på dansk.',
    'Norwegian': 'Generer annonsetekst på norsk.',
    'Finnish': 'Luo mainosteksti suomeksi.',
    'Greek': 'Δημιουργήστε διαφημιστικό κείμενο στα ελληνικά.',
    'Czech': 'Vygenerujte text reklamy v češtině.',
    'Romanian': 'Generați textul publicitar în limba română.',
    'Hungarian': 'Hozzon létre hirdetési szöveget magyarul.',
    'Ukrainian': 'Створіть рекламний текст українською мовою.',
    'Hebrew': 'צור טקסט פרסומי בעברית.',
  }

  return languageInstructions[targetLanguage] || languageInstructions['English']
}
