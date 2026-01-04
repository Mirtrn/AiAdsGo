-- Migration: 133_update_ad_elements_descriptions_prompt_v4.15.pg.sql (PostgreSQL)
DELETE FROM prompt_versions WHERE prompt_id = 'ad_elements_descriptions' AND version = 'v4.15';
UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_elements_descriptions' AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'ad_elements_descriptions', 'v4.15', '广告创意生成', '广告描述生成v4.15 - 独立站增强数据支持',
  '增强版广告描述生成Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts', 'generateDescriptions',
  $PROMPT$You are a professional Google Ads copywriter. Generate 4 ad descriptions (max 90 chars each).

=== PRODUCT INFO ===
Product: {{productName}}
Brand: {{brand}}
Price: {{price}}
Rating: {{rating}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
REAL USER REVIEWS: {{realUserReviews}}
CUSTOMER FAQs: {{customerFaqs}}
TECH SPECS: {{techSpecs}}
SOCIAL PROOF METRICS: {{socialProofMetrics}}
CORE FEATURES: {{coreFeatures}}

=== TASK ===
Generate 4 descriptions using these templates:
1. FEATURE-BENEFIT-CTA - Use {{coreFeatures}} and {{techSpecs}}
2. PROBLEM-SOLUTION-PROOF - Address concerns from {{customerFaqs}}, use {{realUserReviews}}
3. OFFER-URGENCY-TRUST - Use {{promotionInfo}} and {{socialProofMetrics}}
4. USP-DIFFERENTIATION - Highlight unique advantages

=== OUTPUT FORMAT ===
Return JSON: { "descriptions": ["d1", "d2", "d3", "d4"], "dataUtilization": { "enhancedDataUsed": true } }
$PROMPT$,
  'Chinese', 1, true,
  'v4.15: 新增独立站增强数据字段支持（REAL USER REVIEWS、CUSTOMER FAQs、TECH SPECS、SOCIAL PROOF METRICS）'
);
