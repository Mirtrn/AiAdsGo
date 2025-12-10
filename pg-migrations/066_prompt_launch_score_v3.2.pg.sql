-- Migration: 066_prompt_launch_score_v3.2.pg.sql
-- Description: 修复Launch Score Prompt输出格式，匹配ScoreAnalysis接口字段名
-- Date: 2025-12-10

-- 禁用旧版本 v3.1
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'launch_score_evaluation' AND version = 'v3.1';

-- 插入新版本 v3.2（如果不存在）
INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, created_at, change_notes
)
VALUES (
  'launch_score_evaluation',
  'v3.2',
  '投放评分',
  'Launch Score Evaluation',
  '修复JSON输出格式，匹配ScoreAnalysis接口字段名',
  'src/lib/scoring.ts',
  'createLaunchScore',
  'You are a professional Google Ads campaign launch evaluator.

=== CAMPAIGN OVERVIEW ===
Brand: {{brand}}
Product: {{productName}}
Target Country: {{targetCountry}}
Campaign Budget: {{budget}}

=== KEYWORDS DATA ===
Total Keywords: {{keywordCount}}
Match Type Distribution: {{matchTypeDistribution}}
Keywords List:
{{keywordsList}}

Negative Keywords: {{negativeKeywords}}

=== LANDING PAGE ===
URL: {{landingPageUrl}}
Page Type: {{pageType}}

=== AD CREATIVES ===
Headlines Count: {{headlineCount}}
Descriptions Count: {{descriptionCount}}
Sample Headlines: {{sampleHeadlines}}
Sample Descriptions: {{sampleDescriptions}}

=== EVALUATION TASK ===

Score this campaign launch readiness across 5 dimensions (total 100 points):

**1. Keyword Quality (30 points)**
- Relevance to product (0-10)
- Match type strategy (0-8)
- Negative keywords coverage (0-7)
- Search intent alignment (0-5)

IMPORTANT RULES:
- Negative keywords MUST be checked
- Missing negative keywords = deduct 5-10 points
- Competition level is reference only, do NOT deduct points

**2. Market Fit (25 points)**
- Target country alignment (0-10)
- Language/localization (0-8)
- Audience targeting potential (0-7)

IMPORTANT RULES:
- Cross-border domains (amazon.ca, amazon.co.uk) are NORMAL
- Do NOT deduct points for cross-border e-commerce URLs

**3. Landing Page Quality (20 points)**
- URL trustworthiness (0-8)
- Expected load speed (0-6)
- Mobile optimization likelihood (0-6)

**4. Budget Reasonability (15 points)**
- CPC alignment with industry (0-6)
- Competition vs budget match (0-5)
- ROI potential (0-4)

**5. Creative Quality (10 points)**
- Headline attractiveness (0-4)
- Description persuasiveness (0-3)
- Uniqueness and differentiation (0-3)

=== OUTPUT FORMAT ===
Return JSON with EXACT field names:
{
  "keywordAnalysis": {
    "score": 25,
    "issues": ["issue1", "issue2"],
    "suggestions": ["suggestion1", "suggestion2"]
  },
  "marketFitAnalysis": {
    "score": 22,
    "issues": [],
    "suggestions": ["suggestion1"]
  },
  "landingPageAnalysis": {
    "score": 18,
    "issues": [],
    "suggestions": []
  },
  "budgetAnalysis": {
    "score": 12,
    "issues": [],
    "suggestions": ["suggestion1"]
  },
  "contentAnalysis": {
    "score": 8,
    "issues": [],
    "suggestions": ["suggestion1"]
  },
  "overallRecommendations": [
    "Top priority action item 1",
    "Top priority action item 2"
  ]
}

CRITICAL: Use EXACT field names above. Do NOT use "dimensions", "keywordQuality", "marketFit", etc.',
  'Chinese',
  1,
  NOW(),
  '修复字段名：dimensions.keywordQuality → keywordAnalysis，匹配ScoreAnalysis接口'
)
ON CONFLICT (prompt_id, version) DO NOTHING;

-- 确保v3.2是唯一激活的版本
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'launch_score_evaluation' AND version != 'v3.2';

UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'launch_score_evaluation' AND version = 'v3.2';
