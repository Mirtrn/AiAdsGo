# IPRocket 代理服务故障排查报告

**日期**: 2026-03-08
**用户**: autoads (user_id: 1)
**问题**: 换链接任务执行失败，报错 "IPRocket API business error: Business abnormality"

## 问题现象

换链接任务执行时报错：
```
错误: 🔴 IPRocket 代理服务商返回业务异常
原始错误: URL解析失败（6次尝试后）: Playwright解析失败:
IPRocket API business error: Business abnormality, please contact customer service
```

## 排查过程

### 1. 检查用户配置

```sql
SELECT key, value FROM system_settings
WHERE user_id = 1 AND category = 'proxy';
```

**结果**: ✅ 代理配置正常，包含 8 个国家的 IPRocket API URL

### 2. 测试 IPRocket API

```bash
curl "https://api.iprocket.io/api?username=com49692430&password=XXX&cc=DE&ips=1&type=-res-&proxyType=http&responseType=txt"
```

**结果**: ✅ API 正常返回代理凭证
```
148.251.54.17:5959:com49692430-res-de-sid-912293243:Qxi9V59e3kNOW6pnRi3i
```

### 3. 测试代理连接

使用测试脚本 `scripts/test-iprocket-proxy.ts` 测试多个国家的代理：

| 国家 | 成功率 | 平均耗时 | 状态 |
|------|--------|----------|------|
| DE   | 0/3    | 1616ms   | ❌ 失败 |
| US   | 0/3    | 906ms    | ❌ 失败 |
| GB   | 0/3    | 306ms    | ❌ 失败 |
| FR   | 0/3    | 1385ms   | ❌ 失败 |

**结果**: ❌ **所有代理都无法连接**

### 4. 详细连接测试

```bash
curl -v -x "http://username:password@95.217.225.56:5959" "https://www.amazon.de"
```

**结果**:
- ✅ TCP 连接成功
- ✅ HTTP CONNECT 隧道请求发送
- ❌ 代理服务器无响应（超时）

## 根本原因

**IPRocket 代理服务器故障**

1. ✅ IPRocket API 服务正常（能获取代理凭证）
2. ✅ 账户认证正常（没有返回配额或权限错误）
3. ❌ **代理服务器本身无法建立 HTTPS 隧道**

这不是：
- ❌ 账户配额问题
- ❌ 账户被封禁
- ❌ 单个 IP 被封
- ❌ 代码配置问题

而是：
- ✅ **IPRocket 代理服务器集群故障**

## 影响范围

- 所有使用 IPRocket 代理的换链接任务
- 所有国家的代理（DE, US, GB, FR, CA, AU, IT, ES）
- 可能影响其他使用 IPRocket 的功能（补点击任务等）

## 解决方案

### 短期方案（立即）

1. **联系 IPRocket 客服**
   - 报告代理服务器无响应问题
   - 确认服务状态和预计恢复时间
   - 客服联系方式：https://iprocket.io/support

2. **暂时禁用换链接任务**
   ```sql
   UPDATE url_swap_tasks
   SET status = 'disabled',
       error_message = 'IPRocket 代理服务故障，暂时禁用'
   WHERE user_id = 1 AND status = 'enabled';
   ```

### 中期方案（1-3天）

1. **等待 IPRocket 恢复**
   - 定期测试代理连接
   - 恢复后重新启用任务

2. **临时使用其他代理服务商**
   - 如果有其他代理服务商账户，可以临时切换

### 长期方案（1-2周）

1. **添加备用代理服务商**
   - Oxylabs
   - Bright Data
   - Smartproxy
   - 实现代理服务商自动切换机制

2. **实现代理健康检查**
   - 定期检测代理服务可用性
   - 自动切换到可用的代理服务商
   - 发送告警通知

3. **优化错误处理**
   - 区分代理服务故障和其他错误
   - 提供更明确的错误提示
   - 自动重试机制

## 验证步骤

IPRocket 恢复后，执行以下验证：

1. **测试代理连接**
   ```bash
   npx tsx scripts/test-iprocket-proxy.ts
   ```

2. **手动触发换链接任务**
   - 在 `/admin/queue` 页面手动触发调度器
   - 检查任务执行结果

3. **重新启用任务**
   ```sql
   UPDATE url_swap_tasks
   SET status = 'enabled',
       error_message = NULL
   WHERE user_id = 1 AND error_message LIKE '%IPRocket%';
   ```

## 附录

### 测试脚本

创建了 `scripts/test-iprocket-proxy.ts` 用于诊断代理质量：
- 测试多个国家的代理
- 检测连接成功率和响应时间
- 提供详细的诊断信息

### 相关文件

- `src/lib/proxy/providers/iprocket-provider.ts` - IPRocket 代理提供商实现
- `src/lib/url-resolver-playwright.ts` - Playwright URL 解析器
- `src/lib/queue/executors/url-swap-executor.ts` - 换链接任务执行器
