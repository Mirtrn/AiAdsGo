-- Migration: 134_update_ad_elements_headlines_prompt_v4.15.pg.sql (PostgreSQL)
DELETE FROM prompt_versions WHERE prompt_id = 'ad_elements_headlines' AND version = 'v4.15';
UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_elements_headlines' AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'ad_elements_headlines', 'v4.15', '广告创意生成', '广告标题生成v4.15 - 独立站增强数据支持',
  '增强版广告标题生成Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts', 'generateHeadlines',
  $PROMPT$You are a professional Google Ads copywriter. Generate 15 ad headlines (max 30 chars each).

=== PRODUCT INFO ===
Product: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
REAL USER REVIEWS: {{realUserReviews}}
TECH SPECS: {{techSpecs}}
SOCIAL PROOF METRICS: {{socialProofMetrics}}
CORE FEATURES: {{coreFeatures}}

=== TASK ===
Generate 15 headlines in these groups:
1. Brand + USP (3) - From {{product.uniqueSellingPoints}} and {{coreFeatures}}
2. Keyword + Audience (3) - Combine {{topKeywords}} with {{product.targetAudience}}
3. Feature + Number (3) - From {{product.productHighlights}} and {{techSpecs}}
4. Social Proof (3) - Use {{trustBadges}} and {{socialProofMetrics}}
5. Question + Pain Point (3) - From {{realUserReviews}}

=== OUTPUT FORMAT ===
Return JSON: { "headlines": ["h1", ...(15)], "dataUtilization": { "enhancedDataUsed": true } }
$PROMPT$,
  'Chinese', 1, true,
  'v4.15: 新增独立站增强数据字段支持（REAL USER REVIEWS、TECH SPECS、SOCIAL PROOF METRICS、CORE FEATURES）'
);
