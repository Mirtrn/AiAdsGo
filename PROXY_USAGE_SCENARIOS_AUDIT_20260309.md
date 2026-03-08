# 代理 IP 使用场景全面检查

**日期**: 2026-03-09
**目的**: 检查所有使用代理 IP 的场景，确保优化方案不会遗漏或破坏任何业务逻辑

---

## 📋 代理 IP 使用场景汇总

### 1. 补点击任务（Click Farm）

**文件**: `src/lib/queue/executors/click-farm-executor.ts:95`

**代码**:
```typescript
const creds = await getProxyIp(trimmed, false)  // forceRefresh=false
```

**使用方式**: HTTP 代理（HttpsProxyAgent）

**业务需求**:
- ❌ **不能使用代理凭证缓存**
- ✅ 每次点击必须使用不同的代理 IP
- ✅ 模拟真实用户行为

**当前状态**:
- ✅ 使用 `getProxyIp(trimmed, false)`，不强制刷新
- ✅ 受全局频率限制保护
- ⚠️ 但 `forceRefresh=false` 可能使用 `getProxyIp` 内部的缓存（5分钟）

**需要修改**: 是，应该使用 `forceRefresh=true` 确保每次获取新 IP

---

### 2. 换链接任务（URL Swap）

**文件**: `src/lib/url-resolver-playwright.ts:159`

**代码**:
```typescript
const { browser, context, instanceId } = await pool.acquire(
  proxyUrl,
  proxyCredentials,
  targetCountry,
  true  // ✅ 允许使用代理凭证缓存
)
```

**使用方式**: Playwright 浏览器代理

**业务需求**:
- ✅ 可以使用代理凭证缓存
- ✅ 只是解析 URL，不涉及点击行为

**当前状态**:
- ✅ 已修改，允许使用缓存
- ✅ 受全局频率限制保护

---

### 3. HTTP URL 解析

**文件**: `src/lib/url-resolver-http.ts:185`

**代码**:
```typescript
const proxyCredentials = await getProxyIp(proxyUrl)
```

**使用方式**: HTTP 代理（HttpsProxyAgent）

**业务需求**:
- ✅ 可以使用缓存
- ✅ 只是解析 URL

**当前状态**:
- ✅ 受全局频率限制保护
- ⚠️ 使用 `getProxyIp` 默认参数，可能使用内部缓存

---

### 4. 深度抓取（Scraper）

**文件**: `src/lib/scraper.ts:40`

**代码**:
```typescript
const proxy: ProxyCredentials = await getProxyIp(proxyUrl)
```

**使用方式**: Playwright 浏览器代理

**业务需求**:
- ✅ 可以使用缓存
- ✅ 抓取商品详情，不涉及点击

**当前状态**:
- ✅ 受全局频率限制保护
- ⚠️ 使用 `getProxyIp` 默认参数

---

### 5. 隐身抓取（Stealth Scraper）

**文件**: `src/lib/stealth-scraper/browser-stealth.ts:106`

**代码**:
```typescript
proxy = await getProxyIp(effectiveProxyUrl)
```

**使用方式**: Playwright 浏览器代理

**业务需求**:
- ✅ 可以使用缓存
- ✅ 抓取数据，不涉及点击

**当前状态**:
- ✅ 受全局频率限制保护

---

### 6. 联盟产品抓取

**文件**: `src/lib/affiliate-products.ts`

**代码**:
```typescript
// Line 3036
const proxy = await fetchProxyIp(params.proxyProviderUrl, 3, false)

// Line 3418
const proxy = await fetchProxyIp(params.proxyProviderUrl, 3, false)
```

**使用方式**: Playwright 浏览器代理

**业务需求**:
- ✅ 可以使用缓存
- ✅ 抓取产品信息

**当前状态**:
- ✅ 受全局频率限制保护

---

### 7. 代理池预热

**文件**: `src/lib/proxy/proxy-pool.ts:48`

**代码**:
```typescript
const proxyCredentials = await fetchProxyIp(proxyUrl)
```

**使用方式**: 预热代理池

**业务需求**:
- ✅ 可以使用缓存
- ✅ 预热场景

**当前状态**:
- ✅ 受全局频率限制保护

---

### 8. 用户隔离代理池

**文件**: `src/lib/proxy/user-isolated-proxy-pool.ts:386`

**代码**:
```typescript
const proxyCredentials = await fetchProxyIp(proxyUrl)
```

**使用方式**: 用户隔离代理池

**业务需求**:
- ✅ 可以使用缓存

**当前状态**:
- ✅ 受全局频率限制保护

---

### 9. Proxy Axios（HTTP 请求）

**文件**: `src/lib/proxy-axios.ts:127`

**代码**:
```typescript
const proxy = await getProxyIp(proxyUrl)
```

**使用方式**: HTTP 代理

**业务需求**:
- ✅ 可以使用缓存

**当前状态**:
- ✅ 受全局频率限制保护

---

### 10. 代理验证 API

**文件**: `src/app/api/settings/proxy/validate/route.ts:42`

**代码**:
```typescript
const proxyIp = await fetchProxyIp(proxy_url)
```

**使用方式**: 验证代理配置

**业务需求**:
- ✅ 可以使用缓存
- ✅ 验证场景

**当前状态**:
- ✅ 受全局频率限制保护

---

## 🔍 发现的问题

### 问题 1: 补点击任务使用 `forceRefresh=false`

**文件**: `src/lib/queue/executors/click-farm-executor.ts:95`

**当前代码**:
```typescript
const creds = await getProxyIp(trimmed, false)  // forceRefresh=false
```

**问题**:
- `getProxyIp` 的第二个参数是 `forceRefresh`
- `forceRefresh=false` 会使用 `getProxyIp` 内部的缓存（5分钟）
- 这意味着补点击任务可能在 5 分钟内使用同一个代理 IP
- **破坏业务逻辑** ❌

**解决方案**:
```typescript
const creds = await getProxyIp(trimmed, true)  // forceRefresh=true，每次获取新 IP
```

---

### 问题 2: `getProxyIp` 内部缓存机制

**文件**: `src/lib/proxy/fetch-proxy-ip.ts:470-493`

**当前代码**:
```typescript
export async function getProxyIp(
  proxyUrl: string,
  forceRefresh = true  // 默认 true
): Promise<ProxyCredentials> {
  const now = Date.now()

  // 检查缓存
  if (!forceRefresh) {
    const cached = proxyCache.get(proxyUrl)
    if (cached && now < cached.expiresAt) {
      console.log(`使用缓存的代理IP: ${cached.credentials.fullAddress}`)
      return cached.credentials
    }
    // ...
  }
  // ...
}
```

**问题**:
- `getProxyIp` 有自己的缓存机制（5分钟）
- 当 `forceRefresh=false` 时，会使用这个缓存
- 这与我们新增的 `PlaywrightPool` 代理凭证缓存是**两个独立的缓存**

**影响**:
- 补点击任务如果使用 `forceRefresh=false`，会受到这个缓存影响
- 其他场景也可能受影响

---

## ✅ 修复建议

### 修复 1: 补点击任务强制刷新

**文件**: `src/lib/queue/executors/click-farm-executor.ts`

**修改**:
```typescript
// 修改前
const creds = await getProxyIp(trimmed, false)

// 修改后
const creds = await getProxyIp(trimmed, true)  // 🔥 强制刷新，确保每次获取新 IP
```

---

### 修复 2: 明确 `getProxyIp` 缓存策略

**建议**: 保持 `getProxyIp` 的缓存机制，但明确使用场景：

**需要每次获取新 IP 的场景**:
- ✅ 补点击任务: `getProxyIp(url, true)`
- ✅ 任何需要模拟真实用户行为的场景

**可以使用缓存的场景**:
- ✅ URL 解析: `getProxyIp(url, false)` 或使用默认值
- ✅ 数据抓取: `getProxyIp(url, false)` 或使用默认值
- ✅ 代理验证: `getProxyIp(url, false)` 或使用默认值

---

## 📊 缓存层级

我们现在有**两层缓存**：

### 第 1 层: `getProxyIp` 内部缓存

**位置**: `src/lib/proxy/fetch-proxy-ip.ts`

**缓存时间**: 5 分钟

**控制参数**: `forceRefresh`
- `true`: 不使用缓存，每次调用 API
- `false`: 使用缓存（如果未过期）

**适用场景**: 所有使用 `getProxyIp` 的场景

---

### 第 2 层: `PlaywrightPool` 代理凭证缓存

**位置**: `src/lib/playwright-pool.ts`

**缓存时间**: 5 分钟

**控制参数**: `allowCredentialsCache`
- `true`: 使用缓存
- `false`: 不使用缓存（默认）

**适用场景**: 只适用于 Playwright 浏览器代理

---

## 🎯 最终建议

### 立即修复

1. **修复补点击任务**
   ```typescript
   // src/lib/queue/executors/click-farm-executor.ts:95
   const creds = await getProxyIp(trimmed, true)  // 改为 true
   ```

### 文档说明

2. **明确两层缓存的使用场景**
   - 第 1 层（`getProxyIp`）: 通用缓存，适用于所有场景
   - 第 2 层（`PlaywrightPool`）: 只适用于 Playwright 场景

### 代码审查

3. **审查所有 `getProxyIp` 调用**
   - 确认每个调用的 `forceRefresh` 参数是否符合业务需求
   - 补点击任务必须使用 `forceRefresh=true`

---

## 📝 总结

### 发现的场景

- ✅ 10 个使用代理 IP 的场景
- ✅ 大部分场景可以使用缓存
- ❌ 1 个场景（补点击）需要修复

### 需要修复

- ❌ 补点击任务使用 `forceRefresh=false`，需要改为 `true`

### 已经保护

- ✅ 所有场景都受全局频率限制保护
- ✅ 换链接任务已启用 Playwright 凭证缓存

---

**检查人**: Claude
**完成时间**: 2026-03-09
**状态**: 发现 1 个需要修复的问题
