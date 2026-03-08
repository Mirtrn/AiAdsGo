# IPRocket 高频调用导致业务异常的根本原因分析

**日期**: 2026-03-09
**问题**: 生产环境换链接任务执行时报错 "IPRocket 代理服务商返回业务异常...原始错误: URL解析失败（6次尝试后）"

---

## 🎯 根本原因

通过代码追踪和测试验证，确认问题的根本原因是：

**在换链接任务执行过程中，Playwright 浏览器实例创建时会高频调用 IPRocket API，触发了 IPRocket 的频率限制风控机制。**

---

## 📊 完整调用链路

### 1. URL 解析重试循环
**文件**: `src/lib/url-resolver-enhanced.ts:788`

```typescript
while (attempt <= retryConfig.maxRetries) {  // 默认重试 5 次（短链接）
  const proxy = proxyPool.getBestProxyForCountry(targetCountry)
  result = await resolveWithPlaywright(affiliateLink, proxy.url, targetCountry)
}
```

### 2. Playwright 解析
**文件**: `src/lib/url-resolver-playwright.ts:722`

```typescript
async function resolveWithPlaywright(affiliateLink, proxyUrl, targetCountry) {
  const result = await resolveAffiliateLinkWithPlaywright(affiliateLink, proxyUrl, 5000, targetCountry)
}
```

### 3. 获取浏览器实例
**文件**: `src/lib/url-resolver-playwright.ts:159`

```typescript
async function getBrowserFromPool(proxyUrl, targetCountry) {
  const pool = getPlaywrightPool()
  const { browser, context, instanceId } = await pool.acquire(proxyUrl, proxyCredentials, targetCountry)
}
```

### 4. Playwright 连接池获取实例
**文件**: `src/lib/playwright-pool.ts:452-507`

```typescript
async acquire(proxyUrl, proxyCredentials, targetCountry) {
  // 1. 尝试复用现有空闲实例
  const existing = this.findIdleInstance(proxyKey)
  if (existing) {
    return { browser: existing.browser, context: newContext, instanceId: existing.id }
  }

  // 2. 检查是否可以创建新实例
  const proxyInstanceCount = this.countInstancesForProxy(proxyKey)
  const canCreateForProxy = proxyInstanceCount < POOL_CONFIG.maxInstancesPerProxy  // 3
  const canCreateGlobal = this.instances.size < POOL_CONFIG.maxInstances  // 8

  if (canCreateForProxy && canCreateGlobal) {
    // 🔥 关键：创建新实例
    return await this.createAndRegisterInstance(proxyUrl, proxyCredentials, targetCountry)
  }
}
```

### 5. 创建新实例（触发 IPRocket API 调用）
**文件**: `src/lib/playwright-pool.ts:705`

```typescript
private async createInstance(proxyUrl, proxyCredentials, targetCountry) {
  if (proxyUrl) {
    const { getProxyIp } = await import('./proxy/fetch-proxy-ip')
    // 🔥 关键：每次创建实例都调用 IPRocket API
    proxy = await getProxyIp(proxyUrl, true)  // forceRefresh=true 总是获取新IP
  }
}
```

### 6. 获取代理 IP
**文件**: `src/lib/proxy/fetch-proxy-ip.ts:223`

```typescript
export async function fetchProxyIp(proxyUrl, maxRetries = 3, skipHealthCheck = false) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 🔥 关键：调用 Provider 的 extractCredentials
    const credentials = await provider.extractCredentials(proxyUrl)
  }
}
```

### 7. IPRocket API 调用
**文件**: `src/lib/proxy/providers/iprocket-provider.ts:54-133`

```typescript
async extractCredentials(proxyUrl: string): Promise<ProxyCredentials> {
  // 🔥 关键：实际的 IPRocket API HTTP 请求
  const response = await axios.get(proxyUrl, { timeout: 10000 })

  // 检测业务异常错误
  if (text.trim().startsWith('{') && text.includes('"code"')) {
    const jsonResp = JSON.parse(text)
    if (jsonResp.code && jsonResp.code !== 200) {
      throw createIprocketApiError(jsonResp.code, errorMsg)
    }
  }
}
```

---

## 🔥 触发高频调用的场景

### 场景 1: 单个任务重试
- 1 个换链接任务执行
- URL 解析失败，重试 5 次
- 每次重试可能需要创建新的 Playwright 实例
- **可能产生 5 次 IPRocket API 调用**

### 场景 2: 多任务并发（高危）
- 10 个换链接任务并发执行
- Playwright 连接池已满（maxInstances=8）
- 每个任务重试 5 次
- 在短时间内（几秒钟）可能产生 **10-50 次 IPRocket API 调用**
- **如果调用间隔小于 50ms，触发 IPRocket 风控**

### 场景 3: 连接池频繁创建实例
- Playwright 连接池配置：
  - `maxInstances: 8` （最多 8 个实例）
  - `maxInstancesPerProxy: 3` （每个代理最多 3 个实例）
  - `maxIdleTime: 60000` （空闲 1 分钟后清理）
- 如果任务执行时间超过 1 分钟，实例被清理
- 下次执行需要重新创建实例
- **每次创建都调用 IPRocket API**

---

## 🧪 测试验证

### 测试脚本: `scripts/test-iprocket-frequency.js`

```javascript
// 测试结果：
// 正常频率 (1000ms): 5/5 成功
// 高频 (100ms): 10/10 成功
// 极高频 (50ms): 前 5 次成功，第 6 次开始触发"业务异常"错误
```

**结论**: IPRocket API 有频率限制，50ms 间隔会在第 6 次调用后触发风控。

---

## 💡 解决方案

### 方案 1: 添加全局 IPRocket API 调用频率限制（推荐）

在 `src/lib/proxy/fetch-proxy-ip.ts` 中添加全局调用频率限制：

```typescript
// 全局 IPRocket API 调用频率限制
const iprocketCallQueue: Array<() => Promise<void>> = []
let lastIprocketCallTime = 0
const MIN_IPROCKET_CALL_INTERVAL = 100 // 最小调用间隔 100ms

async function throttleIprocketCall<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      const now = Date.now()
      const timeSinceLastCall = now - lastIprocketCallTime

      if (timeSinceLastCall < MIN_IPROCKET_CALL_INTERVAL) {
        const waitTime = MIN_IPROCKET_CALL_INTERVAL - timeSinceLastCall
        console.log(`⏳ IPRocket API 频率限制，等待 ${waitTime}ms...`)
        await new Promise(r => setTimeout(r, waitTime))
      }

      lastIprocketCallTime = Date.now()

      try {
        const result = await fn()
        resolve(result)
      } catch (error) {
        reject(error)
      } finally {
        // 执行队列中的下一个调用
        const next = iprocketCallQueue.shift()
        if (next) {
          next()
        }
      }
    }

    // 如果有正在执行的调用，加入队列
    if (Date.now() - lastIprocketCallTime < MIN_IPROCKET_CALL_INTERVAL) {
      iprocketCallQueue.push(execute)
    } else {
      execute()
    }
  })
}

// 在 fetchProxyIp 中使用
export async function fetchProxyIp(proxyUrl: string, maxRetries = 3, skipHealthCheck = false) {
  const provider = ProxyProviderRegistry.getProvider(proxyUrl)

  // 如果是 IPRocket，使用频率限制
  if (provider.name === 'IPRocket') {
    return throttleIprocketCall(() => provider.extractCredentials(proxyUrl))
  }

  return provider.extractCredentials(proxyUrl)
}
```

### 方案 2: 使用代理凭证缓存

在 `src/lib/playwright-pool.ts` 中添加代理凭证缓存：

```typescript
// 代理凭证缓存（5 分钟）
const proxyCredentialsCache = new Map<string, {
  credentials: any
  expiresAt: number
}>()

private async createInstance(proxyUrl, proxyCredentials, targetCountry) {
  if (proxyUrl) {
    // 检查缓存
    const cached = proxyCredentialsCache.get(proxyUrl)
    if (cached && Date.now() < cached.expiresAt) {
      console.log(`🔥 使用缓存的代理凭证: ${cached.credentials.host}:${cached.credentials.port}`)
      proxy = cached.credentials
    } else {
      // 获取新凭证
      const { getProxyIp } = await import('./proxy/fetch-proxy-ip')
      proxy = await getProxyIp(proxyUrl, true)

      // 缓存 5 分钟
      proxyCredentialsCache.set(proxyUrl, {
        credentials: proxy,
        expiresAt: Date.now() + 5 * 60 * 1000
      })
    }
  }
}
```

### 方案 3: 增加 Playwright 连接池大小

在 `src/lib/playwright-pool.ts` 中调整配置：

```typescript
const POOL_CONFIG = {
  maxInstances: 15,              // 从 8 提升到 15
  maxInstancesPerProxy: 5,       // 从 3 提升到 5
  maxIdleTime: 5 * 60 * 1000,    // 从 1 分钟提升到 5 分钟
  launchTimeout: 30000,
  acquireTimeout: 180000,
  warmupCount: 3,                // 从 1 提升到 3
}
```

---

## 📝 建议

1. **立即实施方案 1**：添加全局 IPRocket API 调用频率限制，这是最直接有效的解决方案
2. **同时实施方案 2**：添加代理凭证缓存，减少不必要的 API 调用
3. **可选实施方案 3**：如果内存允许，增加连接池大小可以进一步减少实例创建频率

---

## ✅ 验证方法

实施修复后，可以通过以下方式验证：

1. 在生产环境执行换链接任务
2. 监控 IPRocket API 调用日志
3. 确认调用间隔 >= 100ms
4. 确认不再出现"业务异常"错误

---

**报告人**: Claude
**审核**: 待审核
