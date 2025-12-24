# 货币符号和金额参数修复方案

## 问题定位

用户反馈:不仅是货币符号,对应广告的参数也都要匹配正确的货币和金额

## 系统现状检查

### ✅ 已实现的功能

1. **数据库层面**
   - `google_ads_accounts.currency` 字段存储账号货币(USD/CNY/EUR等)
   - 测试数据显示: ID=1使用USD, ID=2-5使用CNY

2. **前端显示层面**  
   - Step3CampaignConfig.tsx:134 - 使用 `selectedAccount?.currencyCode`
   - Step4PublishSummary.tsx:59 - 使用 `selectedAccount?.currencyCode`
   - 都正确使用CURRENCY_SYMBOLS映射显示货币符号

3. **后端API层面**
   - campaign-publish-executor.ts:139 - 从DB读取 `adsAccount.currency`
   - google-ads-api.ts:570-571 - CPC出价使用micros单位(*1000000)
   - 预算金额使用micros单位(*1000000)

4. **货币工具库**
   - src/lib/currency.ts - 提供完整的货币转换和格式化功能
   - CURRENCY_SYMBOLS - 20种货币符号映射
   - EXCHANGE_RATES - 20种货币汇率
   - calculateMaxCPC() - 支持跨货币CPC计算

### 🔍 需要检查的环节

1. **账号选择时货币信息传递**
   - Step2AccountLinking → Step3CampaignConfig
   - 确保selectedAccount包含currencyCode字段

2. **默认值设置**
   - Step3中的budgetAmount默认值
   - Step3中的maxCpcBid默认值  
   - 是否根据账号货币动态调整?

3. **Google Ads API调用**
   - createGoogleAdsCampaign() 的budgetAmount参数
   - createGoogleAdsAdGroup() 的cpcBidMicros参数
   - 是否使用账号货币对应的正确金额?

## 修复方案

### 1. 确保账号选择时正确传递货币

```typescript
// Step2AccountLinking.tsx
const selectedAccount = {
  id: account.id,
  customerId: account.customer_id,
  accountName: account.account_name,
  currencyCode: account.currency || 'USD', // 关键字段
  //...
}
```

### 2. Step3根据货币动态设置默认值

```typescript
// Step3CampaignConfig.tsx
const accountCurrency = selectedAccount?.currencyCode || 'USD'
const getDefaultBudget = (currency: string): number => {
  const defaults: Record<string, number> = {
    USD: 10,
    CNY: 70,  // 70人民币 ≈ 10美元
    EUR: 10,
    //...
  }
  return defaults[currency] || 10
}
```

### 3. Step4正确显示货币和金额

```typescript
// Step4PublishSummary.tsx  
const accountCurrency = selectedAccount?.currencyCode || 'USD'
const currencySymbol = CURRENCY_SYMBOLS[accountCurrency] || '$'

// 显示预算: {currencySymbol}{campaignConfig.budgetAmount}
// 显示CPC: {currencySymbol}{campaignConfig.maxCpcBid}
```

### 4. 后端确保使用账号货币

```typescript
// campaign-publish-executor.ts
const adsAccount = await db.queryOne(
  `SELECT id, customer_id, currency FROM google_ads_accounts ...`
)

// 使用账号货币的默认CPC
const effectiveMaxCpcBid = campaignConfig.maxCpcBid || getDefaultCPC(adsAccount.currency)

// Google Ads API使用micros单位
cpcBidCeilingMicros: effectiveMaxCpcBid * 1000000
```

## 测试方案

1. **测试USD账号**
   - 检查Step3默认预算是否为$10
   - 检查Step3默认CPC是否为$0.17
   - 检查Step4显示是否为美元符号$

2. **测试CNY账号**
   - 检查Step3默认预算是否为¥70
   - 检查Step3默认CPC是否为¥1.2  
   - 检查Step4显示是否为人民币符号¥

3. **测试发布到Google Ads**
   - 确认Campaign预算金额单位正确
   - 确认AdGroup CPC出价金额单位正确
   - 在Google Ads后台验证显示金额

## 关键修复点

1. ✅ 前端已正确使用 selectedAccount.currencyCode
2. ✅ 后端已正确使用 adsAccount.currency
3. ✅ 货币符号映射已完整
4. ✅ 货币默认值已完整
5. ⚠️  需确认: selectedAccount对象是否包含currencyCode字段
6. ⚠️  需确认: Google Ads API micros单位转换是否正确

