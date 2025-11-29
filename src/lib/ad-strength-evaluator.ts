/**
 * Ad Strength评估器 - 本地评估算法
 *
 * 基于Google Ads Ad Strength标准的6维度评分系统：
 * 1. Diversity (20%) - 资产多样性
 * 2. Relevance (20%) - 关键词相关性
 * 3. Brand Search Volume (20%) - 品牌搜索量
 * 4. Completeness (15%) - 资产完整性
 * 5. Quality (15%) - 内容质量
 * 6. Compliance (10%) - 政策合规性
 *
 * 输出：0-100分 + POOR/AVERAGE/GOOD/EXCELLENT评级
 */

import type {
  HeadlineAsset,
  DescriptionAsset,
  QualityMetrics
} from './ad-creative'
import { getKeywordSearchVolumes } from './keyword-planner'
import { normalizeLanguageCode } from './language-country-codes'

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
      score: number // 0-20
      weight: 0.20
      details: {
        typeDistribution: number // 0-8 资产类型分布
        lengthDistribution: number // 0-8 长度梯度
        textUniqueness: number // 0-4 文本独特性
      }
    }
    relevance: {
      score: number // 0-20
      weight: 0.20
      details: {
        keywordCoverage: number // 0-12 关键词覆盖率
        keywordNaturalness: number // 0-8 关键词自然度
      }
    }
    completeness: {
      score: number // 0-15
      weight: 0.15
      details: {
        assetCount: number // 0-9 资产数量
        characterCompliance: number // 0-6 字符合规性
      }
    }
    quality: {
      score: number // 0-15
      weight: 0.15
      details: {
        numberUsage: number // 0-4 数字使用
        ctaPresence: number // 0-4 CTA存在
        urgencyExpression: number // 0-3 紧迫感表达
        differentiation: number // 0-4 差异化表达（NEW）
      }
    }
    compliance: {
      score: number // 0-10
      weight: 0.10
      details: {
        policyAdherence: number // 0-6 政策遵守
        noSpamWords: number // 0-4 无垃圾词汇
      }
    }
    brandSearchVolume: {
      score: number // 0-20
      weight: 0.20
      details: {
        monthlySearchVolume: number // 月均搜索量
        volumeLevel: 'micro' | 'small' | 'medium' | 'large' | 'xlarge' // 流量级别
        dataSource: 'keyword_planner' | 'cached' | 'database' | 'unavailable' // 数据来源
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
  }
): Promise<AdStrengthEvaluation> {

  // 1. Diversity维度 (25%)
  const diversity = calculateDiversity(headlines, descriptions)

  // 2. Relevance维度 (25%)
  const relevance = calculateRelevance(headlines, descriptions, keywords)

  // 3. Completeness维度 (20%)
  const completeness = calculateCompleteness(headlines, descriptions)

  // 4. Quality维度 (20%)
  const quality = calculateQuality(headlines, descriptions, options?.brandName)

  // 5. Compliance维度 (10%)
  const compliance = calculateCompliance(headlines, descriptions)

  // 6. Brand Search Volume维度 (20%)
  const brandSearchVolume = await calculateBrandSearchVolume(
    options?.brandName,
    options?.targetCountry || 'US',
    options?.targetLanguage || 'en',
    options?.userId
  )

  // 计算总分（100分制）
  const overallScore = diversity.score + relevance.score + completeness.score + quality.score + compliance.score + brandSearchVolume.score

  // 确定评级
  const rating = scoreToRating(overallScore)

  // 生成改进建议
  const suggestions = generateSuggestions(diversity, relevance, completeness, quality, compliance, brandSearchVolume, rating)

  return {
    overallScore: Math.round(overallScore),
    rating,
    dimensions: {
      diversity,
      relevance,
      completeness,
      quality,
      compliance,
      brandSearchVolume
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
 */
function calculateRelevance(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[]
) {
  const allTexts = [...headlines.map(h => h.text), ...descriptions.map(d => d.text)].join(' ').toLowerCase()

  // 2.1 关键词覆盖率 (0-12分) - 优化：支持词形变化和部分匹配
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
  const keywordCoverage = coverageRatio * 12

  // 调试输出
  if (coverageRatio < 0.8) {
    const unmatchedKeywords = keywords.filter(kw => !matchedKeywords.includes(kw))
    console.log(`⚠️ 关键词覆盖率偏低: ${(coverageRatio * 100).toFixed(0)}%`)
    console.log(`   匹配成功: ${matchedKeywords.join(', ')}`)
    console.log(`   匹配失败: ${unmatchedKeywords.join(', ')}`)
  }

  // 2.2 关键词自然度 (0-8分)
  // 检查关键词是否自然融入（非堆砌）
  const keywordDensity = calculateKeywordDensity(allTexts, keywords)
  const naturalness = keywordDensity < 0.3 ? 8 : (keywordDensity < 0.5 ? 5.6 : 3.2) // 密度低于30%最佳

  const totalScore = keywordCoverage + naturalness

  return {
    score: Math.min(20, Math.round(totalScore)), // 确保不超过最大值20
    weight: 0.20 as const,
    details: {
      keywordCoverage: Math.round(keywordCoverage),
      keywordNaturalness: Math.round(naturalness)
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
 * 6. 计算Brand Search Volume（品牌搜索量）- 20分
 */
async function calculateBrandSearchVolume(
  brandName: string | undefined,
  targetCountry: string,
  targetLanguage: string,
  userId?: number
) {
  // 如果没有品牌名称，返回0分
  if (!brandName || brandName.trim() === '') {
    console.log('⚠️ 未提供品牌名称，品牌搜索量得分为0')
    return {
      score: 0,
      weight: 0.20 as const,
      details: {
        monthlySearchVolume: 0,
        volumeLevel: 'micro' as const,
        dataSource: 'unavailable' as const
      }
    }
  }

  try {
    // 规范化语言代码（将完整语言名称转换为代码，如 "English" → "en"）
    const normalizedLanguage = normalizeLanguageCode(targetLanguage)

    // 使用现有的关键词搜索量查询机制（Redis → Database → Google Ads API）
    const volumeResults = await getKeywordSearchVolumes(
      [brandName],
      targetCountry,
      normalizedLanguage,
      userId
    )

    const brandVolume = volumeResults[0]
    const monthlySearchVolume = brandVolume?.avgMonthlySearches || 0

    // 确定数据来源
    let dataSource: 'keyword_planner' | 'cached' | 'database' = 'keyword_planner'
    if (brandVolume) {
      // 根据实际实现，可能需要从volumeResults中获取数据源信息
      // 这里简化处理，假设成功获取就是从缓存或API
      dataSource = monthlySearchVolume > 0 ? 'cached' : 'keyword_planner'
    }

    // 根据搜索量确定流量级别和分数
    let volumeLevel: 'micro' | 'small' | 'medium' | 'large' | 'xlarge'
    let score: number

    if (monthlySearchVolume >= 100001) {
      volumeLevel = 'xlarge'
      score = 20
    } else if (monthlySearchVolume >= 10001) {
      volumeLevel = 'large'
      score = 15
    } else if (monthlySearchVolume >= 1001) {
      volumeLevel = 'medium'
      score = 10
    } else if (monthlySearchVolume >= 100) {
      volumeLevel = 'small'
      score = 5
    } else {
      volumeLevel = 'micro'
      score = 0
    }

    console.log(`📊 品牌"${brandName}"搜索量: ${monthlySearchVolume.toLocaleString()}/月 (${volumeLevel}级别, ${score}分)`)

    return {
      score,
      weight: 0.20 as const,
      details: {
        monthlySearchVolume,
        volumeLevel,
        dataSource
      }
    }
  } catch (error) {
    console.error(`❌ 获取品牌搜索量失败:`, error)
    // 出错时返回0分，但不影响其他维度评分
    return {
      score: 0,
      weight: 0.20 as const,
      details: {
        monthlySearchVolume: 0,
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
  if (relevance.details.keywordCoverage < 10) {
    suggestions.push('💡 提高关键词覆盖率：至少90%的关键词应出现在创意中')
  }
  if (relevance.details.keywordNaturalness < 6) {
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
