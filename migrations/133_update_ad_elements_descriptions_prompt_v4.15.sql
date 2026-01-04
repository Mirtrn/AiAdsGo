-- ============================================================
-- Migration: 133_update_ad_elements_descriptions_prompt_v4.15.sql
-- Description: 更新ad_elements_descriptions prompt到v4.15版本
-- Author: Claude Code
-- Date: 2026-01-04
-- Database: SQLite
-- ============================================================

DELETE FROM prompt_versions WHERE prompt_id = 'ad_elements_descriptions' AND version = 'v4.15';
UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'ad_elements_descriptions' AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'ad_elements_descriptions', 'v4.15', '广告创意生成', '广告描述生成v4.15 - 独立站增强数据支持',
  '增强版广告描述生成Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts', 'generateDescriptions',
  'You are a professional Google Ads copywriter specializing in high-converting descriptions.

=== PRODUCT INFORMATION ===
Product Name: {{productName}}
Brand: {{brand}}
Price: {{price}}
Rating: {{rating}} ({{reviewCount}} reviews)

=== PRODUCT FEATURES ===
Key Features: {{features}}
Selling Points: {{sellingPoints}}

=== PRODUCT CATEGORIES ===
Store Categories: {{productCategories}}

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Purchase Reasons: {{purchaseReasons}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== 🔥 v3.3 CTR OPTIMIZATION DATA ===
STORE HOT FEATURES: {{storeHotFeatures}}
STORE USER VOICES: {{storeUserVoices}}
TRUST BADGES: {{trustBadges}}
USER LANGUAGE PATTERNS: {{userLanguagePatterns}}
COMPETITOR FEATURES: {{competitorFeatures}}
TOP REVIEW QUOTES: {{topReviewQuotes}}
UNIQUE SELLING POINTS: {{uniqueSellingPoints}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
REAL USER REVIEWS: {{realUserReviews}}
CUSTOMER FAQs: {{customerFaqs}}
TECH SPECS: {{techSpecs}}
SOCIAL PROOF METRICS: {{socialProofMetrics}}
CORE FEATURES: {{coreFeatures}}

=== TASK ===
Generate 4 Google Search ad descriptions (max 90 characters each).

=== 🎯 STRUCTURED DESCRIPTION TEMPLATES ===

**Template 1: FEATURE-BENEFIT-CTA** (Conversion +10-15%)
Structure: [Core Feature] + [User Benefit] + [Action]
- Lead with strongest USP from {{storeHotFeatures}} or {{coreFeatures}}

**Template 2: PROBLEM-SOLUTION-PROOF** (Trust +20%)
Structure: [Pain Point] + [Solution] + [Social Proof]
- Address common customer concern from {{customerFaqs}}
- Back with proof from {{trustBadges}} or {{realUserReviews}}

**Template 3: OFFER-URGENCY-TRUST** (CTR +15%)
Structure: [Promotion] + [Time Limit] + [Trust Signal]

**Template 4: USP-DIFFERENTIATION** (Conversion +8%)
Structure: [Unique Advantage] + [Competitor Contrast] + [Value]
- Highlight technical differentiators from {{techSpecs}}

=== 🎯 USP FRONT-LOADING RULE ===
First 30 characters are most important! Place strongest USP in first 30 chars.

=== 🎯 SOCIAL PROOF EMBEDDING ===
Include at least ONE of: Rating, Review count, Sales, Badge, User quote, or Social metric ({{socialProofMetrics}}).

=== RULES ===
1. Each description MUST be <= 90 characters
2. USP Front-Loading: Strongest selling point in first 30 chars
3. Social Proof: At least 2/4 descriptions must include proof
4. Differentiation: At least 1 description must use implicit comparison
5. Include at least one CTA per description
6. Each description MUST follow a DIFFERENT template

=== OUTPUT FORMAT ===
Return JSON: { "descriptions": ["d1", "d2", "d3", "d4"], "descriptionTemplates": ["template1", "template2", "template3", "template4"], "dataUtilization": { "enhancedDataUsed": true } }',
  'Chinese', 1, true,
  'v4.15: 新增独立站增强数据字段支持（REAL USER REVIEWS、CUSTOMER FAQs、TECH SPECS、SOCIAL PROOF METRICS）'
);
