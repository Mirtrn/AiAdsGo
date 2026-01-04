-- Migration: 135_update_store_highlights_synthesis_prompt_v4.15.sql (SQLite)
DELETE FROM prompt_versions WHERE prompt_id = 'store_highlights_synthesis' AND version = 'v4.15';
UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'store_highlights_synthesis' AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'store_highlights_synthesis', 'v4.15', '广告创意生成', '店铺产品亮点整合v4.15 - 独立站增强数据支持',
  '增强版店铺亮点整合Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts', 'synthesizeStoreHighlights',
  'You are a product marketing expert. Analyze the product highlights from {{productCount}} hot-selling products in a brand store and synthesize them into 5-8 key store-level product highlights.

=== INPUT: Product Highlights by Product ===
{{productHighlights}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
STORE CORE FEATURES: {{coreFeatures}}
STORE SOCIAL PROOF METRICS: {{socialProofMetrics}}
STORE REVIEWS AGGREGATION: {{storeReviews}}

=== TASK ===
Synthesize these product-level highlights into 5-8 concise, store-level product highlights that:
1. Identify common themes and technologies across products
2. Highlight unique innovations that differentiate the brand
3. Focus on customer benefits, not just features
4. Use clear, compelling language
5. Avoid repetition
6. 🆕 Incorporate social proof ({{socialProofMetrics}}) for credibility
7. 🆕 Validate highlights with customer reviews ({{storeReviews}})

=== OUTPUT FORMAT ===
Return a JSON object with this structure:
{
  "storeHighlights": [
    "Highlight 1 - Brief explanation",
    "Highlight 2 - Brief explanation",
    ...
  ],
  "dataUtilization": {
    "enhancedDataUsed": true,
    "socialProofMetrics": [...],
    "coreFeatures": [...]
  }
}

Output in {{langName}}.',
  'English', 1, true,
  'v4.15: 新增独立站增强数据字段支持（SOCIAL PROOF METRICS、CORE FEATURES、STORE REVIEWS）'
);
