# 关键词生成业务逻辑分析与优化建议

## 📊 当前业务流程

### 1. 关键词生成优先级（4个等级）

```
第一优先级 - 品牌短尾词 (必须生成4-6个)
  ├─ 品牌名 + 产品类别
  ├─ 品牌名 + 主要特性
  └─ 品牌名 + 购买意图

第二优先级 - 产品核心词 (必须生成3-5个)
  ├─ 产品类别 + 主要特性
  ├─ 产品类别 + 价格/促销
  └─ 产品类别 + 用户需求

第三优先级 - 购买意图词 (必须生成2-3个)
  ├─ "buy" + 产品名
  ├─ "best" + 产品类别
  └─ "discount" + 产品名

第四优先级 - 长尾精准词 (可选，最多2-3个)
  ├─ 产品特性 + 用户场景
  ├─ 产品类别 + 竞争对手
  └─ 产品类别 + 地理位置
```

### 2. 真实搜索量查询流程

```
AI生成关键词 (10-15个)
    ↓
getKeywordSearchVolumes() 查询搜索量
    ├─ 使用 generateKeywordHistoricalMetrics API
    ├─ 返回: avgMonthlySearches, competition, competitionIndex
    └─ 缓存结果到 Redis
    ↓
过滤低搜索量关键词 (< 1000/月)
    ├─ 移除搜索量为0的关键词
    ├─ 移除搜索量 < 1000/月的关键词
    └─ 保留高质量关键词
    ↓
Keyword Planner 扩展品牌词
    ├─ 使用 getKeywordIdeas() 生成品牌组合词
    ├─ 过滤: 必须包含品牌名 + 搜索量 >= 1000/月
    ├─ 去重: 排除已存在的关键词
    └─ 添加新的品牌关键词
    ↓
最终关键词列表 (10-20个)
```

### 3. 过滤规则

| 规则 | 条件 | 说明 |
|------|------|------|
| 最小搜索量 | >= 1000/月 | 确保关键词质量，避免长尾词过多 |
| 品牌词过滤 | 必须包含品牌名 | Keyword Planner 扩展时的强制条件 |
| 去重 | 不区分大小写 | 避免重复关键词 |
| 竞争度 | 无硬性限制 | 当前未使用竞争度过滤 |
| CPC | 无硬性限制 | 当前未使用CPC过滤 |

---

## 🔍 当前存在的问题

### 问题1: 两个API的角色混淆
**现象**:
- `generateKeywordIdeas` - 用于生成建议（返回相关关键词）
- `generateKeywordHistoricalMetrics` - 用于查询精确搜索量（返回指定关键词的数据）

**当前状态**:
- ✅ `keyword-planner.ts` 已修复：使用 `generateKeywordHistoricalMetrics` 查询搜索量
- ✅ `google-ads-keyword-planner.ts` 正确使用：
  - `getKeywordIdeas()` 用于生成品牌组合词
  - `getKeywordMetrics()` 用于查询精确搜索量

**问题**:
- 在 `ad-creative-generator.ts` 中，调用 `getKeywordIdeas()` 时期望获得真实搜索量，但实际上 `generateKeywordIdeas` 返回的是**建议**，不是**精确搜索量**

### 问题2: 搜索量为0的关键词处理
**现象**:
- AI生成的关键词中，很多在Google Ads中没有搜索量数据
- 这些关键词被过滤掉，导致最终关键词数量不足

**根本原因**:
- AI生成的关键词可能是长尾词或新词
- Google Ads Keyword Planner 只有部分关键词的搜索量数据
- 意大利市场的英文关键词数据可能不完整

### 问题3: 品牌词扩展不足
**现象**:
- 只扩展包含品牌名的关键词
- 忽略了品牌+产品类别、品牌+特性等组合

**当前逻辑**:
```typescript
// 只保留包含品牌名的关键词
if (!keywordText.includes(brandLower)) {
  return false
}
```

### 问题4: 缺少竞争度和CPC过滤
**现象**:
- 虽然获取了竞争度和CPC数据，但没有使用
- 可能选中高竞争、高CPC的关键词

**当前状态**:
- 有 `filterHighQualityKeywords()` 函数但未被调用
- 有 `rankKeywordsByRelevance()` 函数但未被调用

### 问题5: 缺少关键词分组和优先级排序
**现象**:
- 关键词没有按优先级排序
- 没有按意图分组（品牌词、产品词、交易词等）

**当前状态**:
- 有 `groupKeywordsByTheme()` 函数但未被调用

---

## 💡 优化建议

### 优化1: 完善关键词生成流程（P0 - 高优先级）

**目标**: 确保最终关键词数量充足且质量高

**实现步骤**:

```typescript
// 1. AI生成关键词 (10-15个)
const aiKeywords = await generateAdCreativeContent(...)

// 2. 查询搜索量 (使用 generateKeywordHistoricalMetrics)
const keywordsWithVolume = await getKeywordSearchVolumes(aiKeywords, country, language)

// 3. 分层过滤
const tier1 = keywordsWithVolume.filter(kw => kw.searchVolume >= 1000)  // 高质量
const tier2 = keywordsWithVolume.filter(kw => kw.searchVolume >= 100 && kw.searchVolume < 1000)  // 中等
const tier3 = keywordsWithVolume.filter(kw => kw.searchVolume > 0 && kw.searchVolume < 100)  // 长尾

// 4. 品牌词扩展 (使用 generateKeywordIdeas)
const brandIdeas = await getKeywordIdeas({
  seedKeywords: [brandName],
  targetCountry: country,
  targetLanguage: language
})

// 5. 高质量品牌词过滤
const qualityBrandKeywords = filterHighQualityKeywords(brandIdeas, {
  minMonthlySearches: 500,  // 品牌词可以降低到500
  maxCompetitionIndex: 80,
  excludeCompetition: ['HIGH']  // 排除高竞争
})

// 6. 去重和合并
const finalKeywords = mergeDeduplicate([
  ...tier1,
  ...qualityBrandKeywords,
  ...tier2.slice(0, 3),  // 最多3个中等搜索量
  ...tier3.slice(0, 2)   // 最多2个长尾词
])

// 7. 按相关性排序
const rankedKeywords = rankKeywordsByRelevance(finalKeywords)
```

### 优化2: 改进搜索量为0的处理（P1 - 中优先级）

**问题**: 意大利市场的英文关键词搜索量为0

**解决方案**:

```typescript
// 方案A: 使用备选市场的搜索量
if (country === 'IT' && language === 'en') {
  // 意大利英文关键词数据不完整，使用美国英文数据作为参考
  const usVolumes = await getKeywordSearchVolumes(keywords, 'US', 'en')
  // 应用折扣系数 (意大利市场通常是美国的30-50%)
  return usVolumes.map(v => ({
    ...v,
    searchVolume: Math.round(v.searchVolume * 0.4),
    source: 'US_ADJUSTED'
  }))
}

// 方案B: 保留搜索量为0的关键词，但标记为"估计"
const keywordsWithEstimate = keywordsWithVolume.map(kw => ({
  ...kw,
  isEstimated: kw.searchVolume === 0,
  estimatedVolume: kw.searchVolume === 0 ? estimateVolume(kw.keyword) : null
}))

// 方案C: 使用AI估计搜索量
if (kw.searchVolume === 0) {
  const estimate = await estimateKeywordVolume(kw.keyword, country, language)
  kw.searchVolume = estimate
  kw.isEstimated = true
}
```

### 优化3: 增强品牌词扩展（P1 - 中优先级）

**当前**: 只扩展包含品牌名的关键词

**改进**:

```typescript
// 扩展品牌词的多个维度
const brandKeywordPatterns = [
  // 品牌 + 产品类别
  `${brandName} ${productCategory}`,
  // 品牌 + 主要特性
  `${brandName} ${mainFeature}`,
  // 品牌 + 购买意图
  `buy ${brandName}`,
  `${brandName} price`,
  `${brandName} discount`,
  // 品牌 + 竞争对手对比
  `${brandName} vs ${competitor}`,
  // 品牌 + 用户场景
  `${brandName} for ${useCase}`,
]

// 查询这些模式的搜索量
const brandPatternVolumes = await getKeywordMetrics({
  keywords: brandKeywordPatterns,
  targetCountry: country,
  targetLanguage: language
})

// 过滤高质量品牌词
const qualityBrandKeywords = brandPatternVolumes.filter(kw =>
  kw.avgMonthlySearches >= 500 && kw.competitionIndex <= 80
)
```

### 优化4: 实现关键词质量评分系统（P2 - 低优先级）

**目标**: 综合评估关键词质量，优先选择最优关键词

```typescript
interface KeywordScore {
  keyword: string
  searchVolume: number
  competition: number
  cpc: number
  relevance: number  // 与产品的相关性
  intent: string     // 搜索意图
  priority: number   // 优先级 (1-4)
  qualityScore: number  // 综合评分 (0-100)
}

function calculateKeywordScore(kw: KeywordIdea, offer: Offer): KeywordScore {
  // 搜索量得分 (0-30分)
  const searchScore = Math.min((kw.avgMonthlySearches / 10000) * 30, 30)

  // 竞争度得分 (0-25分，竞争度越低分数越高)
  const competitionScore = (100 - kw.competitionIndex) * 0.25

  // CPC得分 (0-20分，CPC越低分数越高)
  const avgCpc = (kw.lowTopOfPageBidMicros + kw.highTopOfPageBidMicros) / 2
  const cpcScore = Math.max(20 - (avgCpc / 5000000) * 20, 0)

  // 相关性得分 (0-25分，基于关键词与产品的匹配度)
  const relevanceScore = calculateRelevance(kw.text, offer) * 25

  const qualityScore = searchScore + competitionScore + cpcScore + relevanceScore

  return {
    keyword: kw.text,
    searchVolume: kw.avgMonthlySearches,
    competition: kw.competitionIndex,
    cpc: avgCpc / 1000000,
    relevance: relevanceScore,
    intent: classifySearchIntent(kw.text),
    priority: determinePriority(kw.text, offer),
    qualityScore
  }
}

// 按质量评分排序
const rankedKeywords = keywords
  .map(kw => calculateKeywordScore(kw, offer))
  .sort((a, b) => b.qualityScore - a.qualityScore)
  .slice(0, 15)  // 取前15个
```

### 优化5: 添加关键词验证和监控（P2 - 低优先级）

```typescript
interface KeywordValidation {
  keyword: string
  isValid: boolean
  issues: string[]
  warnings: string[]
}

function validateKeyword(kw: string, offer: Offer): KeywordValidation {
  const issues: string[] = []
  const warnings: string[] = []

  // 检查长度
  if (kw.length > 80) {
    issues.push('关键词过长 (> 80字符)')
  }

  // 检查特殊字符
  if (!/^[a-zA-Z0-9\s\-&]+$/.test(kw)) {
    warnings.push('包含特殊字符')
  }

  // 检查品牌名
  if (!kw.toLowerCase().includes(offer.brand.toLowerCase())) {
    warnings.push('不包含品牌名')
  }

  // 检查重复词
  const words = kw.split(' ')
  if (new Set(words).size !== words.length) {
    issues.push('包含重复词')
  }

  return {
    keyword: kw,
    isValid: issues.length === 0,
    issues,
    warnings
  }
}
```

---

## 📈 实现优先级

| 优化项 | 优先级 | 工作量 | 收益 | 建议时间 |
|--------|--------|--------|------|----------|
| 完善关键词生成流程 | P0 | 中 | 高 | 立即 |
| 改进搜索量为0处理 | P1 | 中 | 中 | 本周 |
| 增强品牌词扩展 | P1 | 小 | 中 | 本周 |
| 关键词质量评分 | P2 | 大 | 中 | 下周 |
| 关键词验证监控 | P2 | 小 | 低 | 下周 |

---

## 🎯 关键指标

### 当前状态
- 平均关键词数: 10-15个
- 搜索量 >= 1000/月的比例: ~60%
- 品牌词占比: ~30%
- 平均竞争度: MEDIUM

### 优化目标
- 平均关键词数: 15-20个
- 搜索量 >= 1000/月的比例: >= 80%
- 品牌词占比: >= 40%
- 平均竞争度: LOW-MEDIUM

---

## 🔗 相关文件

- `src/lib/ad-creative-generator.ts` - 广告创意生成（关键词生成逻辑）
- `src/lib/keyword-planner.ts` - 关键词搜索量查询（使用 generateKeywordHistoricalMetrics）
- `src/lib/google-ads-keyword-planner.ts` - Google Ads Keyword Planner API 封装
- `src/lib/google-ads-oauth.ts` - OAuth Token 管理

---

## 📝 修改记录

- 2025-11-28: 初始分析，识别5个主要问题和5个优化建议
