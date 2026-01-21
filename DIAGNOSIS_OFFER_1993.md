# Offer 1993 关键词数据异常诊断报告

**日期**: 2026-01-21
**问题**: 广告创意 2482, 2483, 2485 关键词很少且没有搜索量数据
**Offer**: 1993 (Dr. Mercola Complete Probiotics)

---

## 一、问题概述

生产环境 offer 1993 下生成的广告创意出现以下异常：
- 关键词数量少（14-32个）
- 所有关键词搜索量为 0
- 关键词存储为字符串数组，缺少元数据

---

## 二、诊断结果

### 1. Keyword Planner API 调用状态 ✅

**结论**: API 调用成功，数据正常写入

**证据**: 在关键词池生成时间段（2026-01-21 01:50-02:30），global_keywords 表中有大量 Mercola 关键词被写入：

```sql
SELECT keyword, search_volume, created_at
FROM global_keywords
WHERE keyword ILIKE '%mercola%'
  AND country = 'US'
  AND created_at BETWEEN '2026-01-21 01:50:00' AND '2026-01-21 02:30:00'
ORDER BY search_volume DESC;
```

**结果**:
| 关键词 | 搜索量 | 创建时间 |
|--------|--------|----------|
| dr mercola | 12,100 | 2026-01-21 01:52:49 |
| mercola | 8,100 | 2026-01-21 01:52:49 |
| dr mercola supplements | 1,600 | 2026-01-21 01:52:49 |
| dr mercola products | 1,600 | 2026-01-21 01:52:49 |
| dr mercola complete probiotics | 140 | 2026-01-21 01:52:48 |

### 2. OAuth 认证配置 ✅

**结论**: 认证配置正常，未过期

**证据**:
```sql
SELECT
  id, user_id,
  length(refresh_token) as refresh_token_len,
  length(developer_token) as developer_token_len,
  is_active,
  access_token_expires_at
FROM google_ads_credentials
WHERE user_id = 1;
```

**结果**:
- refresh_token: 103 字符 ✅
- developer_token: 22 字符 ✅
- is_active: true ✅
- access_token_expires_at: 2026-01-21T04:16:54 (未过期) ✅

### 3. 关键词池数据异常 ❌

**结论**: 关键词池中所有关键词的 searchVolume 都是 0

**证据**:
```sql
SELECT
  id, offer_id, total_keywords,
  brand_keywords::text
FROM offer_keyword_pools
WHERE offer_id = 1993;
```

**结果**:
```json
{
  "id": 1296,
  "offer_id": 1993,
  "total_keywords": 109,
  "brand_keywords": [
    {"keyword": "Dr. Mercola", "searchVolume": 0, "source": "OFFER_AI_KEYWORDS"},
    {"keyword": "dr. mercola", "searchVolume": 0, "source": "OFFER_EXTRACTED_KEYWORDS"}
  ]
}
```

**所有 bucket 的关键词 searchVolume 也都是 0**

---

## 三、根本原因分析

### 问题定位

**位置**: `src/lib/offer-keyword-pool.ts:2011-2023`

```typescript
export async function generateOfferKeywordPool(
  offerId: number,
  userId: number,
  allKeywords?: string[]  // ⚠️ 可选参数
): Promise<OfferKeywordPool> {
  // ...

  let initialKeywords: PoolKeywordData[]
  if (allKeywords) {
    // ❌ 问题：如果提供了关键词列表，searchVolume 被硬编码为 0
    initialKeywords = allKeywords.map(kw => ({
      keyword: kw,
      searchVolume: 0,  // ❌ 硬编码为 0
      source: 'PROVIDED',
      matchType: 'BROAD'
    }))
  } else {
    initialKeywords = await extractKeywordsFromOffer(offerId, userId)
  }
  // ...
}
```

### 问题原因

1. **调用方传入了字符串数组**: 某个调用方调用 `generateOfferKeywordPool(1993, 1, ['Dr. Mercola', ...])` 时传入了 `allKeywords` 参数

2. **searchVolume 被硬编码为 0**: 当传入 `allKeywords` 时，函数直接将所有关键词的 `searchVolume` 设置为 0，而不是查询 Keyword Planner API

3. **后续扩展也没有更新搜索量**: 虽然 `expandAllKeywords` 函数会调用 Keyword Planner API，但返回的关键词数据没有正确合并搜索量

### 调用链追踪

需要查找谁调用了 `generateOfferKeywordPool` 并传入了 `allKeywords` 参数。

可能的调用来源：
1. 广告创意生成流程 (`src/lib/ad-creative-generator.ts`)
2. API 端点 (`src/app/api/offers/[id]/keywords/route.ts`)
3. 批量任务处理

---

## 四、解决方案

### 方案 1: 立即修复（推荐）

删除现有关键词池并重新生成，**不传入 `allKeywords` 参数**：

```typescript
// 删除现有关键词池
await db.exec('DELETE FROM offer_keyword_pools WHERE offer_id = ?', [1993])

// 重新生成（不传入 allKeywords）
await generateOfferKeywordPool(1993, 1)
```

或者通过 SQL 直接删除：

```sql
DELETE FROM offer_keyword_pools WHERE offer_id = 1993;
-- 然后在应用中重新触发关键词池生成
```

### 方案 2: 代码修复（长期）

修改 `generateOfferKeywordPool` 函数，即使传入 `allKeywords`，也应该查询搜索量：

```typescript
let initialKeywords: PoolKeywordData[]
if (allKeywords) {
  // 🔧 修复：查询搜索量而不是硬编码为 0
  const { getKeywordSearchVolumes } = await import('./keyword-planner')
  const auth = await getUserAuthType(userId)

  const volumes = await getKeywordSearchVolumes(
    allKeywords,
    offer.target_country,
    offer.target_language,
    userId,
    auth.authType,
    auth.serviceAccountId
  )

  initialKeywords = volumes.map(v => ({
    keyword: v.keyword,
    searchVolume: v.avgMonthlySearches || 0,
    competition: v.competition,
    competitionIndex: v.competitionIndex,
    lowTopPageBid: v.lowTopPageBid,
    highTopPageBid: v.highTopPageBid,
    source: 'PROVIDED',
    matchType: 'BROAD'
  }))
} else {
  initialKeywords = await extractKeywordsFromOffer(offerId, userId)
}
```

### 方案 3: 查找调用源并修复

1. 搜索代码中所有调用 `generateOfferKeywordPool` 的地方：
   ```bash
   grep -r "generateOfferKeywordPool" src/
   ```

2. 检查是否有地方传入了第三个参数（`allKeywords`）

3. 修改调用方，不传入 `allKeywords` 参数，或者传入 `PoolKeywordData[]` 而不是 `string[]`

---

## 五、预防措施

### 1. 添加类型检查

修改函数签名，明确要求传入 `PoolKeywordData[]` 而不是 `string[]`：

```typescript
export async function generateOfferKeywordPool(
  offerId: number,
  userId: number,
  initialKeywords?: PoolKeywordData[]  // 改为 PoolKeywordData[]
): Promise<OfferKeywordPool>
```

### 2. 添加验证逻辑

在关键词池保存前，验证搜索量数据：

```typescript
// 验证关键词池质量
const totalKeywords = brandKeywords.length + buckets.bucketA.keywords.length + ...
const keywordsWithVolume = [...brandKeywords, ...buckets.bucketA.keywords, ...]
  .filter(kw => kw.searchVolume > 0).length

if (totalKeywords > 10 && keywordsWithVolume === 0) {
  console.error('⚠️ 警告：关键词池中所有关键词搜索量都是 0，可能存在问题')
  // 可以选择抛出错误或记录日志
}
```

### 3. 添加监控告警

监控关键词池生成质量：
- 关键词数量异常（< 10 个）
- 搜索量全部为 0
- 品牌关键词缺失

---

## 六、验证步骤

修复后，验证以下内容：

1. **关键词池数据**:
   ```sql
   SELECT
     id, offer_id, total_keywords,
     jsonb_array_length(brand_keywords::jsonb) as brand_count
   FROM offer_keyword_pools
   WHERE offer_id = 1993;
   ```

2. **品牌关键词搜索量**:
   ```sql
   SELECT brand_keywords::jsonb->0 as first_brand_keyword
   FROM offer_keyword_pools
   WHERE offer_id = 1993;
   ```

   应该看到类似：
   ```json
   {
     "keyword": "Dr. Mercola",
     "searchVolume": 12100,  // ✅ 不是 0
     "competition": "MEDIUM"
   }
   ```

3. **广告创意关键词**:
   重新生成广告创意后，检查关键词是否包含搜索量数据

---

## 七、总结

### 问题根因

**关键词池生成时，调用方传入了字符串数组 `allKeywords`，导致所有关键词的 `searchVolume` 被硬编码为 0**

### 关键发现

1. ✅ Keyword Planner API 调用正常
2. ✅ OAuth 认证配置正常
3. ✅ global_keywords 表数据正常
4. ❌ 关键词池生成逻辑有缺陷

### 修复优先级

1. **P0 - 立即修复**: 删除并重新生成 offer 1993 的关键词池
2. **P1 - 代码修复**: 修改 `generateOfferKeywordPool` 函数，查询搜索量
3. **P2 - 预防措施**: 添加验证和监控

---

**诊断完成时间**: 2026-01-21
**诊断工具**: PostgreSQL 数据库查询 + 代码分析
**诊断脚本**: `scripts/diagnose-keywords.ts`, `scripts/check-keyword-pool.ts`
