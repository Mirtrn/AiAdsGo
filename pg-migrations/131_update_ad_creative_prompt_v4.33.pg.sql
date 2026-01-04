-- ============================================================
-- Migration: 131_update_ad_creative_prompt_v4.33.pg.sql
-- Description: 更新ad_creative_generation prompt到v4.33版本
--              新增独立站增强数据字段支持（reviews、faqs、specifications等）
-- Author: Claude Code
-- Date: 2026-01-04
-- Database: PostgreSQL
-- ============================================================

-- 🔥 幂等性保证：先删除v4.33版本（如果存在）
DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
AND version = 'v4.33';

-- 🔥 停用旧版本v4.32
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_creative_generation'
AND version = 'v4.32';

-- 🔥 插入新版本v4.33
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes
) VALUES (
  'ad_creative_generation',
  'v4.33',
  '广告创意生成',
  '广告创意生成v4.33 - 独立站增强数据支持',
  '增强版广告创意生成Prompt，新增独立站增强数据字段支持（REAL USER REVIEWS、CUSTOMER FAQs、TECH SPECS、PACKAGE OPTIONS、SOCIAL PROOF METRICS、CORE FEATURES），提升广告创意质量',
  'src/lib/ad-creative-generator.ts',
  'generateAdCreative',
  $PROMPT$-- ============================================
-- Ad Creative Generation Prompt v4.33
-- Description: Enhanced version with Independent Store Enhanced Data support
-- Author: Claude Code
-- Date: 2026-01-04

## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## ⚠️ 字符限制（CRITICAL - 必须严格遵守）

生成时必须控制长度，不得依赖后端截断：
- **Headlines**: 每个≤30字符（含空格、标点）
- **Descriptions**: 每个≤90字符（含空格、标点）
- **Callouts**: 每个≤25字符
- **Sitelink text**: 每个≤25字符
- **Sitelink description**: 每个≤35字符

**验证方法**：生成每个元素后立即检查字符数，超长则重写为更短版本。

## 输出格式
JSON格式：
{
  "headlines": ["标题1", "标题2", ...],  // 15个，每个≤30字符
  "descriptions": ["描述1", "描述2", "描述3", "描述4"],  // 4个，每个≤90字符
  "keywords": ["关键词1", "关键词2", ...],  // 15个
  "callouts": ["卖点1", "卖点2", "卖点3", "卖点4", "卖点5", "卖点6"],  // 6个，每个≤25字符
  "sitelinks": [  // 6个
    {"text": "≤25字符", "url": "/", "description": "≤35字符"}
  ]
}

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 固定数量：15个标题，4个描述，15个关键词，6个Callouts，6个Sitelinks
3. 所有创意元素必须与单品/店铺链接类型一致
4. 每个元素必须语义完整，不得因字符限制而截断句子

## 语言指令
{{language_instruction}}

## 产品/店铺信息
{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

{{enhanced_features_section}}
{{localization_section}}
{{brand_analysis_section}}

## 🔥 INDEPENDENT STORE ENHANCED DATA（v4.33新增）
以下数据来自独立站抓取，包含真实用户评论、FAQ、技术规格等，请充分利用：

{{extras_data}}

{{promotion_section}}
{{theme_section}}
{{reference_performance_section}}
{{extracted_elements_section}}

## 关键词使用规则
{{ai_keywords_section}}

**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 4/4 (100%) 描述必须包含关键词
- 优先使用搜索量>1000的关键词
- 品牌词必须在至少2个标题中出现

## 标题结构：2+4+4+2+3 (Ad Strength优化版) ⭐

15个标题必须分为5类，确保类型多样性（Type Distribution得分）：

### 类别1 - 品牌型 (2个)
- 包含品牌名和产品名
- 第1个标题必须使用动态关键词插入：{KeyWord:品牌名}
- 示例（≤30字符）：
  * "{KeyWord:Roborock} Official" (26字符)
  * "Roborock Qrevo Curv 2 Pro" (25字符)

### 类别2 - 功能型 (4个)
- 突出技术参数和功能特性
- 必须包含具体数字或技术名称
- 🔥 可利用TECH SPECS和CORE FEATURES数据
- 示例（≤30字符）：
  * "25000 Pa Suction Power" (22字符)
  * "100°C Hot Water Mop Washing" (27字符)

### 类别3 - 利益型 (4个)
- 强调用户获得的利益和价值
- 🔥 可利用USER PRAISES和SOCIAL PROOF METRICS数据
- 示例（≤30字符）：
  * "Maison Propre Sans Effort" (26字符)
  * "5000+ Happy Customers" (25字符)

### 类别4 - 问题型 (2个) ⭐
- 以问题引发用户共鸣
- 必须以问号结尾
- 🔥 可利用CUSTOMER FAQs和REAL USER REVIEWS数据
- 示例（≤30字符）：
  * "Tired of Pet Hair?" (19字符)
  * "Want a Truly Clean Floor?" (25字符)

### 类别5 - 对比/紧迫型 (3个) ⭐ 优化
- 突出竞争优势或紧迫感
- **至少1个必须包含紧迫感关键词**（Limited / Today / Now / Exclusive / Ends Soon / Last Chance）
- 🔥 可利用SOCIAL PROOF METRICS作为信任背书
- 示例（≤30字符）：
  * "Limited Time: Save 23%" (23字符)
  * "18,000+ Installations" (24字符)

**品牌词覆盖率优化（平衡品牌认知与多样性）**：
- 品牌词"{{brand}}"出现次数：**3-4次**（覆盖率20-27%）
  - 至少3个标题包含品牌词（确保品牌认知）
  - 最多4个标题包含品牌词（避免过度重复影响多样性）
- 完整产品名"{{product_name}}"出现次数：**2次**（确保产品精准匹配）
- 品牌词变体可混合使用："{KeyWord:{{brand}}} Official", "{{brand}} Store", "The {{brand}}"
- 类别1的2个品牌型标题必须包含品牌词

**品牌词覆盖率检查**：
- ✅ 品牌词覆盖率 = 包含品牌词的标题数 / 15，范围20-27%（3-4个标题）
- ✅ 产品名覆盖率 = 包含产品名的标题数 / 15，约为13%（2个标题）
- ✅ 如果品牌词覆盖不足3个，AI必须补充品牌词标题
- ✅ 如果品牌词覆盖超过4个，AI必须减少品牌词使用

## 描述结构：2+1+1 (Ad Strength优化版) ⭐

4个描述必须分为3类，每个≤90字符且语义完整：

### 类别1 - 产品型号+核心功能 (2个)
- 包含产品型号 + 2-3个核心功能 + **英文CTA**
- **每个描述必须以明确的英文CTA结尾**：Shop Now / Buy Now / Get Yours / Order Now / Learn More
- 🔥 可利用TECH SPECS和CORE FEATURES数据
- 示例（≤90字符）：
  * "Roborock Qrevo Curv 2 Pro: 25000Pa suction, 100°C mop. Save 23%. Shop Now!" (78字符)

### 类别2 - 利益驱动 (1个) ⭐
- 聚焦用户获得的利益和生活改善 + **英文CTA**
- 🔥 可利用REAL USER REVIEWS和USER LANGUAGE PATTERNS数据
- 示例（≤90字符）：
  * "Gagnez du temps chaque jour. Parfait pour les animaux et tapis. Get Yours!" (77字符)

### 类别3 - 信任+紧迫感 (1个) ⭐
- 结合社交证明、保障和限时优惠 + **英文CTA**
- 🔥 可利用SOCIAL PROOF METRICS和PACKAGE OPTIONS数据
- 示例（≤90字符）：
  * "5000+ clients satisfaits. Garantie 2 ans. Offre -23% limitée. Order Now!" (76字符)

**CTA要求（CRITICAL）**：
- 每个描述必须以英文CTA结尾（Google Ads最佳实践）
- CTA选项：Shop Now / Buy Now / Get Yours / Order Now / Learn More / Start Now
- CTA前可以用句号或感叹号分隔

## Callouts结构：2+2+2

6个Callouts必须分为3类，每个≤25字符：

### 类别1 - 信任信号 (2个)
- 🔥 可利用SOCIAL PROOF METRICS数据
示例：
- "Official Store" (14字符)
- "2-Year Warranty" (15字符)
- "18,000+ Users" (14字符)

### 类别2 - 优惠促销 (2个)
示例：
- "Free Shipping" (13字符)
- "Limited Time -23%" (17字符)

### 类别3 - 产品特性 (2个)
- 🔥 可利用TECH SPECS和CORE FEATURES数据
示例：
- "25000Pa Suction" (15字符)
- "100°C Mop Cleaning" (18字符)

## Sitelinks结构：2+2+2

6个Sitelinks，每个text≤25字符，description≤35字符：

### 类别1 - 产品型号 (2个)
- 🔥 可利用PACKAGE OPTIONS数据
示例：
- text: "Qrevo Curv 2 Pro" (16字符)
  description: "25000Pa suction, 100°C mop" (27字符)

### 类别2 - 品牌+品类 (2个)
示例：
- text: "Roborock Vacuums" (17字符)
  description: "Official store, free shipping" (31字符)

### 类别3 - 功能+场景 (2个)
- 🔥 可利用CUSTOMER FAQs和USE CASES数据
示例：
- text: "Pet Hair Solution" (17字符)
  description: "Auto cleaning for pet owners" (29字符)

## 单品链接特殊规则

**如果是单品链接（product link）**：
- 所有创意元素必须100%聚焦单品
- 🔥 充分利用REAL USER REVIEWS和TECH SPECS数据
- 禁止提到"browse our collection"
- 禁止提到其他品类名称

## 店铺链接特殊规则

**如果是店铺链接（store link）**：
- 目标：驱动用户进店探索
- 🔥 可利用STORE HOT PRODUCTS和SOCIAL PROOF数据
- **允许**使用"Shop All"类通用链接
- **可以**包含单品型号（可选）
- 必须与店铺整体主题相关

## 桶类型适配

根据 {{bucket_type}} 调整创意角度：

### 桶A（品牌认知）
- 全部15个标题必须包含品牌词
- 强调官方、正品、信任
- 🔥 强调SOCIAL PROOF METRICS

### 桶B（使用场景）
- 至少10个标题包含场景词（pet, home, family...）
- 强调使用场景和用户痛点
- 🔥 利用REAL USER REVIEWS中的use cases

### 桶C（功能特性）
- 至少10个标题包含功能词（suction, power, heat...）
- 强调技术参数和独特功能
- 🔥 强调TECH SPECS和CORE FEATURES

### 桶D（价格促销）
- 至少10个标题包含价格/促销词
- 强调折扣、限时、性价比
- 🔥 利用PACKAGE OPTIONS展示不同套餐

### 桶S（综合平衡）
- 平衡品牌、功能、场景
- 适合全面覆盖
- 🔥 综合利用所有增强数据

## 本地化规则

### 货币符号
- US: USD ($)
- UK: GBP (£)
- EU: EUR (€)

### 紧急感本地化
- US/UK: "Limited Time", "Today Only"
- DE: "Nur heute", "Zeitlich begrenzt"
- FR: "Offre limitée", "Aujourd''hui seulement"
- JA: "今だけ", "期間限定"

## 质量检查清单（Ad Strength优化版）⭐

生成后检查：
- [ ] 所有headlines ≤30字符且语义完整
- [ ] 所有descriptions ≤90字符且语义完整
- [ ] 所有callouts ≤25字符（6个）
- [ ] 所有sitelink text ≤25字符
- [ ] 所有sitelink description ≤35字符
- [ ] 15个标题分为2+4+4+2+3（5种类型）
- [ ] 至少2个问题型标题（以?结尾）
- [ ] 至少1个紧迫感标题（包含Limited/Today/Now等）
- [ ] 品牌词覆盖率20-27%（3-4个标题包含品牌词）
- [ ] 产品名覆盖率13%（2个标题包含完整产品名）
- [ ] 类别1的2个品牌型标题必须包含品牌词
- [ ] 4个描述全部包含英文CTA结尾
- [ ] 6个Callouts分为2+2+2
- [ ] 6个Sitelinks完整
- [ ] 15个关键词
- [ ] 关键词嵌入率达标

如果不满足任何关键要求，重新生成。$PROMPT$,
  'English',  -- language
  1,  -- created_by (user_id = 1)
  true,  -- is_active
  'v4.33: 新增独立站增强数据字段支持（REAL USER REVIEWS、CUSTOMER FAQs、TECH SPECS、PACKAGE OPTIONS、SOCIAL PROOF METRICS、CORE FEATURES），增强广告创意质量'  -- change_notes
);

-- ============================================================
-- Verification Query (optional, for manual testing)
-- ============================================================
-- SELECT prompt_id, version, name, is_active, created_at
-- FROM prompt_versions
-- WHERE prompt_id = 'ad_creative_generation'
-- ORDER BY created_at DESC
-- LIMIT 3;
