-- =====================================================
-- Migration: 073_prompt_ctr_optimization_v3.3.sql
-- Date: 2025-12-12
-- Purpose: CTR/CPC优化 - 增强标题和描述生成策略
-- Changes:
--   1. ad_elements_headlines v3.2 → v3.3:
--      - 新增DKI模板支持
--      - 数字具体化策略
--      - 情感触发词库
--      - 问句式标题
--      - 关键词嵌入率要求
--   2. ad_elements_descriptions v3.2 → v3.3:
--      - 结构化描述模板(Feature-Benefit-CTA等)
--      - USP前置规则
--      - 社会证明嵌入
--      - 竞品差异化暗示
-- =====================================================

-- Step 1: Deactivate old versions
UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'ad_elements_headlines' AND is_active = 1;
UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'ad_elements_descriptions' AND is_active = 1;

-- Step 2: Insert new headline prompt v3.3
INSERT INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, change_notes, created_at)
VALUES (
  'ad_elements_headlines',
  'v3.3',
  '广告创意生成',
  '广告标题生成v3.3 - CTR优化增强版',
  'CTR优化增强版：DKI模板、数字具体化、情感触发、问句式标题、关键词嵌入率',
  'src/lib/ad-elements-extractor.ts',
  'generateHeadlines',
  'You are a professional Google Ads copywriter specializing in high-CTR headlines.

=== PRODUCT INFORMATION ===
Product Name: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}} ({{product.reviewCount}} reviews)
Price: {{product.price}}

=== PRODUCT FEATURES ===
About This Item:
{{product.aboutThisItem}}

Key Features:
{{product.features}}

=== HIGH-VOLUME KEYWORDS ===
{{topKeywords}}

=== PRODUCT CATEGORIES ===
Store Categories: {{productCategories}}

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Use Cases: {{reviewUseCases}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== 🔥 v3.3 CTR OPTIMIZATION DATA ===

**STORE HOT FEATURES** (from best-selling products):
{{storeHotFeatures}}

**STORE USER VOICES** (aggregated reviews):
{{storeUserVoices}}

**TRUST BADGES** (credibility indicators):
{{trustBadges}}

**USER LANGUAGE PATTERNS** (natural expressions):
{{userLanguagePatterns}}

**COMPETITOR FEATURES** (for differentiation):
{{competitorFeatures}}

**TOP REVIEW QUOTES** (authentic voices):
{{topReviewQuotes}}

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== 🎯 v3.3 CTR OPTIMIZATION STRATEGIES ===

**Strategy 1: NUMBERS & SPECIFICS** (CTR +15-25%)
- Replace vague words with specific numbers
- Extract from product features: resolution (4K, 8MP), battery (180 Days), storage (128GB)
- Examples: "4K Ultra HD Camera" NOT "High Quality Camera"
- Examples: "180-Day Battery Life" NOT "Long Battery"
- Examples: "Save $50 Today" NOT "Great Savings"

**Strategy 2: EMOTIONAL TRIGGERS** (CTR +10-15%)
Use these power words strategically:
- Trust: "Trusted", "Verified", "#1 Rated", "Official"
- Exclusivity: "Exclusive", "Members Only", "VIP"
- Social Proof: "10000+ Sold", "Best Seller", "Top Rated"
- Value: "Best Value", "Premium Quality", "Unbeatable"

**Strategy 3: QUESTION HEADLINES** (CTR +5-12%)
- Generate 1-2 question-style headlines
- Address user pain points or needs
- Examples: "Need Home Security?", "Want 4K Quality?"

**Strategy 4: DKI-READY TEMPLATES** (CTR +15-25%)
- Create headlines that work with Dynamic Keyword Insertion
- Format: "{KeyWord:Default Text}" - but output the DEFAULT version
- Mark DKI-compatible headlines in analysis
- Examples: "Buy Security Camera" (DKI: "Buy {KeyWord:Security Camera}")

=== HEADLINE GROUPS (15 total) ===

**Group 1: Brand + Product (3 headlines)**
- Must include brand name
- Include core product type
- At least 1 with specific number/spec

**Group 2: Keyword-Rich (3 headlines)**
- Incorporate TOP 3 high-volume keywords
- 🔥 CRITICAL: Each headline MUST contain at least 1 keyword from {{topKeywords}}
- Match search intent naturally

**Group 3: Feature + Number (3 headlines)** 🆕
- Lead with specific numbers from features
- Combine spec + benefit
- Examples: "4K + Night Vision", "8MP Crystal Clear"

**Group 4: Emotional + Social Proof (3 headlines)** 🆕
- Use EMOTIONAL TRIGGERS
- Include trust signals
- Examples: "#1 Rated Camera", "Trusted by 1M+"

**Group 5: Question + CTA (3 headlines)** 🆕
- 1-2 question headlines
- 1-2 strong CTA headlines
- Examples: "Need Security?", "Shop Now & Save"

=== RULES ===
1. Each headline MUST be <= 30 characters (including spaces)
2. 🔥 **Keyword Embedding**: At least 8/15 headlines must contain a keyword from {{topKeywords}}
3. 🔥 **Number Usage**: At least 5/15 headlines must contain specific numbers
4. 🔥 **Diversity**: No two headlines should share more than 2 words
5. Use high-intent language: "Buy", "Shop", "Get", "Save", "Discover"
6. NO quotation marks in headlines
7. Vary headline styles for RSA optimization

=== OUTPUT FORMAT ===
Return JSON:
{
  "headlines": ["headline1", "headline2", ..., "headline15"],
  "headlineAnalysis": {
    "brandHeadlines": [0, 1, 2],
    "keywordHeadlines": [3, 4, 5],
    "featureNumberHeadlines": [6, 7, 8],
    "emotionalProofHeadlines": [9, 10, 11],
    "questionCtaHeadlines": [12, 13, 14],
    "dkiCompatible": [3, 4, 5, 12, 13],
    "keywordsEmbedded": ["keyword1", "keyword2", ...],
    "numbersUsed": ["4K", "180 Days", "$50", ...]
  },
  "ctrOptimization": {
    "keywordEmbeddingRate": 0.6,
    "numberUsageRate": 0.4,
    "emotionalTriggerCount": 3,
    "questionHeadlineCount": 2
  }
}',
  1,
  'v3.3 CTR优化: 1)数字具体化策略 2)情感触发词 3)问句式标题 4)DKI模板支持 5)关键词嵌入率要求(8/15)',
  datetime('now')
);

-- Step 3: Insert new description prompt v3.3
INSERT INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, change_notes, created_at)
VALUES (
  'ad_elements_descriptions',
  'v3.3',
  '广告创意生成',
  '广告描述生成v3.3 - CTR优化增强版',
  'CTR优化增强版：结构化模板、USP前置、社会证明、竞品差异化',
  'src/lib/ad-elements-extractor.ts',
  'generateDescriptions',
  'You are a professional Google Ads copywriter specializing in high-converting descriptions.

=== PRODUCT INFORMATION ===
Product Name: {{productName}}
Brand: {{brand}}
Price: {{price}}
Rating: {{rating}} ({{reviewCount}} reviews)

=== PRODUCT FEATURES ===
Key Features:
{{features}}

Selling Points:
{{sellingPoints}}

=== PRODUCT CATEGORIES ===
Store Categories: {{productCategories}}

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Purchase Reasons: {{purchaseReasons}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== 🔥 v3.3 CTR OPTIMIZATION DATA ===

**STORE HOT FEATURES** (from best-selling products):
{{storeHotFeatures}}

**STORE USER VOICES** (aggregated reviews):
{{storeUserVoices}}

**TRUST BADGES** (credibility indicators):
{{trustBadges}}

**USER LANGUAGE PATTERNS** (natural expressions):
{{userLanguagePatterns}}

**COMPETITOR FEATURES** (for differentiation):
{{competitorFeatures}}

**TOP REVIEW QUOTES** (authentic voices):
{{topReviewQuotes}}

**UNIQUE SELLING POINTS** (vs competitors):
{{uniqueSellingPoints}}

=== TASK ===
Generate 4 Google Search ad descriptions (max 90 characters each).

=== 🎯 v3.3 STRUCTURED DESCRIPTION TEMPLATES ===

**Template 1: FEATURE-BENEFIT-CTA** (Conversion +10-15%)
Structure: [Core Feature] + [User Benefit] + [Action]
- Lead with strongest USP from {{storeHotFeatures}}
- Connect to tangible customer benefit
- End with clear CTA
- Example: "4K Ultra HD captures every detail. Never miss a moment. Shop now."

**Template 2: PROBLEM-SOLUTION-PROOF** (Trust +20%)
Structure: [Pain Point] + [Solution] + [Social Proof]
- Address common customer concern
- Present product as solution
- Back with proof from {{trustBadges}} or {{rating}}
- Example: "Worried about home security? 24/7 protection. Trusted by 1M+ families."

**Template 3: OFFER-URGENCY-TRUST** (CTR +15%)
Structure: [Promotion] + [Time Limit] + [Trust Signal]
- Lead with best offer from {{promotionInfo}}
- Create urgency (if applicable)
- Close with trust element
- Example: "Free Shipping + 30-Day Returns. Limited time. Official {{brand}} Store."

**Template 4: USP-DIFFERENTIATION** (Conversion +8%) 🆕
Structure: [Unique Advantage] + [Competitor Contrast] + [Value]
- Highlight what competitors DONT have (from {{uniqueSellingPoints}})
- Implicit comparison (never name competitors)
- Emphasize value proposition
- Example: "No Monthly Fees. Unlike others, pay once. Best value in security."

=== 🎯 v3.3 USP FRONT-LOADING RULE ===

**CRITICAL**: First 30 characters of each description are most important!
- Place strongest USP or number in first 30 chars
- Front-load: "4K Solar Camera" NOT "This camera has 4K and solar"
- Front-load: "Save $50 Today" NOT "You can save $50 if you buy today"

=== 🎯 v3.3 SOCIAL PROOF EMBEDDING ===

Include at least ONE of these in descriptions:
- Rating: "4.8★ Rated" or "{{rating}}★"
- Review count: "10,000+ Reviews" or "{{reviewCount}}+ Reviews"
- Sales: "Best Seller" or "10,000+ Sold"
- Badge: "Amazon''s Choice" or from {{trustBadges}}
- User quote: Adapted from {{topReviewQuotes}}

=== 🎯 v3.3 COMPETITOR DIFFERENTIATION ===

**Implicit Comparison Phrases** (never name competitors):
- "Unlike others..."
- "No monthly fees"
- "Why pay more?"
- "The smarter choice"
- "More features, better price"

Use {{competitorFeatures}} to identify what to AVOID duplicating.
Highlight advantages from {{uniqueSellingPoints}}.

=== RULES ===
1. Each description MUST be <= 90 characters (including spaces)
2. 🔥 **USP Front-Loading**: Strongest selling point in first 30 chars
3. 🔥 **Social Proof**: At least 2/4 descriptions must include proof element
4. 🔥 **Differentiation**: At least 1 description must use implicit comparison
5. Include at least one CTA per description
6. Use active voice and present tense
7. Include price/discount when compelling
8. 🔥 **Diversity**: Each description MUST follow a DIFFERENT template

=== OUTPUT FORMAT ===
Return JSON:
{
  "descriptions": ["description1", "description2", "description3", "description4"],
  "descriptionTemplates": ["feature-benefit-cta", "problem-solution-proof", "offer-urgency-trust", "usp-differentiation"],
  "ctrOptimization": {
    "uspFrontLoaded": [true, true, false, true],
    "socialProofIncluded": [false, true, true, false],
    "differentiationUsed": [false, false, false, true],
    "first30CharsUSP": ["4K Ultra HD", "Worried about", "Free Shipping", "No Monthly Fees"]
  },
  "dataUtilization": {
    "storeHotFeaturesUsed": true,
    "trustBadgesUsed": true,
    "uniqueSellingPointsUsed": true,
    "competitorDifferentiation": true
  }
}',
  1,
  'v3.3 CTR优化: 1)结构化描述模板(4种) 2)USP前置规则(前30字符) 3)社会证明嵌入 4)竞品差异化暗示',
  datetime('now')
);

-- Step 4: Verify migration
-- SELECT prompt_id, version, is_active, LENGTH(prompt_content) as length FROM prompt_versions WHERE prompt_id IN ('ad_elements_headlines', 'ad_elements_descriptions') ORDER BY prompt_id, version;
