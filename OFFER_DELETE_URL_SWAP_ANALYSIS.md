# Offer删除时URL Swap任务自动结束需求评估

## 用户需求

> 当offer删除后，对应的换链接任务也需要自动结束

## 现状分析

### 1. Offers表删除机制

**软删除模式**：
```sql
-- offers表结构
is_deleted INTEGER DEFAULT 0  -- 0=未删除, 1=已删除
deleted_at TEXT               -- 删除时间
```

**删除操作**：
```sql
UPDATE offers SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?
```

### 2. URL Swap Tasks外键约束

```sql
-- url_swap_tasks表（migrations/128_create_url_swap_tasks.sql）
FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
```

**关键问题**：
- ✅ 外键约束已配置ON DELETE CASCADE
- ❌ 但offers使用软删除，**不会触发CASCADE**
- ⚠️ 软删除的offer，对应的url_swap_tasks仍然存在且可能继续运行

### 3. 当前调度器逻辑

**src/lib/url-swap-scheduler.ts（Line 56-61）**：
```typescript
const offer = await getOfferById(task.offer_id)
if (!offer) {
  await setTaskError(task.id, '关联的Offer已删除')
  results.skipped++
  continue
}
```

**现有保护措施**：
- ✅ 调度器检查offer是否存在
- ❌ getOfferById()可能**不过滤软删除的offer**
- ⚠️ 如果getOfferById返回软删除的offer，任务会继续执行

## 合理性评估

### 是否合理？

**✅ 非常合理，理由如下**：

1. **业务逻辑一致性**：
   - Offer已删除 → 推广链接失效 → 换链任务无意义
   - 避免浪费系统资源（代理IP、API调用）

2. **用户体验**：
   - 用户删除Offer后，期望相关任务自动清理
   - 避免Dashboard显示无效任务

3. **数据一致性**：
   - Offer不存在 → 换链任务应该结束
   - 避免错误日志积累

4. **资源优化**：
   - 减少无效的队列任务
   - 降低调度器负载

## 实施方案对比

### 方案1：Offer删除时同步更新任务状态（推荐）✅

**实现位置**：`src/app/api/offers/[id]/route.ts` (DELETE endpoint)

```typescript
// Offer删除API
export async function DELETE(request: NextRequest, { params }) {
  const offerId = params.id

  // 1. 软删除Offer
  await db.exec(`
    UPDATE offers
    SET is_deleted = 1, deleted_at = ?
    WHERE id = ? AND user_id = ?
  `, [now, offerId, userId])

  // 2. 🆕 同步禁用关联的URL Swap任务
  await db.exec(`
    UPDATE url_swap_tasks
    SET status = 'disabled',
        error_message = 'Offer已删除，任务自动禁用',
        updated_at = ?
    WHERE offer_id = ? AND is_deleted = 0
  `, [now, offerId])

  // 3. 🆕 （可选）从队列中移除待处理的任务
  const queueManager = await getOrCreateQueueManager()
  const pendingTasks = await queueManager.adapter.getAllPendingTasks()
  for (const task of pendingTasks) {
    if (task.type === 'url-swap' && task.data.offerId === offerId) {
      await queueManager.adapter.removeTask(task.id)
    }
  }
}
```

**优点**：
- ✅ 实时响应，Offer删除后任务立即禁用
- ✅ 数据一致性强
- ✅ 用户体验好

**缺点**：
- ⚠️ 需要修改Offer删除API
- ⚠️ 队列清理需要遍历（可选步骤）

---

### 方案2：调度器增强检查（补充方案）🔧

**实现位置**：`src/lib/url-swap.ts` (getOfferById)

```typescript
export async function getOfferById(offerId: number): Promise<any | null> {
  const db = await getDatabase()
  return db.queryOne(`
    SELECT * FROM offers
    WHERE id = ?
      AND is_deleted = 0  -- 🆕 过滤软删除的offer
  `, [offerId])
}
```

**优点**：
- ✅ 简单，只需修改一行代码
- ✅ 调度器自动跳过已删除的offer

**缺点**：
- ❌ 任务不会立即禁用（等下一个时间间隔）
- ❌ 状态仍为'enabled'，Dashboard显示不准确
- ⚠️ 每个时间间隔都会检查一次（浪费资源）

---

### 方案3：数据库触发器（过度工程）❌

```sql
CREATE TRIGGER trg_offers_delete_url_swap_tasks
AFTER UPDATE ON offers
FOR EACH ROW
WHEN NEW.is_deleted = 1 AND OLD.is_deleted = 0
BEGIN
  UPDATE url_swap_tasks
  SET status = 'disabled',
      error_message = 'Offer已删除，任务自动禁用',
      updated_at = datetime('now')
  WHERE offer_id = NEW.id AND is_deleted = 0;
END;
```

**优点**：
- ✅ 自动化，无需修改应用代码

**缺点**：
- ❌ 复杂度高（需要同时维护SQLite和PostgreSQL触发器）
- ❌ 调试困难
- ❌ 不符合项目架构（应用层处理业务逻辑）
- ❌ 无法清理队列任务

---

### 方案4：定时清理任务（Cron）⏱️

**实现**：每小时检查一次已删除的offer，禁用对应任务

```typescript
// src/lib/cron/cleanup-deleted-offer-tasks.ts
export async function cleanupDeletedOfferTasks() {
  const db = await getDatabase()

  const result = await db.exec(`
    UPDATE url_swap_tasks
    SET status = 'disabled',
        error_message = 'Offer已删除，任务自动禁用',
        updated_at = datetime('now')
    WHERE offer_id IN (
      SELECT id FROM offers WHERE is_deleted = 1
    )
    AND status != 'disabled'
    AND is_deleted = 0
  `)

  console.log(`清理 ${result.changes} 个已删除Offer的换链任务`)
}
```

**优点**：
- ✅ 解耦，不影响Offer删除流程

**缺点**：
- ❌ 延迟处理（最多延迟1小时）
- ❌ 用户体验差
- ⚠️ 增加系统复杂度（新增Cron任务）

---

## 推荐方案：方案1 + 方案2 组合

### 实施步骤

#### Step 1: 修改Offer删除API（立即禁用任务）

**文件**：`src/app/api/offers/[id]/route.ts`

```typescript
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // ... 现有代码：验证用户权限 ...

  const db = await getDatabase()
  const now = new Date().toISOString()
  const offerId = parseInt(params.id, 10)

  // 1. 软删除Offer
  await db.exec(`
    UPDATE offers
    SET is_deleted = 1, deleted_at = ?
    WHERE id = ? AND user_id = ?
  `, [now, offerId, userId])

  // 2. 🆕 同步禁用关联的URL Swap任务
  const result = await db.exec(`
    UPDATE url_swap_tasks
    SET status = 'disabled',
        error_message = 'Offer已删除，任务自动禁用',
        updated_at = ?
    WHERE offer_id = ?
      AND is_deleted = 0
      AND status != 'disabled'
  `, [now, offerId])

  if (result.changes > 0) {
    console.log(`[Offer删除] 禁用 ${result.changes} 个关联的URL Swap任务`)
  }

  // 3. 🆕 （可选）从队列中移除待处理的任务
  try {
    const { getOrCreateQueueManager } = await import('@/lib/queue/init-queue')
    const queueManager = await getOrCreateQueueManager()

    if (queueManager.adapter.getAllPendingTasks && queueManager.adapter.removeTask) {
      const pendingTasks = await queueManager.adapter.getAllPendingTasks()
      const removedCount = 0

      for (const task of pendingTasks) {
        if (task.type === 'url-swap' && task.data.offerId === offerId) {
          await queueManager.adapter.removeTask(task.id)
          removedCount++
        }
      }

      if (removedCount > 0) {
        console.log(`[Offer删除] 从队列移除 ${removedCount} 个待处理任务`)
      }
    }
  } catch (queueError) {
    // 队列清理失败不影响主流程
    console.warn(`[Offer删除] 队列清理失败:`, queueError)
  }

  return NextResponse.json({ success: true })
}
```

#### Step 2: 增强调度器检查（防御性编程）

**文件**：`src/lib/url-swap.ts`

```typescript
export async function getOfferById(offerId: number): Promise<any | null> {
  const db = await getDatabase()
  return db.queryOne(`
    SELECT * FROM offers
    WHERE id = ?
      AND is_deleted = 0  -- 🆕 过滤软删除的offer
  `, [offerId])
}
```

### 执行效果

```
# 用户在UI删除Offer 123

# Step 1: Offer删除API（立即响应）
[Offer删除] 禁用 1 个关联的URL Swap任务
[Offer删除] 从队列移除 0 个待处理任务

# 数据库状态
offers: { id: 123, is_deleted: 1, deleted_at: '2025-01-03 10:30:00' }
url_swap_tasks: { offer_id: 123, status: 'disabled', error_message: 'Offer已删除，任务自动禁用' }

# Step 2: 调度器检查（下一个时间间隔，10:35）
[url-swap-scheduler] 关联的Offer已删除: task-abc
[url-swap-scheduler] 跳过任务: task-abc

# Dashboard显示
任务列表:
  ❌ Offer 123 的换链任务 - 已禁用（Offer已删除，任务自动禁用）
```

---

## 边界情况处理

### Case 1: Offer恢复（is_deleted改回0）

**问题**：任务已被禁用，offer恢复后任务不会自动恢复

**方案**：
- Offer恢复API中添加任务重启提示
- 用户手动在任务详情页重新启用任务

**代码（可选）**：
```typescript
// Offer恢复API
await db.exec(`
  UPDATE offers
  SET is_deleted = 0, deleted_at = NULL
  WHERE id = ? AND user_id = ?
`, [offerId, userId])

// 检查是否有被禁用的任务
const disabledTask = await db.queryOne(`
  SELECT id FROM url_swap_tasks
  WHERE offer_id = ?
    AND status = 'disabled'
    AND error_message LIKE '%Offer已删除%'
`, [offerId])

if (disabledTask) {
  return NextResponse.json({
    success: true,
    message: '检测到关联的换链任务已被禁用，请前往任务管理页重新启用'
  })
}
```

### Case 2: 批量删除Offer

**问题**：删除多个offer时，需要批量处理任务

**方案**：批量删除API中使用IN子句

```typescript
await db.exec(`
  UPDATE url_swap_tasks
  SET status = 'disabled',
      error_message = 'Offer已删除，任务自动禁用',
      updated_at = ?
  WHERE offer_id IN (${offerIds.join(',')})
    AND is_deleted = 0
`, [now])
```

### Case 3: 任务已在队列中执行

**问题**：任务正在执行时，offer被删除

**方案**：
- 执行器会在下一步检查offer存在性（Step 2已覆盖）
- 任务会失败，但不影响系统稳定性

---

## 最终建议

### 是否合理？

**✅ 非常合理且必要**

### 推荐实施

**方案1 + 方案2 组合**：
1. **立即禁用**（方案1）：Offer删除API中同步更新任务状态
2. **防御性检查**（方案2）：调度器过滤软删除的offer

### 优先级

- **P0（必须）**：Step 2 - 调度器过滤软删除offer（1行代码）
- **P1（重要）**：Step 1 - Offer删除API禁用任务（10行代码）

### 风险评估

- 🟢 **低风险**：修改范围可控，影响明确
- 🟢 **可测试**：容易验证（删除offer → 检查任务状态）
- 🟢 **可回滚**：移除代码即可

---

## 待办事项

如果决定实施，需要完成以下任务：

- [ ] Step 1: 修改src/lib/url-swap.ts的getOfferById，过滤is_deleted=0
- [ ] Step 2: 修改src/app/api/offers/[id]/route.ts的DELETE方法
- [ ] Step 3: 添加队列任务清理逻辑（可选）
- [ ] Step 4: 本地测试（删除offer → 验证任务状态）
- [ ] Step 5: 生产环境验证
