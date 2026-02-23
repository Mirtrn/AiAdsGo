# 否定词匹配类型修复方案

## 🔴 问题诊断

### 核心问题
Offer 173 Creative 81 中存在一个关键配置问题：
- 正向关键词：`"reolink doorbell"` (高意图，有效)
- 否定词：`"or"` (广泛匹配，导致误伤)
- **结果**：搜索 `"reolink doorbell"` 被误伤过滤（因为 "doorbell" 中包含字母 "or"）

### 根本原因
应用层代码在同步到 Google Ads API 时：
1. 从数据库读取 `negative_keywords` 数组（纯文本字符串）
2. **硬编码为广泛匹配** (BROAD match)
3. 无法区分：完全匹配 vs 短语匹配 vs 广泛匹配

**Google Ads API 需要的数据结构**：
```typescript
{
  keywordText: "or",
  matchType: "EXACT",  // ← 应用目前硬编码为 "BROAD"
  isNegative: true
}
```

**当前应用的做法**（src/lib/google-ads-api.ts:L850-880）：
```typescript
export async function createGoogleAdsKeywordsBatch(params: {
  keywords: Array<{
    keywordText: string,
    matchType: 'BROAD' | 'PHRASE' | 'EXACT',  // ← 这里没有为负向词特殊处理
    isNegative?: boolean
  }>
}) {
  // 生成的操作对象中的 match_type 总是使用提供的 matchType
  // 对于负向词，应该能够单独控制匹配类型
}
```

---

## ✅ 修复方案

### 方案 A：数据库结构方案（推荐，长期方案）

#### Step 1: 数据库迁移
```sql
-- 新增迁移文件：082_add_negative_keyword_matchtype.sql
ALTER TABLE ad_creatives
ADD COLUMN negative_keywords_metadata JSONB DEFAULT '[]';

-- 新的数据结构（示例）：
-- negative_keywords_metadata = [
--   { keyword: "or", matchType: "EXACT" },
--   { keyword: "free", matchType: "BROAD" },
--   { keyword: "-app -free", matchType: "PHRASE" }
-- ]

-- 从现有 negative_keywords 迁移数据
UPDATE ad_creatives
SET negative_keywords_metadata = (
  SELECT jsonb_agg(jsonb_build_object('keyword', kw, 'matchType', 'BROAD'))
  FROM jsonb_array_elements_text(negative_keywords) AS kw
  WHERE negative_keywords IS NOT NULL
);
```

#### Step 2: 修改应用代码

**文件**：`src/lib/google-ads-api.ts`

修改 `createGoogleAdsKeywordsBatch()` 函数，为负向词添加专用的 `negativeKeywordMatchType` 参数：

```typescript
export async function createGoogleAdsKeywordsBatch(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  keywords: Array<{
    keywordText: string
    matchType: 'BROAD' | 'PHRASE' | 'EXACT'
    negativeKeywordMatchType?: 'BROAD' | 'PHRASE' | 'EXACT'  // ← 新增
    status: 'ENABLED' | 'PAUSED'
    isNegative?: boolean
    finalUrl?: string
  }>
  accountId?: number
  userId?: number
}) {
  // ...
  const keywordOperations = batch.map(kw => {
    const operation = {
      ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
      keyword: {
        text: kw.keywordText,
        // ← 关键修改：为负向词使用单独的匹配类型
        match_type: kw.isNegative
          ? enums.KeywordMatchType[kw.negativeKeywordMatchType || 'BROAD']
          : enums.KeywordMatchType[kw.matchType],
      },
    }
    // ...
  })
}
```

**文件**：`src/app/api/campaigns/publish/route.ts`

修改发布流程，从 `negative_keywords_metadata` 读取匹配类型：

```typescript
// 从创意中读取否定词和匹配类型
const negativeKeywordOps = (creative.negative_keywords_metadata || []).map(item => ({
  keywordText: item.keyword,
  matchType: 'EXACT',  // 这里的 matchType 对负向词无效
  negativeKeywordMatchType: item.matchType,  // ← 使用这个
  status: 'ENABLED',
  isNegative: true
}))

const keywordOperations = [
  ...positiveKeywordOps,
  ...negativeKeywordOps
]
```

#### Step 3: 更新现有数据

```python
# 为现有创意配置否定词匹配类型
# Offer 173 的所有创意中的 "or" 都改为 EXACT match

# 80-85% 的现有否定词应该是 EXACT match（防止误伤）
# 10-15% 可以是 PHRASE match（特定多词短语）
# 5% 保留 BROAD match（明显无用的词）

negative_keyword_mapping = {
    "or": "EXACT",           # or（独立词）
    "vs": "EXACT",           # vs（独立词）
    "versus": "EXACT",       # versus（独立词）
    "compared to": "PHRASE", # 短语
    "compare": "EXACT",      # compare（独立词）
    "comparison": "EXACT",   # comparison（独立词）
    "how to": "PHRASE",      # 短语
    "free": "EXACT",         # free（独立词）
    "download": "EXACT",     # download（独立词）
    "app": "EXACT",          # app（独立词）
    # ... 等等
}
```

---

## 🎯 对 Offer 173 的具体修复

### 立即修复步骤

#### Step 1：执行数据库迁移

创建新的迁移文件 `migrations/082_add_negative_keyword_matchtype.sql`：

```sql
-- 为 ad_creatives 表添加否定词匹配类型配置
ALTER TABLE ad_creatives
ADD COLUMN negative_keywords_match_type JSONB DEFAULT '{}'::jsonb;

-- 为现有创意初始化默认值（所有否定词都设为 EXACT 匹配，防止误伤）
UPDATE ad_creatives
SET negative_keywords_match_type = (
  SELECT jsonb_object_agg(kw, 'EXACT')
  FROM jsonb_array_elements_text(COALESCE(negative_keywords, '[]'::jsonb)) AS kw
)
WHERE negative_keywords IS NOT NULL AND negative_keywords != '[]'::jsonb;
```

#### Step 2：修改应用代码

**文件**：`src/lib/google-ads-api.ts`

在 `createGoogleAdsKeywordsBatch()` 函数中添加支持：

```typescript
export async function createGoogleAdsKeywordsBatch(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  keywords: Array<{
    keywordText: string
    matchType: 'BROAD' | 'PHRASE' | 'EXACT'
    negativeKeywordMatchType?: 'BROAD' | 'PHRASE' | 'EXACT'  // ← 新增
    status: 'ENABLED' | 'PAUSED'
    finalUrl?: string
    isNegative?: boolean
  }>
  accountId?: number
  userId?: number
}): Promise<Array<{ keywordId: string; resourceName: string; keywordText: string }>> {
  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  const results: Array<{ keywordId: string; resourceName: string; keywordText: string }> = []

  const batchSize = 100
  for (let i = 0; i < params.keywords.length; i += batchSize) {
    const batch = params.keywords.slice(i, i + batchSize)

    const keywordOperations = batch.map(kw => {
      // ← 关键修改：为负向词选择正确的匹配类型
      const effectiveMatchType = kw.isNegative
        ? (kw.negativeKeywordMatchType || 'EXACT')  // 负向词默认用 EXACT
        : kw.matchType  // 正向词用提供的 matchType

      const operation = {
        ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
        keyword: {
          text: kw.keywordText,
          match_type: enums.KeywordMatchType[effectiveMatchType],
        },
      }

      if (kw.isNegative) {
        ;(operation as any).negative = true
      } else {
        ;(operation as any).status = enums.AdGroupCriterionStatus[kw.status]
        if (kw.finalUrl) {
          ;(operation as any).final_urls = [kw.finalUrl]
        }
      }

      return operation
    })

    const response = await customer.adGroupCriteria.create(keywordOperations)

    if (response && response.results && response.results.length > 0) {
      response.results.forEach((result, index) => {
        const keywordId = result.resource_name?.split('/').pop() || ''
        results.push({
          keywordId,
          resourceName: result.resource_name || '',
          keywordText: batch[index].keywordText,
        })
      })
    }
  }

  return results
}
```

**文件**：`src/app/api/campaigns/publish/route.ts`

修改发布流程，从创意中读取否定词配置：

```typescript
// 构建否定词操作
const negativeKeywordOps = (creative.negative_keywords || []).map((keyword: string) => ({
  keywordText: keyword,
  matchType: 'EXACT',  // 这个值对负向词无效
  negativeKeywordMatchType: creative.negative_keywords_match_type?.[keyword] || 'EXACT',  // ← 使用这个
  status: 'ENABLED' as const,
  isNegative: true
}))

const keywordOperations = [
  ...positiveKeywordOps,
  ...negativeKeywordOps
]

await createGoogleAdsKeywordsBatch({
  customerId: adsAccount.customer_id,
  refreshToken: credentials.refresh_token,
  adGroupId: googleAdGroupId,
  keywords: keywordOperations,
  accountId: adsAccount.id,
  userId
})
```

#### Step 3：为 Offer 173 的创意配置正确的匹配类型

```python
import psycopg2
import json

conn = psycopg2.connect(
    host="<db_host>",
    port=<db_port>,
    database="<db_name>",
    user="<db_user>",
    password="<db_password>"
)

cursor = conn.cursor()

# 为 Offer 173 的所有创意配置否定词匹配类型
# 策略：
# - 单字词（如 or, vs, free, download 等）→ EXACT
# - 多字短语（如 "how to", "compared to" 等）→ PHRASE

cursor.execute("""
UPDATE ad_creatives
SET negative_keywords_match_type = (
  SELECT jsonb_object_agg(
    kw,
    CASE
      WHEN kw ~ ' ' THEN 'PHRASE'  -- 包含空格的是短语 → PHRASE
      ELSE 'EXACT'                   -- 单个词 → EXACT
    END
  )
  FROM jsonb_array_elements_text(COALESCE(negative_keywords, '[]'::jsonb)) AS kw
)
WHERE offer_id = 173
  AND negative_keywords IS NOT NULL
  AND negative_keywords != '[]'::jsonb;
""")

conn.commit()
cursor.close()
conn.close()

print("✅ Offer 173 的创意已配置否定词匹配类型")
```

#### Step 4：重新发布 Creative 81

- 重新发布广告以应用新的否定词配置
- 验证：搜索 `"reolink doorbell"` 应该正常展现

### 预期效果

修复前：
```
搜索："reolink doorbell"
匹配规则：包含 or（广泛匹配）
结果：❌ 被 -or 过滤，无展现，损失转化机会
```

修复后：
```
搜索："reolink doorbell"
匹配规则：完全等于 "or"（完全匹配）
结果：✅ 通过，正常展现
对比搜索："reolink or hikvision"
匹配规则：包含 "or" 作为独立词
结果：✅ 被 [-or] 过滤，正确
```

---

## 📊 其他受影响的 Offer

根据扫描，Offer 173 的其他创意也有相同问题：
- Creative 82：否定词包含 "or"
- Creative 83：否定词包含 "or"
- Creative 84：否定词包含 "or"

**建议**：对这些创意也同步应用方案 B 的硬编码规则。

---

## 🚀 长期规划

1. **周期 1**：实现方案 B（应用代码硬编码规则，1-2 天）
2. **周期 2**：实现方案 A 的数据库迁移（1-2 周）
3. **周期 3**：添加 UI/API 支持用户手动配置否定词匹配类型（2-3 周）

---

## 验证清单

- [ ] 应用代码修改完成
- [ ] 本地测试：验证否定词匹配类型逻辑
- [ ] 生产验证：重新发布 Creative 81
- [ ] Google Ads 验证：检查实际关键词设置
- [ ] 流量验证：监控 "reolink doorbell" 搜索的展现和点击
- [ ] 其他创意修复：Creative 82-84 同步应用
