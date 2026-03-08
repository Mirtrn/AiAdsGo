# IPRocket 频率限制修复记录

**日期**: 2026-03-09
**问题**: 生产环境换链接任务执行报错 "IPRocket 代理服务商返回业务异常"
**根本原因**: Playwright 实例创建时高频调用 IPRocket API，触发频率限制风控

---

## 🔧 修复内容

### 1. 添加全局 IPRocket API 调用频率限制

**文件**: `src/lib/proxy/fetch-proxy-ip.ts`

**修改内容**:

1. **添加频率限制机制** (第 7-79 行)
   - 创建全局调用队列 `iprocketCallQueue`
   - 设置最小调用间隔 `MIN_IPROCKET_CALL_INTERVAL = 100ms`
   - 实现 `throttleIprocketCall()` 函数包装 API 调用
   - 实现 `processIprocketQueue()` 函数处理调用队列

2. **应用频率限制** (第 296-299 行)
   - 在 `fetchProxyIp()` 函数中使用 `throttleIprocketCall()` 包装 `extractCredentials()` 调用
   - 只对 IPRocket Provider 进行频率限制，不影响其他 Provider

**关键代码**:

```typescript
// 频率限制包装器
async function throttleIprocketCall<T>(providerName: string, fn: () => Promise<T>): Promise<T> {
  // 只对 IPRocket 进行频率限制
  if (providerName !== 'IPRocket') {
    return fn()
  }

  return new Promise((resolve, reject) => {
    const execute = async () => {
      try {
        const now = Date.now()
        const timeSinceLastCall = now - lastIprocketCallTime

        if (timeSinceLastCall < MIN_IPROCKET_CALL_INTERVAL) {
          const waitTime = MIN_IPROCKET_CALL_INTERVAL - timeSinceLastCall
          console.log(`⏳ [IPRocket 频率限制] 等待 ${waitTime}ms...`)
          await new Promise(r => setTimeout(r, waitTime))
        }

        lastIprocketCallTime = Date.now()
        const result = await fn()
        resolve(result)
      } catch (error) {
        reject(error)
      }
    }

    // 加入队列
    iprocketCallQueue.push({ execute, resolve, reject })

    // 如果没有正在处理队列，开始处理
    if (!isProcessingQueue) {
      processIprocketQueue()
    }
  })
}

// 应用频率限制
const credentials = await throttleIprocketCall(provider.name, () =>
  provider.extractCredentials(proxyUrl)
)
```

---

## 🎯 修复效果

### 修复前
- 多个换链接任务并发执行时，可能在几秒内产生 10-50 次 IPRocket API 调用
- 调用间隔可能小于 50ms，触发 IPRocket 风控
- 第 6 次调用后开始返回"业务异常"错误

### 修复后
- 所有 IPRocket API 调用自动排队
- 确保调用间隔 >= 100ms
- 避免触发 IPRocket 频率限制风控
- 不影响其他代理服务商（Oxylabs、ABCProxy 等）

---

## 📋 测试验证

### 测试脚本
- `scripts/test-iprocket-throttle.ts` - 验证频率限制功能

### 验证步骤
1. 运行测试脚本：`npx tsx scripts/test-iprocket-throttle.ts`
2. 观察调用间隔是否 >= 100ms
3. 确认并发调用正确排队
4. 验证不再出现"业务异常"错误

### 预期结果
- ✅ 最小调用间隔 >= 100ms
- ✅ 所有调用间隔都 >= 100ms
- ✅ 并发调用正确排队执行
- ✅ 不再触发 IPRocket 风控

---

## 🚀 部署建议

### 1. 代码审查
- 确认频率限制逻辑正确
- 确认不影响其他 Provider
- 确认队列处理逻辑无死锁风险

### 2. 测试环境验证
- 在测试环境运行测试脚本
- 执行换链接任务，观察日志
- 确认频率限制生效

### 3. 生产环境部署
- 部署到生产环境
- 监控 IPRocket API 调用日志
- 观察换链接任务执行情况
- 确认不再出现"业务异常"错误

### 4. 监控指标
- IPRocket API 调用频率
- 换链接任务成功率
- 换链接任务执行时间
- IPRocket 错误率

---

## 📝 后续优化建议

### 1. 添加代理凭证缓存（方案 2）
- 在 `playwright-pool.ts` 中添加代理凭证缓存
- 缓存时间 5 分钟
- 进一步减少 IPRocket API 调用次数

### 2. 增加 Playwright 连接池大小（方案 3）
- 如果内存允许，可以增加连接池大小
- `maxInstances: 8 → 15`
- `maxInstancesPerProxy: 3 → 5`
- `maxIdleTime: 60000 → 300000` (1分钟 → 5分钟)
- 减少实例创建频率

### 3. 添加监控和告警
- 监控 IPRocket API 调用频率
- 监控 IPRocket 错误率
- 当错误率超过阈值时告警

---

## 📚 相关文档

- `IPROCKET_HIGH_FREQUENCY_ROOT_CAUSE_20260309.md` - 根本原因分析报告
- `IPROCKET_PROXY_FAILURE_REPORT_20260308.md` - 初始问题报告
- `scripts/test-iprocket-frequency.js` - IPRocket 频率限制测试
- `scripts/test-iprocket-throttle.ts` - 频率限制功能验证

---

**修复人**: Claude
**审核**: 待审核
**状态**: 已实施，待测试验证
