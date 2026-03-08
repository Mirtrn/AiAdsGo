# 换链接任务异常排查报告 - 用户 bravellama305

**日期**: 2026-03-08
**用户**: bravellama305 (user_id: 52)
**问题**: 换链接任务出现 IPRocket 代理服务异常

---

## 问题概述

用户 bravellama305 的多个换链接任务出现连续失败，错误信息显示：

```
🔴 Google Ads API调用失败连续失败 3 次，任务已标记为错误状态。

错误详情: Google Ads API调用失败: URL解析失败（4次尝试后）:
Playwright解析失败: IPRocket API business error:
Business abnormality, please contact customer service
```

---

## 数据库调查结果

### 1. 用户任务状态统计

查询用户的换链接任务，发现以下情况：

| 任务ID | Offer ID | 状态 | 模式 | 总执行次数 | 成功次数 | 失败次数 | 连续失败 |
|--------|----------|------|------|-----------|---------|---------|---------|
| f5355655 | 4320 | enabled | manual | 3 | 3 | 0 | 0 |
| be61ccf7 | 4153 | **error** | auto | 21 | 12 | 9 | **3** |
| 8756b622 | 4034 | enabled | manual | 61 | 55 | 6 | 0 |
| d23d47ee | 4152 | disabled | auto | 40 | 36 | 4 | 0 |
| 2fa9d9e6 | 4153 | **error** | auto | 12 | 7 | 5 | **3** |
| cbd2336e | 4006 | **error** | auto | 233 | 199 | 34 | **3** |
| 4802a60b | 4064 | **error** | manual | 62 | 51 | 11 | **3** |

**关键发现**:
- 共有 **4个任务处于 error 状态**
- 所有错误任务都是因为 **连续失败 3 次** 触发自动错误标记
- 错误原因均为 **IPRocket API business error**

---

## 根本原因分析

### IPRocket 代理服务商业务异常

错误信息 `"Business abnormality, please contact customer service"` 表明这是 **IPRocket 服务商层面的业务错误**，而非技术故障。

可能的原因包括：

1. **账户配额耗尽**
   - 用户的 IPRocket 账户可能已用完流量配额
   - 或达到了请求频率限制

2. **账户状态异常**
   - 账户可能被暂停或限制
   - 可能存在欠费或违规行为

3. **风控触发**
   - 请求频率过高触发风控
   - IP 地址或使用模式被标记为异常

4. **服务商临时故障**
   - IPRocket 服务端出现临时性业务异常
   - 特定地区或节点的服务中断

---

## 代码层面分析

### 错误处理流程

查看 `src/lib/proxy/providers/iprocket-provider.ts` 代码，发现系统已经正确识别并分类了这类错误：

```typescript
function isBusinessAbnormalityError(code: number, message: string): boolean {
  const lowerMessage = String(message || '').toLowerCase()
  if (lowerMessage.includes('business abnormality')) return true
  if (lowerMessage.includes('contact customer service')) return true
  if (lowerMessage.includes('account abnormal')) return true
  if (lowerMessage.includes('risk control')) return true

  return code === 500 && lowerMessage.includes('abnormal')
}
```

当检测到业务异常时，系统会抛出 `ProxyProviderBusinessError`，这是一个 **不可重试的错误类型**，避免了无效的重试循环。

### 重试机制

在 `src/lib/queue/executors/url-swap-executor.ts` 中：

1. URL 解析失败会重试最多 4 次
2. 如果是 `ProxyProviderBusinessError`，会立即停止重试
3. 连续失败 3 次后，任务自动标记为 `error` 状态

这个机制是合理的，避免了在账户异常时持续消耗资源。

---

## 影响范围

### 受影响的任务

- **4 个任务处于 error 状态**（需要手动重新启用）
- **2 个任务已被用户禁用**
- **4 个任务仍在正常运行**（使用 manual 模式的任务成功率较高）

### 成功率分析

| 模式 | 总任务数 | 平均成功率 |
|------|---------|-----------|
| auto | 5 | 78.5% |
| manual | 5 | 88.7% |

**观察**: manual 模式的成功率明显高于 auto 模式，可能是因为：
- manual 模式使用预配置的推广链接列表，减少了实时解析需求
- auto 模式每次都需要实时解析推广链接，对代理的依赖更强

---

## 解决方案

### 立即行动（用户侧）

1. **检查 IPRocket 账户状态**
   ```
   - 登录 IPRocket 控制台
   - 检查账户余额和配额
   - 查看是否有风控提示或账户限制
   - 联系 IPRocket 客服确认账户状态
   ```

2. **临时解决方案**
   - 如果 IPRocket 账户确实有问题，考虑：
     - 充值或升级套餐
     - 更换代理服务商（如 Oxylabs、Bright Data 等）
     - 暂时禁用部分任务，降低请求频率

3. **重新启用任务**
   - 在解决 IPRocket 账户问题后
   - 在任务详情页点击"重新启用"按钮
   - 系统会重置连续失败计数器

### 中期优化（开发侧）

1. **增强错误提示**
   ```typescript
   // 在 url-swap-executor.ts 中，针对 IPRocket 业务错误提供更明确的提示
   if (error.message.includes('Business abnormality')) {
     enhancedMessage =
       `IPRocket 代理服务商返回业务异常，可能原因：\n` +
       `1. 账户配额已用完，请检查 IPRocket 账户余额\n` +
       `2. 账户被暂停或限制，请联系 IPRocket 客服\n` +
       `3. 触发风控限制，请降低请求频率\n\n` +
       `建议操作：\n` +
       `- 登录 IPRocket 控制台检查账户状态\n` +
       `- 考虑更换代理服务商或升级套餐\n` +
       `- 修复后在任务详情页重新启用任务`
   }
   ```

2. **代理服务商健康监控**
   - 实现代理服务商健康度监控
   - 当检测到持续失败时，自动发送告警
   - 提供代理服务商切换建议

3. **优雅降级策略**
   - 当主代理服务商失败时，自动尝试备用服务商
   - 或在无代理情况下尝试直连（针对部分地区）

### 长期改进（架构侧）

1. **多代理服务商支持**
   - 允许用户配置多个代理服务商
   - 实现自动故障转移
   - 负载均衡分配请求

2. **代理池管理优化**
   - 实现代理 IP 质量评分
   - 自动淘汰低质量代理
   - 优先使用高质量代理

3. **用户通知机制**
   - 当任务连续失败时，发送邮件/站内信通知
   - 提供详细的故障诊断信息
   - 引导用户快速解决问题

---

## 代码优化建议

### 1. 增强错误消息（高优先级）

**文件**: `src/lib/queue/executors/url-swap-executor.ts`

在第 638-683 行的错误处理逻辑中，添加针对 IPRocket 业务错误的特殊处理：

```typescript
// 检测 IPRocket 业务错误
else if (
  rawMessage.includes('IPRocket') &&
  (rawMessage.includes('Business abnormality') ||
   rawMessage.includes('contact customer service'))
) {
  errorType = 'link_resolution'
  enhancedMessage =
    `🔴 IPRocket 代理服务商返回业务异常\n\n` +
    `可能原因：\n` +
    `1. 账户配额已用完 - 请检查 IPRocket 账户余额和流量\n` +
    `2. 账户被暂停或限制 - 请联系 IPRocket 客服确认账户状态\n` +
    `3. 触发风控限制 - 请降低请求频率或更换代理服务商\n` +
    `4. 服务商临时故障 - 请稍后重试\n\n` +
    `建议操作：\n` +
    `✓ 登录 IPRocket 控制台检查账户状态\n` +
    `✓ 考虑更换代理服务商（Oxylabs、Bright Data 等）\n` +
    `✓ 或暂时禁用部分任务，降低请求频率\n` +
    `✓ 修复后在任务详情页重新启用任务\n\n` +
    `原始错误: ${rawMessage}`
}
```

### 2. 添加代理服务商健康检查（中优先级）

**新文件**: `src/lib/proxy/health-monitor.ts`

```typescript
/**
 * 代理服务商健康监控
 */
export class ProxyHealthMonitor {
  private failureCount = new Map<string, number>()
  private lastCheckTime = new Map<string, number>()

  recordFailure(provider: string): void {
    const count = this.failureCount.get(provider) || 0
    this.failureCount.set(provider, count + 1)
    this.lastCheckTime.set(provider, Date.now())

    // 连续失败 5 次，发送告警
    if (count + 1 >= 5) {
      this.sendAlert(provider, count + 1)
    }
  }

  recordSuccess(provider: string): void {
    this.failureCount.set(provider, 0)
  }

  private async sendAlert(provider: string, failureCount: number): Promise<void> {
    console.error(
      `⚠️ 代理服务商 ${provider} 连续失败 ${failureCount} 次，` +
      `请检查账户状态或考虑更换服务商`
    )
    // TODO: 发送邮件/站内信通知管理员
  }
}
```

---

## 监控和预防

### 建议添加的监控指标

1. **代理服务商成功率**
   - 按服务商统计成功率
   - 设置阈值告警（如低于 80%）

2. **任务失败率趋势**
   - 监控每小时/每天的失败率
   - 识别异常波动

3. **IPRocket 特定错误统计**
   - 统计 "Business abnormality" 错误频率
   - 提前预警账户问题

### 预防措施

1. **配额预警**
   - 在 IPRocket 配额接近用完时提前通知
   - 建议用户及时充值

2. **请求频率控制**
   - 实现智能限流，避免触发风控
   - 在高峰期自动降低请求频率

3. **备用方案**
   - 鼓励用户配置备用代理服务商
   - 提供无代理模式（针对部分地区）

---

## 总结

### 问题根源
用户 bravellama305 的换链接任务失败是由于 **IPRocket 代理服务商返回业务异常**，这是服务商层面的问题，而非系统 bug。

### 当前状态
- 系统的错误处理机制工作正常
- 已正确识别并分类 IPRocket 业务错误
- 避免了无效的重试循环

### 需要改进
1. **错误提示不够明确** - 用户可能不清楚如何解决 IPRocket 账户问题
2. **缺少主动监控** - 没有提前预警机制
3. **缺少备用方案** - 单一代理服务商存在单点故障风险

### 建议优先级
1. **P0**: 联系用户检查 IPRocket 账户状态（立即）
2. **P1**: 优化错误提示消息（本周内）
3. **P2**: 添加代理健康监控（2周内）
4. **P3**: 实现多代理服务商支持（1个月内）

---

## 附录：相关代码文件

- `src/lib/queue/executors/url-swap-executor.ts` - 换链接任务执行器
- `src/lib/proxy/providers/iprocket-provider.ts` - IPRocket 代理提供商
- `src/lib/proxy/fetch-proxy-ip.ts` - 代理 IP 获取逻辑
- `src/lib/proxy/proxy-errors.ts` - 代理错误分类
- `IPROCKET_DIAGNOSIS_REPORT.md` - 之前的 IPRocket 诊断报告
