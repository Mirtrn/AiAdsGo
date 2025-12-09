# 队列诊断快速参考

## 问题1: 创建一个Offer会产生几个任务？

### 单个Offer创建
- **手动创建（无final_url）**: **1个任务** (`scrape`类型)
- **SSE流式创建（有final_url）**: **0个任务** (直接标记completed)

### 批量Offer创建（N行CSV）
- **总任务数**: **N + 1个**
  - 1个 `batch-offer-creation` 任务（协调器）
  - N个 `offer-extraction` 任务（子任务，每个创建1个Offer）

**示例**:
- 上传10行CSV → 11个任务
- 上传100行CSV → 101个任务

---

## 问题2: 为何/admin/queue显示8个运行中任务？

### 诊断结果

**生产数据库检查** (2025-12-09):
```
✅ offer_tasks running: 0个
✅ batch_tasks running: 0个
✅ 数据库中无运行中任务
```

### 根本原因

**Redis僵尸任务**:
- Redis中存在旧的running任务状态
- 数据库已完成但Redis未同步更新
- /admin/queue从Redis读取统计数据

### 解决方案

**立即执行** (在生产环境):
```bash
# 清理Redis僵尸任务
DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/<db_name>" \
REDIS_URL="redis://<redis_user>:<redis_password>@<redis_host>:<redis_port>" \
tsx scripts/clear-production-queue.ts
```

**验证修复**:
1. 刷新 /admin/queue 页面
2. 检查 "运行中" 任务数是否归零

---

## 任务流程图

### 批量上传流程
```
用户上传CSV (10行)
    ↓
POST /api/offers/batch/create
    ↓
创建 batch_tasks 记录 (status: pending)
    ↓
加入队列: batch-offer-creation 任务
    ↓
BatchCreationExecutor 执行
    ├─ 创建 10个 offer_tasks 记录
    ├─ 加入队列: 10个 offer-extraction 任务
    └─ 启动监控循环（每2秒检查子任务）
         ↓
    OfferExtractionExecutor 执行 (并发执行)
    ├─ offer_tasks #1: extractOffer → AI分析 → 创建Offer #1
    ├─ offer_tasks #2: extractOffer → AI分析 → 创建Offer #2
    ├─ ...
    └─ offer_tasks #10: extractOffer → AI分析 → 创建Offer #10
         ↓
    监控循环检测全部完成
    └─ 更新 batch_tasks (status: completed)
```

**总任务数**: 11个
- 1个 batch-offer-creation 任务
- 10个 offer-extraction 任务

---

## 并发限制配置

```typescript
globalConcurrency: 5          // 全局最多5个并发
perUserConcurrency: 2         // 单用户最多2个并发
perTypeConcurrency: {
  'scrape': 3,                // scrape任务最多3个并发
  'offer-extraction': 2,      // 提取任务最多2个并发（AI密集）
  'batch-offer-creation': 1   // 协调器串行执行
}
```

**影响**:
- 批量上传10个Offer，虽然产生11个任务
- 实际同时运行: 最多2个 offer-extraction 任务
- 其余任务在队列中等待（pending状态）

---

## 相关文件

**核心代码**:
- `src/lib/queue/unified-queue-manager.ts` - 统一队列管理器
- `src/lib/queue/executors/batch-creation-executor.ts` - 批量创建协调器
- `src/lib/queue/executors/offer-extraction-executor.ts` - Offer提取执行器
- `src/app/api/offers/batch/create/route.ts` - 批量上传API
- `src/app/api/queue/stats/route.ts` - 队列统计API

**诊断脚本**:
- `scripts/check-db-tasks.ts` - 检查数据库任务状态
- `scripts/inspect-production-queue.ts` - 检查Redis队列状态（需要网络访问）
- `scripts/clear-production-queue.ts` - 清理僵尸任务

**文档**:
- `QUEUE_DIAGNOSIS_REPORT.md` - 完整诊断报告（本文档的详细版本）

---

## 数据库表结构

### offer_tasks (单个Offer提取任务)
```sql
id          TEXT PRIMARY KEY  -- 任务ID（UUID）
user_id     INTEGER           -- 用户ID
batch_id    TEXT              -- 批量任务ID（可空）
status      TEXT              -- pending/running/completed/failed
stage       TEXT              -- 当前阶段
progress    INTEGER           -- 进度百分比
message     TEXT              -- 进度消息
result      TEXT              -- 提取结果JSON
offer_id    INTEGER           -- 创建的Offer ID（可空）
error       TEXT              -- 错误信息
created_at  TIMESTAMP
started_at  TIMESTAMP
completed_at TIMESTAMP
```

### batch_tasks (批量任务协调器)
```sql
id              TEXT PRIMARY KEY  -- 批量任务ID（UUID）
user_id         INTEGER           -- 用户ID
task_type       TEXT              -- 任务类型（offer-creation）
status          TEXT              -- pending/running/completed/failed/partial
total_count     INTEGER           -- 总任务数
completed_count INTEGER           -- 已完成数
failed_count    INTEGER           -- 失败数
source_file     TEXT              -- 源文件名
metadata        TEXT              -- 元数据JSON
created_at      TIMESTAMP
started_at      TIMESTAMP
completed_at    TIMESTAMP
```

---

## ✅ 已实施的修复方案（2024-12-09）

### 修复内容

#### 1. 修复 key prefix 不一致问题
- **文件**: `src/lib/db-init.ts`
- **问题**: 使用了错误的 `queue:` 前缀
- **修复**: 改为 `autoads:queue:`（与 UnifiedQueueManager 一致）

#### 2. 增强 Redis 清理方法
- **文件**: `src/lib/queue/redis-adapter.ts`
- **新增方法**:
  - `clearAllUnfinished()`: 启动时清空所有未完成任务
  - `cleanupStaleRunningTasks()`: 清理超时的 running 任务

#### 3. UnifiedQueueManager 僵尸任务清理
- **文件**: `src/lib/queue/unified-queue-manager.ts`
- **新增方法**:
  - `cleanupZombieTasks('startup' | 'runtime')`: 清理僵尸任务
  - `performHealthCheck()`: 执行健康检查
- **新增功能**:
  - 启动时自动清理所有 running 任务（僵尸）
  - 定期健康检查（每5分钟）
  - 自动检测和清理超时任务（30分钟超时）

### 双层防护机制

```
应用启动
    ↓
【层1】db-init.ts: checkUnfinishedQueueTasks()
    ↓
    clearRedisAllUnfinishedTasks()
        - 清空 pending:* 队列
        - 清空 running 集合（僵尸任务）
        - 清空 user:*:pending 队列
        - 删除任务详情
    ↓
【层2】UnifiedQueueManager.start()
    ↓
    cleanupZombieTasks('startup')
        - 再次确保无僵尸任务
    ↓
    startHealthCheckLoop()
        - 每5分钟执行健康检查
        - 检测内存计数与Redis不一致
        - 清理超时任务（30分钟）
    ↓
队列正常运行
```

### 日志输出示例

```
🔄 启动清理：清空所有未完成任务...
  📊 Redis清理详情:
     - pending任务: 0
     - running任务(僵尸): 8
     - 用户队列: 2
  ✅ Redis: 已清空 8 个未完成任务
✅ 启动清理完成：系统状态已重置

🚀 队列处理启动中...
🧹 队列启动清理: 清除 0 个僵尸任务
🏥 队列健康检查已启动 (间隔: 300秒)
🚀 队列处理已启动
```

### 验证修复

重启服务后，`/admin/queue` 页面应显示：
- running: 0
- pending: 0（除非有新任务）

---

## 常见问题

**Q: 为什么批量上传10个Offer会产生11个任务？**

A: 1个协调器任务 + 10个子任务。协调器负责创建子任务并监控进度，子任务负责实际提取和创建Offer。

**Q: 批量上传的Offer会同时执行吗？**

A: 不会。受并发限制约束（`offer-extraction: 2`），最多同时执行2个提取任务，其余在队列中等待。

**Q: /admin/queue显示的running任务数从哪来？**

A: 从Redis读取（`autoads:queue:running` 集合）。如果Redis数据不一致，会显示错误的数量。

**Q: 如何确认任务真的在执行？**

A: 检查数据库：
```bash
tsx scripts/check-db-tasks.ts
```
数据库是真实状态，Redis可能存在缓存不一致。
