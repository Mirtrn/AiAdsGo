-- Migration: 132_update_brand_analysis_store_prompt_v4.16.pg.sql (PostgreSQL)
DELETE FROM prompt_versions WHERE prompt_id = 'brand_analysis_store' AND version = 'v4.16';
UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'brand_analysis_store' AND version = 'v4.15';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'brand_analysis_store', 'v4.16', '品牌分析', '品牌店铺分析v4.16 - 独立站增强数据支持',
  '增强版品牌店铺分析Prompt，新增独立站增强数据字段支持',
  'src/lib/ai.ts', 'analyzeBrandStore',
  $PROMPT$You are a professional brand analyst. Analyze the BRAND STORE PAGE data.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE PRODUCTS DATA ===
{{pageData.text}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.16 New）===
User Reviews: {{reviews}}
FAQs: {{faqs}}
Tech Specs: {{specifications}}
Social Proof: {{socialProof}}
Core Features: {{coreFeatures}}

⚠️ USE THIS DATA: If available, incorporate into your analysis.

=== ANALYSIS PRIORITIES ===
1. Hot Products Analysis - Use {{technicalDetails}} and {{coreFeatures}}
2. Brand Positioning - Validate with {{socialProof}} metrics
3. Target Audience - Use {{faqs}} to understand concerns
4. Value Proposition - Validate with {{reviews}}
5. Quality Indicators - Customer sentiment from {{reviews}} and {{socialProof}}

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== OUTPUT FORMAT ===
Return COMPLETE JSON with brand analysis and keywords.
$PROMPT$,
  'English', 1, true,
  'v4.16: 新增独立站增强数据字段支持（REAL USER REVIEWS、FAQ、TECHNICAL SPECS、SOCIAL PROOF）'
);
