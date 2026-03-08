# IPRocket 高频调用问题 - 额外优化措施

**日期**: 2026-03-09
**基础方案**: 方案 1（全局频率限制）已实施
**本文档**: 额外优化措施

---

## 🎯 优化目标

在方案 1（全局频率限制）的基础上，进一步减少 IPRocket API 调用次数，提升系统性能和稳定性。

---

## ✅ 已实施的优化

### 优化 1: 全局 IPRocket API 调用频率限制（方案 1）

**状态**: ✅ 已完成

**效果**:
- 确保调用间隔 >= 100ms
- 避免触发 IPRocket 风控
- 解决"业务异常"错误

**详情**: 见 `SOLUTION_1_IMPLEMENTATION_SUMMARY.md`

---

### 优化 2: 代理凭证缓存（方案 2）

**状态**: ✅ 已完成

**文件**: `src/lib/playwright-pool.ts`

**实现内容**:

1. **添加代理凭证缓存机制**
   ```typescript
   interface ProxyCredentialsCache {
     credentials: {
       host: string
       port: number
       username: string
       password: string
       fullAddress: string
     }
     cachedAt: number
     expiresAt: number
   }

   const proxyCredentialsCache = new Map<string, ProxyCredentialsCache>()
   const PROXY_CREDENTIALS_CACHE_DURATION = 5 * 60 * 1000 // 5 分钟
   ```

2. **实现缓存获取和存储函数**
   - `getCachedProxyCredentials()` - 获取缓存的凭证
   - `cacheProxyCredentials()` - 缓存新凭证

3. **在 createInstance 中使用缓存**
   ```typescript
   // 优先使用缓存
   const cachedProxy = getCachedProxyCredentials(proxyUrl)
   if (cachedProxy) {
     proxy = cachedProxy
   } else {
     // 缓存未命中，调用 API
     proxy = await getProxyIp(proxyUrl, true)
     // 缓存新凭证
     cacheProxyCredentials(proxyUrl, proxy)
   }
   ```

**效果预估**:
- 减少 80-90% 的 IPRocket API 调用
- 5 分钟内重复使用同一凭证
- 显著降低 API 调用频率

**工作原理**:
```
第 1 次创建实例 → 调用 IPRocket API → 缓存凭证（5分钟）
第 2 次创建实例 → 使用缓存凭证 → 不调用 API ✅
第 3 次创建实例 → 使用缓存凭证 → 不调用 API ✅
...
5 分钟后 → 缓存过期 → 调用 API 获取新凭证 → 重新缓存
```

---

## 📋 推荐的额外优化措施

### 优化 3: 增加 Playwright 连接池大小（可选）

**状态**: 待实施

**目的**: 减少实例创建频率，进一步降低 API 调用

**当前配置**:
```typescript
const POOL_CONFIG = {
  maxInstances: 8,              // 最多 8 个实例
  maxInstancesPerProxy: 3,      // 每个代理最多 3 个实例
  maxIdleTime: 60 * 1000,       // 空闲 1 分钟后清理
  launchTimeout: 30000,
  acquireTimeout: 180000,
  warmupCount: 1,
}
```

**建议配置**:
```typescript
const POOL_CONFIG = {
  maxInstances: 15,             // 提升到 15 个实例
  maxInstancesPerProxy: 5,      // 提升到 5 个实例
  maxIdleTime: 5 * 60 * 1000,   // 提升到 5 分钟
  launchTimeout: 30000,
  acquireTimeout: 180000,
  warmupCount: 3,               // 提升到 3 个预热实例
}
```

**优点**:
- 减少实例创建频率
- 提高实例复用率
- 降低 API 调用次数

**缺点**:
- 增加内存占用（每个实例约 50-100MB）
- 需要评估服务器内存容量

**实施建议**:
- 如果服务器内存充足（>= 4GB），建议实施
- 如果内存紧张，保持当前配置

---

### 优化 4: 智能代理凭证刷新策略（可选）

**状态**: 待实施

**目的**: 根据代理健康状态动态调整缓存时间

**实现思路**:

```typescript
interface SmartProxyCache {
  credentials: ProxyCredentials
  cachedAt: number
  expiresAt: number
  successCount: number      // 成功次数
  failureCount: number      // 失败次数
  lastUsedAt: number        // 最后使用时间
}

// 动态调整缓存时间
function calculateCacheDuration(cache: SmartProxyCache): number {
  const baseTime = 5 * 60 * 1000 // 基础 5 分钟

  // 如果代理表现良好，延长缓存时间
  if (cache.successCount > 10 && cache.failureCount === 0) {
    return baseTime * 2 // 10 分钟
  }

  // 如果代理频繁失败，缩短缓存时间
  if (cache.failureCount > 3) {
    return baseTime / 2 // 2.5 分钟
  }

  return baseTime
}
```

**优点**:
- 更智能的缓存管理
- 自动淘汰不良代理
- 延长优质代理使用时间

**缺点**:
- 实现复杂度较高
- 需要额外的状态管理

---

### 优化 5: 代理池预热优化（可选）

**状态**: 待实施

**目的**: 在系统启动时预先获取并缓存代理凭证

**实现思路**:

```typescript
// 在应用启动时预热代理池
async function warmupProxyCredentials() {
  const proxyUrls = await getProxyUrlsFromSettings()

  console.log('🔥 预热代理凭证缓存...')

  for (const proxyUrl of proxyUrls) {
    try {
      const { getProxyIp } = await import('./proxy/fetch-proxy-ip')
      const credentials = await getProxyIp(proxyUrl, true)
      cacheProxyCredentials(proxyUrl, credentials)
      console.log(`✅ 预热成功: ${credentials.fullAddress}`)
    } catch (error) {
      console.warn(`⚠️ 预热失败: ${proxyUrl}`)
    }

    // 遵守频率限制
    await new Promise(r => setTimeout(r, 100))
  }

  console.log('✅ 代理凭证缓存预热完成')
}

// 在应用启动时调用
warmupProxyCredentials()
```

**优点**:
- 首次请求无需等待 API 调用
- 提升用户体验
- 分散 API 调用压力

**缺点**:
- 增加启动时间
- 可能浪费部分凭证（如果未使用）

---

### 优化 6: 监控和告警（推荐）

**状态**: 待实施

**目的**: 实时监控 IPRocket API 调用情况，及时发现问题

**实现内容**:

1. **添加调用统计**
   ```typescript
   interface IprocketApiStats {
     totalCalls: number
     successCalls: number
     failureCalls: number
     businessErrorCalls: number
     avgInterval: number
     lastCallTime: number
   }

   const iprocketStats: IprocketApiStats = {
     totalCalls: 0,
     successCalls: 0,
     failureCalls: 0,
     businessErrorCalls: 0,
     avgInterval: 0,
     lastCallTime: 0,
   }
   ```

2. **记录每次调用**
   ```typescript
   function recordIprocketCall(success: boolean, isBusinessError: boolean) {
     iprocketStats.totalCalls++
     if (success) {
       iprocketStats.successCalls++
     } else {
       iprocketStats.failureCalls++
       if (isBusinessError) {
         iprocketStats.businessErrorCalls++
       }
     }

     // 计算平均间隔
     const now = Date.now()
     if (iprocketStats.lastCallTime > 0) {
       const interval = now - iprocketStats.lastCallTime
       iprocketStats.avgInterval =
         (iprocketStats.avgInterval * (iprocketStats.totalCalls - 1) + interval) /
         iprocketStats.totalCalls
     }
     iprocketStats.lastCallTime = now
   }
   ```

3. **定期输出统计**
   ```typescript
   setInterval(() => {
     console.log('📊 IPRocket API 统计:')
     console.log(`  - 总调用: ${iprocketStats.totalCalls}`)
     console.log(`  - 成功: ${iprocketStats.successCalls}`)
     console.log(`  - 失败: ${iprocketStats.failureCalls}`)
     console.log(`  - 业务异常: ${iprocketStats.businessErrorCalls}`)
     console.log(`  - 平均间隔: ${iprocketStats.avgInterval.toFixed(0)}ms`)
   }, 60000) // 每分钟输出一次
   ```

4. **告警机制**
   ```typescript
   function checkAndAlert() {
     // 如果业务异常超过阈值，发送告警
     if (iprocketStats.businessErrorCalls > 5) {
       sendAlert('IPRocket 业务异常次数过多')
     }

     // 如果平均间隔过小，发送告警
     if (iprocketStats.avgInterval < 100) {
       sendAlert('IPRocket API 调用间隔过小')
     }
   }
   ```

**优点**:
- 实时了解系统状态
- 及时发现异常
- 数据驱动优化

---

## 📊 优化效果对比

### 优化前（无任何优化）
- IPRocket API 调用频率: 不受控制
- 可能触发风控: 是
- 换链接任务失败率: 高

### 优化 1（频率限制）
- IPRocket API 调用频率: 受控（>= 100ms）
- 可能触发风控: 否
- 换链接任务失败率: 低
- API 调用次数: 无减少

### 优化 1 + 2（频率限制 + 凭证缓存）
- IPRocket API 调用频率: 受控（>= 100ms）
- 可能触发风控: 否
- 换链接任务失败率: 低
- API 调用次数: **减少 80-90%** ✅

### 优化 1 + 2 + 3（+ 增加连接池）
- IPRocket API 调用频率: 受控（>= 100ms）
- 可能触发风控: 否
- 换链接任务失败率: 低
- API 调用次数: **减少 90-95%** ✅
- 系统响应速度: 更快

---

## 🎯 实施建议

### 立即实施（已完成）
- ✅ 优化 1: 全局频率限制
- ✅ 优化 2: 代理凭证缓存

### 短期实施（1-2 周）
- 优化 6: 监控和告警

### 中期实施（根据需要）
- 优化 3: 增加连接池大小（如果内存充足）
- 优化 4: 智能刷新策略（如果需要更精细控制）
- 优化 5: 代理池预热（如果启动性能重要）

---

## ✅ 验证清单

- [x] 优化 1: 频率限制已实施
- [x] 优化 2: 凭证缓存已实施
- [ ] 测试环境验证
- [ ] 生产环境部署
- [ ] 监控确认效果
- [ ] 评估是否需要优化 3-6

---

**文档创建**: 2026-03-09
**最后更新**: 2026-03-09
