# 三个问题修复总结

**日期**: 2025-12-10
**状态**: ✅ 全部完成

---

## 📋 问题列表

### 1. PostgreSQL数据库迁移文件

**问题**: 缺少PostgreSQL版本的upload_records表迁移文件，SQLite和PostgreSQL迁移编号应该保持一致（070）

**解决方案**:
- ✅ 创建 `migrations/070_create_upload_records.sql` (SQLite)
- ✅ 创建 `pg-migrations/070_create_upload_records.pg.sql` (PostgreSQL)
- ✅ 注意SQLite和PostgreSQL的差异：
  - UUID类型替代TEXT
  - TIMESTAMP WITH TIME ZONE替代TEXT
  - JSONB替代TEXT（metadata字段）
  - NUMERIC(5,2)替代REAL（success_rate字段）
  - 函数/触发器语法差异
  - 添加JSONB GIN索引优化查询

**关键差异**:
```sql
-- SQLite
id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))
metadata TEXT
success_rate REAL DEFAULT 0.0

-- PostgreSQL
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
metadata JSONB
success_rate NUMERIC(5,2) DEFAULT 0.0
```

---

### 2. 移除上传记录表自动刷新

**问题**: 每10秒自动刷新可能造成不必要的服务器负载

**解决方案**:
- ✅ 修改 `src/app/(app)/offers/batch/page.tsx`
- ✅ 移除 `setInterval` 自动刷新逻辑
- ✅ 保留手动刷新按钮功能

**修改前**:
```typescript
useEffect(() => {
  loadUploadRecords()

  // 自动刷新（每10秒）
  const interval = setInterval(() => {
    loadUploadRecords()
  }, 10000)

  return () => clearInterval(interval)
}, [])
```

**修改后**:
```typescript
useEffect(() => {
  loadUploadRecords()
}, [])
```

**用户体验**: 用户可以通过点击"刷新"按钮手动更新记录列表

---

### 3. 品牌名提取策略优化

**问题**:
- Store页面提取到错误的品牌名："DREO: Best Seller"、"Amazon.ca: eufy Security"
- Product页面虽然策略1.5能提取正确的品牌（从Product Overview表格），但策略1（bylineInfo）先执行，导致提取到错误品牌

**根本原因**:
1. **Store页面**: 从页面标题提取时未清理"Best Seller"等后缀
2. **Product页面**: 策略优先级错误，Product Overview表格（最准确）未优先使用

**解决方案**:

#### 3.1 Store页面修复 (`amazon-store.ts`)

添加更多品牌名清理规则：

```typescript
// 修改前
brandName = storeName
  .replace(/^Amazon\.com:\s*/i, '')
  .replace(/^Amazon:\s*/i, '')
  .replace(/\s+Store$/i, '')
  .replace(/\s+Official Store$/i, '')
  .trim()

// 修改后
brandName = storeName
  .replace(/^Amazon\.com:\s*/i, '')
  .replace(/^Amazon\.ca:\s*/i, '')  // 新增：支持加拿大站
  .replace(/^Amazon:\s*/i, '')
  .replace(/\s+Store$/i, '')
  .replace(/\s+Official Store$/i, '')
  // 🔥 新增：移除"Best Seller"/"Best Sellers"等后缀
  .replace(/:\s*Best Sellers?$/i, '')
  .replace(/\s+-\s+Best Sellers?$/i, '')
  .replace(/\s+Best Sellers?$/i, '')
  .trim()
```

**示例**:
- `"Amazon: DREO: Best Seller"` → `"DREO"` ✅
- `"Amazon.ca: eufy Security"` → `"eufy Security"` ✅

#### 3.2 Product页面修复 (`amazon-product.ts`)

**调整策略优先级**，Product Overview表格提取优先：

| 优先级 | 策略 | 来源 | 说明 |
|-------|------|------|------|
| 🥇 **策略1** | Product Overview表格 | `#productOverview_feature_div` | **最准确** |
| 🥈 策略2 | 品牌链接 | `#bylineInfo` | 可能包含后缀 |
| 🥉 策略3 | data属性 | `[data-brand]` | 结构化数据 |
| 4 | 策略4 | technicalDetails | 技术规格 |
| 5 | 策略5 | 产品标题 | 智能解析 |
| 6 | 策略6 | URL | 备用方案 |
| 7 | 策略7 | meta标签 | 最后手段 |

**修改前顺序**:
1. bylineInfo（可能错误）→ 2. Product Overview → ...

**修改后顺序**:
1. **Product Overview（最准确）** → 2. bylineInfo → ...

**关键代码变更**:
```typescript
// 🔥 策略1（优先级最高）: 从Product Overview表格提取Brand（最准确的来源）
// 2025-12-10修复：Product Overview表格的品牌是最准确的，应该优先使用
$('#productOverview_feature_div tr, #poExpander tr').each((i: number, el: any) => {
  if (brandName) return false
  const label = $(el).find('td.a-span3, td:first-child').text().trim().toLowerCase()
  if (label === 'brand' || label.includes('brand')) {
    const value = $(el).find('td.a-span9, td:last-child').text().trim()
    if (value && value.length > 1 && value.length < 50) {
      brandName = value
      console.log(`✅ 策略1成功: 从Product Overview表格提取品牌 "${brandName}"`)
    }
  }
})

// 策略2: 从核心产品区域的品牌链接提取（次优方法）
if (!brandName) {
  // bylineInfo 提取逻辑...
}
```

**示例日志变化**:
```
// 修复前
✅ 策略1成功: 从选择器#bylineInfo提取品牌 "Visit the DREO Store"  ❌ 错误
✅ 策略1.5成功: 从Product Overview表格提取品牌 "Dreo"  （但已被跳过）

// 修复后
✅ 策略1成功: 从Product Overview表格提取品牌 "Dreo"  ✅ 正确
```

---

## 📊 影响范围

### 修改的文件

1. **migrations/070_create_upload_records.sql** (新增)
   - SQLite版本的upload_records表结构

2. **pg-migrations/070_create_upload_records.pg.sql** (新增)
   - PostgreSQL版本的upload_records表结构

2. **src/app/(app)/offers/batch/page.tsx** (修改)
   - 移除自动刷新逻辑

3. **src/lib/stealth-scraper/amazon-store.ts** (修改)
   - 增强品牌名清理规则（Best Seller等后缀）

4. **src/lib/stealth-scraper/amazon-product.ts** (修改)
   - 调整品牌提取策略优先级（Product Overview优先）

### 测试结果

✅ **编译测试**: `npm run build` 成功通过
⏳ **功能测试**: 需要实际抓取验证

---

## 🎯 预期效果

### 品牌名提取准确率提升

**修复前**:
- ❌ "DREO: Best Seller" （Store页面）
- ❌ "Amazon.ca: eufy Security" （Store页面）
- ❌ "Visit the DREO Store" （Product页面bylineInfo）

**修复后**:
- ✅ "DREO" （Store页面，清理后缀）
- ✅ "eufy Security" （Store页面，清理Amazon.ca前缀）
- ✅ "Dreo" （Product页面，Product Overview优先）

### 性能优化

- **减少服务器负载**: 移除每10秒自动刷新，改为用户按需刷新
- **数据库兼容**: PostgreSQL迁移文件支持生产环境部署

---

## 📝 后续建议

### 短期
1. **测试品牌提取**: 使用实际Store和Product链接验证品牌提取准确性
2. **监控日志**: 观察策略1（Product Overview）的成功率
3. **数据清洗**: 考虑对已有数据库中的错误品牌名进行批量修正

### 中期
1. **品牌名标准化**: 建立品牌名映射表（如"Dreo" vs "DREO"统一为标准形式）
2. **提取策略监控**: 统计各策略的使用频率和准确率
3. **异常告警**: 当品牌名包含特殊字符或长度异常时发出告警

### 长期
1. **机器学习优化**: 基于历史数据训练品牌识别模型
2. **众包校正**: 允许用户标注和修正品牌名
3. **品牌库集成**: 接入第三方品牌数据库API进行验证

---

## 🔍 验证清单

### PostgreSQL迁移
- [ ] 在PostgreSQL开发环境执行migration 070
- [ ] 验证表结构、索引、触发器正常创建
- [ ] 测试upload_records的CRUD操作
- [ ] 验证success_rate自动计算触发器

### 上传记录功能
- [ ] 上传CSV文件，验证不再自动刷新
- [ ] 手动点击"刷新"按钮，验证记录更新
- [ ] 检查浏览器Network面板，确认无定时请求

### 品牌提取准确性
- [ ] 测试Store页面: `https://www.amazon.com/stores/page/7B4F35D7-E874-4CAA-8095-14430026E790`
  - 预期品牌: "DREO" ✅
- [ ] 测试Store页面: `https://www.amazon.ca/stores/eufySecurity/page/...`
  - 预期品牌: "eufy Security" ✅
- [ ] 测试Product页面（包含Product Overview表格）
  - 预期: 策略1成功，从表格提取 ✅
- [ ] 检查日志，确认策略优先级正确

---

**实施人员**: Claude Code
**审核状态**: 待审核
**部署状态**: 待部署
