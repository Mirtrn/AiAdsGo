# Offer 1993 新关键词池问题诊断报告

**日期**: 2026-01-21
**问题**: 修复后重新生成的关键词池仍然没有搜索量数据
**关键词池 ID**: 1301
**广告创意**: 2491, 2493

---

## 一、问题概述

在修复了 `generateOfferKeywordPool` 函数的 `searchVolume` 硬编码问题后，重新生成了 offer 1993 的关键词池和广告创意。但是新生成的数据**仍然存在搜索量为 0 的问题**。

---

## 二、诊断结果

### 1. 新关键词池数据 ❌

**关键词池 ID**: 1301
**创建时间**: 2026-01-21 06:33:17
**总关键词数**: 108

#### 品牌关键词
- **数量**: 仅 1 个
- **内容**: `"dr. mercola"`
- **searchVolume**: 0 ❌
- **source**: `OFFER_EXTRACTED_KEYWORDS`

#### Bucket A 关键词
- **数量**: 27 个
- **searchVolume**: 全部为 0 ❌
- **source**: `OFFER_EXTRACTED_KEYWORDS` 或 `CLUSTERED`
- **示例**:
  - `"Dr. Mercola Complete Probiotics"` (searchVolume: 0)
  - `"dr. mercola supplements"` (searchVolume: 0)
  - `"dr. mercola liposomal vitamin c"` (searchVolume: 0)

### 2. 广告创意数据 ❌

#### 广告创意 2491
- **关键词数量**: 14 个
- **数据类型**: 字符串数组 ❌
- **示例**: `["dr. mercola", "Dr. Mercola Complete Probiotics", ...]`
- **问题**: 没有搜索量等元数据

#### 广告创意 2493
- **关键词数量**: 16 个
- **数据类型**: 字符串数组 ❌
- **示例**: `["dr. mercola", "dr. mercola buy", ...]`
- **问题**: 没有搜索量等元数据

### 3. global_keywords 表 ⚠️

#### 新写入的关键词（6:00 之后）
- **搜索量**: 全部为 0 ❌
- **关键词质量**: 低质量重复词
- **示例**:
  - `"buy dr mercola blended vitamin & mineral supplements buy"` (searchVolume: 0)
  - `"dr mercola blended vitamin & mineral supplements buy buy"` (searchVolume: 0)

#### 旧的关键词（之前生成）
- **搜索量**: 正常 ✅
- **示例**:
  - `"dr mercola"`: 12,100
  - `"mercola"`: 8,100
  - `"dr mercola supplements"`: 1,600

---

## 三、根本原因分析

### 问题 1: 关键词来源错误

**关键发现**: 关键词池中所有关键词的 `source` 都是：
- `OFFER_EXTRACTED_KEYWORDS` (从 offer 提取)
- `CLUSTERED` (聚类生成)

**没有** `KEYWORD_PLANNER` 来源的关键词！

这说明：
1. **Keyword Planner API 没有被调用**
2. **或者调用了但返回了空结果**
3. **使用了 fallback 关键词（从 offer 提取的关键词）**

### 问题 2: extractKeywordsFromOffer 硬编码问题

**位置**: `src/lib/offer-keyword-pool.ts:2391-2399`

```typescript
const addKeywordString = (keyword: string, source: string) => {
  const normalized = keyword?.trim()
  if (!normalized) return
  addKeywordData({
    keyword: normalized,
    searchVolume: 0,  // ❌ 硬编码为 0
    source,
    matchType: 'BROAD'
  })
}
```

当从 offer 的 `extracted_keywords` 字段提取关键词时，`searchVolume` 被硬编码为 0。

### 问题 3: 关键词扩展失败

**可能的原因**:

1. **customerId 或认证信息缺失**
   - 虽然用户有 Google Ads 账户，但可能在获取配置时失败
   - 导致跳过了 Keyword Planner 查询

2. **Keyword Planner API 调用失败**
   - API 返回错误
   - 或者返回的关键词被质量过滤全部过滤掉

3. **种子词问题**
   - 初始种子词质量太差
   - 导致 Keyword Planner 返回空结果

### 问题 4: 广告创意生成问题

广告创意的关键词仍然是字符串数组，说明：
- 广告创意生成时从关键词池获取的关键词就没有元数据
- 或者在生成过程中丢失了元数据

---

## 四、代码问题定位

### 问题代码 1: extractKeywordsFromOffer

**位置**: `src/lib/offer-keyword-pool.ts:2391-2399`

```typescript
const addKeywordString = (keyword: string, source: string) => {
  const normalized = keyword?.trim()
  if (!normalized) return
  addKeywordData({
    keyword: normalized,
    searchVolume: 0,  // ❌ 问题：硬编码为 0
    source,
    matchType: 'BROAD'
  })
}
```

**影响**: 从 offer 提取的关键词 `searchVolume` 都是 0

### 问题代码 2: expandAllKeywords 可能的失败

**位置**: `src/lib/keyword-pool-helpers.ts:195-210`

```typescript
const expandedKeywords = await expandAllKeywords(
  initialKeywords,  // 这些关键词的 searchVolume 都是 0
  offer.brand,
  offer.category || '',
  offer.target_country,
  offer.target_language || 'en',
  authType,
  offer,
  userId,
  customerId,  // 可能为 undefined
  refreshToken,
  accountId,
  clientId,
  clientSecret,
  developerToken
)
```

**可能的问题**:
- `customerId` 为 undefined，导致跳过 Keyword Planner 查询
- 或者 API 调用失败，返回 fallback 关键词

---

## 五、解决方案

### 方案 1: 修复 extractKeywordsFromOffer（推荐）

修改 `extractKeywordsFromOffer` 函数，在提取关键词后，查询搜索量：

```typescript
async function extractKeywordsFromOffer(offerId: number, userId: number): Promise<PoolKeywordData[]> {
  // ... 现有的提取逻辑 ...

  const keywords = Array.from(keywordMap.values())

  // 🔧 新增：查询搜索量
  if (keywords.length > 0) {
    const { getKeywordSearchVolumes } = await import('./keyword-planner')
    const auth = await getUserAuthType(userId)
    const offer = await findOfferById(offerId, userId)

    if (offer) {
      try {
        const volumes = await getKeywordSearchVolumes(
          keywords.map(k => k.keyword),
          offer.target_country,
          offer.target_language || 'en',
          userId,
          auth.authType,
          auth.serviceAccountId
        )

        // 更新搜索量
        const volumeMap = new Map(volumes.map(v => [v.keyword.toLowerCase(), v]))
        for (const kw of keywords) {
          const volume = volumeMap.get(kw.keyword.toLowerCase())
          if (volume) {
            kw.searchVolume = volume.avgMonthlySearches || 0
            kw.competition = volume.competition
            kw.competitionIndex = volume.competitionIndex
            kw.lowTopPageBid = volume.lowTopPageBid
            kw.highTopPageBid = volume.highTopPageBid
          }
        }
      } catch (error) {
        console.warn(`⚠️ 查询搜索量失败: ${error}`)
      }
    }
  }

  return keywords
}
```

### 方案 2: 调试 expandAllKeywords

添加详细日志，确认：
1. `customerId` 是否正确传递
2. Keyword Planner API 是否被调用
3. 返回的关键词数量和质量

### 方案 3: 检查认证配置

确认 `getGoogleAdsConfig` 是否正确返回配置：

```typescript
const config = await getGoogleAdsConfig(userId)
console.log('Google Ads Config:', {
  hasRefreshToken: !!config?.refreshToken,
  hasClientId: !!config?.clientId,
  hasDeveloperToken: !!config?.developerToken
})
```

---

## 六、验证步骤

修复后，验证以下内容：

1. **关键词池数据**:
   ```sql
   SELECT
     substring(brand_keywords::text, 1, 500) as sample
   FROM offer_keyword_pools
   WHERE offer_id = 1993
   ORDER BY created_at DESC
   LIMIT 1;
   ```

   应该看到 `searchVolume` 大于 0 的关键词

2. **关键词来源**:
   检查是否有 `source: "KEYWORD_PLANNER"` 的关键词

3. **广告创意关键词**:
   检查是否是对象数组而不是字符串数组

---

## 七、总结

### 核心问题

1. ❌ **extractKeywordsFromOffer 硬编码问题**: 从 offer 提取的关键词 `searchVolume` 都是 0
2. ❌ **Keyword Planner 扩展失败**: 没有从 Keyword Planner 获取到关键词
3. ❌ **使用了 fallback 关键词**: 所有关键词都来自 offer 提取或聚类生成

### 修复优先级

1. **P0 - 修复 extractKeywordsFromOffer**: 添加搜索量查询逻辑
2. **P1 - 调试 expandAllKeywords**: 确认为什么没有调用 Keyword Planner
3. **P2 - 添加日志**: 增加详细日志便于排查问题

---

**诊断完成时间**: 2026-01-21
**诊断工具**: PostgreSQL 查询 + Node.js 脚本
**诊断脚本**: `scripts/diagnose-new-pool.ts`
