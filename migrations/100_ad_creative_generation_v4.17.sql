-- =====================================================
-- Migration: 100_ad_creative_generation_v4.17.sql
-- Description: 广告创意生成Prompt v4.17 - 支持店铺链接类型区分
-- Date: 2025-12-24
-- Database: SQLite
-- =====================================================

-- ========================================
-- ad_creative_generation: v4.8 → v4.17
-- ========================================

-- 0. 检查是否已是 v4.17 活跃版本（防重复执行）
INSERT OR IGNORE INTO prompt_versions (
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
  'v4.17',
  '广告创意生成',
  '广告创意生成v4.17 - 支持店铺链接类型区分',
  '根据链接类型（单品/店铺）使用不同的创意策略，支持5种店铺创意类型',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## 🆕 v4.16 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**
**✅ 关键词嵌入和主题一致性不会冲突**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 这些关键词已经是"品牌词 + 桶匹配词"的组合
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ✅ 正确: "Solar Powered Cameras" (关键词: solar camera)
- ❌ 错误: "Camera Camera Camera Security Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式
- 标题之间应有明显差异，覆盖不同用户搜索意图

## 🔥 v4.11 描述嵌入规则 (MANDATORY)

### ⚠️ 强制要求：5/5 (100%) 描述必须包含关键词

**🔑 描述规则**:

**规则1: 品牌词出现**
- **必须**在至少3个描述中包含品牌词 {{brand}}

**规则2: 桶匹配词出现**
- **必须**在所有5个描述中包含当前桶的核心关键词
- 关键词应自然融入描述核心卖点和行动号召中

**规则3: 行动号召 (Call-to-Action)**
- 每个描述**必须**包含明确的CTA
- CTA示例：
  - 购买类：Shop Now, Buy Today, Order Now, Get Yours
  - 探索类：Explore Collection, Discover More, See All
  - 限时类：Limited Time Offer, Don''t Miss Out

**规则4: 描述结构**
- 长度：90-150字符（最佳Google Ads响应式广告长度）
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## 🔥 v4.12 USP 嵌入规则 (MANDATORY)

### ⚠️ 强制要求：3/3 (100%) 描述必须包含 USP

**🔑 USP 规则**:

**规则1: USP 数量**
- 从 {{unique_selling_points}} 中提取 **3个最相关** 的 USP
- 这些 USP 应与当前创意类型（{{bucket_type}}）高度相关

**规则2: USP 融入**
- **必须**将 3 个 USP 分别融入 3 个不同的描述中
- 每个描述包含 1 个核心 USP
- USP 融入方式：
  - 直接引用：{{usps}} 中的具体内容
  - 自然嵌入：融入描述的核心卖点和 CTA 中

**规则3: USP 与 CTA 配合**
- USP 后应紧跟相关的 CTA
- 示例："Free Shipping + Fast Delivery → Shop Now"

## 🔥 v4.14 差异化策略

### ⚠️ 强制要求：避免创意之间高度相似

**🔑 差异化规则**:

**规则1: 核心卖点差异化**
- 每组5个标题应使用 **不同的核心卖点**
- 例如：
  - 标题1-3: 使用 USP 1 (技术规格)
  - 标题4-5: 使用 USP 2 (用户体验)
  - 避免所有标题都围绕同一个卖点

**规则2: 表达方式差异化**
- 避免相似的句式结构
- 混合使用：
  - 疑问句 vs 陈述句
  - 数字驱动 vs 情感驱动
  - 紧迫感 vs 理性分析

**规则3: 关键词位置差异化**
- 品牌词位置：标题开头/中间/结尾
- 品类词位置：与不同关键词组合
- 行动词变化：Shop/Buy/Discover/Get/Explore

## 🔥 v4.15 本地化规则 (CRITICAL)

### ⚠️ 强制要求：根据目标国家本地化

**🔑 本地化规则**:

**规则1: 货币符号**
- 🇺🇸 US: USD ($)
- 🇬🇧 UK: GBP (£)
- 🇪🇺 EU: EUR (€)
- 🇯🇵 JP: JPY (¥)
- 其他: 根据 {{target_country}} 使用对应货币符号

**规则2: 紧急感本地化**
- 🇺🇸/🇬🇧: "Limited Time", "Today Only", "Ends Soon"
- 🇩🇪/🇪🇸/🇫🇷: "Nur heute", "Oferta limitada", "Offre limitée"
- 🇯🇵: "今だけ", "期間限定"

**规则3: 数字格式**
- 🇺🇸/🇬🇧: 1,234.56
- 🇪🇺: 1.234,56
- 🇯🇵: 123,456

**规则4: 促销词本地化**
- Sale → Oferta / Angebot / Promotion
- Discount → Descuento / Rabatt / Réduction
- Free → Gratis / Gratuit / Kostenlos

## 🆕 v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## 📋 输出格式

**输出5个标题 + 5个描述为一组完整广告创意**

{{output_format_section}}',
  'English',
  1,
  0,
  'v4.17 更新内容:
1. 支持链接类型参数 (linkType: product/store)
2. 单品链接: 4种创意类型 (A产品/B购买/C功能/D紧迫)
3. 店铺链接: 5种创意类型 (A品牌/B场景/C精选/D信任/S全景)
4. 新增店铺链接特殊规则指导
5. 优化关键词分层架构支持'
);

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2. 将 v4.17 设为活跃版本
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.17';

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC
LIMIT 5;
