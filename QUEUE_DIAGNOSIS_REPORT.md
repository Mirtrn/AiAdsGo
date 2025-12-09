# Offer创建流程与队列管理诊断报告

**生成时间**: 2025-12-09
**问题**: 前端无操作后，/admin/queue页面显示8个运行中任务

---

## 1. Offer创建流程分析

### 1.1 单个Offer创建流程

**API路径**: `POST /api/offers`

**完整流程**:

1. **创建Offer记录** (`createOffer`)
   - 在 `offers` 表创建基础记录
   - 状态设为 `pending`
   - 自动生成 `offer_name` 和 `target_language`

2. **智能抓取判断** (src/app/api/offers/route.ts:68-90)
   ```typescript
   if (offer.final_url) {
     // ✅ SSE已完成完整分析，标记为completed
     await updateOfferScrapeStatus(offer.id, userId, 'completed')
   } else {
     // 触发后台抓取（URGENT优先级）
     triggerOfferScraping(offer.id, userId, ...)
   }
   ```

3. **后台抓取任务** (如果需要)
   - 任务类型: `scrape`
   - 进入统一队列 (UnifiedQueueManager)
   - 执行器: ScrapingExecutor（未在代码中找到，可能缺失）

**关键发现**:
- ✅ 单个Offer创建 **只产生1个任务**（scrape类型）
- ✅ 如果 `final_url` 已存在，**不产生任务**（直接标记completed）

---

### 1.2 批量Offer创建流程

**API路径**: `POST /api/offers/batch/create`

**完整流程**:

1. **解析CSV文件**
   - 校验必填列: `affiliate_link`, `target_country`
   - 跳过缺失参数的行
   - 最大500行

2. **创建batch_tasks记录**
   - `id`: 随机UUID
   - `status`: pending
   - `total_count`: CSV有效行数

3. **加入batch-offer-creation任务**
   - 任务类型: `batch-offer-creation`
   - 数据: `{ batchId, rows[] }`
   - 进入统一队列

4. **BatchCreationExecutor执行** (协调器)
   - 更新 `batch_tasks.status = 'running'`
   - 为每行数据创建:
     - `offer_tasks` 记录（关联batch_id）
     - `offer-extraction` 队列任务
   - 启动监控循环（每2秒检查子任务完成情况）

5. **OfferExtractionExecutor执行** (每个子任务)
   - 更新 `offer_tasks.status = 'running'`
   - 调用 `extractOffer` (核心提取函数)
   - 执行AI分析 (review + competitor + ad extraction)
   - **自动创建Offer记录** (批量任务特有)
   - 更新 `offer_tasks.status = 'completed'`

6. **监控循环完成批量任务**
   - 检查所有子任务状态
   - 更新 `batch_tasks` 进度和最终状态

**关键发现**:
- ✅ 批量上传N行数据产生 **1 + N 个任务**
  - 1个 `batch-offer-creation` 任务（协调器）
  - N个 `offer-extraction` 任务（子任务）

---

## 2. 队列管理系统分析

### 2.1 统一队列架构

**核心组件**: `UnifiedQueueManager` (src/lib/queue/unified-queue-manager.ts)

**存储策略**:
- Redis优先: `redisKeyPrefix = 'autoads:queue:'`
- 内存回退: 如果Redis连接失败

**并发控制**:
```typescript
globalConcurrency: 5          // 全局最多5个并发任务
perUserConcurrency: 2         // 单用户最多2个并发任务
perTypeConcurrency: {
  'scrape': 3,
  'offer-extraction': 2,
  'batch-offer-creation': 1   // 批量协调器串行执行
}
```

**任务类型**:
1. `scrape` - Offer抓取（需要代理）
2. `offer-extraction` - Offer提取（需要代理，AI密集型）
3. `batch-offer-creation` - 批量任务协调器
4. `ai-analysis`, `sync`, `backup`, `email`, `export`, `link-check`, `cleanup`

---

### 2.2 队列状态API

**路径**: `GET /api/queue/stats`

**返回数据结构**:
```typescript
{
  global: {
    running: number,    // 全局运行中任务数
    queued: number,     // 全局待处理任务数
    completed: number,
    failed: number
  },
  perUser: [{
    userId: number,
    running: number,
    queued: number,
    completed: number,
    failed: number
  }],
  byType: { [type: string]: number },  // 任务类型分布
  proxy: { ... }  // 代理池状态
}
```

**数据来源**:
- `queueManager.getStats()` - 从Redis/内存适配器读取
- 实时统计，不依赖数据库

---

## 3. 问题诊断：8个运行中任务

### 3.1 实际检查结果

**生产环境数据库检查**:
```bash
tsx scripts/check-db-tasks.ts
```

**结果**:
```
📊 offer_tasks 任务统计:
  completed: 1

🔄 运行中的 offer_tasks:
  找到 0 个运行中的任务

📊 batch_tasks 任务统计:
  (无数据)

🔄 运行中的 batch_tasks:
  找到 0 个运行中的批量任务
```

**关键发现**:
- ✅ 数据库中 **0个running任务**
- ✅ 数据库中只有 **1个completed任务**

---

### 3.2 问题根源分析

#### 可能原因1: Redis数据不一致

**现象**:
- Redis连接超时 (`ETIMEDOUT`)
- /admin/queue页面从Redis读取统计数据
- Redis中可能存在"僵尸任务"（stuck in running state）

**验证**:
- 本地无法直接连接生产Redis（网络隔离）
- 需要通过生产环境服务器执行检查

**解决方案**:
```bash
# 在生产环境执行
DATABASE_URL=... REDIS_URL=... tsx scripts/clear-production-queue.ts
```

#### 可能原因2: 队列管理器初始化问题

**代码位置**: `src/lib/queue/unified-queue-manager.ts:163-165`

```typescript
// 【队列恢复】功能已完全移除
// 启动时会自动清空所有未完成任务（见 db-init.ts）
// 用户可以重新提交任务
```

**问题**:
- 注释说明启动时会清空未完成任务
- 但实际Redis数据可能未清空
- 导致旧的running任务仍显示在统计中

#### 可能原因3: 前端缓存问题

**代码位置**: `src/app/(app)/admin/queue/page.tsx:88-103`

**自动刷新逻辑**:
```typescript
useEffect(() => {
  fetchStats()

  // 自动刷新（每5秒）
  if (autoRefresh && activeTab === 'monitor') {
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }
}, [autoRefresh, activeTab])
```

**问题**:
- fetchStats调用 `GET /api/queue/stats`
- 如果Redis数据错误，前端会持续显示错误数据
- 没有前端缓存，应该是实时数据

---

## 4. 创建Offer的任务数量总结

### 4.1 单个Offer创建

**场景1: 手动创建（无final_url）**
- 任务数: **1个** (`scrape` 任务)

**场景2: SSE流式创建（有final_url）**
- 任务数: **0个** (直接标记completed)

### 4.2 批量Offer创建（N行CSV）

**场景: CSV批量上传**
- 总任务数: **1 + N 个**
  - 1个 `batch-offer-creation` 任务
  - N个 `offer-extraction` 任务

**示例**:
- 上传10行CSV → 11个任务
- 上传100行CSV → 101个任务

**任务关系**:
```
batch-offer-creation (协调器)
 ├─ offer-extraction #1 → 创建 Offer #1
 ├─ offer-extraction #2 → 创建 Offer #2
 ├─ ...
 └─ offer-extraction #N → 创建 Offer #N
```

---

## 5. 推荐解决方案

### 5.1 立即解决：清理Redis僵尸任务

```bash
# 连接到生产环境服务器
ssh production-server

# 设置环境变量
export DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/<db_name>"
export REDIS_URL="redis://<redis_user>:<redis_password>@<redis_host>:<redis_port>"

# 执行清理脚本
cd /path/to/autobb
tsx scripts/clear-production-queue.ts
```

### 5.2 长期优化：队列健康检查

**新增定时任务**:

```typescript
// src/lib/queue/health-check.ts
import { getQueueManager } from './unified-queue-manager'
import { getDatabase } from '@/lib/db'

/**
 * 队列健康检查：清理Redis中的僵尸任务
 * 运行频率：每小时
 */
export async function queueHealthCheck() {
  const queue = getQueueManager()
  const db = getDatabase()

  // 1. 获取Redis中的running任务
  const stats = await queue.getStats()
  const runningTaskIds = Object.keys(stats.byUser)
    .flatMap(userId => stats.byUser[userId].running)

  // 2. 查询数据库中的实际running任务
  const dbRunningTasks = await db.query(`
    SELECT id FROM offer_tasks WHERE status = 'running'
  `)
  const dbRunningIds = new Set(dbRunningTasks.map(t => t.id))

  // 3. 找出僵尸任务（Redis有但数据库没有）
  const zombieTasks = runningTaskIds.filter(id => !dbRunningIds.has(id))

  // 4. 清理僵尸任务
  for (const taskId of zombieTasks) {
    await queue.adapter.updateTaskStatus(taskId, 'failed', 'Zombie task cleaned')
  }

  if (zombieTasks.length > 0) {
    console.log(`🧹 清理了 ${zombieTasks.length} 个僵尸任务`)
  }
}
```

### 5.3 监控告警：异常任务检测

**新增监控指标**:

1. **running任务时长超过阈值**
   - 阈值: 10分钟（`taskTimeout = 600000ms`）
   - 告警: 发送通知或自动标记为failed

2. **Redis与数据库不一致**
   - 检查: Redis running count ≠ DB running count
   - 告警: 触发健康检查

3. **队列堆积告警**
   - 阈值: pending > 100
   - 告警: 队列处理能力不足

---

## 6. 代码改进建议

### 6.1 优化批量任务监控循环

**当前问题** (src/lib/queue/executors/batch-creation-executor.ts:112-174):
```typescript
// 启动监控循环（每2秒检查一次）
const monitorInterval = setInterval(async () => {
  // ...
}, 2000)

// 超时保护：10分钟后自动停止监控
setTimeout(() => {
  clearInterval(monitorInterval)
  console.log(`⏱️ 批量任务监控超时: batch=${batchId}`)
}, 600000)
```

**问题**:
- 监控循环在任务执行器内启动
- 如果执行器进程重启，监控循环丢失
- 批量任务可能永远停在 `running` 状态

**建议改进**:
```typescript
// 方案1: 使用数据库触发器或后台定时任务监控
// 方案2: 将监控逻辑移到队列管理器的主循环中
// 方案3: 使用Redis发布订阅机制通知状态变化
```

### 6.2 增强任务超时机制

**当前实现** (src/lib/queue/unified-queue-manager.ts:405-408):
```typescript
const result = await this.executeWithTimeout(
  executor(task),
  this.config.taskTimeout  // 10分钟
)
```

**建议增强**:
```typescript
// 1. 记录任务开始时间到Redis
// 2. 定期检查超时任务（独立进程）
// 3. 超时后强制清理并标记failed

async function cleanupTimeoutTasks() {
  const now = Date.now()
  const tasks = await redis.hgetall('autoads:queue:tasks')

  for (const [taskId, taskData] of Object.entries(tasks)) {
    const task = JSON.parse(taskData)
    if (task.status === 'running' && now - task.startedAt > taskTimeout) {
      await updateTaskStatus(taskId, 'failed', 'Task timeout')
    }
  }
}
```

---

## 7. 总结

### 7.1 问题回答

**问题1**: 创建一个offer，会在页面/admin/queue下显示几个任务在执行？

**答案**:
- **手动创建（无final_url）**: 1个任务（`scrape`类型）
- **SSE流式创建（有final_url）**: 0个任务（直接完成）
- **批量创建N个Offer**: N+1个任务（1个协调器 + N个子任务）

**问题2**: 为何页面/admin/queue还一直显示8个运行中的任务？

**答案**:
- **根本原因**: Redis中存在僵尸任务（数据库已完成但Redis未更新）
- **验证结果**: 数据库中0个running任务，Redis无法连接验证
- **解决方案**: 在生产环境执行 `clear-production-queue.ts` 清理Redis

### 7.2 行动项

**立即执行**:
1. ✅ 在生产环境执行Redis清理脚本
2. ✅ 验证/admin/queue页面显示是否恢复正常

**短期优化** (1周内):
1. 实现队列健康检查定时任务
2. 增加任务超时自动清理机制
3. 完善监控告警（僵尸任务、队列堆积）

**长期改进** (1个月内):
1. 优化批量任务监控循环（避免进程重启丢失）
2. 实现Redis与数据库状态一致性校验
3. 增加队列管理后台界面（手动清理、重试功能）
