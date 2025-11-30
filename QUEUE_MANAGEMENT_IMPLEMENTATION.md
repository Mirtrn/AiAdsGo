# 队列管理系统实现文档

## 📋 实现概述

**实现日期**: 2025-11-30
**功能**: 批量上传Offer时的队列管理和并发限制
**目标**: 防止服务器过载，优化资源利用

---

## 🎯 核心功能

### 1. 全局并发限制

防止所有用户的总并发数超过服务器承载能力

**默认值**: CPU核心数 × 2（例如：8核 → 16并发）

**配置项**: `globalConcurrency`

### 2. 单用户并发限制

防止单个用户占用过多资源

**默认值**: 全局并发 ÷ 4（例如：16 → 4并发/用户）

**配置项**: `perUserConcurrency`

### 3. 优先级队列

支持任务优先级（1-10，数字越大优先级越高）

**默认优先级**: 5

**配置项**: `enablePriority`

### 4. 动态配置

根据机器配置（CPU核心数、内存）自动计算推荐并发数

**配置来源**:
1. 机器配置（自动检测）
2. 全局配置（system_settings表）
3. 用户配置（system_settings表，覆盖全局配置）

### 5. 监控统计

实时监控队列状态，包括：
- 全局运行中/队列中/已完成/失败任务数
- 单用户运行中/队列中/已完成/失败任务数
- 当前配置信息

---

## 📁 实现文件

### 1. 队列管理器核心

#### `src/lib/scrape-queue-manager.ts`

**功能**：
- 队列管理（添加、执行、取消任务）
- 并发控制（全局 + 单用户）
- 优先级排序
- 超时处理
- 统计信息

**关键类**：
```typescript
class ScrapeQueueManager {
  // 添加任务到队列
  async addTask(options: TaskOptions, execute: () => Promise<void>): Promise<void>

  // 获取队列统计信息
  getStats(): QueueStats

  // 更新配置
  updateConfig(config: Partial<QueueConfig>): void

  // 清空队列
  clearQueue(userId?: number): number

  // 取消特定任务
  cancelTask(offerId: number): boolean
}
```

**配置接口**：
```typescript
interface QueueConfig {
  globalConcurrency: number      // 全局并发限制
  perUserConcurrency: number     // 单用户并发限制
  maxQueueSize: number           // 队列最大长度
  taskTimeout: number            // 任务超时时间（毫秒）
  enablePriority: boolean        // 是否启用优先级队列
}
```

**默认配置计算**：
```typescript
// 根据CPU核心数和内存动态计算
const cpuCount = os.cpus().length
const totalMemoryGB = os.totalmem() / (1024 ** 3)

// 全局并发 = CPU核心数 * 2（考虑IO密集型任务）
const defaultGlobalConcurrency = Math.max(4, Math.min(cpuCount * 2, 20))

// 单用户并发 = 全局并发 / 4（防止单用户占用过多资源）
const defaultPerUserConcurrency = Math.max(2, Math.floor(defaultGlobalConcurrency / 4))
```

---

### 2. 配置管理

#### `src/lib/queue-config.ts`

**功能**：
- 从 `system_settings` 表读取配置
- 保存配置到数据库
- 初始化默认配置

**关键函数**：
```typescript
// 获取队列配置（优先级：用户配置 > 全局配置 > 默认配置）
function getQueueConfig(userId?: number): Partial<QueueConfig>

// 保存队列配置
function saveQueueConfig(config: Partial<QueueConfig>, userId?: number): void

// 初始化默认配置
function initializeDefaultQueueConfig(): void
```

**数据库表结构**：
```sql
-- system_settings表
CREATE TABLE system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,           -- 'queue'
  config_key TEXT NOT NULL,         -- 'global_concurrency', 'per_user_concurrency', etc.
  config_value TEXT NOT NULL,       -- 配置值
  user_id INTEGER,                  -- NULL表示全局配置，非NULL表示用户配置
  description TEXT,                 -- 配置说明
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category, config_key, user_id)
);
```

**默认配置**：
```sql
INSERT INTO system_settings (category, config_key, config_value, user_id, description) VALUES
  ('queue', 'global_concurrency', '8', NULL, '全局并发限制（所有用户）'),
  ('queue', 'per_user_concurrency', '2', NULL, '单用户并发限制'),
  ('queue', 'max_queue_size', '1000', NULL, '队列最大长度'),
  ('queue', 'task_timeout', '300000', NULL, '任务超时时间（毫秒）'),
  ('queue', 'enable_priority', 'true', NULL, '是否启用优先级队列');
```

---

### 3. 集成到抓取流程

#### `src/lib/offer-scraping.ts`

**修改内容**：

**修改前**：
```typescript
export function triggerOfferScraping(
  offerId: number,
  userId: number,
  url: string,
  brand: string
): void {
  setImmediate(async () => {
    await performScrapeAndAnalysis(offerId, userId, url, brand)
  })
}
```

**修改后**：
```typescript
export function triggerOfferScraping(
  offerId: number,
  userId: number,
  url: string,
  brand: string,
  priority: number = 5  // 新增：优先级参数
): void {
  setImmediate(async () => {
    // 🚀 获取队列管理器（加载用户配置）
    const queueConfig = getQueueConfig(userId)
    const queueManager = getQueueManager(queueConfig)

    // 添加到队列（会自动控制并发）
    await queueManager.addTask(
      { userId, offerId, priority },
      async () => {
        // 更新状态为 in_progress
        updateOfferScrapeStatus(offerId, userId, 'in_progress')

        // 执行抓取
        await performScrapeAndAnalysis(offerId, userId, url, brand)
      }
    )
  })
}
```

**关键改进**：
1. ✅ 添加到队列而不是立即执行
2. ✅ 自动控制并发（全局 + 单用户）
3. ✅ 支持优先级
4. ✅ 自动超时处理
5. ✅ 统计信息收集

---

### 4. 监控API

#### `src/app/api/queue/stats/route.ts`

**功能**：获取队列统计信息

**端点**：`GET /api/queue/stats`

**响应示例**：
```json
{
  "success": true,
  "stats": {
    "global": {
      "running": 5,
      "queued": 12,
      "completed": 123,
      "failed": 3
    },
    "perUser": [
      {
        "userId": 1,
        "running": 2,
        "queued": 5,
        "completed": 50,
        "failed": 1
      },
      {
        "userId": 2,
        "running": 3,
        "queued": 7,
        "completed": 73,
        "failed": 2
      }
    ],
    "config": {
      "globalConcurrency": 8,
      "perUserConcurrency": 2,
      "maxQueueSize": 1000,
      "taskTimeout": 300000,
      "enablePriority": true
    }
  }
}
```

**查询参数**：
- `userId`: 只返回特定用户的统计（可选）

---

#### `src/app/api/queue/config/route.ts`

**功能**：获取和更新队列配置

**端点**：
- `GET /api/queue/config` - 获取配置
- `PUT /api/queue/config` - 更新配置（仅管理员）

**GET响应示例**：
```json
{
  "success": true,
  "config": {
    "globalConcurrency": 8,
    "perUserConcurrency": 2,
    "maxQueueSize": 1000,
    "taskTimeout": 300000,
    "enablePriority": true
  }
}
```

**PUT请求示例**：
```json
{
  "globalConcurrency": 16,
  "perUserConcurrency": 4
}
```

**PUT响应示例**：
```json
{
  "success": true,
  "message": "配置已更新",
  "config": {
    "globalConcurrency": 16,
    "perUserConcurrency": 4
  }
}
```

---

## 🔄 工作流程

### 批量上传流程（带队列管理）

```
用户上传CSV文件
    ↓
【1-2秒】验证CSV + 创建Offer记录
    ↓
【立即返回】显示创建成功摘要
    ↓
【后台】每个Offer调用 triggerOfferScraping()
    ↓
【队列管理器】检查并发限制
    ├─ 全局并发已满？→ 加入队列等待
    ├─ 用户并发已满？→ 加入队列等待
    └─ 有空闲槽位？→ 立即执行
    ↓
【执行任务】
  1. 更新状态为 in_progress
  2. 执行完整抓取流程
  3. 更新状态为 completed/failed
    ↓
【任务完成】
  - 释放并发槽位
  - 尝试执行队列中的下一个任务
  - 更新统计信息
```

### 并发控制示例

**场景**：
- 全局并发限制：8
- 单用户并发限制：2
- 用户A上传10个Offer
- 用户B上传10个Offer

**执行过程**：
```
时刻T0：
  运行中：0
  队列：用户A(10) + 用户B(10) = 20

时刻T1（开始执行）：
  运行中：用户A(2) + 用户B(2) = 4
  队列：用户A(8) + 用户B(8) = 16

时刻T2（达到全局限制）：
  运行中：用户A(2) + 用户B(2) + 用户C(2) + 用户D(2) = 8
  队列：用户A(8) + 用户B(8) + 用户C(8) + 用户D(8) = 32

时刻T3（用户A完成1个任务）：
  运行中：用户A(2) + 用户B(2) + 用户C(2) + 用户D(2) = 8
  队列：用户A(7) + 用户B(8) + 用户C(8) + 用户D(8) = 31
  说明：用户A立即从队列中取出1个任务执行
```

---

## 📊 性能优化

### 1. 动态并发调整

**根据机器配置自动调整**：

| CPU核心数 | 内存 | 推荐全局并发 | 推荐单用户并发 |
|----------|------|------------|--------------|
| 2核 | 4GB | 4 | 1 |
| 4核 | 8GB | 8 | 2 |
| 8核 | 16GB | 16 | 4 |
| 16核 | 32GB | 20 (上限) | 5 |

### 2. 优先级队列

**优先级规则**：
1. 优先级高的任务优先执行
2. 优先级相同时，先添加的优先执行

**使用场景**：
- 手动创建的Offer：优先级 8（高）
- 批量上传的Offer：优先级 5（中）
- 后台重试的Offer：优先级 3（低）

### 3. 超时处理

**默认超时**：5分钟（300000ms）

**超时后**：
- 任务标记为失败
- 释放并发槽位
- 执行下一个任务

---

## 🎯 使用示例

### 1. 批量上传（自动使用队列）

```typescript
// src/app/api/offers/batch/route.ts
for (const offerData of offers) {
  const offer = createOffer(userId, offerData)

  // 自动添加到队列，控制并发
  triggerOfferScraping(
    offer.id,
    userId,
    offer.url,
    offer.brand,
    5 // 优先级：中
  )
}
```

### 2. 手动创建（高优先级）

```typescript
// src/app/api/offers/route.ts
const offer = createOffer(userId, input)

// 高优先级，优先执行
triggerOfferScraping(
  offer.id,
  userId,
  offer.url,
  offer.brand,
  8 // 优先级：高
)
```

### 3. 获取队列统计

```typescript
// 前端代码
const response = await fetch('/api/queue/stats')
const data = await response.json()

console.log('全局运行中:', data.stats.global.running)
console.log('全局队列中:', data.stats.global.queued)
console.log('当前配置:', data.stats.config)
```

### 4. 更新配置（管理员）

```typescript
// 前端代码
const response = await fetch('/api/queue/config', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    globalConcurrency: 16,
    perUserConcurrency: 4,
  }),
})

const data = await response.json()
console.log('配置已更新:', data.config)
```

---

## 🔍 监控和调试

### 1. 日志输出

**队列管理器日志**：
```
[QueueManager] 初始化队列管理器: { globalConcurrency: 8, perUserConcurrency: 2, ... }
[QueueManager] 机器配置: CPU=8核, 内存=16.00GB
[QueueManager] 推荐并发: 全局=16, 单用户=4
[QueueManager] 添加任务: Offer #123, 用户 #1, 优先级 5, 队列长度 1
[QueueManager] 开始执行任务: Offer #123, 用户 #1
[QueueManager] 当前状态: 全局运行 1/8, 队列 0
[QueueManager] ✅ 任务完成: Offer #123, 耗时 45000ms
```

**配置加载日志**：
```
[QueueConfig] 加载配置 (userId=1): { perUserConcurrency: 2, taskTimeout: 300000 }
[QueueConfig] 保存配置成功 (userId=undefined): { globalConcurrency: 16 }
```

### 2. 监控面板（未来）

**建议实现**：
- 实时队列状态图表
- 每个用户的并发使用情况
- 任务完成率和失败率
- 平均任务执行时间

---

## ⚠️ 注意事项

### 1. 并发限制建议

**不要设置过高**：
- 全局并发过高会导致服务器过载
- 单用户并发过高会影响其他用户

**推荐值**：
- 全局并发：CPU核心数 × 2
- 单用户并发：全局并发 ÷ 4

### 2. 队列长度限制

**默认值**：1000

**超过限制**：
- 新任务会被拒绝
- 返回错误："队列已满"

**建议**：
- 监控队列长度
- 及时清理失败任务
- 增加并发数或优化任务执行时间

### 3. 超时时间设置

**默认值**：5分钟（300000ms）

**建议**：
- 根据实际抓取时间调整
- 不要设置过短（会导致任务频繁超时）
- 不要设置过长（会占用并发槽位）

---

## 🐛 故障排查

### 问题1：任务一直在队列中，不执行

**可能原因**：
1. 全局并发已满
2. 用户并发已满
3. 所有用户的并发都已满

**解决方法**：
1. 检查队列统计：`GET /api/queue/stats`
2. 增加并发数：`PUT /api/queue/config`
3. 清空队列：`queueManager.clearQueue()`

### 问题2：任务频繁超时

**可能原因**：
1. 超时时间设置过短
2. 网络慢或AI API响应慢
3. 任务执行逻辑有问题

**解决方法**：
1. 增加超时时间：`PUT /api/queue/config`
2. 优化抓取逻辑
3. 检查网络和API状态

### 问题3：队列已满

**可能原因**：
1. 并发数过低，任务堆积
2. 任务执行时间过长
3. 大量失败任务未清理

**解决方法**：
1. 增加并发数
2. 优化任务执行时间
3. 清空队列：`queueManager.clearQueue()`

---

## 📈 性能指标

### 1. 吞吐量

**定义**：每分钟完成的任务数

**计算**：
```typescript
const throughput = stats.globalCompleted / (Date.now() - startTime) * 60000
console.log(`吞吐量: ${throughput.toFixed(2)} 任务/分钟`)
```

**优化目标**：
- 8核服务器：~10-20 任务/分钟
- 16核服务器：~20-40 任务/分钟

### 2. 平均任务时间

**定义**：每个任务的平均执行时间

**计算**：
```typescript
const avgTime = totalTime / stats.globalCompleted
console.log(`平均任务时间: ${(avgTime / 1000).toFixed(2)} 秒`)
```

**优化目标**：
- 理想：30-60秒/任务
- 可接受：60-120秒/任务
- 需优化：>120秒/任务

### 3. 失败率

**定义**：失败任务占总任务的比例

**计算**：
```typescript
const failureRate = stats.globalFailed / (stats.globalCompleted + stats.globalFailed) * 100
console.log(`失败率: ${failureRate.toFixed(2)}%`)
```

**优化目标**：
- 理想：<5%
- 可接受：5-10%
- 需优化：>10%

---

## 🚀 未来优化方向

### 短期优化（P1）

1. **添加队列监控面板**
   - 实时显示队列状态
   - 图表展示并发使用情况
   - 任务完成率和失败率

2. **优化优先级算法**
   - 考虑任务等待时间
   - 防止低优先级任务饿死

3. **添加任务重试机制**
   - 失败任务自动重试
   - 指数退避策略

### 中期优化（P2）

1. **分布式队列**
   - 使用Redis实现分布式队列
   - 支持多服务器负载均衡

2. **智能调度**
   - 根据服务器负载动态调整并发数
   - 根据任务类型分配资源

3. **任务分组**
   - 批量任务分组执行
   - 减少数据库查询次数

### 长期优化（P3）

1. **机器学习优化**
   - 预测任务执行时间
   - 智能分配并发资源

2. **自动扩缩容**
   - 根据队列长度自动扩容
   - 空闲时自动缩容

3. **多级队列**
   - 快速队列（<30秒任务）
   - 慢速队列（>30秒任务）
   - 超长队列（>5分钟任务）

---

## ✨ 总结

### 实现成果

1. ✅ **全局并发限制**
   - 防止服务器过载
   - 根据机器配置自动调整

2. ✅ **单用户并发限制**
   - 防止单用户占用过多资源
   - 保证多用户公平性

3. ✅ **优先级队列**
   - 支持任务优先级
   - 重要任务优先执行

4. ✅ **动态配置**
   - 支持全局配置和用户配置
   - 实时更新，无需重启

5. ✅ **监控统计**
   - 实时监控队列状态
   - 提供API查询统计信息

### 技术亮点

1. ✅ **单例模式**
   - 全局唯一的队列管理器实例
   - 避免资源浪费

2. ✅ **优先级排序**
   - 自动按优先级和添加时间排序
   - 确保重要任务优先执行

3. ✅ **超时处理**
   - 自动检测任务超时
   - 释放资源，执行下一个任务

4. ✅ **统计信息**
   - 实时统计全局和单用户数据
   - 支持监控和调试

5. ✅ **配置持久化**
   - 配置保存到数据库
   - 支持全局和用户级配置

---

**实现状态**: ✅ 已完成
**测试状态**: ⏳ 待测试
**部署状态**: ⏳ 待部署

**实现人员**: Claude Code
**审核人员**: 待审核
**批准人员**: 待批准
