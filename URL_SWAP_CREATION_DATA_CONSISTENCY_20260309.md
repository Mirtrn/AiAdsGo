# 换链接任务创建和首次执行的数据口径说明

**日期**: 2026-03-09
**问题**: 第一次创建换链接任务时，统计数据会计为1次，那历史记录的口径呢？

---

## 📊 任务创建流程

### 1. 创建任务时（初始化）

**代码位置**: `src/lib/url-swap.ts:138-170`

**初始值**:
```typescript
progress: 0
total_swaps: 0
success_swaps: 0
failed_swaps: 0
url_changed_count: 0
swap_history: []  // 空数组
```

**说明**:
- ✅ 创建任务时，所有统计计数器都初始化为 **0**
- ✅ 历史记录初始化为 **空数组 []**
- ✅ 数据口径一致

### 2. 首次执行时

**触发时机**:
- 任务创建后，根据 `next_swap_at` 时间，由调度器触发首次执行
- 或者用户手动触发执行

**执行逻辑**:
1. 解析 URL（如果是自动模式）
2. 更新 Google Ads
3. 更新统计计数器: `total_swaps = 1`, `success_swaps = 1`（如果成功）
4. 记录历史: `swap_history.push({...})`

**预期结果**:
- ✅ `total_swaps = 1`
- ✅ `success_swaps = 1`
- ✅ `swap_history.length = 1`
- ✅ 数据口径一致

---

## 🔍 实际案例分析

### 任务 ID: b9467b70-4ed5-42cc-9be0-36f0ff32b728

**数据**:
```
created_at: 2026-03-08 13:32:34
started_at: 2026-03-08 13:32:34
total_swaps: 6
success_swaps: 5
failed_swaps: 1
history_count: 1
```

**分析**:
1. 任务创建时间 = 开始时间，说明创建后立即开始执行
2. 执行了 6 次（5次成功 + 1次失败）
3. 但历史记录只有 1 条（最后那次失败的）

**问题**:
- ❌ 前 5 次成功执行时，有些没有记录到历史中
- ❌ 数据口径不一致

**原因**:
- 当 URL 未变化时，成功执行不记录历史（已在之前修复）

---

## ✅ 修复后的预期行为

### 创建任务

```
total_swaps: 0
success_swaps: 0
failed_swaps: 0
swap_history: []
```

### 第1次执行（成功）

```
total_swaps: 1
success_swaps: 1
failed_swaps: 0
swap_history: [
  {success: true, swapped_at: "...", ...}
]
```

### 第2次执行（成功，URL未变化）

**修复前**:
```
total_swaps: 2
success_swaps: 2
failed_swaps: 0
swap_history: [
  {success: true, swapped_at: "...", ...}
]  // ❌ 没有新增记录
```

**修复后**:
```
total_swaps: 2
success_swaps: 2
failed_swaps: 0
swap_history: [
  {success: true, swapped_at: "...", ...},
  {success: true, swapped_at: "...", ...}  // ✅ 新增记录
]
```

### 第3次执行（失败）

```
total_swaps: 3
success_swaps: 2
failed_swaps: 1
swap_history: [
  {success: true, swapped_at: "...", ...},
  {success: true, swapped_at: "...", ...},
  {success: false, error_message: "...", ...}  // ✅ 新增失败记录
]
```

---

## 📝 关键要点

### 1. 创建任务时不计入统计

- ✅ 创建任务时，统计计数器初始化为 **0**
- ✅ 历史记录初始化为 **空数组**
- ✅ **不会**计为1次执行

### 2. 首次执行时才计入统计

- ✅ 首次执行时，`total_swaps` 从 0 变为 1
- ✅ 首次执行时，`swap_history` 从 [] 变为 [1条记录]
- ✅ 数据口径一致

### 3. 每次执行都应该记录

- ✅ 无论成功失败
- ✅ 无论 URL 是否变化
- ✅ 确保 `total_swaps = swap_history.length`

---

## 🧪 验证方法

### 创建新任务后验证

```sql
-- 1. 创建任务后立即查询
SELECT total_swaps, success_swaps, failed_swaps,
       jsonb_array_length(swap_history) as history_count
FROM url_swap_tasks
WHERE id = '<新任务ID>';

-- 预期结果：
-- total_swaps = 0
-- success_swaps = 0
-- failed_swaps = 0
-- history_count = 0

-- 2. 首次执行后查询
SELECT total_swaps, success_swaps, failed_swaps,
       jsonb_array_length(swap_history) as history_count
FROM url_swap_tasks
WHERE id = '<新任务ID>';

-- 预期结果：
-- total_swaps = 1
-- success_swaps = 1 (如果成功) 或 failed_swaps = 1 (如果失败)
-- history_count = 1
```

---

## ✅ 总结

### 问题澄清

用户问："第一次创建换链接任务时，统计数据会计为1次，那历史记录的口径呢？"

### 答案

**创建任务时**:
- ❌ 统计数据**不会**计为1次，初始值为 **0**
- ❌ 历史记录**不会**有1条，初始值为 **空数组 []**

**首次执行时**:
- ✅ 统计数据计为1次: `total_swaps = 1`
- ✅ 历史记录有1条: `swap_history.length = 1`
- ✅ 数据口径一致

### 修复效果

修复后，确保：
- ✅ 每次执行都更新统计计数器
- ✅ 每次执行都记录到历史中
- ✅ `total_swaps = swap_history.length`（数据口径一致）

---

**说明人**: Claude
**完成时间**: 2026-03-09
