# 补点击任务状态设计分析

## 一、当前状态定义

根据 `src/lib/click-farm-types.ts:7-12`，补点击任务有以下5个状态：

```typescript
export type ClickFarmTaskStatus =
  | 'pending'    // 等待开始
  | 'running'    // 运行中
  | 'paused'     // 已中止（代理缺失）
  | 'stopped'    // 已停止（用户手动）
  | 'completed'; // 已完成
```

### 状态含义详解

| 状态 | 含义 | 触发条件 | 可编辑 | 可重启 |
|------|------|----------|--------|--------|
| **pending** | 等待开始 | 任务刚创建，尚未开始执行 | ✅ 是 | ❌ 否 |
| **running** | 运行中 | Cron调度器正在执行点击 | ✅ 是 | ❌ 否 |
| **paused** | 已中止 | 代理缺失或其他错误 | ❌ 否 | ✅ 是 |
| **stopped** | 已停止 | 用户手动停止 | ❌ 否 | ✅ 是 |
| **completed** | 已完成 | 超过结束日期自动完成 | ❌ 否 | ❌ 否 |

---

## 二、任务开始日期与执行时机

### 当前实现

**问题：用户配置的补点击任务开始日期默认是否是当天？**

查看创建任务代码 `src/lib/click-farm.ts:18-41`：

```typescript
export async function createClickFarmTask(
  userId: number,
  input: CreateClickFarmTaskRequest
): Promise<ClickFarmTask> {
  const db = await getDatabase();

  const result = await db.exec(`
    INSERT INTO click_farm_tasks (
      user_id, offer_id, daily_click_count, start_time, end_time,
      duration_days, hourly_distribution, timezone
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    userId,
    input.offer_id,
    input.daily_click_count,
    input.start_time,      // 🔥 只存储时间段 "06:00"
    input.end_time,        // 🔥 只存储时间段 "24:00"
    input.duration_days,
    JSON.stringify(input.hourly_distribution),
    input.timezone || 'America/New_York'
  ]);

  return (await getClickFarmTaskById(result.lastInsertRowid as number, userId))!;
}
```

**关键发现：**
1. ❌ **没有存储开始日期字段** - 数据库表中没有 `start_date` 字段
2. ✅ **只存储时间段** - `start_time`/`end_time` 只是时间（如 "06:00-24:00"）
3. ✅ **默认立即开始** - 任务创建后状态为 `pending`，等待Cron调度器执行
4. ✅ **执行逻辑** - Cron每小时检查 `pending`/`running` 任务，根据当前小时执行

### 执行时机分析

查看Cron调度器 `src/app/api/cron/click-farm-scheduler/route.ts:40-111`：

```typescript
const tasks = await getPendingTasks();  // 🔥 获取所有 pending/running 任务

for (const task of tasks) {
  // 🔥 检查是否应该完成（超过duration_days）
  if (shouldCompleteTask(task)) {
    await updateTaskStatus(task.id, 'completed');
    continue;
  }

  // 🔥 获取当前时区的小时
  const currentHour = getHourInTimezone(new Date(), task.timezone);

  // 🔥 获取该小时应该执行的点击数
  const clickCount = task.hourly_distribution[currentHour] || 0;

  if (clickCount === 0) {
    // 该小时无需执行
    continue;
  }

  // 🔥 将点击任务加入队列
  for (let i = 0; i < clickCount; i++) {
    await queueManager.enqueue('click-farm', taskData, task.user_id);
  }
}
```

**执行时机结论：**
- ✅ **立即开始**：任务创建后立即变为 `pending`，Cron在下一个小时开始执行
- ✅ **无需等待次日**：如果当前是14:00创建，15:00就会开始执行
- ✅ **按时区执行**：根据 `timezone` 字段和 `hourly_distribution` 确定执行时间

### ⚠️ 潜在问题

**问题：当前无法指定未来开始日期**

例如：
- 用户在12月28日创建任务，希望从12月30日开始执行
- 当前实现：任务会在12月28日的下一个小时就开始执行 ❌

**建议增强：**
```sql
ALTER TABLE click_farm_tasks ADD COLUMN scheduled_start_date TEXT;  -- YYYY-MM-DD格式
```

然后在Cron调度器中增加日期判断：
```typescript
if (task.scheduled_start_date) {
  const today = new Date().toISOString().split('T')[0];
  if (today < task.scheduled_start_date) {
    continue;  // 尚未到开始日期，跳过
  }
}
```

---

## 三、状态转换详解

### 1. pending → running

**触发时机：** Cron调度器首次执行任务

**代码位置：** `src/lib/click-farm.ts:295-313`

```typescript
export async function updateTaskStatus(
  id: number | string,
  status: ClickFarmTaskStatus,
  nextRunAt?: string
): Promise<void> {
  const db = await getDatabase();

  const updates: string[] = [`status = ?`];
  const params: any[] = [status];

  // 🔥 首次从pending变为running时，记录started_at
  if (status === 'running') {
    updates.push(`started_at = COALESCE(started_at, datetime('now'))`);
  }

  // 🔥 完成时记录completed_at
  if (status === 'completed') {
    updates.push(`completed_at = datetime('now')`);
  }

  // ...
}
```

**状态转换条件：**
- 任务状态为 `pending`
- Cron调度器检测到当前小时有点击任务
- 更新 `status = 'running'` + `started_at = now()`

### 2. running → completed

**触发时机：** 超过结束日期

**代码位置：** `src/lib/click-farm/scheduler.ts:100-116`

```typescript
export function shouldCompleteTask(task: ClickFarmTask): boolean {
  if (task.duration_days === -1) {
    // 🔥 无限期任务不会自动完成
    return false;
  }

  if (!task.started_at) {
    return false;
  }

  const startDate = new Date(task.started_at);
  const now = new Date();
  const elapsedDays = Math.floor(
    (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // 🔥 超过duration_days则完成
  return elapsedDays >= task.duration_days;
}
```

**状态转换条件：**
- 任务状态为 `running`
- `(now - started_at) >= duration_days`
- 更新 `status = 'completed'` + `completed_at = now()`

**示例：**
- 任务创建于 2024-12-25 14:00，`duration_days = 7`
- `started_at = 2024-12-25 14:00`
- `completed_at = 2024-01-01 14:00`（7天后）

### 3. running → paused

**触发时机：** 代理缺失或其他错误

**代码位置：** `src/app/api/cron/click-farm-scheduler/route.ts:73-98`

```typescript
// 检查代理配置
const proxyConfig = await db.queryOne<any>(`
  SELECT proxy_url FROM system_settings
  WHERE user_id = ? AND key = ?
`, [task.user_id, `proxy_${offer.target_country.toLowerCase()}`]);

if (!proxyConfig || !proxyConfig.proxy_url) {
  // 🔥 代理缺失，中止任务
  await pauseClickFarmTask(
    task.id,
    'no_proxy',
    `缺少${offer.target_country}国家的代理配置`
  );

  // 🔔 发送任务中止通知
  await notifyTaskPaused(
    task.user_id,
    task.id,
    'no_proxy',
    `缺少${offer.target_country}国家的代理配置，请前往设置页面配置`
  );

  continue;
}
```

**状态转换条件：**
- 任务状态为 `running`
- 代理URL缺失
- 更新 `status = 'paused'` + `pause_reason = 'no_proxy'` + `paused_at = now()`

### 4. running → stopped

**触发时机：** 用户手动停止

**代码位置：** `src/lib/click-farm.ts:183-197`

```typescript
export async function stopClickFarmTask(
  id: number | string,
  userId: number
): Promise<ClickFarmTask> {
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET status = 'stopped', updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND status IN ('pending', 'running', 'paused')
  `, [id, userId]);

  return (await getClickFarmTaskById(id, userId))!;
}
```

**状态转换条件：**
- 用户点击"停止"按钮
- 任务状态为 `pending`/`running`/`paused`
- 更新 `status = 'stopped'`

### 5. stopped/paused → running

**触发时机：** 用户手动重启

**代码位置：** `src/lib/click-farm.ts:199-214`

```typescript
export async function restartClickFarmTask(
  id: number | string,
  userId: number
): Promise<ClickFarmTask> {
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET status = 'running',
        pause_reason = NULL,
        pause_message = NULL,
        paused_at = NULL,
        updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND status IN ('stopped', 'paused')
  `, [id, userId]);

  return (await getClickFarmTaskById(id, userId))!;
}
```

**状态转换条件：**
- 用户点击"重启"按钮
- 任务状态为 `stopped`/`paused`
- 更新 `status = 'running'` + 清除pause字段

---

## 四、状态汇总表

### 任务在设定运行日期中间的状态

| 时间点 | 状态 | 说明 |
|--------|------|------|
| **刚创建** | `pending` | 等待Cron调度器首次执行 |
| **首次执行后** | `running` | 正在执行点击任务 |
| **代理缺失** | `paused` | 中止执行，等待用户配置代理 |
| **用户停止** | `stopped` | 暂停执行，等待用户重启 |
| **超过结束日期** | `completed` | 任务完成 |

### 任务超过结束日期后的状态

**状态：** `completed`

**触发逻辑：** Cron调度器在每小时检查时，调用 `shouldCompleteTask()` 判断是否超过 `duration_days`，如果超过则自动更新为 `completed`。

**示例：**
```
created_at:    2024-12-25 14:00
duration_days: 7
started_at:    2024-12-25 15:00 (首次Cron执行)
completed_at:  2024-01-01 15:00 (7天后自动完成)
```

### 代理缺失或错误导致无法执行的状态

**状态：** `paused`

**触发逻辑：** Cron调度器在执行前检查代理配置，如果缺失则调用 `pauseClickFarmTask()` 并发送通知。

**Pause Reason枚举：**
```typescript
export type PauseReason =
  | 'no_proxy'   // 缺少代理（当前唯一实现）
  | 'manual'     // 手动中止（预留）
  | null;
```

### 其他情况下的状态

| 场景 | 状态 | 说明 |
|------|------|------|
| **Offer被删除** | `stopped` + `is_deleted=1` | 软删除，保留历史数据 |
| **无限期任务** | `running` | `duration_days = -1`，永不自动完成 |
| **编辑任务** | 保持原状态 | 仅pending/running可编辑 |
| **重启任务** | `running` | stopped/paused可重启 |

---

## 五、状态转换图

```
┌─────────┐
│ pending │ (任务创建)
└────┬────┘
     │ Cron首次执行
     ▼
┌─────────┐
│ running │ ◄──┐ (正常运行)
└────┬────┘    │
     │         │ 用户重启
     ├─────────┼──────────┐
     │         │          │
     ▼         │          ▼
┌──────────┐   │    ┌─────────┐
│ paused   │───┘    │ stopped │ (用户停止)
│(代理缺失)│        └─────────┘
└──────────┘              │
     │                    │ 用户重启
     └────────────────────┘

     │ 超过duration_days
     ▼
┌───────────┐
│ completed │ (任务完成，不可逆)
└───────────┘
```

---

## 六、发现的问题与建议

### 问题1：无法指定未来开始日期

**当前行为：** 任务创建后立即变为 `pending`，下一个小时就开始执行

**建议：** 增加 `scheduled_start_date` 字段，支持指定未来日期开始

```sql
ALTER TABLE click_farm_tasks ADD COLUMN scheduled_start_date TEXT;  -- YYYY-MM-DD
```

### 问题2：状态显示不够清晰

**当前行为：** `pending` 和 `running` 状态难以区分

**建议：** 在UI中显示更详细的状态信息：
- `pending` → "等待开始（下一个小时）"
- `running` → "运行中（已执行X天/共Y天）"
- `paused` → "已中止（原因：代理缺失）"

### 问题3：completed状态无法重启

**当前行为：** 任务完成后无法重新执行

**建议：** 支持"复制任务"功能，基于已完成任务创建新任务

### 问题4：pause_reason只有no_proxy

**当前实现：** 只有代理缺失会触发paused状态

**建议：** 增加更多暂停原因：
- `offer_deleted` - Offer已删除
- `rate_limit` - 触发限流
- `auth_error` - 认证失败

---

## 七、总结

### 当前状态设计评价

**优点：**
- ✅ 状态定义清晰，覆盖主要场景
- ✅ 支持无限期任务（`duration_days = -1`）
- ✅ 自动完成机制合理
- ✅ 支持手动停止和重启

**不足：**
- ⚠️ 无法指定未来开始日期
- ⚠️ pending和running状态区分不明显
- ⚠️ pause_reason枚举不完整
- ⚠️ completed状态不可逆

### 建议优先级

**P0（必须修复）：**
- 增加 `scheduled_start_date` 字段支持

**P1（建议优化）：**
- 完善 `pause_reason` 枚举
- UI状态显示优化

**P2（可选功能）：**
- 支持任务复制
- 支持completed任务重启
