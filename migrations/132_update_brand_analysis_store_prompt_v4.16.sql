-- ============================================================
-- Migration: 132_update_brand_analysis_store_prompt_v4.16.sql
-- Description: 更新brand_analysis_store prompt到v4.16版本
--              新增独立站增强数据字段支持（reviews、faqs、specifications等）
-- Author: Claude Code
-- Date: 2026-01-04
-- Database: SQLite
-- ============================================================

-- 🔥 幂等性保证：先删除v4.16版本（如果存在）
DELETE FROM prompt_versions
WHERE prompt_id = 'brand_analysis_store'
AND version = 'v4.16';

-- 🔥 停用旧版本v4.15
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'brand_analysis_store'
AND version = 'v4.15';

-- 🔥 插入新版本v4.16
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
  'brand_analysis_store',
  'v4.16',
  '品牌分析',
  '品牌店铺分析v4.16 - 独立站增强数据支持',
  '增强版品牌店铺分析Prompt，新增独立站增强数据字段支持（REAL USER REVIEWS、FAQ、TECHNICAL SPECS、SOCIAL PROOF），提升品牌分析深度',
  'src/lib/ai.ts',
  'analyzeBrandStore',
  'You are a professional brand analyst. Analyze the BRAND STORE PAGE data and extract comprehensive brand information.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE PRODUCTS DATA ===
{{pageData.text}}

=== 🎯 SUPPLEMENTARY DATA (v3.4) ===
**Technical Details** (product specifications if available):
{{technicalDetails}}

**Review Highlights** (key customer feedback if available):
{{reviewHighlights}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.16 New）===

**User Reviews** (Actual customer feedback):
{{reviews}}

**Frequently Asked Questions** (Common customer questions):
{{faqs}}

**Product Specifications** (Detailed tech specs):
{{specifications}}

**Social Proof** (Trust metrics):
{{socialProof}}

**Core Features** (Primary selling points):
{{coreFeatures}}

⚠️ USE THIS DATA: If the above enhanced data is available (not "Not available"), incorporate them into your analysis for richer insights about product quality and customer satisfaction.

=== ANALYSIS METHODOLOGY ===

Hot Score Formula: Rating × log10(Review Count + 1)
- TOP 5 HOT-SELLING = highest scores (proven winners)
- Other best sellers = good performers

=== ANALYSIS PRIORITIES ===

1. **Hot Products Analysis** (TOP 5 by Hot Score):
   - Product names and categories
   - Price points and positioning
   - Review scores and volume
   - Why these products succeed
   - 🆕 Include insights from {{technicalDetails}} and {{coreFeatures}} if available
   - 🆕 Use {{reviews}} to validate customer satisfaction

2. **Brand Positioning**:
   - Core brand identity
   - Price tier (Budget/Mid/Premium)
   - Primary product categories
   - Brand differentiators
   - 🆕 Validate with {{socialProof}} metrics

3. **Target Audience**:
   - Demographics
   - Use cases
   - Pain points addressed
   - Lifestyle fit
   - 🆕 Use {{faqs}} to understand customer concerns

4. **Value Proposition**:
   - Key benefits
   - Unique selling points
   - Customer promises
   - 🆕 Validate with {{reviewHighlights}} and {{reviews}} if available

5. **Quality Indicators**:
   - Amazon Choice badge
   - Best Seller rankings
   - Prime eligibility
   - Active promotions
   - High review counts (500+)
   - 🆕 Customer sentiment from {{reviews}} and {{socialProof}}

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== KEYWORDS QUALITY REQUIREMENTS (CRITICAL) ===
"keywords" 字段必须严格遵循以下要求：

1. **输出格式**：
   - JSON数组格式：["关键词1", "关键词2", "关键词3"]
   - 每个关键词用双引号包围
   - 关键词之间用英文逗号分隔

2. **长度限制**：
   - 每个关键词≤5个单词
   - 禁止：超过5个单词的长描述

3. **允许的关键词类型**：
   ✅ **品牌相关词**：{{pageData.brand}}, {{pageData.brand}} official, {{pageData.brand}} store
   ✅ **产品类别词**：smart ring, fitness tracker, health monitor
   ✅ **功能词**：sleep tracking, heart rate monitoring, stress tracking
   ✅ **场景词**：workout tracking, health monitoring, wellness tracking

4. **严格禁止的关键词**：
   ❌ **购买渠道**：store, shop, amazon, ebay, near me, official
   ❌ **价格词**：price, cost, cheap, discount, sale, deal, coupon, code
   ❌ **时间词**：2025, 2024, black friday, prime day, cyber monday
   ❌ **查询词**：history, tracker, locator, review, compare, vs
   ❌ **购买行为**：buy, purchase, order, where to buy

5. **数量要求**：
   - 生成15-25个关键词
   - 确保涵盖品牌、产品类别、功能、场景等不同维度

6. **示例**（错误示例）：
   ❌ "RingConn Gen 2 Smart Ring, weltweit erstes Schlafapnoe-Monitoring, Keine App-Abonnement" (太长)
   ❌ "ringconn store amazon discount code 2025" (过度组合)
   ❌ "ringconn price history" (查询词)

7. **示例**（正确示例）：
   ✅ ["smart ring", "fitness tracker", "health monitor", "sleep tracking", "heart rate monitoring"]

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object:
{
  "brandName": "Official brand name",
  "brandDescription": "Comprehensive brand overview",
  "positioning": "Premium/Mid-range/Budget positioning analysis",
  "targetAudience": "Detailed target customer description",
  "valueProposition": "Core value proposition statement",
  "categories": ["Category 1", "Category 2"],
  "sellingPoints": ["Brand USP 1", "Brand USP 2", "Brand USP 3"],
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "hotProducts": [
    {
      "name": "Product name",
      "category": "Product category",
      "price": "$XX.XX",
      "rating": 4.5,
      "reviewCount": 1234,
      "hotScore": 3.87,
      "successFactors": ["Factor 1", "Factor 2"],
      "productHighlights": ["Key feature 1", "Key feature 2", "Key feature 3"]
    }
  ],
  "qualityIndicators": {
    "amazonChoiceCount": 3,
    "bestSellerCount": 2,
    "primeProductRatio": "80%",
    "avgRating": 4.3,
    "totalReviews": 50000,
    "🆕 socialProofMetrics": ["18,000+ Installations", "60% Decrease in Accident Rates"]
  },
  "competitiveAnalysis": {
    "strengths": ["Strength 1", "Strength 2"],
    "opportunities": ["Opportunity 1", "Opportunity 2"]
  }
}

=== IMPORTANT NOTES ===
- Ensure "keywords" field follows ALL quality requirements above
- Do NOT include any prohibited keywords
- Focus on brand identity, product categories, and use cases
- Keywords should be search-friendly and have commercial value
- 🔥 Leverage {{reviews}}, {{faqs}}, and {{socialProof}} for deeper customer insights',
  1,  -- is_active
  datetime('now'),
  datetime('now')
);
