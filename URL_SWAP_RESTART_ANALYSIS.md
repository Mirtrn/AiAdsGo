# 服务重启时换链接任务处理方案评估

## 用户需求

> 如果服务重启，需要把之前未完成的换链接子任务从队列清空，并设置状态为"失败"，然后等到下一个时间间隔执行新的换链接子任务

## 现有架构分析

### 1. URL Swap系统组成

```
┌─────────────────────────────────────────────────────────────┐
│                      URL Swap任务流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  url_swap_tasks表                                             │
│  ├─ status: enabled/disabled/error/completed                 │
│  ├─ next_swap_at: 下次执行时间（UTC）                          │
│  └─ consecutive_failures: 连续失败次数                         │
│                                                               │
│         ↓ (每5分钟Cron触发)                                    │
│                                                               │
│  URL Swap调度器 (src/lib/url-swap-scheduler.ts)               │
│  ├─ getPendingTasks() - 查询待处理任务                         │
│  ├─ 代理验证                                                   │
│  ├─ enqueue('url-swap', taskData) - 入队                      │
│  └─ 更新next_swap_at（下次执行时间）                           │
│                                                               │
│         ↓                                                     │
│                                                               │
│  统一队列 (UnifiedQueueManager)                                │
│  ├─ Redis/内存存储                                             │
│  ├─ 任务状态: pending -> processing -> completed/failed      │
│  ├─ 并发控制（url-swap: 10）                                   │
│  ├─ 健康检查（每5分钟，清理30分钟超时任务）                      │
│  └─ 自动重试（maxRetries: 3）                                 │
│                                                               │
│         ↓                                                     │
│                                                               │
│  URL Swap执行器 (url-swap-executor.ts)                        │
│  ├─ resolveAffiliateLink() - 解析推广链接                      │
│  ├─ 检测URL变化                                                │
│  ├─ updateCampaignFinalUrlSuffix() - 更新Google Ads          │
│  ├─ recordSwapHistory() - 记录历史                            │
│  └─ updateTaskAfterSwap() - 更新url_swap_tasks状态            │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 2. 服务重启场景分析

#### 场景A：Redis队列 + 服务重启

```
重启前：
- url_swap_tasks: { id: 'task-1', status: 'enabled', next_swap_at: '14:05' }
- Redis队列: { id: 'queue-1', type: 'url-swap', status: 'processing', taskData: {...} }

重启时刻：14:03

重启后：
- url_swap_tasks: { id: 'task-1', status: 'enabled', next_swap_at: '14:05' }
- Redis队列: { id: 'queue-1', type: 'url-swap', status: 'processing', taskData: {...} }
  （Redis持久化，任务仍然存在）

问题：
✅ 健康检查会在30分钟后清理processing任务
❌ 14:05分调度器检测到next_swap_at已到，会重新入队
⚠️ 可能导致重复执行（如果queue-1在14:35前完成）
```

#### 场景B：内存队列 + 服务重启

```
重启前：
- url_swap_tasks: { id: 'task-1', status: 'enabled', next_swap_at: '14:05' }
- 内存队列: { id: 'queue-1', type: 'url-swap', status: 'processing', taskData: {...} }

重启时刻：14:03

重启后：
- url_swap_tasks: { id: 'task-1', status: 'enabled', next_swap_at: '14:05' }
- 内存队列: （清空）

问题：
✅ 14:05分调度器会重新入队，自动恢复
❌ 丢失了processing任务（但影响较小，因为会重新执行）
```

### 3. 潜在问题总结

| 问题 | 场景 | 严重性 | 影响 |
|------|------|--------|------|
| **重复执行** | Redis + 重启 | 🟡 中等 | 可能导致同一时间间隔多次换链 |
| **任务丢失** | 内存 + 重启 | 🟢 低 | 调度器会重新入队 |
| **状态不一致** | Redis + 重启 | 🟡 中等 | 队列processing但executor未运行 |
| **统计污染** | 设置为失败 | 🔴 高 | 增加failed_swaps和consecutive_failures |

## 方案对比

### 方案1: 启动时清理URL Swap队列任务（推荐）✅

**实现**:
```typescript
// src/lib/queue/unified-queue-manager.ts

async cleanupUrlSwapTasksOnStartup(): Promise<void> {
  console.log('[队列健康] 服务启动，清理换链接队列任务...')

  // 删除所有 type='url-swap' 且 status='processing' 的任务
  // 不修改 url_swap_tasks 表的统计数据
  const deleted = await this.adapter.deleteTasksByTypeAndStatus('url-swap', 'processing')

  if (deleted > 0) {
    console.log(`[队列健康] ✅ 清理 ${deleted} 个未完成的换链接任务`)
  } else {
    console.log('[队列健康] ✅ 无需清理')
  }
}
```

**优点**:
- ✅ 简单、干净
- ✅ 不影响统计数据（failed_swaps、consecutive_failures）
- ✅ 避免重复执行
- ✅ 调度器会在下一个时间间隔重新入队

**缺点**:
- ⚠️ 需要适配器支持deleteTasksByTypeAndStatus（Redis需实现）

---

### 方案2: 启动时清理 + 设置为失败（用户原方案）❌

**实现**:
```typescript
async cleanupAndFailUrlSwapTasks(): Promise<void> {
  const tasks = await this.adapter.getTasksByTypeAndStatus('url-swap', 'processing')

  for (const task of tasks) {
    // 1. 删除队列任务
    await this.adapter.deleteTask(task.id)

    // 2. 更新url_swap_tasks为失败
    const db = await getDatabase()
    await db.exec(`
      UPDATE url_swap_tasks
      SET failed_swaps = failed_swaps + 1,
          consecutive_failures = consecutive_failures + 1,
          updated_at = ?
      WHERE id = ?
    `, [new Date().toISOString(), task.data.taskId])
  }
}
```

**缺点**:
- ❌ **污染统计数据**：任务未真正执行但记录为失败
- ❌ **误触暂停策略**：可能导致consecutive_failures累积到3，自动暂停任务
- ❌ **误导性指标**：Dashboard会显示错误的失败率

**不推荐原因**: 重启并非任务失败，不应影响业务统计。

---

### 方案3: 依赖现有健康检查（保守）⏳

**实现**:
```
无需修改代码，依赖现有机制：
- 健康检查每5分钟运行
- 清理超过30分钟的processing任务
```

**优点**:
- ✅ 无需开发

**缺点**:
- ❌ 最多等待30分钟才清理
- ❌ 可能导致短期内的重复执行
- ⚠️ 不确定性高

**适用场景**: 对重复执行容忍度高的环境

---

### 方案4: 幂等性设计（工程化）🔧

**实现**:
```typescript
// url-swap-executor.ts 修改
export async function executeUrlSwapTask(task: Task<UrlSwapTaskData>) {
  // 1. 检查任务是否已在当前时间间隔内执行过
  const lastSwapAt = task.data.lastSwapAt
  const intervalMinutes = task.data.intervalMinutes
  const now = Date.now()

  if (lastSwapAt && (now - lastSwapAt) < intervalMinutes * 60 * 1000) {
    console.log(`[url-swap-executor] 跳过重复执行: ${task.id}`)
    return { success: true, changed: false }
  }

  // 2. 正常执行逻辑...
}
```

**优点**:
- ✅ 允许重复执行但避免重复操作
- ✅ 系统容错性更强

**缺点**:
- ⚠️ 复杂度增加
- ⚠️ 仍然可能产生不必要的API调用（resolveAffiliateLink）

---

## 推荐方案：方案1（清理队列任务）

### 实施步骤

#### Step 1: 添加适配器支持

**Redis适配器**（src/lib/queue/redis-adapter.ts）:
```typescript
async deleteTasksByTypeAndStatus(
  type: TaskType,
  status: 'pending' | 'processing'
): Promise<number> {
  const pipeline = this.redis.pipeline()
  const queueKey = `${this.keyPrefix}${status}`

  // 获取所有任务
  const tasks = await this.redis.lrange(queueKey, 0, -1)
  let deletedCount = 0

  for (const taskStr of tasks) {
    const task = JSON.parse(taskStr)
    if (task.type === type) {
      pipeline.lrem(queueKey, 1, taskStr)
      pipeline.del(`${this.keyPrefix}task:${task.id}`)
      deletedCount++
    }
  }

  await pipeline.exec()
  return deletedCount
}
```

**内存适配器**（src/lib/queue/memory-adapter.ts）:
```typescript
async deleteTasksByTypeAndStatus(
  type: TaskType,
  status: 'pending' | 'processing'
): Promise<number> {
  const queue = status === 'pending' ? this.pendingQueue : this.processingQueue
  const before = queue.length

  // 过滤掉指定类型的任务
  const filtered = queue.filter(task => task.type !== type)

  if (status === 'pending') {
    this.pendingQueue = filtered
  } else {
    this.processingQueue = filtered
  }

  const deletedCount = before - filtered.length

  // 同时从tasks Map中删除
  for (const task of queue) {
    if (task.type === type) {
      this.tasks.delete(task.id)
    }
  }

  return deletedCount
}
```

#### Step 2: 队列管理器添加启动清理

**unified-queue-manager.ts**:
```typescript
async start(): Promise<void> {
  // ... 现有代码 ...

  // 🆕 启动时清理换链接队列任务
  await this.cleanupUrlSwapTasksOnStartup()

  // 启动处理循环
  this.startProcessingLoop()

  // 启动健康检查
  this.startHealthCheckLoop()
}

private async cleanupUrlSwapTasksOnStartup(): Promise<void> {
  try {
    console.log('[队列健康] 🧹 服务启动，清理换链接队列任务...')

    // 清理 processing 状态的 url-swap 任务
    const processingDeleted = await this.adapter.deleteTasksByTypeAndStatus('url-swap', 'processing')

    // 清理 pending 状态的 url-swap 任务（可选）
    const pendingDeleted = await this.adapter.deleteTasksByTypeAndStatus('url-swap', 'pending')

    const total = processingDeleted + pendingDeleted

    if (total > 0) {
      console.log(`[队列健康] ✅ 清理 ${total} 个换链接任务 (processing: ${processingDeleted}, pending: ${pendingDeleted})`)
      console.log('[队列健康] ℹ️  任务将在下一个时间间隔由调度器重新入队')
    } else {
      console.log('[队列健康] ✅ 无需清理换链接任务')
    }
  } catch (error: any) {
    console.error('[队列健康] ❌ 清理换链接任务失败:', error.message)
    // 不阻塞启动流程
  }
}
```

#### Step 3: 类型定义更新

**types.ts**:
```typescript
export interface QueueStorageAdapter {
  // ... 现有方法 ...

  /**
   * 删除指定类型和状态的所有任务
   * @param type 任务类型
   * @param status 任务状态
   * @returns 删除的任务数量
   */
  deleteTasksByTypeAndStatus?(
    type: TaskType,
    status: 'pending' | 'processing'
  ): Promise<number>
}
```

### 执行效果

```
# 服务重启前
Redis队列:
- task-1: { type: 'url-swap', status: 'processing', ... }
- task-2: { type: 'url-swap', status: 'pending', ... }
- task-3: { type: 'click-farm', status: 'processing', ... }

# 服务启动时
[队列健康] 🧹 服务启动，清理换链接队列任务...
[队列健康] ✅ 清理 2 个换链接任务 (processing: 1, pending: 1)
[队列健康] ℹ️  任务将在下一个时间间隔由调度器重新入队

# 服务重启后
Redis队列:
- task-3: { type: 'click-farm', status: 'processing', ... }  # 保留其他类型任务

url_swap_tasks表:
- task-1: { status: 'enabled', next_swap_at: '14:05', failed_swaps: 0 }  # 统计数据未受影响
- task-2: { status: 'enabled', next_swap_at: '14:10', failed_swaps: 0 }

# 下一个时间间隔（14:05）
Cron触发 -> 调度器检测到 next_swap_at <= now -> 重新入队 task-1
```

---

## 最终建议

### 是否合理？

**部分合理 ✅**:
- ✅ 清理队列任务是合理的（避免重复执行）
- ❌ 设置为"失败"不合理（污染统计数据）

### 推荐实施：方案1（清理队列任务，不修改统计）

**理由**:
1. **避免重复执行**: 重启时清理processing/pending任务
2. **保持统计准确**: 不影响failed_swaps和consecutive_failures
3. **自动恢复**: 调度器会在下一个时间间隔重新入队
4. **简单可靠**: 实现简单，影响范围可控
5. **适用性广**: 同时支持Redis和内存队列

**风险评估**:
- 🟢 低风险：只影响url-swap类型任务，其他任务（click-farm等）不受影响
- 🟢 可回滚：如有问题，移除启动清理代码即可

---

## 待办事项

如果决定实施方案1，需要完成以下任务：

- [ ] 更新types.ts，添加deleteTasksByTypeAndStatus接口定义
- [ ] 实现redis-adapter.ts的deleteTasksByTypeAndStatus
- [ ] 实现memory-adapter.ts的deleteTasksByTypeAndStatus
- [ ] 更新unified-queue-manager.ts，添加cleanupUrlSwapTasksOnStartup
- [ ] 在start()方法中调用清理函数
- [ ] 本地测试（模拟重启场景）
- [ ] 生产环境灰度验证

---

## 附录：其他注意事项

### A. 为什么不清理click-farm任务？

Click-farm任务通常是一次性任务，重启后：
- 如果未完成，用户期望继续执行（不应清理）
- 健康检查会清理真正超时的任务（30分钟）

### B. 是否需要清理pending状态？

**推荐清理**:
- pending任务可能是重复入队的（调度器会重新入队）
- 避免积压过多任务

**可选不清理**:
- 如果pending任务数量少，影响不大
- 可以让队列正常处理

建议：**同时清理processing和pending**，确保队列完全干净。
