# Launch Score 评估机制优化总结

**日期**: 2025-12-13
**目标**: 修复关键词冲突、预算数据传递和拦截提示问题

---

## 问题分析

### 问题1：关键词冲突（竞品品牌同时出现在正负关键词中）

**现象**：
- Launch Score评估发现：'Arlo'、'Blink'、'SimpliSafe' 既在目标关键词中，又在否定关键词中
- 导致广告无法展示，预算白白消耗

**根本原因**：
1. **正面关键词生成**（`keywords_generation` v3.1 prompt）：
   - 包含"Intent Keywords"类别，其中有"comparison queries"（对比查询）
   - AI可能生成"Eufy vs Arlo"、"Arlo alternative"等竞品关键词

2. **否定关键词生成**（`generateNegativeKeywords` 函数）：
   - 明确指示"排除主要竞品的品牌名和型号"
   - AI会生成"Arlo"、"Ring"、"Blink"等否定词

3. **冲突结果**：
   - 同一个品牌名（如"Arlo"）既在正面关键词中（作为对比词），又在否定关键词中（作为排除词）
   - Google Ads会优先应用否定关键词，导致广告无法展示

**解决方案**：
- 创建 `keywords_generation` v3.2 prompt
- 添加 `CRITICAL RESTRICTIONS` 章节，明确禁止生成竞品品牌关键词
- 移除"comparison queries"类别，只保留自有品牌和通用类别关键词

---

### 问题2：预算数据未传递

**现象**：
- Launch Score评估时，预算显示为"Based on keyword competition"（概念性描述）
- AI无法基于此进行预算合理性评分，导致预算得分仅2/15分

**根本原因**：
- `scoring.ts:93` 行硬编码预算为 `'Based on keyword competition'`
- `calculateLaunchScore` 函数未接收 `campaignConfig` 参数
- Step3的预算数据（`budgetAmount`、`maxCpcBid`）未传递给Launch Score计算

**解决方案**：
1. 修改 `calculateLaunchScore` 函数签名，添加 `campaignConfig` 可选参数
2. 在 `campaigns/publish/route.ts` 中传递预算数据：
   ```typescript
   {
     budgetAmount: _campaignConfig.budgetAmount,
     maxCpcBid: _campaignConfig.maxCpcBid,
     budgetType: _campaignConfig.budgetType
   }
   ```
3. 在 `scoring.ts` 中格式化预算信息：
   ```typescript
   const budgetText = campaignConfig?.budgetAmount
     ? `$${campaignConfig.budgetAmount}/day (${campaignConfig.budgetType || 'DAILY'}), Max CPC: $${campaignConfig.maxCpcBid || 'Auto'}`
     : 'Based on keyword competition'
   ```

---

### 问题3：拦截提示不够具体

**现象**：
- Launch Score < 80时，只显示"建议优化后再发布"
- 用户不知道具体要修复什么问题

**根本原因**：
- 拦截响应只包含 `keywordAnalysis.issues`，缺少其他维度的问题
- 没有提供具体的修复建议和优先级

**解决方案**：
1. 收集所有5个维度的问题和建议：
   - `keywordAnalysis`
   - `marketFitAnalysis`
   - `landingPageAnalysis`
   - `budgetAnalysis`
   - `contentAnalysis`

2. 优化响应结构：
   ```json
   {
     "error": "投放风险较高（Launch Score: 72分），建议优化",
     "details": {
       "launchScore": 72,
       "threshold": 80,
       "breakdown": {
         "keyword": { "score": 16, "max": 30 },
         "marketFit": { "score": 24, "max": 25 },
         "landingPage": { "score": 20, "max": 20 },
         "budget": { "score": 2, "max": 15 },
         "content": { "score": 10, "max": 10 }
       },
       "issues": [
         "关键词匹配类型缺失（258个关键词）",
         "正负关键词冲突（Arlo、Blink、SimpliSafe）",
         "预算未定义"
       ],
       "suggestions": [
         "为所有关键词定义匹配类型（Phrase/Exact）",
         "重构Campaign：分离品牌、通用、竞品关键词",
         "使用Keyword Planner估算CPC并设置具体预算"
       ],
       "overallRecommendations": [
         "Top Priority: 修复关键词策略（定义匹配类型 + 解决冲突）",
         "Top Priority: 设置具体日预算"
       ],
       "canForcePublish": true
     },
     "action": "LAUNCH_SCORE_WARNING"
   }
   ```

---

## 实施的修复

### 1. 数据库迁移文件

创建了两个迁移文件：
- `migrations/077_fix_keyword_conflict_and_budget.sql` (SQLite)
- `pg-migrations/077_fix_keyword_conflict_and_budget.pg.sql` (PostgreSQL)

**内容**：
- 停用旧版本 `keywords_generation` v3.1
- 插入新版本 `keywords_generation` v3.2
- 添加 `CRITICAL RESTRICTIONS` 章节，禁止生成竞品品牌关键词

### 2. 代码修改

#### 2.1 `src/lib/scoring.ts`

**修改1**: 添加 `campaignConfig` 参数
```typescript
export async function calculateLaunchScore(
  offer: Offer,
  creative: AdCreative,
  userId: number,
  campaignConfig?: {
    budgetAmount?: number
    maxCpcBid?: number
    budgetType?: string
  }
): Promise<...>
```

**修改2**: 格式化预算信息
```typescript
const budgetText = campaignConfig?.budgetAmount
  ? `$${campaignConfig.budgetAmount}/day (${campaignConfig.budgetType || 'DAILY'}), Max CPC: $${campaignConfig.maxCpcBid || 'Auto'}`
  : 'Based on keyword competition'
```

#### 2.2 `src/app/api/campaigns/publish/route.ts`

**修改1**: 传递预算数据给 `calculateLaunchScore`
```typescript
const launchScoreResult = await calculateLaunchScore(
  offer,
  { ...primaryCreative, ... } as AdCreative,
  userId,
  {
    budgetAmount: _campaignConfig.budgetAmount,
    maxCpcBid: _campaignConfig.maxCpcBid,
    budgetType: _campaignConfig.budgetType
  }
)
```

**修改2**: 优化拦截响应（收集所有维度的问题和建议）
```typescript
const allIssues = [
  ...(launchScoreResult.scoreAnalysis.keywordAnalysis?.issues || []),
  ...(launchScoreResult.scoreAnalysis.marketFitAnalysis?.issues || []),
  ...(launchScoreResult.scoreAnalysis.landingPageAnalysis?.issues || []),
  ...(launchScoreResult.scoreAnalysis.budgetAnalysis?.issues || []),
  ...(launchScoreResult.scoreAnalysis.contentAnalysis?.issues || [])
]

const allSuggestions = [
  ...(launchScoreResult.scoreAnalysis.keywordAnalysis?.suggestions || []),
  ...(launchScoreResult.scoreAnalysis.marketFitAnalysis?.suggestions || []),
  ...(launchScoreResult.scoreAnalysis.landingPageAnalysis?.suggestions || []),
  ...(launchScoreResult.scoreAnalysis.budgetAnalysis?.suggestions || []),
  ...(launchScoreResult.scoreAnalysis.contentAnalysis?.suggestions || [])
]
```

**修改3**: 优化 `breakdown` 结构（显示最大分值）
```typescript
breakdown: {
  keyword: { score: keywordScore, max: 30 },
  marketFit: { score: marketFitScore, max: 25 },
  landingPage: { score: landingPageScore, max: 20 },
  budget: { score: budgetScore, max: 15 },
  content: { score: contentScore, max: 10 }
}
```

---

## 验证步骤

### 1. 应用数据库迁移

```bash
# SQLite
sqlite3 /path/to/autoads.db < migrations/077_fix_keyword_conflict_and_budget.sql

# PostgreSQL
psql -d autoads -f pg-migrations/077_fix_keyword_conflict_and_budget.pg.sql
```

### 2. 验证Prompt版本

```sql
SELECT prompt_id, version, is_active, name
FROM prompt_versions
WHERE prompt_id = 'keywords_generation'
ORDER BY version DESC;
```

预期结果：
- v3.2 的 `is_active` 应为 `1` (SQLite) 或 `true` (PostgreSQL)
- v3.1 的 `is_active` 应为 `0` (SQLite) 或 `false` (PostgreSQL)

### 3. 测试关键词生成

重新生成Offer #136的广告创意，验证：
- ✅ 正面关键词中不包含竞品品牌（Arlo、Ring、Blink）
- ✅ 否定关键词中包含竞品品牌
- ✅ 无关键词冲突

### 4. 测试预算传递

在广告发布流程的Step3设置预算后，验证：
- ✅ Launch Score评估时显示具体预算（如"$50/day (DAILY), Max CPC: $1.5"）
- ✅ 预算得分提升（从2/15提升到10+/15）

### 5. 测试拦截提示

触发Launch Score < 80的场景，验证：
- ✅ 显示所有5个维度的分数和最大值
- ✅ 显示所有维度的问题列表
- ✅ 显示所有维度的修复建议
- ✅ 显示总体优化建议（`overallRecommendations`）

---

## 预期效果

### 关键词冲突问题
- **修复前**: 258个关键词中，部分竞品品牌关键词与否定关键词冲突
- **修复后**: 关键词只包含自有品牌和通用类别，无冲突

### 预算评分问题
- **修复前**: 预算得分 2/15（因为预算为"Based on keyword competition"）
- **修复后**: 预算得分 10+/15（基于具体的预算数据）

### 拦截提示问题
- **修复前**: 只显示"建议优化后再发布"，无具体指导
- **修复后**: 显示详细的问题列表、修复建议和优先级

### Launch Score提升
- **修复前**: 72分（关键词16/30 + 预算2/15）
- **修复后**: 85+分（关键词25+/30 + 预算10+/15）

---

## 保留的机制

### 1. Launch Score阈值
- **80分阈值**: 保持不变
- **60分严重阈值**: 保持不变（强制阻断）
- **60-80分警告阈值**: 保持不变（允许强制发布）

### 2. 强制发布选项
- 保留 `forcePublish` 参数
- 60-80分时允许用户强制发布
- <60分时强制阻断，不允许发布

### 3. 评分维度权重
- 关键词质量：30分
- 市场契合度：25分
- 着陆页质量：20分
- 预算合理性：15分
- 内容创意质量：10分

---

## 后续优化建议

### 1. 前端UI优化
在Launch Score拦截弹窗中：
- 显示5个维度的雷达图
- 按优先级排序问题列表（P0 > P1 > P2）
- 提供"一键修复"按钮（跳转到对应的编辑页面）

### 2. 智能修复建议
基于AI分析结果，提供可执行的修复操作：
- "自动移除冲突关键词"按钮
- "使用Keyword Planner估算预算"按钮
- "重新生成关键词"按钮

### 3. 历史数据分析
记录所有Launch Score评估结果，分析：
- 哪些问题最常见
- 哪些维度最容易失分
- 强制发布的Campaign的ROI表现

---

## 相关文件

### 修改的文件
- `src/lib/scoring.ts`
- `src/app/api/campaigns/publish/route.ts`

### 新增的文件
- `migrations/077_fix_keyword_conflict_and_budget.sql`
- `pg-migrations/077_fix_keyword_conflict_and_budget.pg.sql`
- `LAUNCH_SCORE_FIXES.md` (本文档)

### 相关文档
- `PRD.md` - Section 3.10: Launch Score投放评分
- `TECHNICAL_SPEC.md` - Section 4.7: Launch Score评估系统
- `DEVELOPMENT_PLAN.md` - Sprint 3.3: Launch Score功能
