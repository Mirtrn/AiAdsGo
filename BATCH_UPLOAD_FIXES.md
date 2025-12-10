# 批量上传问题修复报告

## 问题1：批量创建后Offer状态显示"等待抓取"  ✅ 已修复

### 根本原因
**PostgreSQL兼容性问题**：`updateOfferScrapeStatus`函数使用了SQLite专用的`datetime('now')`语法，PostgreSQL不支持此函数，导致UPDATE语句执行失败。

### 证据链
1. 生产数据库查询：16个批量创建的offers状态都是`pending`
2. 对应的offer_tasks状态都是`completed`
3. 说明任务执行完成，但状态更新SQL失败
4. 错误被try-catch捕获（line 228-231），没有抛出异常

### 修复内容
**文件1**: `src/lib/offers.ts`
- Line 800-801: 添加数据库类型检测
- Line 806, 829: 使用动态SQL函数替换硬编码的`datetime('now')`
- Line 862, 869-870, 878: 修复else分支的相同问题

**文件2**: `src/lib/queue/executors/offer-extraction-executor.ts`
- Line 40: 添加数据库类型检测
- Line 47, 79, 98, 246-247, 264-265: 所有时间戳更新使用动态SQL函数

### 技术说明
**PostgreSQL适配器已有自动转换功能**（`src/lib/db.ts:121`）：
```typescript
result = result.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP')
```

但使用模板字符串插值`${nowFunc}`会绕过SQL转换器，所以采用运行时动态选择的方案。

### 验证步骤
1. ✅ TypeScript编译成功
2. ⏳ 生产环境部署
3. ⏳ 批量上传测试
4. ⏳ 确认状态显示"已完成"

## 问题2：竞品链接中的多余后缀 🔍 排查中

### 问题描述
竞品链接显示为：
```
https://www.amazon.com/dp/B0CW65GK5X:amzn1.deal.17f9879e
```
后缀`:amzn1.deal.17f9879e`是Amazon deal标识符，应该被移除。

### 根本原因 ✅ 已定位
**竞品数据采集时未清理ASIN中的deal标识符**：生产数据库查询显示`competitor_analysis` JSON中的ASIN字段包含deal后缀。

**证据**：
```json
{
  "competitors": [
    {
      "asin": "B093KRX2K1:amzn1.deal.f75af6de",  // ❌ 包含deal后缀
      "name": "Neakasa P1 Pro Pet Grooming Kit...",
      ...
    }
  ]
}
```

**数据流**：
1. 竞品搜索 → Amazon返回deal链接（如`/dp/B093KRX2K1:amzn1.deal.f75af6de`）
2. `extractAsin()`提取 → 未过滤deal后缀 → 存储到数据库
3. 前端显示 → 使用`comp.asin`构建链接 → 出现错误链接

### 修复方案 ✅ 已实施
**位置**：`src/lib/competitor-analyzer.ts:494-501`

**根本原因**：Amazon搜索结果页面的`data-asin`属性有时包含deal标识符，代码直接读取属性值未做清理

**修复代码**：
```typescript
// 修复前（Line 494）
const asin = el.getAttribute('data-asin')
if (!asin) continue

// 修复后（Line 494-501）
let asin = el.getAttribute('data-asin')
if (!asin) continue

// 🔧 修复: 清理ASIN中的deal标识符后缀 (如 :amzn1.deal.xxx)
// Amazon搜索结果的data-asin有时包含deal参数，需要移除
if (asin.includes(':')) {
  asin = asin.split(':')[0]
}
```

### 验证步骤
1. ✅ TypeScript编译成功
2. ⏳ 生产环境部署
3. ⏳ 批量上传测试
4. ⏳ 确认竞品链接不再包含deal后缀

## 修复优先级
- P0: 问题1（状态显示）- ✅ 已修复
- P1: 问题2（竞品链接）- ✅ 已修复

## 后续步骤
1. 部署到生产环境
2. 批量上传测试验证
3. 监控Offer状态和竞品链接显示
