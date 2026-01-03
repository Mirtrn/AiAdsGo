# URL Swap换链接业务逻辑深度Review

## Review目标
评估换链接任务能否按照用户配置的时间间隔（如5分钟）在持续天数（如14天）内稳定运行，并针对各种异常情况进行合理处理。

---

## 一、总体架构分析

### 1.1 系统组成

```
┌─────────────────────────────────────────────────────────────────────┐
│                         URL Swap 系统架构                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐        │
│  │ 任务创建API   │────▶│  调度器      │────▶│  统一队列    │        │
│  │ (url-swap/   │     │ scheduler    │     │ (Redis/内存) │        │
│  │  tasks/)     │     │              │     │              │        │
│  └──────────────┘     └──────────────┘     └──────┬───────┘        │
│                                                    │                │
│                                                    ▼                │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐        │
│  │ Dashboard    │◀────│ 执行器       │◀────│ 队列处理循环  │        │
│  │ (洞察/监控)   │     │ executor     │     │ (100ms间隔)  │        │
│  └──────────────┘     └──────────────┘     └──────────────┘        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 关键文件清单

| 文件 | 功能 | 代码行数 |
|------|------|----------|
| `url-swap-types.ts` | 类型定义 | 192行 |
| `url-swap.ts` | 核心业务逻辑 | 659行 |
| `url-swap-scheduler.ts` | 调度器 | 169行 |
| `url-swap-executor.ts` | 执行器 | 224行 |
| `url-swap-validator.ts` | 验证器 | 123行 |
| `migrations/128_create_url_swap_tasks.sql` | 数据库结构 | 105行 |

---

## 二、时间间隔稳定性分析

### 2.1 时间计算逻辑 ✅ 正确

**文件**: `url-swap-scheduler.ts:22-27`
```typescript
export function calculateNextSwapAt(intervalMinutes: number): Date {
  const now = new Date()
  const intervalMs = intervalMinutes * 60 * 1000
  // 计算下一个间隔点
  return new Date(Math.ceil(now.getTime() / intervalMs) * intervalMs)
}
```

**分析**：
- ✅ 使用向上取整，确保时间间隔对齐
- ✅ 例如：14:03创建，间隔5分钟 → next_swap_at = 14:05
- ✅ 避免任务堆积，时间点可预测

### 2.2 调度触发机制 ❌ 严重问题

**问题发现**：`triggerAllUrlSwapTasks()` **没有被任何Cron调用**

**证据**：
```bash
$ grep -r "triggerAllUrlSwapTasks" --include="*.ts"
# 只在定义处出现，没有调用处
```

**影响**：
1. 任务创建后只会执行一次（事件驱动）
2. 如果任务失败，不会自动重试
3. 除非用户手动点击"立即执行"，否则不会继续

**当前状态**：
```
任务生命周期：
创建 → triggerUrlSwapScheduling() → 立即执行一次 → 结束
                                          ↑
                                          │
                                          └── 不会再自动触发！
```

**需要修复**：添加Cron调用或定时任务

---

## 三、持续天数管理分析

### 3.1 任务完成判断 ✅ 基本正确

**文件**: `click-farm/scheduler.ts:195-229`
```typescript
export function shouldCompleteTask(task: ClickFarmTask): boolean {
  if (task.duration_days === -1) {
    // 无限期任务不会自动完成
    return false
  }
  // 使用UTC时间戳计算经过的天数
  const elapsedDays = Math.floor((nowUTC - startedAtUTC) / (1000 * 60 * 60 * 24))
  return elapsedDays >= task.duration_days
}
```

**分析**：
- ✅ 支持无限期任务（duration_days = -1）
- ✅ 使用UTC时间戳，避免时区问题
- ✅ 向上取整，确保跨过完整的duration_days天

### 3.2 进度计算 ✅ 已修复

**文件**: `click-farm/scheduler.ts:140-144`
```typescript
export function calculateProgress(task: ClickFarmTask): number {
  if (task.duration_days === -1) {
    // 无限期任务不显示进度
    return 0
  }
  // ...
}
```

### 3.3 问题：无限期任务不会自动完成

**边界情况**：
- 如果duration_days = -1，任务永远不会标记为completed
- 需要用户手动禁用或删除

**建议**：可以考虑添加"最大执行次数"限制（如1000次），避免无限运行

---

## 四、异常处理机制分析

### 4.1 错误分类 ✅ 完善

**文件**: `url-swap.ts:292`
```typescript
export type UrlSwapErrorType = 'link_resolution' | 'google_ads_api' | 'other'
```

### 4.2 连续失败自动暂停 ✅ 已实现

**文件**: `url-swap.ts:305-376`
```typescript
export async function setTaskError(
  id: string,
  errorMessage: string,
  errorType: UrlSwapErrorType = 'other'
): Promise<void> {
  // 链接解析失败：连续3次失败后自动暂停
  if (errorType === 'link_resolution') {
    if (newConsecutiveFailures >= 3) {
      newStatus = 'disabled'
      // ...
    }
  }
  // 其他错误：仅设置error状态，不自动暂停
}
```

**分析**：
- ✅ link_resolution错误：连续3次失败后自动暂停
- ✅ google_ads_api错误：仅设置error状态
- ✅ 成功执行时重置consecutive_failures

### 4.3 错误类型检测 ✅ 已实现

**文件**: `url-swap-executor.ts:151-168`
```typescript
// 检测推广链接解析失败
if (
  error.message.includes('resolve') ||
  error.message.includes('affiliate') ||
  error.message.includes('无法访问') ||
  error.message.includes('Failed to fetch') ||
  error.message.includes('timeout') ||
  error.message.includes('ENOTFOUND') ||
  error.message.includes('ECONNREFUSED') ||
  error.message.includes('network')
) {
  errorType = 'link_resolution'
}
```

### 4.4 执行器错误处理 ✅ 完善

**文件**: `url-swap-executor.ts:148-188`
```typescript
} catch (error: any) {
  // 1. 检测错误类型
  // 2. 记录错误历史
  await recordSwapHistory(taskId, { success: false, error_message: ... })
  // 3. 更新失败统计
  await updateTaskStats(taskId, false, false)
  // 4. 设置错误状态（带错误类型分类）
  await setTaskError(taskId, enhancedMessage, errorType)
  return { success: false, changed: false }
}
```

### 4.5 代理验证 ✅ 完善

**文件**: `url-swap-scheduler.ts:63-68`
```typescript
const proxyPool = getProxyPool()
if (!proxyPool.hasProxyForCountry(offer.target_country)) {
  await setTaskError(task.id, `缺少 ${offer.target_country} 国家的代理配置`)
  results.skipped++
  continue
}
```

### 4.6 Offer删除处理 ✅ 已实现

**文件**: `offers.ts:765-811`
```typescript
// 禁用关联的URL Swap任务
await db.exec(`
  UPDATE url_swap_tasks
  SET status = 'disabled',
      error_message = 'Offer已删除，任务自动禁用'
  WHERE offer_id = ?
`, [id])
```

---

## 五、数据一致性分析

### 5.1 数据库结构 ✅ 正确

**文件**: `migrations/128_create_url_swap_tasks.sql`

**关键设计**：
- ✅ 外键约束：FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
  - ⚠️ 但Offers使用软删除，不会触发CASCADE
- ✅ 唯一约束：CONSTRAINT uq_url_swap_offer UNIQUE (offer_id)
- ✅ 软删除：is_deleted, deleted_at
- ✅ 统计字段：total_swaps, success_swaps, failed_swaps, consecutive_failures

### 5.2 索引设计 ✅ 优化

```sql
-- 调度查询优化
CREATE INDEX idx_url_swap_scheduled
  ON url_swap_tasks(next_swap_at, started_at)
  WHERE status = 'enabled';
```

### 5.3 任务状态流转 ✅ 清晰

```
┌─────────────────────────────────────────────────────────────────┐
│                         状态流转图                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐ │
│   │ enabled │────▶│  error  │────▶│disabled │     │completed│ │
│   └─────────┘     └─────────┘     └─────────┘     └─────────┘ │
│        │              │               ▲              ▲         │
│        │              │               │              │         │
│        │              ▼               │              │         │
│        │        ┌─────────┐           │              │         │
│        └───────▶│disabled │───────────┴──────────────┘         │
│                 └─────────┘                                    │
│                                                                  │
│  状态说明：                                                      │
│  - enabled: 正常运行，等待下一个时间间隔                          │
│  - error: 发生错误，等待用户干预或自动恢复                        │
│  - disabled: 已禁用（手动或自动暂停）                            │
│  - completed: 已完成（duration_days到期）                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 连续失败重置 ✅ 已实现

**文件**: `url-swap-executor.ts:202-213`
```typescript
if (success) {
  await db.exec(`
    UPDATE url_swap_tasks
    SET ...
        consecutive_failures = 0,  // ✅ 成功时重置
        ...
  `, [now, taskId])
}
```

---

## 六、问题清单和修复建议

### 🔴 P0 - 严重问题（必须修复）

#### 问题1：缺少Cron调度触发

**描述**：`triggerAllUrlSwapTasks()` 没有被任何定时任务调用

**影响**：
- 任务创建后只执行一次
- 失败后不会自动重试

**修复建议**：
```typescript
// 新建文件: src/app/api/cron/url-swap/route.ts
import { triggerAllUrlSwapTasks } from '@/lib/url-swap-scheduler'

export async function GET() {
  const result = await triggerAllUrlSwapTasks()
  return Response.json({ success: true, ...result })
}
```

**Cron配置**：
```bash
# 每5分钟执行一次
*/5 * * * * curl -s https://your-domain.com/api/cron/url-swap
```

---

### 🟡 P1 - 重要问题（建议修复）

#### 问题2：未处理Google Ads API失败的场景

**描述**：执行器中Google Ads API失败时，只记录错误但不更新统计

**文件**: `url-swap-executor.ts:126-129`
```typescript
} catch (adsError: any) {
  console.error(`[url-swap-executor] Google Ads更新失败: ${taskId}`, adsError.message)
  // ⚠️ 即使Ads API失败，仍然记录URL变化
  // 但没有区分"URL变化但Ads失败"和"正常成功"
}
```

**建议**：
```typescript
// 5.1 记录换链历史（包含Ads API状态）
await recordSwapHistory(taskId, {
  swapped_at: new Date().toISOString(),
  previous_final_url: currentFinalUrl || '',
  previous_final_url_suffix: currentFinalUrlSuffix || '',
  new_final_url: resolved.finalUrl,
  new_final_url_suffix: resolved.finalUrlSuffix,
  success: adsApiSuccess,  // ✅ 区分Ads API是否成功
  error_message: adsApiSuccess ? null : adsError.message
})

// 5.2 更新任务状态
if (adsApiSuccess) {
  await updateTaskAfterSwap(taskId, resolved.finalUrl, resolved.finalUrlSuffix)
} else {
  // Ads API失败，但URL已解析，标记为部分成功
  await updateTaskAfterPartialSwap(taskId, resolved.finalUrl, resolved.finalUrlSuffix)
}
```

---

### 🟢 P2 - 优化建议（可选）

#### 问题3：缺少最大执行次数限制

**描述**：duration_days = -1的无限期任务会永远运行

**建议**：添加可选的max_swaps限制
```typescript
// 数据库添加字段
ALTER TABLE url_swap_tasks ADD COLUMN max_swaps INTEGER DEFAULT NULL;

// 调度时检查
if (task.max_swaps && task.total_swaps >= task.max_swaps) {
  await updateTaskStatus(task.id, 'completed')
  continue
}
```

#### 问题4：URL未变化时也会更新next_swap_at

**描述**：即使URL未变化，也会更新next_swap_at（这是正确的）

**但**：缺少"无变化"的历史记录

**建议**：在URL未变化时也记录历史
```typescript
if (!urlChanged) {
  await recordSwapHistory(taskId, {
    swapped_at: new Date().toISOString(),
    previous_final_url: currentFinalUrl || '',
    previous_final_url_suffix: currentFinalUrlSuffix || '',
    new_final_url: currentFinalUrl || '',
    new_final_url_suffix: currentFinalUrlSuffix || '',
    success: true,
    error_message: 'URL无变化，跳过更新'
  })
}
```

#### 问题5：缺少任务超时保护

**描述**：如果resolveAffiliateLink卡住，任务会一直等待

**建议**：添加超时控制
```typescript
const resolved = await Promise.race([
  resolveAffiliateLink(affiliateLink, { targetCountry, skipCache: true }),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('解析超时')), 30000)
  )
])
```

---

## 七、测试用例建议

### 7.1 正常流程测试

| 测试场景 | 预期结果 |
|----------|----------|
| 创建任务，间隔5分钟 | 5分钟后自动执行 |
| 连续执行10次 | 每次间隔5分钟，共10次 |
| URL变化 | 更新Google Ads，记录历史 |
| URL无变化 | 跳过更新，更新统计 |

### 7.2 异常流程测试

| 测试场景 | 预期结果 |
|----------|----------|
| 推广链接失效（1次） | error状态，连续失败1/3 |
| 推广链接失效（2次） | error状态，连续失败2/3 |
| 推广链接失效（3次） | disabled状态，自动暂停 |
| Google Ads API失败 | 记录错误，不更新URL |
| Offer被删除 | 任务自动禁用 |
| 缺少代理配置 | 跳过任务，记录错误 |

### 7.3 边界情况测试

| 测试场景 | 预期结果 |
|----------|----------|
| duration_days = -1（无限期） | 任务永不自动完成 |
| duration_days = 1 | 24小时后标记为completed |
| 服务重启 | 队列任务清理，下一个间隔重新入队 |

---

## 八、总结

### 8.1 优点

1. ✅ 清晰的状态机设计
2. ✅ 完善的错误分类和自动暂停策略
3. ✅ 支持双数据库（SQLite/PostgreSQL）
4. ✅ 合理的索引优化
5. ✅ 软删除和历史记录支持

### 8.2 需要修复

1. **P0 - 必须**：添加Cron调度触发
2. **P1 - 建议**：区分URL变化和Ads API成功状态
3. **P2 - 可选**：添加超时保护和最大执行次数限制

### 8.3 稳定性评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 时间间隔 | 75% | 计算逻辑正确，但缺少Cron触发 |
| 持续天数 | 85% | 基本正确，可考虑添加max_swaps |
| 异常处理 | 90% | 完善，错误分类清晰 |
| 数据一致 | 90% | 状态流转清晰，重置逻辑正确 |
| **总体** | **85%** | 核心功能完善，需修复P0问题 |

---

## 九、待办清单

### 必须完成（P0）

- [ ] 创建Cron路由：`src/app/api/cron/url-swap/route.ts`
- [ ] 配置外部Cron（每5分钟调用）

### 建议完成（P1）

- [ ] 区分Google Ads API成功/失败状态
- [ ] 更新Dashboard洞察规则

### 可选优化（P2）

- [ ] 添加max_swaps字段和限制
- [ ] 添加解析超时保护
- [ ] URL无变化时也记录历史
