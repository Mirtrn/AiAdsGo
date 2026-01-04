-- Migration: 134_update_ad_elements_headlines_prompt_v4.15.sql (SQLite)
DELETE FROM prompt_versions WHERE prompt_id = 'ad_elements_headlines' AND version = 'v4.15';
UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'ad_elements_headlines' AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'ad_elements_headlines', 'v4.15', '广告创意生成', '广告标题生成v4.15 - 独立站增强数据支持',
  '增强版广告标题生成Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts', 'generateHeadlines',
  'You are a professional Google Ads copywriter specializing in high-CTR headlines.

=== PRODUCT INFORMATION ===
Product Name: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}} ({{product.reviewCount}} reviews)
Price: {{product.price}}

=== 🎯 DEEP ANALYSIS DATA (PRIORITY) ===
Unique Selling Points: {{product.uniqueSellingPoints}}
Target Audience: {{product.targetAudience}}
Product Highlights: {{product.productHighlights}}
Brand Description: {{product.brandDescription}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
REAL USER REVIEWS: {{realUserReviews}}
TECH SPECS: {{techSpecs}}
SOCIAL PROOF METRICS: {{socialProofMetrics}}
CORE FEATURES: {{coreFeatures}}

=== PRODUCT FEATURES ===
About This Item: {{product.aboutThisItem}}
Key Features: {{product.features}}

=== HIGH-VOLUME KEYWORDS ===
{{topKeywords}}

=== PRODUCT CATEGORIES ===
Store Categories: {{productCategories}}

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Use Cases: {{reviewUseCases}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== 🎯 HEADLINE STRATEGIES ===

**Group 1: Brand + USP (3)** - Use {{product.uniqueSellingPoints}} and {{coreFeatures}}
**Group 2: Keyword + Audience (3)** - Combine {{topKeywords}} with {{product.targetAudience}}
**Group 3: Feature + Number (3)** - From {{product.productHighlights}} and {{techSpecs}}
**Group 4: Social Proof (3)** - Use {{trustBadges}}, ratings, {{socialProofMetrics}}
**Group 5: Question + Pain Point (3)** - Address needs from {{realUserReviews}}

=== RULES ===
1. Each headline MUST be <= 30 characters
2. Include at least 3 question headlines (CTR +5-12%)
3. Use numbers and specifics when available (CTR +15-25%)
4. Create DKI-ready headlines (use {KeyWord:default})
5. 🆕 Leverage {{realUserReviews}} for authentic user voice headlines
6. 🆕 Use {{socialProofMetrics}} for trust-based headlines

=== OUTPUT FORMAT ===
Return JSON: { "headlines": ["h1", "h2", ...(15)], "headlineGroups": {...}, "dataUtilization": { "enhancedDataUsed": true } }',
  'Chinese', 1, true,
  'v4.15: 新增独立站增强数据字段支持（REAL USER REVIEWS、TECH SPECS、SOCIAL PROOF METRICS、CORE FEATURES）'
);
