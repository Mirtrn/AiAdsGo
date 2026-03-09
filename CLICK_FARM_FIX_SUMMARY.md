# 补点击任务15.5%缺失问题 - 修复总结

## 修复完成 ✅

已完成对正常运行期间15.5%点击缺失问题的修复。

## 修改内容

### 1. 代码默认值调整（核心修复）

| 参数 | 修改前 | 修改后 | 文件 |
|------|--------|--------|------|
| 执行器内存压力阈值 | 80% | **90%** | `click-farm-executor.ts` |
| 批次分发器内存压力阈值 | 82% | **90%** | `click-farm-batch-executor.ts` |
| 调度器内存压力阈值 | 85% | **90%** | `click-farm-scheduler-trigger.ts` |
| 批次大小 | 20 | **10** | `click-farm-batch-executor.ts` |
| 批次间隔 | 200ms | **500ms** | `click-farm-batch-executor.ts` |

### 2. 日志增强

**执行器** (`click-farm-executor.ts:336`):
```typescript
console.warn(`[ClickFarm] 内存压力过高，跳过执行`, {
  taskId,
  heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
  heapLimit: `${(heap.heap_size_limit / 1024 / 1024).toFixed(2)} MB`,
  percentage: `${pct}%`,
  threshold: `${CLICK_FARM_EXECUTOR_HEAP_PRESSURE_PCT}%`
})
```

**批次分发器** (`click-farm-batch-executor.ts:142`):
```typescript
console.warn(`[BatchExecutor] 内存压力过高，延迟批次任务`, {
  clickFarmTaskId,
  targetDate,
  targetHour,
  totalClicks,
  dispatchedClicks,
  remaining,
  heapUsed,
  percentage,
  threshold,
  delayMs
})
```

**调度器** (`click-farm-scheduler-trigger.ts:367`):
```typescript
console.log(`[Trigger] 创建批次任务`, {
  taskId,
  targetDate,
  targetHour,
  clickCount,
  batchSize,
  refererType
})
```

**批次完成** (`click-farm-batch-executor.ts:199`):
```typescript
console.log(`[BatchExecutor] 批次分发完成`, {
  clickFarmTaskId,
  targetDate,
  targetHour,
  totalClicks,
  dispatchedThisBatch,
  totalDispatched,
  remaining,
  progress
})
```

### 3. 新增工具

**内存监控脚本**: `scripts/monitor_memory.js`
- 每5秒检查内存使用情况
- 显示堆内存使用率和阈值
- 彩色输出（🟢正常/🟠警告/🔴危险）

### 4. 文档更新

- `CLICK_FARM_FIX_MISSING_CLICKS.md` - 完整修复说明
- `.env.production.example` - 生产环境配置示例
- `.env` - 开发环境配置

## 修复原理

### 问题根因

高点击量任务（200+次/天）在峰值小时（如75次/小时）会产生大量并发请求，导致：

1. **内存压力上升**
   - 批次分发: 4批 × 20个 = 80个任务对象
   - 执行器并发: 最多20个HTTP请求
   - 队列积压: 未处理的任务对象

2. **触发保护机制**
   - 执行器在80%阈值时跳过点击
   - 批次分发器在82%阈值时延迟1000ms
   - 导致部分点击缺失

### 修复策略

1. **提高内存容忍度** (80%/82% → 90%)
   - 减少因内存压力跳过的点击
   - 给系统更多运行空间

2. **减小批次大小** (20 → 10)
   - 降低单批内存占用
   - 减少内存压力峰值
   - 更平滑的分发过程

3. **增加批次间隔** (200ms → 500ms)
   - 给执行器更多处理时间
   - 避免队列快速积压
   - 降低内存压力增长速度

### 效果预期

**修复前**:
```
75次/小时 = 4批 × 20个
分发耗时: 800ms
内存峰值: 可能超过80%
缺失率: 15.5%
```

**修复后**:
```
75次/小时 = 8批 × 10个
分发耗时: 3500ms
内存峰值: 更平滑，不易超过90%
缺失率: < 5% (预期)
```

## 部署方式

### 生产环境（推荐）

**直接部署，无需配置环境变量**：

```bash
# 1. 拉取最新代码
git pull

# 2. 重新构建
docker-compose build

# 3. 重启服务
docker-compose up -d

# 4. 验证日志
docker logs -f autobb-app-1 | grep -E "\[ClickFarm\]|\[BatchExecutor\]|\[Trigger\]"
```

### 开发环境

```bash
# 重启开发服务器
npm run dev
```

## 验证方法

### 1. 检查failed_clicks数据

```sql
SELECT
  id,
  daily_click_count,
  total_clicks,
  success_clicks,
  failed_clicks,
  ROUND(100.0 * failed_clicks / NULLIF(total_clicks, 0), 2) as fail_rate
FROM click_farm_tasks
WHERE daily_click_count >= 200
ORDER BY daily_click_count DESC;
```

### 2. 监控内存使用

```bash
# 使用监控脚本
node scripts/monitor_memory.js

# 查看容器统计
docker stats autobb-app-1 --no-stream

# 查看日志
docker logs -f autobb-app-1 | grep -i "memory\|pressure"
```

### 3. 观察缺失率

**修复前** (预期):
- 缺失率: 15.5%
- failed_clicks: 较高
- 日志中有大量内存压力警告

**修复后** (预期):
- 缺失率: < 5%
- failed_clicks: 显著降低
- 内存压力警告减少

## 监控计划

| 阶段 | 时间 | 任务 |
|------|------|------|
| 数据收集 | 第1-3天 | 每天检查failed_clicks、监控内存、收集日志 |
| 效果评估 | 第4-7天 | 对比修复前后缺失率、确认根因 |
| 稳定观察 | 第8-14天 | 持续监控、确保效果稳定 |

## 回滚方案

如果修复后出现问题，可以回滚代码：

```bash
# 回滚到修复前的commit
git revert HEAD

# 重新构建部署
docker-compose build
docker-compose up -d
```

或者通过环境变量覆盖默认值：

```bash
CLICK_FARM_EXECUTOR_HEAP_PRESSURE_PCT=80
CLICK_FARM_BATCH_HEAP_PRESSURE_PCT=82
CLICK_FARM_BATCH_SIZE=20
CLICK_FARM_BATCH_DELAY_MS=200
```

## 相关文件

### 核心代码
- `src/lib/queue/executors/click-farm-executor.ts` - 执行器
- `src/lib/queue/executors/click-farm-batch-executor.ts` - 批次分发器
- `src/lib/click-farm/click-farm-scheduler-trigger.ts` - 调度器

### 工具脚本
- `scripts/monitor_memory.js` - 内存监控脚本

### 文档
- `CLICK_FARM_FIX_MISSING_CLICKS.md` - 完整修复说明
- `.env.production.example` - 生产环境配置示例

## 技术细节

### 内存压力计算

```typescript
const heapUsed = process.memoryUsage().heapUsed
const limit = getHeapStatistics().heap_size_limit
const percentage = (heapUsed / limit) * 100

if (percentage >= THRESHOLD) {
  // 触发保护机制
}
```

### 批次分发流程（修复后）

```
调度器 (每小时整点)
  ↓
创建批次任务 (totalClicks=75, dispatchedClicks=0)
  ↓
批次分发器
  ↓
第1批: 入队10个 (dispatchedClicks=10, remaining=65)
  ↓ 延迟500ms
第2批: 入队10个 (dispatchedClicks=20, remaining=55)
  ↓ 延迟500ms
第3批: 入队10个 (dispatchedClicks=30, remaining=45)
  ↓ 延迟500ms
第4批: 入队10个 (dispatchedClicks=40, remaining=35)
  ↓ 延迟500ms
第5批: 入队10个 (dispatchedClicks=50, remaining=25)
  ↓ 延迟500ms
第6批: 入队10个 (dispatchedClicks=60, remaining=15)
  ↓ 延迟500ms
第7批: 入队10个 (dispatchedClicks=70, remaining=5)
  ↓ 延迟500ms
第8批: 入队5个 (dispatchedClicks=75, remaining=0)
  ↓
完成 (总耗时: 3500ms)
```

### 内存压力对比

**修复前**:
```
批次大小: 20
批次间隔: 200ms
峰值并发: 20个HTTP + 60个待处理任务
内存压力: 快速上升，易超过80%
```

**修复后**:
```
批次大小: 10
批次间隔: 500ms
峰值并发: 20个HTTP + 30个待处理任务
内存压力: 平滑上升，不易超过90%
```

---

**修复时间**: 2026-03-09
**修复人员**: Claude Code
**预计生效**: 部署后立即生效
**完整效果**: 需观察3-7天
