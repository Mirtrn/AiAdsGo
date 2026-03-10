# Search Term 优化文档

## 优化概述

本次优化让 Google Ads Search Terms（搜索词）数据在广告创意生成中发挥更大的正向作用。

## 优化前的问题

### 原有机制
Search terms 仅用作**负向反馈**：
- ❌ **Hard Negative Terms**: 高成本低效率的搜索词，完全排除
- ⚠️ **Soft Suppress Terms**: 中等效率不佳的搜索词，降低优先级

### 局限性
1. **未利用正向信号**: 高转化的搜索词没有被用于关键词扩展
2. **错失高潜力词**: 实际表现好的搜索词未被识别和利用
3. **单向反馈**: 只告诉 AI "不要用什么"，没有告诉"应该用什么"

## 优化方案

### 1. 新增高性能搜索词识别

在 `search-term-feedback-hints.ts` 中添加高性能搜索词分类：

```typescript
// 识别标准
const HIGH_PERFORMING_MIN_CLICKS = 5
const HIGH_PERFORMING_MIN_CTR = 0.03 // 3%
const HIGH_PERFORMING_MIN_CONVERSIONS = 2
const HIGH_PERFORMING_MIN_CONVERSION_RATE = 0.05 // 5%

// 识别逻辑
const highByCtr = clicks >= 5 && ctr >= 3%
const highByConversion = conversions >= 2 && conversionRate >= 5%
```

### 2. 集成到关键词生成流程

在 `ad-creative-generator.ts` 中：

```typescript
// 高性能搜索词作为关键词候选
let searchTermKeywords = highPerformingTerms.map(term => ({
  keyword: term,
  searchVolume: 0,
  source: 'SEARCH_TERM_HIGH_PERFORMING',
  priority: 'HIGH'
}))

// 优先级排序
// 桶关键词(100) > 高性能搜索词(80) > AI增强(50) > 基础(10)
```

### 3. 更新 AI Prompt

```typescript
if (highTerms.length > 0) {
  lines.push(`- ✅ HIGH-PERFORMING TERMS: ${highTerms.join(', ')}
    (prioritize these themes and related keywords).`)
}
```

## 优化效果

### 数据流向

**优化前**:
```
Search Terms → [负向过滤] → AI Prompt (排除列表)
```

**优化后**:
```
Search Terms → [三向分类] → {
  ✅ 高性能词 → 关键词候选池 + AI Prompt (优先主题)
  ❌ 硬排除词 → AI Prompt (完全排除)
  ⚠️ 软抑制词 → AI Prompt (降低优先级)
}
```

### 关键词来源优先级

```
1. Keyword Pool (桶关键词)         - 优先级 100
2. High-Performing Search Terms   - 优先级 80  🆕
3. AI Enhanced Keywords           - 优先级 50
4. Extracted Keywords             - 优先级 10
```

### 实际应用场景

#### 场景 1: 发现新关键词机会
```
用户搜索: "best solar lights for garden path"
表现: CTR 4.5%, 3 conversions
结果: 被识别为高性能词，添加到关键词池
```

#### 场景 2: 验证关键词质量
```
关键词池中有: "solar garden lights"
搜索词表现: CTR 5%, 转化率 8%
结果: 提升该关键词优先级，AI 更多使用
```

#### 场景 3: 避免低效关键词
```
搜索词: "free solar lights"
表现: CTR 0.8%, 高 CPC, 0 conversions
结果: 标记为硬排除，AI 不再生成类似词
```

## 技术实现细节

### 数据库查询优化

```sql
SELECT
  str.search_term,
  SUM(str.impressions) AS impressions,
  SUM(str.clicks) AS clicks,
  SUM(str.cost) AS cost,
  SUM(str.conversions) AS conversions,        -- 🆕
  SUM(str.conversion_value) AS conversion_value  -- 🆕
FROM search_term_reports str
JOIN campaigns c ON c.id = str.campaign_id
WHERE str.user_id = ? AND c.offer_id = ?
GROUP BY str.search_term
```

### 分类逻辑

```typescript
// 优先级: 高性能 > 负向
if (highByCtr || highByConversion) {
  highPerformingTerms.push(term)
  continue // 跳过负向分类
}

if (hardByCpc || hardByCtr) {
  hardNegativeTerms.push(term)
  continue
}

if (softByCpc || softByCtr) {
  softSuppressTerms.push(term)
}
```

### 去重和标准化

```typescript
// Google Ads 标准化
const uniqueKeywords = deduplicateKeywordsWithPriority(
  mergedKeywords,
  kw => kw.keyword,
  kw => priorityScore(kw.source)
)
```

## 测试覆盖

创建了完整的测试套件 `search-term-feedback-hints.high-performing.test.ts`:

- ✅ 基于 CTR 识别高性能词
- ✅ 基于转化率识别高性能词
- ✅ 高性能词不被误判为负向词
- ✅ 处理无转化数据的情况
- ✅ 去重和数量限制
- ✅ 搜索词清洗和验证

## API 更新

所有相关 API 路由已更新：
- `/api/offers/[id]/generate-ad-creative`
- `/api/offers/[id]/generate-creatives`
- `/api/offers/[id]/generate-creatives-stream`

日志输出示例：
```
🔁 搜索词反馈已加载: high=5, hard=3, soft=8, rows=127
🔍 添加 5 个高性能搜索词作为关键词候选
```

## 预期收益

1. **关键词质量提升**: 基于真实表现数据选择关键词
2. **发现新机会**: 自动识别用户实际搜索的高价值词
3. **降低试错成本**: 避免重复使用已证明低效的词
4. **数据驱动优化**: 从"猜测"转向"验证"

## 后续优化方向

1. **动态阈值调整**: 根据账户历史表现自适应调整识别阈值
2. **搜索词聚类**: 将相似搜索词聚类，识别主题趋势
3. **时间序列分析**: 识别搜索词表现的趋势变化
4. **竞品词识别**: 从搜索词中识别竞品关键词机会

## 版本信息

- **优化日期**: 2026-03-10
- **影响模块**:
  - `search-term-feedback-hints.ts`
  - `ad-creative-generator.ts`
  - API 路由 (3个)
- **测试覆盖**: 6 个新测试用例
- **向后兼容**: ✅ 完全兼容现有代码
