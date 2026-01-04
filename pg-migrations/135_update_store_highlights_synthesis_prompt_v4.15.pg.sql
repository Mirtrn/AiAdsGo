-- Migration: 135_update_store_highlights_synthesis_prompt_v4.15.pg.sql (PostgreSQL)
DELETE FROM prompt_versions WHERE prompt_id = 'store_highlights_synthesis' AND version = 'v4.15';
UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'store_highlights_synthesis' AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'store_highlights_synthesis', 'v4.15', '广告创意生成', '店铺产品亮点整合v4.15 - 独立站增强数据支持',
  '增强版店铺亮点整合Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts', 'synthesizeStoreHighlights',
  $PROMPT$You are a product marketing expert. Synthesize product highlights from {{productCount}} products into 5-8 store-level highlights.

=== INPUT: Product Highlights ===
{{productHighlights}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
STORE CORE FEATURES: {{coreFeatures}}
STORE SOCIAL PROOF METRICS: {{socialProofMetrics}}
STORE REVIEWS: {{storeReviews}}

=== TASK ===
Synthesize into 5-8 store highlights that:
1. Identify common themes and technologies
2. Highlight unique innovations
3. Focus on customer benefits
4. Incorporate {{socialProofMetrics}} for credibility
5. Validate with {{storeReviews}}

=== OUTPUT FORMAT ===
Return JSON: { "storeHighlights": ["h1", "h2", ...], "dataUtilization": { "enhancedDataUsed": true } }

Output in {{langName}}.
$PROMPT$,
  'English', 1, true,
  'v4.15: 新增独立站增强数据字段支持（SOCIAL PROOF METRICS、CORE FEATURES、STORE REVIEWS）'
);
