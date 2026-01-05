/**
 * Ad Strength评估器 - 本地评估算法
 *
 * 基于Google Ads Ad Strength标准的7维度评分系统（优化版）：
 * 1. Diversity (18%) - 资产多样性
 * 2. Relevance (18%) - 关键词相关性
 * 3. Brand Search Volume (18%) - 品牌搜索量
 * 4. Completeness (14%) - 资产完整性
 * 5. Quality (14%) - 内容质量
 * 6. Compliance (8%) - 政策合规性
 * 7. Competitive Positioning (10%) - 竞争定位 [NEW]
 *
 * 输出：0-100分 + POOR/AVERAGE/GOOD/EXCELLENT评级
 */

import type {
  HeadlineAsset,
  DescriptionAsset,
  QualityMetrics
} from './ad-creative'
import { getKeywordSearchVolumes } from './keyword-planner'
import { getUserAuthType } from './google-ads-oauth'
import { normalizeLanguageCode } from './language-country-codes'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'

/**
 * Ad Strength评级标准
 */
export type AdStrengthRating = 'PENDING' | 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT'

/**
 * 完整评估结果
 */
export interface AdStrengthEvaluation {
  // 总体评分
  overallScore: number // 0-100
  rating: AdStrengthRating

  // 各维度得分
  dimensions: {
    diversity: {
      score: number // 0-18
      weight: 0.18
      details: {
        typeDistribution: number // 0-7.2 资产类型分布
        lengthDistribution: number // 0-7.2 长度梯度
        textUniqueness: number // 0-3.6 文本独特性
      }
    }
    relevance: {
      score: number // 0-18
      weight: 0.18
      details: {
        keywordCoverage: number // 0-10 关键词覆盖率
        keywordEmbedding: number // 0-4 关键词嵌入率得分 (v3.3新增)
        keywordEmbeddingRate: number // 0-100 关键词嵌入率百分比 (v3.3新增)
        keywordNaturalness: number // 0-6 关键词自然度
        productFocus: number // 0-4 单品聚焦度 (v4.18新增) - 检查创意是否100%聚焦单品
      }
    }
    completeness: {
      score: number // 0-14
      weight: 0.14
      details: {
        assetCount: number // 0-8.4 资产数量
        characterCompliance: number // 0-5.6 字符合规性
      }
    }
    quality: {
      score: number // 0-14
      weight: 0.14
      details: {
        numberUsage: number // 0-3.73 数字使用
        ctaPresence: number // 0-3.73 CTA存在
        urgencyExpression: number // 0-2.8 紧迫感表达
        differentiation: number // 0-3.73 差异化表达
      }
    }
    compliance: {
      score: number // 0-8
      weight: 0.08
      details: {
        policyAdherence: number // 0-4.8 政策遵守
        noSpamWords: number // 0-3.2 无垃圾词汇
      }
    }
    brandSearchVolume: {
      score: number // 0-18
      weight: 0.18
      details: {
        brandNameSearchVolume: number // 品牌名搜索量（如 "Nike"）
        brandKeywordSearchVolume: number // 品牌关键词搜索量总和（如 "Nike运动鞋" + "Nike鞋"）
        totalBrandSearchVolume: number // 两者之和
        volumeLevel: 'micro' | 'small' | 'medium' | 'large' | 'xlarge' // 流量级别
        dataSource: 'keyword_planner' | 'cached' | 'database' | 'unavailable' // 数据来源
      }
    }
    competitivePositioning: {
      score: number // 0-10
      weight: 0.10
      details: {
        priceAdvantage: number // 0-3 价格优势量化
        uniqueMarketPosition: number // 0-3 独特市场定位
        competitiveComparison: number // 0-2 竞品对比暗示
        valueEmphasis: number // 0-2 性价比强调
      }
    }
  }

  // 资产级别评分（可选）
  assetScores?: {
    headlines: Array<{
      text: string
      score: number
      issues: string[]
      suggestions: string[]
    }>
    descriptions: Array<{
      text: string
      score: number
      issues: string[]
      suggestions: string[]
    }>
  }

  // 改进建议
  suggestions: string[]
}

/**
 * 多语言CTA词汇表（行动召唤）
 * 支持: 英语、中文、日语、韩语、德语、法语、西班牙语、意大利语、葡萄牙语、
 *       荷兰语、瑞典语、挪威语、丹麦语、芬兰语、波兰语、俄语、阿拉伯语、土耳其语、越南语、泰语
 */
const MULTILINGUAL_CTA_WORDS: Record<string, string[]> = {
  // 英语
  en: ['shop now', 'buy now', 'get', 'order', 'learn more', 'sign up', 'try', 'start', 'subscribe', 'download', 'join', 'discover', 'explore', 'save', 'claim'],
  // 中文
  zh: ['立即购买', '马上购买', '立即下单', '获取', '了解更多', '注册', '免费试用', '开始', '订阅', '下载', '加入', '探索', '省钱', '领取', '抢购', '点击', '立刻'],
  // 日语
  ja: ['今すぐ購入', '購入する', 'ご注文', '詳しく', '登録', '試す', '始める', 'ダウンロード', '参加', '発見', '探索', '節約', '申し込む', 'クリック'],
  // 韩语
  ko: ['지금 구매', '구매하기', '주문', '자세히', '가입', '시작', '다운로드', '참여', '발견', '탐색', '절약', '신청', '클릭'],
  // 德语
  de: ['jetzt kaufen', 'kaufen', 'bestellen', 'mehr erfahren', 'anmelden', 'testen', 'starten', 'herunterladen', 'beitreten', 'entdecken', 'sparen', 'sichern', 'holen'],
  // 法语
  fr: ['acheter maintenant', 'acheter', 'commander', 'en savoir plus', 'inscrivez-vous', 'essayer', 'commencer', 'télécharger', 'rejoindre', 'découvrir', 'économiser', 'obtenir'],
  // 西班牙语
  es: ['comprar ahora', 'comprar', 'pedir', 'más información', 'registrarse', 'probar', 'empezar', 'descargar', 'unirse', 'descubrir', 'ahorrar', 'obtener', 'solicitar'],
  // 意大利语
  it: ['acquista ora', 'acquista', 'compra', 'ordina', 'scopri di più', 'iscriviti', 'prova', 'inizia', 'scarica', 'unisciti', 'scopri', 'risparmia', 'ottieni', 'richiedi'],
  // 葡萄牙语
  pt: ['comprar agora', 'comprar', 'pedir', 'saiba mais', 'inscreva-se', 'experimentar', 'começar', 'baixar', 'participar', 'descobrir', 'economizar', 'obter'],
  // 荷兰语
  nl: ['nu kopen', 'kopen', 'bestellen', 'meer informatie', 'aanmelden', 'proberen', 'starten', 'downloaden', 'deelnemen', 'ontdekken', 'besparen', 'krijgen'],
  // 瑞典语
  sv: ['köp nu', 'köp', 'beställ', 'läs mer', 'registrera', 'prova', 'börja', 'ladda ner', 'gå med', 'upptäck', 'spara', 'hämta'],
  // 挪威语
  no: ['kjøp nå', 'kjøp', 'bestill', 'les mer', 'registrer', 'prøv', 'start', 'last ned', 'bli med', 'oppdag', 'spar', 'få'],
  // 丹麦语
  da: ['køb nu', 'køb', 'bestil', 'læs mere', 'tilmeld', 'prøv', 'start', 'download', 'deltag', 'opdag', 'spar', 'få'],
  // 芬兰语
  fi: ['osta nyt', 'osta', 'tilaa', 'lue lisää', 'rekisteröidy', 'kokeile', 'aloita', 'lataa', 'liity', 'löydä', 'säästä', 'hanki'],
  // 波兰语
  pl: ['kup teraz', 'kup', 'zamów', 'dowiedz się więcej', 'zarejestruj', 'wypróbuj', 'zacznij', 'pobierz', 'dołącz', 'odkryj', 'oszczędź', 'otrzymaj'],
  // 俄语
  ru: ['купить сейчас', 'купить', 'заказать', 'узнать больше', 'зарегистрироваться', 'попробовать', 'начать', 'скачать', 'присоединиться', 'открыть', 'сэкономить', 'получить'],
  // 阿拉伯语
  ar: ['اشتري الآن', 'اشتري', 'اطلب', 'اعرف المزيد', 'سجل', 'جرب', 'ابدأ', 'حمل', 'انضم', 'اكتشف', 'وفر', 'احصل'],
  // 土耳其语
  tr: ['şimdi satın al', 'satın al', 'sipariş ver', 'daha fazla bilgi', 'kaydol', 'dene', 'başla', 'indir', 'katıl', 'keşfet', 'tasarruf et', 'al'],
  // 越南语
  vi: ['mua ngay', 'mua', 'đặt hàng', 'tìm hiểu thêm', 'đăng ký', 'thử', 'bắt đầu', 'tải xuống', 'tham gia', 'khám phá', 'tiết kiệm', 'nhận'],
  // 泰语
  th: ['ซื้อเลย', 'ซื้อ', 'สั่งซื้อ', 'เรียนรู้เพิ่มเติม', 'สมัคร', 'ลอง', 'เริ่มต้น', 'ดาวน์โหลด', 'เข้าร่วม', 'ค้นพบ', 'ประหยัด', 'รับ']
}

/**
 * 多语言紧迫感词汇表
 */
const MULTILINGUAL_URGENCY_WORDS: Record<string, string[]> = {
  // 英语
  en: ['limited', 'today', 'now', 'hurry', 'exclusive', 'only', 'sale ends', 'last chance', 'don\'t miss', 'ending soon', 'while supplies last', 'act fast', 'urgent', 'final'],
  // 中文
  zh: ['限时', '今天', '立即', '马上', '独家', '仅剩', '即将结束', '最后机会', '不要错过', '抢购', '限量', '紧急', '最后', '倒计时', '仅限今日', '错过不再'],
  // 日语
  ja: ['限定', '今日', '今すぐ', '急いで', '独占', 'のみ', 'セール終了', '最後のチャンス', 'お見逃しなく', '間もなく終了', '在庫限り', '急げ', '緊急', '最終'],
  // 韩语
  ko: ['한정', '오늘', '지금', '서둘러', '독점', '단독', '세일 종료', '마지막 기회', '놓치지 마세요', '곧 종료', '재고 한정', '급하게', '긴급', '마지막'],
  // 德语
  de: ['begrenzt', 'heute', 'jetzt', 'schnell', 'exklusiv', 'nur', 'angebot endet', 'letzte chance', 'nicht verpassen', 'bald endend', 'solange vorrat', 'eilen', 'dringend', 'letzte'],
  // 法语
  fr: ['limité', 'aujourd\'hui', 'maintenant', 'vite', 'exclusif', 'seulement', 'offre expire', 'dernière chance', 'ne manquez pas', 'bientôt terminé', 'stock limité', 'urgent', 'final'],
  // 西班牙语
  es: ['limitado', 'hoy', 'ahora', 'rápido', 'exclusivo', 'solo', 'oferta termina', 'última oportunidad', 'no te pierdas', 'pronto termina', 'existencias limitadas', 'urgente', 'final'],
  // 意大利语
  it: ['limitato', 'oggi', 'ora', 'subito', 'esclusivo', 'solo', 'offerta scade', 'ultima occasione', 'non perdere', 'tempo limitato', 'scorte limitate', 'urgente', 'ultimi', 'pochi pezzi', 'a breve'],
  // 葡萄牙语
  pt: ['limitado', 'hoje', 'agora', 'rápido', 'exclusivo', 'apenas', 'oferta termina', 'última chance', 'não perca', 'em breve', 'estoque limitado', 'urgente', 'final'],
  // 荷兰语
  nl: ['beperkt', 'vandaag', 'nu', 'snel', 'exclusief', 'alleen', 'aanbieding eindigt', 'laatste kans', 'mis het niet', 'binnenkort eindigend', 'beperkte voorraad', 'urgent', 'laatste'],
  // 瑞典语
  sv: ['begränsad', 'idag', 'nu', 'snabbt', 'exklusiv', 'endast', 'erbjudandet slutar', 'sista chansen', 'missa inte', 'snart slut', 'begränsat lager', 'brådskande', 'sista'],
  // 挪威语
  no: ['begrenset', 'i dag', 'nå', 'fort', 'eksklusiv', 'kun', 'tilbudet slutter', 'siste sjanse', 'ikke gå glipp av', 'snart slutt', 'begrenset lager', 'haster', 'siste'],
  // 丹麦语
  da: ['begrænset', 'i dag', 'nu', 'hurtigt', 'eksklusiv', 'kun', 'tilbuddet slutter', 'sidste chance', 'gå ikke glip af', 'snart slut', 'begrænset lager', 'haster', 'sidste'],
  // 芬兰语
  fi: ['rajoitettu', 'tänään', 'nyt', 'nopeasti', 'eksklusiivinen', 'vain', 'tarjous päättyy', 'viimeinen mahdollisuus', 'älä missaa', 'pian päättyy', 'rajoitettu varasto', 'kiireellinen', 'viimeinen'],
  // 波兰语
  pl: ['ograniczone', 'dziś', 'teraz', 'szybko', 'ekskluzywne', 'tylko', 'oferta kończy się', 'ostatnia szansa', 'nie przegap', 'wkrótce kończy się', 'ograniczone zapasy', 'pilne', 'ostatni'],
  // 俄语
  ru: ['ограничено', 'сегодня', 'сейчас', 'быстро', 'эксклюзивно', 'только', 'акция заканчивается', 'последний шанс', 'не пропустите', 'скоро закончится', 'ограниченный запас', 'срочно', 'последний'],
  // 阿拉伯语
  ar: ['محدود', 'اليوم', 'الآن', 'سريعا', 'حصري', 'فقط', 'العرض ينتهي', 'الفرصة الأخيرة', 'لا تفوت', 'ينتهي قريبا', 'مخزون محدود', 'عاجل', 'أخير'],
  // 土耳其语
  tr: ['sınırlı', 'bugün', 'şimdi', 'hızlı', 'özel', 'sadece', 'teklif bitiyor', 'son şans', 'kaçırma', 'yakında bitiyor', 'sınırlı stok', 'acil', 'son'],
  // 越南语
  vi: ['giới hạn', 'hôm nay', 'ngay', 'nhanh', 'độc quyền', 'chỉ', 'ưu đãi kết thúc', 'cơ hội cuối', 'đừng bỏ lỡ', 'sắp kết thúc', 'số lượng có hạn', 'khẩn cấp', 'cuối cùng'],
  // 泰语
  th: ['จำกัด', 'วันนี้', 'ตอนนี้', 'เร็ว', 'พิเศษ', 'เท่านั้น', 'ข้อเสนอสิ้นสุด', 'โอกาสสุดท้าย', 'อย่าพลาด', 'ใกล้หมด', 'สต็อกจำกัด', 'ด่วน', 'สุดท้าย']
}

/**
 * 扩展的技术规格词汇（支持更多产品类别）
 */
const TECH_SPECS_PATTERN = /4k|8k|hd|uhd|fhd|qhd|ai|wifi|wi-fi|bluetooth|5g|lte|4g|3g|poe|nvr|dvr|fps|mp|ghz|mhz|mah|wh|watts|w\b|ip\d{2}|usb|hdmi|type-c|thunderbolt|\d+pa|\d+rpm|\d+db|nfc|gps|oled|amoled|lcd|led|\d+hz|\d+bit|\d+gb|\d+tb|\d+mb|ssd|hdd|ddr\d|ram|rom|\d+mp|\d+mm|\d+cm/i

/**
 * 扩展的独特功能词汇（多语言支持）
 */
const UNIQUE_FEATURES_PATTERNS: Record<string, RegExp> = {
  en: /no subscription|subscription.free|solar.powered|battery.powered|wireless|waterproof|water.resistant|night.vision|motion.detection|two.way.audio|cloud.storage|local.storage|voice.control|smart.home|all.in.one|self.cleaning|auto.empty|hands.free/i,
  zh: /免订阅|免费订阅|太阳能|电池供电|无线|防水|夜视|移动检测|双向语音|云存储|本地存储|语音控制|智能家居|一体机|自清洁|自动清空|免手动/i,
  ja: /サブスク不要|ソーラー|バッテリー|ワイヤレス|防水|ナイトビジョン|動体検知|双方向音声|クラウド|ローカル|音声制御|スマートホーム|オールインワン|自動清掃|自動ゴミ収集|ハンズフリー/i,
  ko: /구독 불필요|태양열|배터리|무선|방수|야간 시야|동작 감지|양방향 오디오|클라우드|로컬|음성 제어|스마트홈|올인원|자동 청소|자동 비움|핸즈프리/i,
  de: /ohne abo|solar|akku|kabellos|wasserdicht|nachtsicht|bewegungserkennung|zwei.wege.audio|cloud|lokal|sprachsteuerung|smart home|all.in.one|selbstreinigend|automatisch/i,
  fr: /sans abonnement|solaire|batterie|sans fil|étanche|vision nocturne|détection mouvement|audio bidirectionnel|cloud|local|contrôle vocal|maison intelligente|tout.en.un|auto.nettoyant|automatique/i,
  es: /sin suscripción|solar|batería|inalámbrico|impermeable|visión nocturna|detección movimiento|audio bidireccional|nube|local|control voz|hogar inteligente|todo.en.uno|auto.limpieza|automático/i,
  it: /senza abbonamento|solare|batteria|wireless|senza fili|impermeabile|visione notturna|rilevamento movimento|audio bidirezionale|cloud|locale|controllo vocale|casa intelligente|all.in.one|tutto.in.uno|auto.pulizia|automatico|svuota|lava|asciuga/i,
  pt: /sem assinatura|solar|bateria|sem fio|à prova d'água|visão noturna|detecção movimento|áudio bidirecional|nuvem|local|controle voz|casa inteligente|tudo.em.um|auto.limpeza|automático/i
}

/**
 * 禁用词清单（Google Ads政策违规）
 */
const FORBIDDEN_WORDS = [
  // 绝对化词汇
  '100%', '最佳', '第一', '保证', '必须',
  'best in the world', 'number one', 'guaranteed',

  // 夸大表述
  '奇迹', '魔法', '神奇', '完美',
  'miracle', 'magic', 'perfect',

  // 误导性词汇
  '免费', '赠送', '白拿',
  'free money', 'get rich quick'
]

/**
 * 主评估函数
 */
export async function evaluateAdStrength(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[],
  options?: {
    brandName?: string
    targetCountry?: string
    targetLanguage?: string
    userId?: number
    sitelinks?: Array<{ text: string; url: string; description?: string }>
    callouts?: string[]
    // [NEW] 关键词搜索量数据（用于品牌关键词搜索量评分）
    keywordsWithVolume?: Array<{
      keyword: string
      searchVolume: number
    }>
  }
): Promise<AdStrengthEvaluation> {

  // 1. Diversity维度 (18%)
  const diversityRaw = calculateDiversity(headlines, descriptions)
  const diversity = {
    score: Math.round(diversityRaw.score * 0.9), // 20分 * 0.9 = 18分
    weight: 0.18 as const,
    details: diversityRaw.details
  }

  // 2. Relevance维度 (18%)
  const relevanceRaw = calculateRelevance(headlines, descriptions, keywords, options?.sitelinks, options?.callouts)
  const relevance = {
    score: Math.round(relevanceRaw.score * 0.9), // 20分 * 0.9 = 18分
    weight: 0.18 as const,
    details: relevanceRaw.details
  }

  // 3. Completeness维度 (14%)
  const completenessRaw = calculateCompleteness(headlines, descriptions)
  const completeness = {
    score: Math.round(completenessRaw.score * 0.933), // 15分 * 0.933 = 14分
    weight: 0.14 as const,
    details: completenessRaw.details
  }

  // 4. Quality维度 (14%)
  const qualityRaw = calculateQuality(headlines, descriptions, options?.brandName)
  const quality = {
    score: Math.round(qualityRaw.score * 0.933), // 15分 * 0.933 = 14分
    weight: 0.14 as const,
    details: qualityRaw.details
  }

  // 5. Compliance维度 (8%)
  const complianceRaw = calculateCompliance(headlines, descriptions)
  const compliance = {
    score: Math.round(complianceRaw.score * 0.8), // 10分 * 0.8 = 8分
    weight: 0.08 as const,
    details: complianceRaw.details
  }

  // 6. Brand Search Volume维度 (18%) - [NEW] 融入品牌关键词搜索量
  const brandSearchVolumeRaw = await calculateBrandSearchVolume(
    options?.brandName,
    options?.targetCountry || 'US',
    options?.targetLanguage || 'en',
    options?.userId,
    options?.keywordsWithVolume
  )
  const brandSearchVolume = {
    score: Math.round(brandSearchVolumeRaw.score * 0.9), // 20分 * 0.9 = 18分
    weight: 0.18 as const,
    details: brandSearchVolumeRaw.details
  }

  // 7. Competitive Positioning维度 (10%) - 新增
  const competitivePositioning = await calculateCompetitivePositioning(headlines, descriptions, options?.userId)

  // 计算总分（100分制）
  const overallScore = diversity.score + relevance.score + completeness.score + quality.score + compliance.score + brandSearchVolume.score + competitivePositioning.score

  // 确定评级
  const rating = scoreToRating(overallScore)

  // 生成改进建议
  const suggestions = generateSuggestions(diversity, relevance, completeness, quality, compliance, brandSearchVolume, competitivePositioning, rating)

  return {
    overallScore: Math.round(overallScore),
    rating,
    dimensions: {
      diversity,
      relevance,
      completeness,
      quality,
      compliance,
      brandSearchVolume,
      competitivePositioning
    },
    suggestions
  }
}

/**
 * 1. 计算Diversity（多样性）- 20分
 */
function calculateDiversity(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  // 1.1 资产类型分布 (0-8分)
  const headlineTypes = new Set(headlines.map(h => h.type).filter(Boolean))
  let typeDistribution = Math.min(8, headlineTypes.size * 1.6) // 5种类型 * 1.6分/种

  // 优化：如果所有headlines都没有type属性，使用启发式规则估算多样性
  if (headlineTypes.size === 0 && headlines.length >= 10) {
    console.log('⚠️ Headlines缺少type属性，使用启发式规则评估多样性')

    // 基于文本内容的多样性评估
    const hasNumbers = headlines.filter(h => /\d/.test(h.text)).length
    const hasCTA = headlines.filter(h => /shop|buy|get|order|now/i.test(h.text)).length
    const hasUrgency = headlines.filter(h => /limited|today|only|exclusive/i.test(h.text)).length
    const hasBrand = headlines.filter(h => h.text.length < 25).length // 短标题通常是品牌类

    // 估算类型数量（每满足一个特征算1种类型）
    const estimatedTypes = [hasNumbers > 0, hasCTA > 0, hasUrgency > 0, hasBrand > 3].filter(Boolean).length
    typeDistribution = Math.min(8, estimatedTypes * 1.6 + 1.6) // 基础分1.6分

    console.log(`   估算类型数: ${estimatedTypes}, 多样性得分: ${typeDistribution}`)
  } else if (headlineTypes.size > 0) {
    console.log(`✅ Headlines类型分布: ${Array.from(headlineTypes).join(', ')} (${headlineTypes.size}种)`)
  }

  // 1.2 长度梯度分布 (0-8分)
  const lengthCategories = {
    short: headlines.filter(h => (h.length || h.text.length) <= 20).length,
    medium: headlines.filter(h => {
      const len = h.length || h.text.length
      return len > 20 && len <= 25
    }).length,
    long: headlines.filter(h => (h.length || h.text.length) > 25).length
  }

  console.log(`📏 长度分布: 短=${lengthCategories.short}, 中=${lengthCategories.medium}, 长=${lengthCategories.long}`)

  // 理想：短5 中5 长5，每个分类达标得2.67分
  const lengthScore =
    Math.min(2.67, lengthCategories.short / 5 * 2.67) +
    Math.min(2.67, lengthCategories.medium / 5 * 2.67) +
    Math.min(2.66, lengthCategories.long / 5 * 2.66)

  // 1.3 文本独特性 (0-4分)
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)]
  const uniqueness = calculateTextUniqueness(allTexts)
  const textUniqueness = uniqueness * 4 // 0-1 转为 0-4

  console.log(`🎨 文本独特性: ${(uniqueness * 100).toFixed(1)}% (得分: ${textUniqueness.toFixed(1)})`)

  const totalScore = typeDistribution + lengthScore + textUniqueness

  return {
    score: Math.min(20, Math.round(totalScore)), // 确保不超过最大值20
    weight: 0.20 as const,
    details: {
      typeDistribution: Math.round(typeDistribution),
      lengthDistribution: Math.round(lengthScore),
      textUniqueness: Math.round(textUniqueness * 10) / 10
    }
  }
}

/**
 * 2. 计算Relevance（相关性）- 20分
 *
 * v3.3 CTR优化：新增关键词嵌入率检测
 * - 目标：8/15 headlines包含关键词 (53%+)
 * - 这是Google Ads RSA的最佳实践
 *
 * v4.18新增：单品聚焦度检查
 */
function calculateRelevance(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[],
  sitelinks?: Array<{ text: string; url: string; description?: string }>,
  callouts?: string[]
) {
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)].join(' ').toLowerCase()

  // 2.1 关键词覆盖率 (0-10分) - 优化：支持词形变化和部分匹配
  const matchedKeywords = keywords.filter(kw => {
    const kwLower = kw.toLowerCase()

    // 精确匹配
    if (allTexts.includes(kwLower)) return true

    // 词形变化匹配（单复数、ing形式等）
    const kwRoot = kwLower.replace(/s$|ing$|ed$/g, '') // 简单词根提取
    if (kwRoot.length >= 3 && allTexts.includes(kwRoot)) return true

    // 部分匹配（关键词是文本中某个词的一部分）
    const words = allTexts.split(/\s+/)
    if (words.some(word => word.includes(kwLower) || kwLower.includes(word))) return true

    return false
  })

  const coverageRatio = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0
  const keywordCoverage = coverageRatio * 10 // 降低到10分，为嵌入率腾出空间

  // 调试输出
  if (coverageRatio < 0.8) {
    const unmatchedKeywords = keywords.filter(kw => !matchedKeywords.includes(kw))
    console.log(`⚠️ 关键词覆盖率偏低: ${(coverageRatio * 100).toFixed(0)}%`)
    console.log(`   匹配成功: ${matchedKeywords.join(', ')}`)
    console.log(`   匹配失败: ${unmatchedKeywords.join(', ')}`)
  }

  // 2.2 关键词嵌入率 (0-4分) - v3.3 CTR优化新增
  // 目标：8/15 headlines (53%+) 包含关键词
  const headlinesWithKeyword = headlines.filter(h => {
    const headlineText = h.text.toLowerCase()
    return keywords.some(kw => {
      const kwLower = kw.toLowerCase()
      // 精确匹配
      if (headlineText.includes(kwLower)) return true
      // 词根匹配
      const kwRoot = kwLower.replace(/s$|ing$|ed$/g, '')
      if (kwRoot.length >= 3 && headlineText.includes(kwRoot)) return true
      return false
    })
  })

  const embeddingRate = headlines.length > 0 ? headlinesWithKeyword.length / headlines.length : 0
  const targetEmbeddingRate = 8 / 15 // 53%

  // 评分：达到53%得满分4分，低于则按比例扣分
  let keywordEmbedding = 0
  if (embeddingRate >= targetEmbeddingRate) {
    keywordEmbedding = 4
  } else if (embeddingRate >= 0.4) {
    keywordEmbedding = 3
  } else if (embeddingRate >= 0.27) {
    keywordEmbedding = 2
  } else if (embeddingRate > 0) {
    keywordEmbedding = 1
  }

  console.log(`🔑 关键词嵌入率: ${headlinesWithKeyword.length}/${headlines.length} (${(embeddingRate * 100).toFixed(0)}%)`)
  if (embeddingRate < targetEmbeddingRate) {
    console.log(`   ⚠️ 低于目标 ${(targetEmbeddingRate * 100).toFixed(0)}%，建议增加关键词嵌入`)
  } else {
    console.log(`   ✅ 达到目标嵌入率`)
  }

  // 2.3 关键词自然度 (0-6分)
  // 检查关键词是否自然融入（非堆砌）
  const keywordDensity = calculateKeywordDensity(allTexts, keywords)
  const naturalness = keywordDensity < 0.3 ? 6 : (keywordDensity < 0.5 ? 4 : 2) // 密度低于30%最佳

  // 2.4 单品聚焦度 (0-4分) - v4.18新增
  // 检查创意是否100%聚焦单品，排除其他品类
  const productFocus = calculateProductFocus(headlines, descriptions, sitelinks, callouts)

  const totalScore = keywordCoverage + keywordEmbedding + naturalness + productFocus.score

  return {
    score: Math.min(20, Math.round(totalScore)), // 确保不超过最大值20
    weight: 0.20 as const,
    details: {
      keywordCoverage: Math.round(keywordCoverage),
      keywordEmbedding: Math.round(keywordEmbedding), // v3.3新增
      keywordEmbeddingRate: Math.round(embeddingRate * 100), // v3.3新增：百分比
      keywordNaturalness: Math.round(naturalness),
      productFocus: Math.round(productFocus.score) // v4.18新增
    }
  }
}

/**
 * 3. 计算Completeness（完整性）- 15分
 */
function calculateCompleteness(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  // 3.1 资产数量 (0-9分)
  const headlineCount = Math.min(15, headlines.length)
  const descriptionCount = Math.min(4, descriptions.length)
  const assetCount = (headlineCount / 15 * 6.75) + (descriptionCount / 4 * 2.25) // Headlines占6.75分，Descriptions占2.25分

  // 3.2 字符合规性 (0-6分)
  const headlineCompliance = headlines.filter(h => {
    const len = h.length || h.text.length
    return len >= 10 && len <= 30
  }).length / headlines.length

  const descriptionCompliance = descriptions.filter(d => {
    const len = d.length || d.text.length
    return len >= 60 && len <= 90
  }).length / descriptions.length

  const characterCompliance = (headlineCompliance * 3.75) + (descriptionCompliance * 2.25)

  const totalScore = assetCount + characterCompliance

  return {
    score: Math.min(15, Math.round(totalScore)), // 确保不超过最大值15
    weight: 0.15 as const,
    details: {
      assetCount: Math.round(assetCount),
      characterCompliance: Math.round(characterCompliance)
    }
  }
}

/**
 * 4. 计算Quality（质量）- 15分
 *
 * 子维度：
 * - 数字使用 (4分): 具体的数字增强可信度（如 "4K", "24/7", "30-Day"）
 * - CTA存在 (4分): 行动召唤提升转化率
 * - 紧迫感 (3分): 时效性表达增加紧迫性
 * - 差异化 (4分): 突出独特卖点，避免通用表达（NEW）
 */
function calculateQuality(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  brandName?: string,
  productData?: any // 产品数据（用于USP分析）
) {
  // 4.1 数字使用 (0-4分) - 降低权重，从5分改为4分
  const headlinesWithNumbers = headlines.filter(h => h.hasNumber || /\d/.test(h.text)).length
  const numberUsage = Math.min(4, headlinesWithNumbers / 3 * 4) // 至少3个含数字得满分

  // 4.2 CTA存在 (0-4分) - 降低权重，从5分改为4分
  const descriptionsWithCTA = descriptions.filter(d =>
    d.hasCTA || /shop now|buy now|get|order|learn more|sign up|try|start/i.test(d.text)
  ).length
  const ctaPresence = Math.min(4, descriptionsWithCTA / 2 * 4) // 至少2个含CTA得满分

  // 4.3 紧迫感表达 (0-3分) - 降低权重，从5分改为3分
  const headlinesWithUrgency = headlines.filter(h =>
    h.hasUrgency || /limited|today|now|hurry|exclusive|only|sale ends/i.test(h.text)
  ).length
  const urgencyExpression = Math.min(3, headlinesWithUrgency / 2 * 3) // 至少2个含紧迫感得满分

  // 4.4 差异化表达 (0-4分) - 新增维度
  const differentiation = calculateDifferentiation(headlines, descriptions, brandName, productData)

  const totalScore = numberUsage + ctaPresence + urgencyExpression + differentiation

  console.log(`📊 Quality子维度:`)
  console.log(`   - 数字使用: ${numberUsage.toFixed(1)}/4 (${headlinesWithNumbers}个标题含数字)`)
  console.log(`   - CTA存在: ${ctaPresence.toFixed(1)}/4 (${descriptionsWithCTA}个描述含CTA)`)
  console.log(`   - 紧迫感: ${urgencyExpression.toFixed(1)}/3 (${headlinesWithUrgency}个标题含紧迫感)`)
  console.log(`   - 差异化: ${differentiation.toFixed(1)}/4`)

  return {
    score: Math.min(15, Math.round(totalScore)), // 确保不超过最大值15
    weight: 0.15 as const,
    details: {
      numberUsage: Math.round(numberUsage * 10) / 10,
      ctaPresence: Math.round(ctaPresence * 10) / 10,
      urgencyExpression: Math.round(urgencyExpression * 10) / 10,
      differentiation: Math.round(differentiation * 10) / 10
    }
  }
}

/**
 * 4.4 计算差异化表达 (0-4分)
 *
 * 评估创意是否突出产品独特卖点（USP），避免过于通用的表达
 */
function calculateDifferentiation(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  brandName?: string,
  productData?: any
): number {
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)].join(' ').toLowerCase()
  let score = 0

  // 1. 技术规格提及 (+1.5分)
  // 检查是否提到具体的技术参数（4K, HD, AI, WiFi, Bluetooth, 5G, LTE等）
  const techSpecs = /4k|8k|hd|uhd|ai|wifi|bluetooth|5g|lte|4g|poe|nvr|dvr|fps|mp|ghz|mah|watts|ip\d{2}/i
  const hasTechSpecs = techSpecs.test(allTexts)
  if (hasTechSpecs) {
    score += 1.5
    console.log(`   ✅ 提及技术规格 (+1.5分)`)
  }

  // 2. 独特功能提及 (+1.5分)
  // 检查是否提到独特的功能特性（no subscription, solar, battery, wireless, waterproof, night vision等）
  const uniqueFeatures = /no subscription|subscription.free|solar.powered|battery.powered|wireless|waterproof|night.vision|motion.detection|two.way.audio|cloud.storage|local.storage|voice.control|smart.home/i
  const hasUniqueFeatures = uniqueFeatures.test(allTexts)
  if (hasUniqueFeatures) {
    score += 1.5
    console.log(`   ✅ 提及独特功能 (+1.5分)`)
  }

  // 3. 避免过于通用的标题 (+1分)
  // 检查是否存在过于通用的标题（"Buy Now", "Shop Now", "Best Quality", "Trusted Brand"等）
  const genericPhrases = [
    /^buy now$/i,
    /^shop now$/i,
    /^get yours$/i,
    /^trusted [\w\s]+$/i, // "Trusted Security Cameras"
    /^best [\w\s]+$/i,    // "Best Quality Products"
    /^high quality$/i,
    /^premium [\w\s]+$/i,
    /^top rated$/i,
    /^official site$/i    // "Official Site"
  ]

  const genericHeadlineCount = headlines.filter(h => {
    const text = h.text.trim()
    return genericPhrases.some(pattern => pattern.test(text))
  }).length

  if (genericHeadlineCount === 0) {
    score += 1
    console.log(`   ✅ 无通用标题 (+1分)`)
  } else if (genericHeadlineCount <= 2) {
    score += 0.5
    console.log(`   ⚠️ ${genericHeadlineCount}个通用标题 (+0.5分)`)
  } else {
    console.log(`   ❌ ${genericHeadlineCount}个通用标题 (+0分)`)
  }

  // 确保分数在0-4之间
  return Math.min(4, Math.max(0, score))
}

/**
 * 5. 计算Competitive Positioning（竞争定位）- 10分
 *
 * 【方案B：混合架构 - 支持全球所有语言】
 *
 * 第一层：快速通用检测（0成本，支持所有语言）
 *   - 通用货币符号 + 数字检测（支持€£$¥₹₽฿元等）
 *   - 常见独特性词汇（20+语言）
 *   - 对比关键词（replace, substitute等）
 *
 * 第二层：AI增强分析（按需触发）
 *   - 当快速检测分数 > 6分时触发
 *   - 使用Gemini进行深度语义分析
 *   - 结果缓存避免重复调用
 *
 * 评估广告文案中的竞品差异化和市场定位表达
 */
async function calculateCompetitivePositioning(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  userId?: number
): Promise<{
  score: number
  weight: 0.10
  details: {
    priceAdvantage: number
    uniqueMarketPosition: number
    competitiveComparison: number
    valueEmphasis: number
  }
}> {
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)].join(' ')
  const allTextsLower = allTexts.toLowerCase()

  let priceAdvantage = 0
  let uniqueMarketPosition = 0
  let competitiveComparison = 0
  let valueEmphasis = 0

  console.log('🎯 评估竞争定位维度 (混合方案 - 全语言支持):')

  // ========================================
  // 第一层：快速通用检测（支持所有语言）
  // ========================================

  // 1. 价格优势量化检测 (0-3分)
  // 通用货币符号 + 数字模式（支持全球所有货币）
  const universalCurrencyPattern = /(?:€|£|\$|¥|₹|₽|฿|₪|₩|元|円|圓|บาท|रु|руб)\s*\d+|\d+\s*(?:€|£|\$|¥|₹|₽|฿|₪|₩|元|円|圓|บาท|रु|руб)/

  // 常见"节省"关键词（20+语言）
  const savingsKeywords = /(?:save|risparmia|ahorra|économise?|sparen|economize|bespaar|сэкономить|節約|절약|ประหยัด|توفير|חסוך|tasarruf|spara|gem|חיסכון|tiết kiệm|menjimat|save|discount|sconto|descuento|réduction|rabatt|desconto|korting|скидка|割引|할인|ส่วนลด|خصم|הנחה|indirim|rabat|छूट|giảm giá|diskaun)/i

  // 百分比折扣模式（如 "Save 20%", "20% off", "20% discount"）
  const percentagePattern = /(?:save|discount|off|减|折扣|割引|할인|ส่วนลด|خصم|הנחה|indirim|छूट|giảm|diskaun)?\s*(\d{1,2})%/i

  // "No fees" / "Zero cost" 模式（明确的零成本承诺）
  const noFeesPattern = /(?:no|zero|without|免|無|なし|없음|ไม่มี|بدون|ללא|yok|बिना|không|tanpa)\s+(?:monthly\s+)?(?:fees?|cost|charge|price|subscription|月费|费用|料金|수수료|ค่าธรรมเนียม|رسوم|עמלה|ücret|शुल्क|phí|bayaran)/i

  // "Free" 相关模式（免费福利）
  const freePattern = /\bfree\s+(?:shipping|delivery|trial|returns?|installation|warranty|support|训练|运费|配送|试用|退货|安装|保修|サポート|無料|무료|ฟรี|مجاني|חינם|ücretsiz|मुफ़्त|miễn phí|percuma)\b/i

  // 优先检测高价值量化模式
  const hasQuantifiedSavings = universalCurrencyPattern.test(allTexts) && savingsKeywords.test(allTextsLower)
  const hasPercentageDiscount = percentagePattern.test(allTexts)
  const hasNoFees = noFeesPattern.test(allTextsLower)
  const hasFreeOffer = freePattern.test(allTextsLower)

  if (hasQuantifiedSavings || hasPercentageDiscount || hasNoFees) {
    priceAdvantage = 3
    if (hasQuantifiedSavings) console.log('   ✅ 价格优势量化（货币+节省） (+3分)')
    if (hasPercentageDiscount) console.log('   ✅ 价格优势量化（百分比折扣） (+3分)')
    if (hasNoFees) console.log('   ✅ 价格优势量化（零费用承诺） (+3分)')
  } else if (hasFreeOffer) {
    priceAdvantage = 2.5
    console.log('   ✅ 免费福利（Free offer） (+2.5分)')
  } else if (savingsKeywords.test(allTextsLower) || /best value|affordable|budget|cheap|economic|便宜|实惠|划算|お得|저렴|ราคาถูก|رخيص|זול|ucuz|billig|goedkoop|дешевый|barato|bon marché|economico|सस्ता|rẻ|murah/i.test(allTextsLower)) {
    priceAdvantage = 1.5
    console.log('   ⚠️ 价格优势非量化（通用检测） (+1.5分)')
  } else {
    console.log('   ❌ 无价格优势表达 (+0分)')
  }

  // 2. 独特市场定位检测 (0-3分)
  // 常见"唯一/独特"关键词（20+语言）
  const uniquenessKeywords = /(?:only|unique|exclusive|first|sole|unico|unica|único|única|einzig|exclusivo|exclusiva|seul|seule|единственный|唯一|独家|専用|のみ|유일|독점|เท่านั้น|พิเศษ|الوحيد|حصري|יחיד|בלעדי|tek|sadece|एकमात्र|विशेष|duy nhất|độc quyền|eksklusif|tunggal|exclusief|eneste|unik|ainoa|enda|μόνο|μοναδικό|jedyny|wyłączny)/i

  // 常见"第一/领先"关键词
  const leadershipKeywords = /#1|numero\s*1|number\s*one|第一|ナンバーワン|넘버원|อันดับ\s*1|رقم\s*1|מספר\s*1|1\s*numaralı|नंबर\s*1|số\s*1|nombor\s*1|primeiro|primero|erste|premier|première|первый|πρώτο|pierwszy/i

  // "Official" 官方店铺/授权经销商
  const officialPattern = /\bofficial\s+(?:store|shop|seller|dealer|partner|retailer)|authorized\s+(?:dealer|seller|retailer)|官方|正規店|공식|อย่างเป็นทางการ|رسمي|רשמי|resmi|официальный|chính thức|rasmi\b/i

  // 技术规格/等级标识（如 IK10, IP67, 4K, Ultra HD）
  const technicalSpecPattern = /\b(?:IK\d{1,2}|IP\d{2}|4K|8K|[UQ]HD|Ultra\s+HD|Full\s+HD|[0-9]+MP|[0-9]+K|HDR10|Dolby|DTS|WiFi\s*[56]|5G|LTE|A\+\+|Grade\s+A|CE|FCC|UL|ISO\s*\d+)/i

  const hasUniqueness = uniquenessKeywords.test(allTexts) || leadershipKeywords.test(allTexts)
  const hasOfficialStatus = officialPattern.test(allTexts)
  const hasTechnicalDifferentiation = technicalSpecPattern.test(allTexts)

  if (hasUniqueness || hasOfficialStatus) {
    uniqueMarketPosition = 3
    if (hasUniqueness) console.log('   ✅ 独特市场定位（唯一性声明） (+3分)')
    if (hasOfficialStatus) console.log('   ✅ 独特市场定位（官方/授权） (+3分)')
  } else if (hasTechnicalDifferentiation) {
    uniqueMarketPosition = 2.5
    console.log('   ✅ 独特市场定位（技术规格） (+2.5分)')
  } else if (/top|best|leading|premier|superior|migliore|mejor|meilleur|beste|лучший|最好|最高|ベスト|최고|ดีที่สุด|الأفضل|הטוב|en iyi|सर्वश्रेष्ठ|tốt nhất|terbaik|beste|paras|bästa|καλύτερο|najlepszy/i.test(allTextsLower)) {
    uniqueMarketPosition = 1.5
    console.log('   ⚠️ 隐含独特性（通用检测） (+1.5分)')
  } else {
    console.log('   ❌ 无独特定位声明 (+0分)')
  }

  // 3. 竞品对比暗示检测 (0-2分)
  // 常见"对比/替换"关键词（20+语言）
  const comparisonKeywords = /(?:vs|versus|compared?|comparison|replace|substitute|switch|sostituisci|rimpiazza|reemplazar|sustituir|remplacer|substituer|ersetzen|austauschen|substituir|trocar|vervangen|замени|比較|比较|取代|代替|比べる|交換|비교|교체|เปรียบเทียบ|แทนที่|مقارنة|استبدال|השווה|החלף|karşılaştır|değiştir|तुलना|बदलें|so sánh|thay thế|bandingkan|ganti|vergelijken|sammenlign|bytt|vertaa|vaihda|jämför|byt|σύγκριση|αντικατάσταση|porównaj|wymień)/i

  const hasComparison = comparisonKeywords.test(allTextsLower)

  if (hasComparison) {
    competitiveComparison = 2
    console.log('   ✅ 明确竞品对比（通用检测） (+2分)')
  } else if (/better|superior|outperform|migliore|mejor|meilleur|besser|melhor|beter|лучше|更好|优于|より良い|더 좋은|ดีกว่า|أفضل من|טוב יותר|daha iyi|बेहतर|tốt hơn|lebih baik|bedre|parempi|bättre|καλύτερο|lepszy/i.test(allTextsLower)) {
    competitiveComparison = 1
    console.log('   ⚠️ 隐含对比（通用检测） (+1分)')
  } else {
    console.log('   ❌ 无竞品对比暗示 (+0分)')
  }

  // 4. 性价比强调检测 (0-2分)
  // 常见"性价比/价值"关键词（20+语言）
  const valueKeywords = /(?:value\s+for\s+money|worth|bang\s+for|rapporto\s+qualità|qualità.prezzo|relación\s+calidad|calidad.precio|rapport\s+qualité|qualité.prix|preis.leistung|custo.benefício|prijs.kwaliteit|соотношение|价值|性价比|コスパ|가성비|คุ้มค่า|قيمة مقابل|ערך תמורה|fiyat performans|मूल्य के लिए|giá trị|nilai untuk wang|waarde voor|verdi for|arvo|värde för|αξία για|stosunek)/i

  const hasValue = valueKeywords.test(allTextsLower)

  if (hasValue) {
    valueEmphasis = 2
    console.log('   ✅ 性价比强调 (+2分)')
  } else if (/great\s+deal|special\s+offer|offerta\s+speciale|ottim[ao]\s+prezzo/i.test(allTextsLower)) {
    valueEmphasis = 1
    console.log('   ⚠️ 隐含性价比 (+1分)')
  } else {
    console.log('   ❌ 无性价比强调 (+0分)')
  }

  const totalScore = priceAdvantage + uniqueMarketPosition + competitiveComparison + valueEmphasis
  console.log(`   🎯 竞争定位总分（第一层）: ${totalScore.toFixed(1)}/10`)

  // ========================================
  // 第二层：AI增强分析（按需触发）
  // ========================================
  // 触发条件：快速检测分数 > 6分（说明有较强的竞争定位元素，值得深度分析）
  const AI_ENHANCEMENT_THRESHOLD = 6

  if (totalScore > AI_ENHANCEMENT_THRESHOLD) {
    console.log(`   🤖 触发AI增强分析（分数${totalScore.toFixed(1)} > ${AI_ENHANCEMENT_THRESHOLD}）`)

    const aiEnhancedScore = await enhanceCompetitivePositioningWithAI(allTexts, {
      priceAdvantage,
      uniqueMarketPosition,
      competitiveComparison,
      valueEmphasis
    }, userId)

    if (aiEnhancedScore) {
      console.log(`   ✨ AI增强后总分: ${aiEnhancedScore.score.toFixed(1)}/10`)
      return aiEnhancedScore
    }
  }

  return {
    score: Math.min(10, Math.max(0, totalScore)),
    weight: 0.10 as const,
    details: {
      priceAdvantage: Math.round(priceAdvantage * 10) / 10,
      uniqueMarketPosition: Math.round(uniqueMarketPosition * 10) / 10,
      competitiveComparison: Math.round(competitiveComparison * 10) / 10,
      valueEmphasis: Math.round(valueEmphasis * 10) / 10
    }
  }
}

// ========================================
// 缓存机制（Redis优先，内存降级）
// ========================================
interface CachedResult {
  score: number
  weight: 0.10
  details: {
    priceAdvantage: number
    uniqueMarketPosition: number
    competitiveComparison: number
    valueEmphasis: number
    aiConfidence: number
  }
  timestamp: number
}

// 内存缓存（Redis不可用时的降级方案）
const memoryCache = new Map<string, CachedResult>()
const CACHE_TTL_SECONDS = 60 * 60 * 24 // 24小时（Redis用秒）
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000 // 24小时（内存用毫秒）
const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'autoads:'

// Redis可用性状态（避免频繁检查）
let redisAvailable: boolean | null = null
let lastRedisCheck = 0
const REDIS_CHECK_INTERVAL = 60 * 1000 // 60秒检查一次

/**
 * 检查Redis是否可用
 */
async function isRedisAvailable(): Promise<boolean> {
  const now = Date.now()

  // 如果60秒内检查过，直接返回缓存结果
  if (redisAvailable !== null && now - lastRedisCheck < REDIS_CHECK_INTERVAL) {
    return redisAvailable
  }

  try {
    const { getRedisClient } = await import('./redis')
    const client = getRedisClient()
    await client.ping()
    redisAvailable = true
    lastRedisCheck = now
    return true
  } catch (error) {
    redisAvailable = false
    lastRedisCheck = now
    return false
  }
}

/**
 * 生成缓存key
 */
function generateCacheKey(text: string): string {
  // 使用简单的哈希函数生成缓存key
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `${REDIS_KEY_PREFIX}cp:${Math.abs(hash).toString(36)}`
}

/**
 * 从缓存获取结果（Redis优先，内存降级）
 */
async function getCachedResult(adCopyText: string): Promise<CachedResult | null> {
  const key = generateCacheKey(adCopyText)

  // 尝试从Redis获取
  if (await isRedisAvailable()) {
    try {
      const { getRedisClient } = await import('./redis')
      const client = getRedisClient()
      const data = await client.get(key)

      if (data) {
        console.log('   📦 Redis缓存命中')
        return JSON.parse(data)
      }
    } catch (error: any) {
      console.warn(`   ⚠️ Redis读取失败: ${error.message}，尝试内存缓存`)
    }
  }

  // 降级到内存缓存
  const cached = memoryCache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('   📦 内存缓存命中')
    return cached
  }

  // 过期则删除
  if (cached) {
    memoryCache.delete(key)
  }

  return null
}

/**
 * 保存结果到缓存（Redis优先，内存降级）
 */
async function setCachedResult(adCopyText: string, result: CachedResult) {
  const key = generateCacheKey(adCopyText)
  const resultWithTimestamp = { ...result, timestamp: Date.now() }

  // 尝试保存到Redis
  if (await isRedisAvailable()) {
    try {
      const { getRedisClient } = await import('./redis')
      const client = getRedisClient()
      await client.setex(key, CACHE_TTL_SECONDS, JSON.stringify(resultWithTimestamp))
      console.log('   💾 已缓存到Redis（TTL: 24小时）')
      return
    } catch (error: any) {
      console.warn(`   ⚠️ Redis写入失败: ${error.message}，降级到内存缓存`)
    }
  }

  // 降级到内存缓存
  memoryCache.set(key, resultWithTimestamp)

  // 内存缓存清理：超过1000条时删除最旧的500条
  if (memoryCache.size > 1000) {
    const entries = Array.from(memoryCache.entries())
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
    entries.slice(0, 500).forEach(([k]) => memoryCache.delete(k))
    console.log('   🗑️ 内存缓存清理：删除500条旧记录')
  }

  console.log('   💾 已缓存到内存（TTL: 24小时）')
}

/**
 * 🤖 AI增强的竞争定位分析（第二层）
 *
 * 使用Gemini进行深度语义分析，支持所有语言
 * 仅在第一层检测分数 > 6分时触发
 */
async function enhanceCompetitivePositioningWithAI(
  adCopyText: string,
  fastDetectionScores: {
    priceAdvantage: number
    uniqueMarketPosition: number
    competitiveComparison: number
    valueEmphasis: number
  },
  userId?: number
): Promise<{
  score: number
  weight: 0.10
  details: {
    priceAdvantage: number
    uniqueMarketPosition: number
    competitiveComparison: number
    valueEmphasis: number
    aiConfidence: number
  }
} | null> {
  try {
    // 如果没有userId，无法调用AI，直接返回null
    if (!userId) {
      console.log('   ⚠️ 无用户ID，跳过AI增强分析')
      return null
    }

    // 检查是否有缓存
    const cached = await getCachedResult(adCopyText)
    if (cached) {
      console.log('   📦 使用缓存结果（AI增强）')
      return {
        score: cached.score,
        weight: cached.weight,
        details: cached.details
      }
    }

    const { generateContent } = await import('./gemini')

    const prompt = `
You are an expert in Google Ads competitive positioning analysis. Analyze the following ad copy for competitive positioning elements in ANY language.

Ad Copy:
${adCopyText}

Initial Fast Detection Scores (0-max):
- Price Advantage: ${fastDetectionScores.priceAdvantage}/3
- Unique Market Position: ${fastDetectionScores.uniqueMarketPosition}/3
- Competitive Comparison: ${fastDetectionScores.competitiveComparison}/2
- Value Emphasis: ${fastDetectionScores.valueEmphasis}/2

Task: Perform deep semantic analysis to refine these scores. Return JSON with:

{
  "priceAdvantage": 0-3,     // Quantified savings (e.g., "Save €170", "节省170€", "170€ توفير")
  "uniqueMarketPosition": 0-3, // Uniqueness claims (e.g., "Only", "唯一", "الوحيد", "เท่านั้น")
  "competitiveComparison": 0-2, // Competitor comparison (e.g., "Replace", "取代", "استبدل", "แทนที่")
  "valueEmphasis": 0-2,       // Value proposition (e.g., "Best value", "性价比", "أفضل قيمة", "คุ้มค่า")
  "confidence": 0.0-1.0       // Confidence level (0.8+ means high confidence)
}

Rules:
- Detect patterns in ANY language (not just English/Italian/Spanish)
- Score based on clarity and strength of claims
- Consider cultural context (e.g., Asian markets emphasize "value", Western markets emphasize "savings")
- If initial score is accurate, return same score
- Only increase score if you find clear evidence that was missed
- Return 0 if element not present
- Confidence: 1.0 = certain, 0.8 = high confidence, 0.6 = moderate, <0.5 = uncertain
`.trim()

    // 智能模型选择：广告强度评估使用Flash模型（简单评分任务）
    // 🔧 修复：添加try-catch和降级策略
    let result
    try {
      result = await generateContent({
        operationType: 'ad_strength_evaluation',
        prompt,
        temperature: 0.3, // 低温度确保一致性
        maxOutputTokens: 4096, // 🔧 增加token限制，避免Gemini 2.5 Pro thinking模式导致MAX_TOKENS错误（thinking tokens ~2000 + response ~500）
        responseSchema: {
          type: 'OBJECT',
          properties: {
            priceAdvantage: { type: 'NUMBER', description: 'Score 0-3' },
            uniqueMarketPosition: { type: 'NUMBER', description: 'Score 0-3' },
            competitiveComparison: { type: 'NUMBER', description: 'Score 0-2' },
            valueEmphasis: { type: 'NUMBER', description: 'Score 0-2' },
            confidence: { type: 'NUMBER', description: 'Confidence 0.0-1.0' }
          },
          required: ['priceAdvantage', 'uniqueMarketPosition', 'competitiveComparison', 'valueEmphasis', 'confidence']
        },
        responseMimeType: 'application/json',
      }, userId)
    } catch (schemaError: any) {
      // 如果schema模式失败，降级到纯文本模式
      console.warn(`   ⚠️ JSON schema模式失败: ${schemaError.message}`)
      console.log(`   🔄 降级到纯文本模式重试...`)

      // 修改prompt，要求返回JSON格式但不使用schema约束
      const fallbackPrompt = prompt + '\n\nIMPORTANT: Return ONLY valid JSON, no markdown, no extra text.'

      result = await generateContent({
        operationType: 'ad_strength_evaluation',
        prompt: fallbackPrompt,
        temperature: 0.3,
        maxOutputTokens: 4096, // 🔧 增加token限制，避免Gemini 2.5 Pro thinking模式导致MAX_TOKENS错误（thinking tokens ~2000 + response ~500）
      }, userId)

      console.log(`   ✓ 降级模式成功获取响应`)
    }

    // 记录token使用
    if (result.usage) {
      const cost = estimateTokenCost(
        result.model,
        result.usage.inputTokens,
        result.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: result.model,
        operationType: 'competitive_positioning_analysis',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        cost,
        apiType: result.apiType
      })
    }

    // 🔧 健壮的JSON解析
    let aiScores: {
      priceAdvantage: number
      uniqueMarketPosition: number
      competitiveComparison: number
      valueEmphasis: number
      confidence: number
    }
    try {
      // 清理可能的markdown代码块
      let jsonText = result.text.trim()
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\n/, '').replace(/\n```$/, '')
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\n/, '').replace(/\n```$/, '')
      }

      aiScores = JSON.parse(jsonText)

      // 验证必需字段
      const requiredFields = ['priceAdvantage', 'uniqueMarketPosition', 'competitiveComparison', 'valueEmphasis', 'confidence']
      const missingFields = requiredFields.filter(field => !(field in aiScores))

      if (missingFields.length > 0) {
        throw new Error(`AI响应缺少必需字段: ${missingFields.join(', ')}`)
      }
    } catch (parseError: any) {
      console.error(`   ❌ JSON解析失败: ${parseError.message}`)
      console.error(`   原始响应: ${result.text}`)
      throw new Error(`AI响应格式错误: ${parseError.message}`)
    }

    console.log(`   🤖 AI分析结果 (置信度: ${(aiScores.confidence * 100).toFixed(0)}%):`)
    console.log(`      价格优势: ${fastDetectionScores.priceAdvantage} → ${aiScores.priceAdvantage}`)
    console.log(`      独特定位: ${fastDetectionScores.uniqueMarketPosition} → ${aiScores.uniqueMarketPosition}`)
    console.log(`      竞品对比: ${fastDetectionScores.competitiveComparison} → ${aiScores.competitiveComparison}`)
    console.log(`      性价比: ${fastDetectionScores.valueEmphasis} → ${aiScores.valueEmphasis}`)

    // 只有当置信度 >= 0.6 时才使用AI增强结果
    if (aiScores.confidence < 0.6) {
      console.log(`   ⚠️ AI置信度过低 (${(aiScores.confidence * 100).toFixed(0)}%)，使用快速检测结果`)
      return null
    }

    const totalScore = aiScores.priceAdvantage + aiScores.uniqueMarketPosition +
                      aiScores.competitiveComparison + aiScores.valueEmphasis

    const enhancedResult = {
      score: Math.min(10, Math.max(0, totalScore)),
      weight: 0.10 as const,
      details: {
        priceAdvantage: Math.round(aiScores.priceAdvantage * 10) / 10,
        uniqueMarketPosition: Math.round(aiScores.uniqueMarketPosition * 10) / 10,
        competitiveComparison: Math.round(aiScores.competitiveComparison * 10) / 10,
        valueEmphasis: Math.round(aiScores.valueEmphasis * 10) / 10,
        aiConfidence: Math.round(aiScores.confidence * 100) / 100
      }
    }

    // 缓存结果（24小时）
    setCachedResult(adCopyText, { ...enhancedResult, timestamp: Date.now() })
    console.log(`   💾 结果已缓存（TTL: 24小时）`)

    return enhancedResult

  } catch (error: any) {
    console.error(`   ❌ AI增强分析失败: ${error.message}`)
    console.error(`   → 降级使用快速检测结果`)
    return null // 失败时返回null，使用快速检测结果
  }
}

/**
 * 6. 计算Brand Search Volume（品牌搜索量）- 18分
 * [NEW] 融入品牌关键词搜索量：品牌名搜索量 + 包含品牌名的关键词搜索量总和
 */
async function calculateBrandSearchVolume(
  brandName: string | undefined,
  targetCountry: string,
  targetLanguage: string,
  userId?: number,
  keywordsWithVolume?: Array<{ keyword: string; searchVolume: number }>
) {
  // 如果没有品牌名称，返回0分
  if (!brandName || brandName.trim() === '') {
    console.log('⚠️ 未提供品牌名称，品牌搜索量得分为0')
    return {
      score: 0,
      weight: 0.20 as const,
      details: {
        brandNameSearchVolume: 0,
        brandKeywordSearchVolume: 0,
        totalBrandSearchVolume: 0,
        volumeLevel: 'micro' as const,
        dataSource: 'unavailable' as const
      }
    }
  }

  try {
    // ========================================
    // 1. 计算品牌名搜索量（brandNameSearchVolume）
    // ========================================
    const normalizedLanguage = normalizeLanguageCode(targetLanguage)

    // 🔧 修复(2025-12-26): 支持服务账号模式
    const auth = userId ? await getUserAuthType(userId) : { authType: 'oauth' as const, serviceAccountId: undefined }
    const volumeResults = await getKeywordSearchVolumes(
      [brandName],
      targetCountry,
      normalizedLanguage,
      userId,
      auth.authType,
      auth.serviceAccountId
    )

    const brandVolume = volumeResults[0]
    const brandNameSearchVolume = brandVolume?.avgMonthlySearches || 0

    // 确定数据来源
    let dataSource: 'keyword_planner' | 'cached' | 'database' = 'keyword_planner'
    if (brandVolume) {
      dataSource = brandNameSearchVolume > 0 ? 'cached' : 'keyword_planner'
    }

    // ========================================
    // 2. 计算品牌关键词搜索量总和（brandKeywordSearchVolume）
    // ========================================
    let brandKeywordSearchVolume = 0
    let brandKeywordsCount = 0

    if (keywordsWithVolume && keywordsWithVolume.length > 0) {
      const brandNameLower = brandName.toLowerCase()

      // 过滤出包含品牌名的关键词
      const brandKeywords = keywordsWithVolume.filter(kw => {
        const keywordLower = kw.keyword.toLowerCase()
        // 包含品牌名（不是精确等于品牌名，那是brandNameSearchVolume）
        return keywordLower.includes(brandNameLower) && keywordLower !== brandNameLower
      })

      // 计算搜索量总和
      brandKeywordSearchVolume = brandKeywords.reduce((sum, kw) => sum + (kw.searchVolume || 0), 0)
      brandKeywordsCount = brandKeywords.length

      console.log(`🏷️ 品牌关键词: 发现${brandKeywordsCount}个包含"${brandName}"的关键词`)
      console.log(`   品牌关键词搜索量: ${brandKeywordSearchVolume.toLocaleString()}/月`)
    } else {
      console.log('⚠️ 未提供keywordsWithVolume，跳过品牌关键词搜索量计算')
    }

    // ========================================
    // 3. 计算总分（品牌名搜索量 + 品牌关键词搜索量）
    // ========================================
    const totalBrandSearchVolume = brandNameSearchVolume + brandKeywordSearchVolume

    console.log(`📊 品牌"${brandName}"搜索量分析:`)
    console.log(`   品牌名搜索量: ${brandNameSearchVolume.toLocaleString()}/月`)
    console.log(`   品牌关键词搜索量: ${brandKeywordSearchVolume.toLocaleString()}/月`)
    console.log(`   总计: ${totalBrandSearchVolume.toLocaleString()}/月`)

    // 根据总搜索量确定流量级别和分数（对数缩放）
    let volumeLevel: 'micro' | 'small' | 'medium' | 'large' | 'xlarge'
    let score: number

    if (totalBrandSearchVolume >= 100001) {
      // xlarge: 100001+ → 18-20分
      volumeLevel = 'xlarge'
      if (totalBrandSearchVolume >= 1000001) {
        score = 20
      } else if (totalBrandSearchVolume >= 500001) {
        score = 19
      } else {
        score = 18
      }
    } else if (totalBrandSearchVolume >= 10001) {
      // large: 10001-100000 → 13-17分
      volumeLevel = 'large'
      const logMin = Math.log10(10001)
      const logMax = Math.log10(100000)
      const logValue = Math.log10(totalBrandSearchVolume)
      const ratio = (logValue - logMin) / (logMax - logMin)
      score = Math.round(13 + ratio * 4)
    } else if (totalBrandSearchVolume >= 1001) {
      // medium: 1001-10000 → 8-12分
      volumeLevel = 'medium'
      const logMin = Math.log10(1001)
      const logMax = Math.log10(10000)
      const logValue = Math.log10(totalBrandSearchVolume)
      const ratio = (logValue - logMin) / (logMax - logMin)
      score = Math.round(8 + ratio * 4)
    } else if (totalBrandSearchVolume >= 100) {
      // small: 100-1000 → 4-7分
      volumeLevel = 'small'
      const logMin = Math.log10(100)
      const logMax = Math.log10(1000)
      const logValue = Math.log10(totalBrandSearchVolume)
      const ratio = (logValue - logMin) / (logMax - logMin)
      score = Math.round(4 + ratio * 3)
    } else if (totalBrandSearchVolume >= 10) {
      // micro-high: 10-99 → 2-3分
      volumeLevel = 'micro'
      score = totalBrandSearchVolume >= 50 ? 3 : 2
    } else if (totalBrandSearchVolume >= 1) {
      // micro-low: 1-9 → 1分
      volumeLevel = 'micro'
      score = 1
    } else {
      // zero: 0 → 给予默认分数（服务账号模式无法获取搜索量）
      volumeLevel = 'micro'
      // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，给予中等默认分数10分
      // 避免因技术限制导致得分过低
      score = 10
    }

    console.log(`   流量级别: ${volumeLevel}, 评分: ${score}分`)

    return {
      score,
      weight: 0.20 as const,
      details: {
        brandNameSearchVolume,
        brandKeywordSearchVolume,
        totalBrandSearchVolume,
        volumeLevel,
        dataSource
      }
    }
  } catch (error) {
    console.error(`❌ 获取品牌搜索量失败:`, error)
    return {
      score: 0,
      weight: 0.20 as const,
      details: {
        brandNameSearchVolume: 0,
        brandKeywordSearchVolume: 0,
        totalBrandSearchVolume: 0,
        volumeLevel: 'micro' as const,
        dataSource: 'unavailable' as const
      }
    }
  }
}

/**
 * 5. 计算Compliance（合规性）- 10分
 */
function calculateCompliance(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)]

  // 5.1 政策遵守 (0-6分)
  // 基础合规：6分，每发现1个问题扣2分
  let policyIssues = 0

  // 检查重复内容（超过80%相似视为重复）
  for (let i = 0; i < allTexts.length; i++) {
    for (let j = i + 1; j < allTexts.length; j++) {
      const similarity = calculateSimilarity(allTexts[i], allTexts[j])
      if (similarity > 0.8) policyIssues++
    }
  }

  const policyAdherence = Math.max(0, 6 - policyIssues * 2)

  // 5.2 无垃圾词汇 (0-4分)
  const forbiddenWordsFound = allTexts.filter(text =>
    FORBIDDEN_WORDS.some(word => text.toLowerCase().includes(word.toLowerCase()))
  ).length

  const noSpamWords = Math.max(0, 4 - forbiddenWordsFound)

  const totalScore = policyAdherence + noSpamWords

  return {
    score: Math.min(10, Math.round(totalScore)), // 确保不超过最大值10
    weight: 0.10 as const,
    details: {
      policyAdherence: Math.round(policyAdherence),
      noSpamWords: Math.round(noSpamWords)
    }
  }
}

/**
 * 将分数转换为评级
 */
function scoreToRating(score: number): AdStrengthRating {
  if (score >= 85) return 'EXCELLENT'
  if (score >= 70) return 'GOOD'
  if (score >= 50) return 'AVERAGE'
  if (score > 0) return 'POOR'
  return 'PENDING'
}

/**
 * 生成改进建议
 */
function generateSuggestions(
  diversity: any,
  relevance: any,
  completeness: any,
  quality: any,
  compliance: any,
  brandSearchVolume: any,
  competitivePositioning: any,
  rating: AdStrengthRating
): string[] {
  const suggestions: string[] = []

  // 如果已经是EXCELLENT，给予肯定
  if (rating === 'EXCELLENT') {
    suggestions.push('✅ 广告创意质量优秀，符合Google Ads最高标准')
    return suggestions
  }

  // Diversity建议
  if (diversity.details.typeDistribution < 6) {
    suggestions.push('💡 增加资产类型多样性：确保包含品牌、产品、促销、CTA、紧迫感5种类型')
  }
  if (diversity.details.lengthDistribution < 6) {
    suggestions.push('💡 优化长度分布：建议短标题5个、中标题5个、长标题5个')
  }
  if (diversity.details.textUniqueness < 3) {
    suggestions.push('💡 提高文本独特性：避免使用相似或重复的表述')
  }

  // Relevance建议
  if (relevance.details.keywordCoverage < 8) {
    suggestions.push('💡 提高关键词覆盖率：至少80%的关键词应出现在创意中')
  }
  // v3.3 CTR优化：关键词嵌入率建议
  if (relevance.details.keywordEmbeddingRate < 53) {
    suggestions.push(`🔑 提高关键词嵌入率：当前${relevance.details.keywordEmbeddingRate}%，目标53%+ (8/15 headlines含关键词)`)
  }
  if (relevance.details.keywordNaturalness < 4) {
    suggestions.push('💡 优化关键词自然度：避免关键词堆砌，自然融入文案')
  }

  // Completeness建议
  if (completeness.details.assetCount < 7) {
    suggestions.push('💡 补充资产数量：建议15个Headlines + 4个Descriptions')
  }
  if (completeness.details.characterCompliance < 5) {
    suggestions.push('💡 优化字符长度：Headlines 10-30字符，Descriptions 60-90字符')
  }

  // Quality建议
  if (quality.details.numberUsage < 4) {
    suggestions.push('💡 增加数字使用：至少3个Headlines包含具体数字（折扣、价格、数量）')
  }
  if (quality.details.ctaPresence < 4) {
    suggestions.push('💡 强化行动号召：至少2个Descriptions包含明确CTA（Shop Now、Get、Buy）')
  }
  if (quality.details.urgencyExpression < 3) {
    suggestions.push('💡 增加紧迫感：至少2个Headlines体现限时优惠或稀缺性')
  }

  // Compliance建议
  if (compliance.details.policyAdherence < 5) {
    suggestions.push('⚠️ 减少内容重复：确保每个资产独特且差异化')
  }
  if (compliance.details.noSpamWords < 3) {
    suggestions.push('⚠️ 移除违规词汇：避免使用绝对化、夸大或误导性表述')
  }

  // Brand Search Volume建议
  if (brandSearchVolume.details.volumeLevel === 'micro') {
    suggestions.push('📊 品牌知名度较低：建议加强品牌推广，提升市场认知度')
  } else if (brandSearchVolume.details.volumeLevel === 'small') {
    suggestions.push('📊 品牌处于成长期：建议结合品牌建设和效果营销策略')
  } else if (brandSearchVolume.details.volumeLevel === 'medium') {
    suggestions.push('📊 品牌具备一定影响力：可以适当增加品牌类创意资产比例')
  }
  // large和xlarge级别无需建议，已经有足够品牌影响力

  // Competitive Positioning建议 (新增)
  if (competitivePositioning.details.priceAdvantage < 2) {
    suggestions.push('🎯 强化价格优势：量化节省金额（如"Save €170"）提升竞争力')
  }
  if (competitivePositioning.details.uniqueMarketPosition < 2) {
    suggestions.push('🎯 突出独特定位：使用"L\'unica"、"The Only"等表述建立市场差异化')
  }
  if (competitivePositioning.details.competitiveComparison < 1) {
    suggestions.push('🎯 暗示竞品对比：通过"Sostituisci il vecchio"等表述引导替换竞品')
  }
  if (competitivePositioning.details.valueEmphasis < 1) {
    suggestions.push('🎯 强调性价比：使用"Rapporto Qualità-Prezzo"等表述增强价值感知')
  }

  return suggestions
}

/**
 * 辅助函数：计算文本独特性（0-1）
 */
function calculateTextUniqueness(texts: string[]): number {
  if (texts.length === 0) return 0

  let totalSimilarity = 0
  let comparisons = 0

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      totalSimilarity += calculateSimilarity(texts[i], texts[j])
      comparisons++
    }
  }

  const avgSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 0
  return 1 - avgSimilarity // 独特性 = 1 - 相似度
}

/**
 * 辅助函数：计算关键词密度
 */
function calculateKeywordDensity(text: string, keywords: string[]): number {
  const words = text.split(/\s+/)
  const keywordMatches = words.filter(word =>
    keywords.some(kw => word.toLowerCase().includes(kw.toLowerCase()))
  ).length

  return words.length > 0 ? keywordMatches / words.length : 0
}

/**
 * v4.18新增: 计算单品聚焦度 (0-4分)
 *
 * 检查广告创意是否100%聚焦于单品商品，排除以下情况：
 * - 提到其他品类（如"doorbell", "vacuum", "lock"等）
 * - 使用通用店铺文案（如"browse our collection", "shop all"）
 * - 暗示多产品（如"full lineup", "wide range"）
 *
 * 评分规则：
 * - 4分：所有元素都聚焦单品，无任何其他品类提及
 * - 3分：95%以上聚焦，允许1-2个轻微问题
 * - 2分：80%-95%聚焦，有一些其他品类提及
 * - 1分：60%-80%聚焦，有较多其他品类提及
 * - 0分：<60%聚焦，大量其他品类提及
 */
function calculateProductFocus(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  sitelinks?: Array<{ text: string; url: string; description?: string }>,
  callouts?: string[],
  categoryWhitelist?: string[]  // 动态传入目标品类白名单
): { score: number; issues: string[] } {
  const issues: string[] = []
  let problemCount = 0

  const allHeadlines = headlines.map(h => h.text.toLowerCase())
  const allDescriptions = descriptions.map(d => d.text.toLowerCase())
  const allSitelinkTexts = (sitelinks || []).map(s => (s.text + ' ' + (s.description || '')).toLowerCase())
  const allCallouts = (callouts || []).map(c => c.toLowerCase())
  const allTexts = [...allHeadlines, ...allDescriptions, ...allSitelinkTexts, ...allCallouts]

  // 1. 动态生成"其他品类"列表（排除目标品类）
  const targetCategories = (categoryWhitelist || []).map(c => c.toLowerCase())
  const allCategoryTerms = [
    // 门铃类
    'doorbell', 'video doorbell', 'smart doorbell', 'door camera',
    // 吸尘器类
    'vacuum', 'robot vacuum', 'vacuum cleaner', 'cordless vacuum', 'robot mop',
    // 智能锁类
    'smart lock', 'door lock', 'fingerprint lock', 'keyless lock',
    // 智能家居类
    'smart home', 'home automation', 'smart plug', 'smart bulb', 'smart speaker',
    // 母婴类
    'breast pump', 'baby monitor', 'baby gear',
    // 店铺通用类（单品链接不应出现）
    'browse our collection', 'shop all', 'browse collection', 'explore our',
    'full lineup', 'wide range', 'our product line', 'all products'
  ]

  // 过滤：只检查不在目标品类白名单中的品类词
  const otherCategoryTerms = allCategoryTerms.filter(term => {
    // 检查term中是否包含目标品类词
    const isTargetCategory = targetCategories.some(cat =>
      term.toLowerCase().includes(cat) || cat.includes(term.toLowerCase())
    )
    return !isTargetCategory  // 排除目标品类，保留其他品类
  })

  // 2. 通用店铺/品牌文案列表
  const genericStoreTerms = [
    'browse our collection', 'shop all cameras', 'shop all products',
    'browse collection', 'explore our full', 'our product line',
    'all products', 'wide range', 'full lineup', 'complete lineup',
    'smart home solutions', 'home security solutions', 'whole home',
    'entire home', 'every room', 'all your needs', 'one stop shop',
    'everything you need', 'full range of', 'complete range of',
    'shop the full', 'view all products', 'see all products'
  ]

  // 3. 通用品牌卖点（单品不应使用）
  const genericBrandTerms = [
    'wide product range', 'full product line', 'complete security lineup',
    'smart home lineup', 'full line of', 'complete line of',
    'diverse selection', 'extensive collection', 'comprehensive range',
    'for all your', 'for every need', 'solutions for'
  ]

  // 4. 检查所有文本中的其他品类提及
  allTexts.forEach((text, idx) => {
    otherCategoryTerms.forEach(term => {
      if (text.includes(term)) {
        const source = idx < allHeadlines.length ? 'Headline' :
                      idx < allHeadlines.length + allDescriptions.length ? 'Description' :
                      idx < allHeadlines.length + allDescriptions.length + allSitelinkTexts.length ? 'Sitelink' : 'Callout'
        issues.push(`${source} ${idx + 1} 包含其他品类词: "${term}"`)
        problemCount++
      }
    })
  })

  // 5. 检查Headlines是否太通用（没有产品信息）
  allHeadlines.forEach((text, idx) => {
    // 检查是否太通用（没有产品信息）
    const isTooGeneric = text.length < 15 ||
      (!text.includes('pro') && !text.includes('max') && !text.includes('2k') &&
       !text.includes('4k') && !text.includes('camera') && !text.includes('ring'))

    // 获取headline类型
    const headlineType = headlines[idx]?.type || ''

    if (isTooGeneric && headlineType && !text.includes(headlineType)) {
      // 排除正常类型标识（如"brand", "feature"等）
      if (!['brand', 'feature', 'promo', 'cta', 'urgency', 'social_proof', 'question', 'emotional'].includes(headlineType)) {
        issues.push(`Headline ${idx + 1} 可能太通用，缺乏产品细节`)
        problemCount += 0.5
      }
    }
  })

  // 6. 检查Sitelinks中的通用店铺文案
  allSitelinkTexts.forEach((text, idx) => {
    genericStoreTerms.forEach(term => {
      if (text.includes(term)) {
        issues.push(`Sitelink ${idx + 1} 包含店铺通用文案: "${term}"（单品链接应避免）`)
        problemCount++
      }
    })
  })

  // 7. 检查Callouts中的通用品牌文案
  allCallouts.forEach((text, idx) => {
    genericBrandTerms.forEach(term => {
      if (text.includes(term)) {
        issues.push(`Callout ${idx + 1} 包含通用品牌文案: "${term}"（单品应突出具体功能）`)
        problemCount++
      }
    })
  })

  // 8. 检查Descriptions中的店铺通用文案
  allDescriptions.forEach((text, idx) => {
    genericStoreTerms.forEach(term => {
      if (text.includes(term)) {
        issues.push(`Description ${idx + 1} 包含店铺通用文案: "${term}"（单品链接应避免）`)
        problemCount++
      }
    })
  })

  // 9. 计算得分
  // 基于问题数量扣分
  let score = 4
  if (problemCount >= 3) score = 0
  else if (problemCount >= 2.5) score = 1
  else if (problemCount >= 1.5) score = 2
  else if (problemCount >= 0.5) score = 3

  // 10. 额外检查：是否提到多个品类（使用动态品类列表）
  const categoryMentions = allTexts.filter(text =>
    allCategoryTerms.some(cat => text.includes(cat))
  ).length

  if (categoryMentions > 3) {
    issues.push(`创意中提及多个品类（${categoryMentions}次），建议聚焦单一品类`)
    score = Math.max(0, score - 1)
  }

  // 输出调试信息
  if (score < 4) {
    console.log(`⚠️ 单品聚焦度评分: ${score}/4 (${problemCount}个问题)`)
    issues.forEach(issue => console.log(`   - ${issue}`))
  } else {
    console.log(`✅ 单品聚焦度评分: ${score}/4 (无问题)`)
  }

  return { score, issues }
}

/**
 * 辅助函数：计算两个文本的综合相似度 (0-1)
 * 使用多种算法的加权平均，确保更精确的相似度检测
 * 权重: Jaccard 30%, Cosine 30%, Levenshtein 20%, N-gram 20%
 */
function calculateSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0

  // 1. Jaccard 相似度 (词集合) - 30%
  const jaccardSimilarity = calculateJaccardSimilarity(text1, text2)

  // 2. Cosine 相似度 (词频向量) - 30%
  const cosineSimilarity = calculateCosineSimilarity(text1, text2)

  // 3. Levenshtein 相似度 (编辑距离) - 20%
  const levenshteinSimilarity = calculateLevenshteinSimilarity(text1, text2)

  // 4. N-gram 相似度 (词序) - 20%
  const ngramSimilarity = calculateNgramSimilarity(text1, text2, 2)

  // 加权平均
  const weightedSimilarity =
    jaccardSimilarity * 0.3 +
    cosineSimilarity * 0.3 +
    levenshteinSimilarity * 0.2 +
    ngramSimilarity * 0.2

  return Math.min(1, Math.max(0, weightedSimilarity))
}

/**
 * Jaccard 相似度 (词集合)
 */
function calculateJaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 0))
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 0))

  if (words1.size === 0 && words2.size === 0) return 1
  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])

  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * Cosine 相似度 (词频向量)
 */
function calculateCosineSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  const words2 = text2.toLowerCase().split(/\s+/).filter(w => w.length > 0)

  if (words1.length === 0 || words2.length === 0) return 0

  const allWords = new Set([...words1, ...words2])
  const vector1: Record<string, number> = {}
  const vector2: Record<string, number> = {}

  // 构建词频向量
  for (const word of allWords) {
    vector1[word] = words1.filter(w => w === word).length
    vector2[word] = words2.filter(w => w === word).length
  }

  // 计算点积
  let dotProduct = 0
  for (const word of allWords) {
    dotProduct += (vector1[word] || 0) * (vector2[word] || 0)
  }

  // 计算模
  const magnitude1 = Math.sqrt(Object.values(vector1).reduce((sum, val) => sum + val * val, 0))
  const magnitude2 = Math.sqrt(Object.values(vector2).reduce((sum, val) => sum + val * val, 0))

  return magnitude1 > 0 && magnitude2 > 0 ? dotProduct / (magnitude1 * magnitude2) : 0
}

/**
 * Levenshtein 相似度 (编辑距离)
 */
function calculateLevenshteinSimilarity(text1: string, text2: string): number {
  const distance = levenshteinDistance(text1, text2)
  const maxLength = Math.max(text1.length, text2.length)
  return maxLength > 0 ? 1 - distance / maxLength : 0
}

/**
 * 计算 Levenshtein 距离
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[str2.length][str1.length]
}

/**
 * N-gram 相似度 (词序)
 */
function calculateNgramSimilarity(text1: string, text2: string, n: number = 2): number {
  const ngrams1 = getNgrams(text1, n)
  const ngrams2 = getNgrams(text2, n)

  if (ngrams1.length === 0 && ngrams2.length === 0) return 1
  if (ngrams1.length === 0 || ngrams2.length === 0) return 0

  const intersection = ngrams1.filter(ng => ngrams2.includes(ng)).length
  const union = new Set([...ngrams1, ...ngrams2]).size

  return union > 0 ? intersection / union : 0
}

/**
 * 提取 N-gram
 */
function getNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  const ngrams: string[] = []

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '))
  }

  return ngrams
}

/**
 * 单个资产评分（可选功能）
 */
export async function evaluateIndividualAsset(
  asset: HeadlineAsset | DescriptionAsset,
  type: 'headline' | 'description',
  keywords: string[]
): Promise<{
  score: number
  issues: string[]
  suggestions: string[]
}> {
  const issues: string[] = []
  const suggestions: string[] = []
  let score = 100

  const text = asset.text
  const length = asset.length || text.length

  // 长度检查
  if (type === 'headline') {
    if (length < 10) {
      issues.push('字符数过少（建议10-30字符）')
      score -= 20
    } else if (length > 30) {
      issues.push('字符数超限（最多30字符）')
      score -= 30
    }
  } else {
    if (length < 60) {
      issues.push('字符数过少（建议60-90字符）')
      score -= 20
    } else if (length > 90) {
      issues.push('字符数超限（最多90字符）')
      score -= 30
    }
  }

  // 关键词检查
  const hasKeyword = keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()))
  if (!hasKeyword) {
    issues.push('未包含关键词')
    suggestions.push('建议融入至少1个关键词')
    score -= 15
  }

  // 禁用词检查
  const hasForbiddenWord = FORBIDDEN_WORDS.some(word => text.toLowerCase().includes(word.toLowerCase()))
  if (hasForbiddenWord) {
    issues.push('包含违规词汇')
    suggestions.push('移除绝对化或夸大表述')
    score -= 25
  }

  // Headline特定检查
  if (type === 'headline') {
    const headlineAsset = asset as HeadlineAsset

    if (!headlineAsset.type) {
      suggestions.push('建议分类为：品牌/产品/促销/CTA/紧迫感')
    }

    if (!headlineAsset.hasNumber && headlineAsset.type === 'promo') {
      suggestions.push('促销类标题建议包含具体数字')
    }
  }

  // Description特定检查
  if (type === 'description') {
    const descAsset = asset as DescriptionAsset

    if (!descAsset.hasCTA) {
      suggestions.push('建议添加行动号召（Shop Now, Get, Learn More）')
      score -= 10
    }
  }

  return {
    score: Math.max(0, score),
    issues,
    suggestions
  }
}
