-- ============================================================
-- Migration: 130_update_prompt_v4.16.pg.sql
-- Description: 更新product_analysis_single prompt到v4.16版本
--              新增独立站增强数据字段（reviews、faqs、specifications等）
-- Author: Claude Code
-- Date: 2026-01-04
-- Database: PostgreSQL
-- ============================================================

-- 🔥 幂等性保证：先删除v4.16版本（如果存在）
DELETE FROM prompt_versions
WHERE prompt_id = 'product_analysis_single'
AND version = 'v4.16';

-- 🔥 停用旧版本v4.15
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'product_analysis_single'
AND version = 'v4.15';

-- 🔥 插入新版本v4.16（使用$$语法避免转义问题）
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
  'product_analysis_single',
  'v4.16',
  '产品分析',
  '单品产品分析v4.16',
  '增强版单品产品分析Prompt，新增独立站增强数据字段支持（reviews、faqs、specifications、packages、socialProof、coreFeatures、secondaryFeatures）',
  'src/lib/ai.ts',
  'analyzeProductPage',
  $$You are a professional product analyst. Analyze the following product page data comprehensively.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== FULL PAGE DATA ===
{{pageData.text}}

=== 🎯 ENHANCED DATA (P1 Optimization) ===

**Technical Specifications** (Direct from product detail page):
{{technicalDetails}}

**Review Highlights** (Key points from user reviews):
{{reviewHighlights}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA (v4.16 New) ===

**User Reviews** (Actual customer feedback from Judge.me/other review systems):
{{reviews}}
- Use these reviews to identify real customer pain points and needs
- Extract authentic use cases and satisfaction indicators
- Identify common praises and concerns

**Frequently Asked Questions** (Common customer questions):
{{faqs}}
- Understand what customers care about most
- Use FAQs to address potential objections in your analysis
- Identify information gaps that need to be highlighted

**Product Specifications** (Detailed technical specs):
{{specifications}}
- Use for technical differentiation analysis
- Identify standout specifications vs competitors

**Package Options** (Available product bundles):
{{packages}}
- Analyze pricing tiers and value propositions
- Identify upsell opportunities

**Social Proof** (Trust indicators and metrics):
{{socialProof}}
- Use metrics like "18,000+ Installations" to assess market acceptance
- Leverage social proof for competitive positioning

**Core Features** (Primary selling points):
{{coreFeatures}}
- These are the main value propositions
- Prioritize in your analysis

**Secondary Features** (Additional benefits):
{{secondaryFeatures}}
- Use to round out the value proposition
- Identify differentiation opportunities

=== ANALYSIS REQUIREMENTS ===

CRITICAL: Focus ONLY on the MAIN PRODUCT. IGNORE:
- "Customers also bought"
- "Frequently bought together"
- "Related products"
- "Compare with similar items"

Analyze the following dimensions using the data provided:

1. **Product Core** (from Title, Description, PRODUCT FEATURES, ABOUT THIS ITEM, Core Features):
   - Product name and model
   - Key selling points (USPs)
   - 🔥 USE Core Features and Secondary Features data above
   - Core features and benefits
   - Target use cases

2. **Technical Analysis** (from TECHNICAL DETAILS, Specifications sections above):
   - 🎯 USE the provided Technical Specifications data above
   - 🔥 USE the Product Specifications data above
   - Key specifications that matter to customers
   - Dimensions and compatibility information
   - Material and build quality indicators
   - Technical advantages vs competitors

3. **Pricing Intelligence** (from Price data, Package Options):
   - Current vs Original price
   - Discount percentage
   - 🔥 USE Package Options to analyze pricing tiers
   - Price competitiveness assessment
   - Value proposition

4. **Review Insights** (from Rating, Review Count, Review Highlights, User Reviews sections above):
   - 🎯 USE the provided Review Highlights data above
   - 🔥 USE the User Reviews data above for deeper insights
   - Overall sentiment
   - Key positives customers mention
   - Common concerns or issues
   - Real use cases from reviews
   - Credibility indicators from actual user experience

5. **Customer Intent Analysis** (from FAQs section above):
   - 🔥 USE the FAQs data above to understand customer concerns
   - Identify what customers care about most
   - Address potential objections preemptively
   - Highlight information that answers common questions

6. **Market Position** (from Sales Rank, Category, Prime, Badges, Social Proof):
   - Category ranking
   - Prime eligibility impact
   - Quality badges (Amazon's Choice, Best Seller)
   - 🔥 USE Social Proof data to assess market acceptance
   - Market competitiveness

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
   ✅ **品牌相关词**：{{pageData.brand}}, {{pageData.brand}} official
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
Return a COMPLETE JSON object with this structure:
{
  "productDescription": "Detailed product description emphasizing technical specs and user-validated features from reviews and FAQs",
  "sellingPoints": ["USP 1 (from tech specs)", "USP 2 (from reviews)", "USP 3 (from FAQs)", "USP 4 (from social proof)"],
  "targetAudience": "Description of ideal customers based on use cases, FAQs, and review insights",
  "category": "Product category",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "pricing": {
    "current": "$.XX",
    "original": "$.XX or null",
    "discount": "XX% or null",
    "competitiveness": "Premium/Competitive/Budget",
    "valueAssessment": "Analysis of price-to-value ratio based on features, reviews, and packages"
  },
  "reviews": {
    "rating": 4.5,
    "count": 1234,
    "sentiment": "Positive/Mixed/Negative",
    "positives": ["Pro 1 (from reviews)", "Pro 2 (from reviews)"],
    "concerns": ["Con 1 (from reviews)", "Con 2 (from FAQs)"],
    "useCases": ["Use case 1 (from reviews)", "Use case 2 (from FAQs)"]
  },
  "promotions": {
    "active": true,
    "types": ["Coupon", "Deal", "Lightning Deal"],
    "urgency": "Limited time offer" or null
  },
  "competitiveEdges": {
    "badges": ["Amazon's Choice", "Best Seller"],
    "primeEligible": true,
    "stockStatus": "In Stock",
    "salesRank": "#123 in Category",
    "socialProof": ["18,000+ Installations", "60% Decrease in Accident Rates"]
  },
  "productHighlights": ["Key spec 1 (verified by reviews)", "Key spec 2 (from FAQs)", "Key spec 3 (from social proof)"]
}

=== IMPORTANT NOTES ===
- Ensure "keywords" field follows ALL quality requirements above
- Do NOT include any prohibited keywords
- Focus on product features, use cases, and technical specifications
- Keywords should be search-friendly and have commercial value
- 🔥 Leverage User Reviews, FAQs, and Social Proof data for deeper insights
- 🔥 Prioritize customer-validated features over marketing claims$$,
  'English',  -- language
  1,  -- created_by (user_id = 1)
  true,  -- is_active
  'v4.16: 新增独立站增强数据字段支持（reviews、faqs、specifications、packages、socialProof、coreFeatures、secondaryFeatures），提升AI分析质量'  -- change_notes
);

-- ============================================================
-- Verification Query (optional, for manual testing)
-- ============================================================
-- SELECT prompt_id, version, name, is_active, created_at
-- FROM prompt_versions
-- WHERE prompt_id = 'product_analysis_single'
-- ORDER BY created_at DESC
-- LIMIT 3;
