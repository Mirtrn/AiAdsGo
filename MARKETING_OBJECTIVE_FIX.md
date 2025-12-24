# 营销目标(Marketing Objective)显示问题修复报告

**修复日期**: 2025-12-24
**问题来源**: 用户反馈截图显示Google Ads UI中"营销目标"为空

---

## 问题描述

### 症状
用户发布广告系列到真实Google Ads账号后,在Google Ads UI中查看:
- **广告系列名称**: `274-184-anycubic-Search-20251224211816`
- **广告系列状态**: 已启用 ✅
- **营销目标**: ❌ **没有选择营销目标**（应该显示"网站流量"）

### 根因分析

通过代码审查发现问题根源:

#### 1. 前端Step3未传递营销目标参数
```typescript
// src/app/(app)/offers/[id]/launch/steps/Step3CampaignConfig.tsx

interface CampaignConfig {
  campaignName: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  // ...其他字段...
  // ❌ 缺失: marketingObjective 字段
}
```

#### 2. 前端发布请求体缺失字段
```typescript
// src/app/(app)/offers/[id]/launch/steps/Step4PublishSummary.tsx:144-158

const response = await fetch('/api/campaigns/publish', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'credentials': 'include'
  },
  body: JSON.stringify({
    offerId: offer.id,
    adCreativeId: selectedCreative.id,
    googleAdsAccountId: selectedAccount.id,
    campaignConfig: campaignConfig,  // ❌ campaignConfig中没有marketingObjective
    pauseOldCampaigns: pauseOldCampaigns,
    enableCampaignImmediately: enableCampaignImmediately,
    forcePublish: true
  })
})
```

#### 3. 后端虽有处理但前端未传值
```typescript
// src/app/api/campaigns/publish/route.ts:786

marketingObjective: _campaignConfig.marketingObjective || 'WEB_TRAFFIC'
// ⚠️ 由于前端campaignConfig没有marketingObjective字段,这里永远使用默认值
```

```typescript
// src/lib/queue/executors/campaign-publish-executor.ts:116

marketingObjective = 'WEB_TRAFFIC'  // 🔧 默认营销目标为网站流量
// ⚠️ 虽然后端有默认值,但需要前端传递正确配置
```

#### 4. 后端已实现营销目标设置逻辑
```typescript
// src/lib/queue/executors/campaign-publish-executor.ts:252-275

try {
  console.log(`\n🎯 设置营销目标: ${marketingObjective}`)
  const marketingObjectiveResult = await setCampaignMarketingObjective({
    customerId: adsAccount.customer_id,
    refreshToken: credentials!.refresh_token,
    campaignId: googleCampaignId,
    marketingObjective: marketingObjective,  // ← 接收到的值永远是默认值
    accountId: adsAccount.id,
    userId,
    loginCustomerId: finalLoginCustomerId
  })
  // ...
} catch (marketingObjectiveError: any) {
  // 营销目标设置失败不阻断发布流程,只记录警告
  console.log(`⚠️ 营销目标设置失败（不影响发布）: ${marketingObjectiveError.message}`)
}
```

### 问题链路图

```mermaid
graph LR
    A[Step3: 配置广告] -->|缺失marketingObjective| B[campaignConfig对象]
    B -->|传给API| C[POST /api/campaigns/publish]
    C -->|使用默认值WEB_TRAFFIC| D[队列任务]
    D -->|调用setCampaignMarketingObjective| E[Google Ads API]
    E -->|设置失败或不生效| F[UI显示"没有选择营销目标"]

    style A fill:#ff6b6b
    style B fill:#ff6b6b
    style F fill:#ff6b6b
```

---

## 修复方案

### 修复文件
`src/app/(app)/offers/[id]/launch/steps/Step3CampaignConfig.tsx`

### 修复内容

#### 1. 在CampaignConfig接口添加marketingObjective字段
```typescript
interface CampaignConfig {
  // Campaign Level
  campaignName: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  targetCountry: string
  targetLanguage: string
  biddingStrategy: string
  finalUrlSuffix: string
  marketingObjective: 'WEB_TRAFFIC' | 'SALES' | 'LEADS' | 'STORE_VISITS'  // ✅ 新增(2025-12-24): 营销目标

  // Ad Group Level
  adGroupName: string
  maxCpcBid: number
  // ...
}
```

#### 2. 在初始化配置时设置默认值
```typescript
const [config, setConfig] = useState<CampaignConfig>(
  initialConfig || {
    // Campaign Level
    campaignName: initialNaming.campaignName,
    budgetAmount: getDefaultBudget(accountCurrency),
    budgetType: 'DAILY' as const,
    targetCountry: offer.targetCountry || 'US',
    targetLanguage: offer.targetLanguage || 'en',
    biddingStrategy: 'MAXIMIZE_CLICKS',
    marketingObjective: 'WEB_TRAFFIC' as const,  // ✅ 新增(2025-12-24): 营销目标默认为网站流量
    finalUrlSuffix: selectedCreative?.finalUrlSuffix || offer.finalUrlSuffix || '',
    // ...
  }
)
```

### 修复位置
- **文件**: `src/app/(app)/offers/[id]/launch/steps/Step3CampaignConfig.tsx`
- **行号**:
  - 接口定义: Line 106
  - 初始化配置: Line 214

---

## 验证方法

### 1. 前端数据流验证
打开浏览器DevTools Console,在Step3配置完成后查看:
```javascript
console.log('campaignConfig:', campaignConfig)
// 应该看到:
// {
//   campaignName: "...",
//   budgetAmount: 10,
//   marketingObjective: "WEB_TRAFFIC",  // ✅ 必须存在
//   ...
// }
```

### 2. API请求验证
在Network面板查看 `POST /api/campaigns/publish` 请求体:
```json
{
  "offerId": 123,
  "adCreativeId": 456,
  "googleAdsAccountId": 789,
  "campaignConfig": {
    "campaignName": "...",
    "marketingObjective": "WEB_TRAFFIC",  // ✅ 必须存在
    "budgetAmount": 10,
    "budgetType": "DAILY",
    "biddingStrategy": "MAXIMIZE_CLICKS",
    ...
  },
  ...
}
```

### 3. 后端日志验证
检查队列执行器日志:
```bash
🎯 设置营销目标: WEB_TRAFFIC  # ← 应该显示正确的值(不是undefined)
✅ 营销目标设置成功: 营销目标 WEB_TRAFFIC 设置成功
```

### 4. Google Ads UI验证
发布广告系列后,登录Google Ads控制台:
1. 进入"广告系列"页面
2. 点击刚发布的广告系列
3. 查看"营销目标"字段
4. **期望结果**: 显示"网站流量"或"Website traffic" ✅

---

## 技术背景

### Google Ads API营销目标设置机制

#### 问题: Google Ads API v21没有直接的"营销目标"字段
Google Ads的"营销目标"(Marketing Objective)并不是Campaign资源的直接字段,而是通过以下机制实现:

#### 解决方案: 使用CampaignConversionGoal
```typescript
// src/lib/google-ads-api.ts:1895-2125

export async function setCampaignMarketingObjective(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  marketingObjective: MarketingObjective  // 'WEB_TRAFFIC' | 'SALES' | 'LEADS' | 'STORE_VISITS'
  ...
}): Promise<{ success: boolean; message: string }> {
  // 1. 查询Campaign现有的转化目标
  const query = `
    SELECT
      campaign_conversion_goal.resource_name,
      campaign_conversion_goal.category,
      campaign_conversion_goal.origin,
      campaign_conversion_goal.biddable
    FROM campaign_conversion_goal
    WHERE campaign.id = ${campaignId}
  `

  // 2. 找到匹配的转化目标(根据category和origin)
  const mapping = MARKETING_OBJECTIVE_MAPPING[marketingObjective]
  // WEB_TRAFFIC → category=PAGE_VIEW(3), origin=WEBSITE(2)

  // 3. 更新biddable=true
  await customer.campaignConversionGoals.update([{
    resource_name: targetGoal.resource_name,
    biddable: true
  }])
}
```

#### 营销目标映射表
```typescript
const MARKETING_OBJECTIVE_MAPPING = {
  'WEB_TRAFFIC': {
    category: enums.ConversionActionCategory.PAGE_VIEW,  // 3
    origin: enums.ConversionOrigin.WEBSITE,              // 2
    conversionActionCategory: enums.ConversionActionCategory.PAGE_VIEW,
    conversionActionName: 'AutoAds - Page View'
  },
  'SALES': {
    category: enums.ConversionActionCategory.PURCHASE,   // 4
    origin: enums.ConversionOrigin.WEBSITE,              // 2
    ...
  },
  // ...
}
```

---

## 相关文档

### 业务需求
- **文档**: `docs/BasicPrinciples/RequirementsV1.md`
- **章节**: 第16条 - "发布广告"功能的默认值
- **原文**:
  > objective 默认是 Website traffic
  > Conversion goals 默认是 Page views

### Google Ads API文档
- [Campaign Conversion Goals](https://developers.google.com/google-ads/api/reference/rpc/latest/CampaignConversionGoal)
- [Conversion Action Category Enum](https://developers.google.com/google-ads/api/reference/rpc/latest/ConversionActionCategoryEnum.ConversionActionCategory)
- [Conversion Origin Enum](https://developers.google.com/google-ads/api/reference/rpc/latest/ConversionOriginEnum.ConversionOrigin)

---

## 历史问题追踪

### 为什么之前的代码禁用了营销目标设置?
```typescript
// src/lib/google-ads-api.ts:554-564 (修复前的注释)

// ❌ DISABLED: CampaignGoalCategory enum不存在于google-ads-api v21
// 营销目标不是必填字段,可以在Google Ads UI中手动设置
// campaign.campaign_goal = {
//   goal_category: enums.CampaignGoalCategory.WEBSITE_TRAFFIC,
//   optimization_goal_type: enums.OptimizationGoalType.MAXIMIZE_CONVERSION_VALUE
// }
```

**原因**: 尝试使用不存在的 `CampaignGoalCategory` 枚举导致失败,于是禁用了设置逻辑。

**正确做法**: 使用 `CampaignConversionGoal` + `biddable=true` 来设置营销目标(已在2025-12-19实现)。

---

## 后续优化建议

### 1. 支持用户选择营销目标
当前只支持默认的 `WEB_TRAFFIC`,可以在Step3增加营销目标选择器:
```tsx
<Select
  value={config.marketingObjective}
  onValueChange={(value) => handleChange('marketingObjective', value)}
>
  <SelectItem value="WEB_TRAFFIC">网站流量 (Website Traffic)</SelectItem>
  <SelectItem value="SALES">销售 (Sales)</SelectItem>
  <SelectItem value="LEADS">潜在客户 (Leads)</SelectItem>
  <SelectItem value="STORE_VISITS">实体店访问 (Store Visits)</SelectItem>
</Select>
```

### 2. 前端显示营销目标
在Step4汇总页面显示选择的营销目标:
```tsx
<div>
  <Label>营销目标 (Marketing Objective)</Label>
  <div className="text-sm text-muted-foreground">
    {campaignConfig.marketingObjective === 'WEB_TRAFFIC' && '网站流量 (Website Traffic)'}
    {campaignConfig.marketingObjective === 'SALES' && '销售 (Sales)'}
    {campaignConfig.marketingObjective === 'LEADS' && '潜在客户 (Leads)'}
    {campaignConfig.marketingObjective === 'STORE_VISITS' && '实体店访问 (Store Visits)'}
  </div>
</div>
```

### 3. 错误处理增强
如果Google Ads账号缺少对应的转化操作,自动创建:
```typescript
// src/lib/google-ads-api.ts:1742-1788 (已实现)

async function createConversionAction(
  customer: Customer,
  marketingObjective: MarketingObjective
): Promise<string | null> {
  const mapping = MARKETING_OBJECTIVE_MAPPING[marketingObjective]
  const conversionAction = {
    name: `${mapping.conversionActionName} - ${Date.now()}`,
    category: mapping.conversionActionCategory,
    type: enums.ConversionActionType.WEBPAGE,  // 网页转化
    status: enums.ConversionActionStatus.ENABLED,
    ...
  }
  const response = await customer.conversionActions.create([conversionAction])
  return response.results[0].resource_name
}
```

---

## 总结

### 修复内容
✅ 在 `CampaignConfig` 接口添加 `marketingObjective` 字段
✅ 在初始化配置时设置默认值 `'WEB_TRAFFIC'`
✅ 确保前端传递完整的 `campaignConfig` 给后端API

### 影响范围
- **前端**: Step3广告配置页面
- **后端**: `/api/campaigns/publish` 接收完整配置
- **队列**: Campaign发布执行器使用正确的营销目标值
- **Google Ads**: 广告系列在UI中正确显示"网站流量"

### 预期效果
发布广告系列后,在Google Ads UI中查看:
- **营销目标**: ✅ **网站流量 (Website traffic)**
- **转化目标**: ✅ **网页浏览次数 (Page views)**
