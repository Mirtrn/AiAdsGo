# 换链接任务统计数据口径不一致问题分析和修复

**日期**: 2026-03-09
**问题**: 换链接任务显示"总执行次数6，成功次数5，失败次数1"，但"换链历史记录"中只显示"失败1 总执行1"

---

## 🔍 问题分析

### 数据库实际数据

任务 ID: `b9467b70-4ed5-42cc-9be0-36f0ff32b728`

```
total_swaps = 6
success_swaps = 5
failed_swaps = 1
swap_history = [1条记录]  // 只有1条失败记录
```

### 根本原因

**统计计数器** 和 **换链历史** 的更新逻辑不一致：

#### 1. 统计计数器（total_swaps, success_swaps, failed_swaps）

**更新时机**: 每次执行都会更新

**代码位置**:
- 成功时: `src/lib/url-swap.ts:1045-1047` (`updateTaskAfterSwap`)
- 失败时: `src/lib/queue/executors/url-swap-executor.ts:768-769` (`updateTaskStats`)

```typescript
// 成功时
UPDATE url_swap_tasks
SET total_swaps = total_swaps + 1,
    success_swaps = success_swaps + 1,
    url_changed_count = url_changed_count + 1
WHERE id = ?

// 失败时
UPDATE url_swap_tasks
SET total_swaps = total_swaps + 1,
    failed_swaps = failed_swaps + 1
WHERE id = ?
```

#### 2. 换链历史（swap_history）

**更新时机**: 只在以下情况记录

**代码位置**: `src/lib/queue/executors/url-swap-executor.ts`

1. **URL 发生变化时**（第465行）:
   ```typescript
   if (urlChanged) {
     await recordSwapHistory(taskId, {
       swapped_at: new Date().toISOString(),
       previous_final_url: currentUrlFromDb,
       previous_final_url_suffix: currentSuffixFromDb,
       new_final_url: resolved.finalUrl,
       new_final_url_suffix: resolved.finalUrlSuffix,
       success: true
     })
   }
   ```

2. **执行失败时**（第708行）:
   ```typescript
   await recordSwapHistory(taskId, {
     swapped_at: new Date().toISOString(),
     previous_final_url: effectiveCurrentFinalUrl || '',
     previous_final_url_suffix: effectiveCurrentFinalUrlSuffix || '',
     new_final_url: '',
     new_final_url_suffix: '',
     success: false,
     error_message: enhancedMessage
   })
   ```

3. **自动模式成功时**（第619行）:
   ```typescript
   await recordSwapHistory(taskId, {
     swapped_at: new Date().toISOString(),
     previous_final_url: effectiveCurrentFinalUrl || '',
     previous_final_url_suffix: effectiveCurrentFinalUrlSuffix || '',
     new_final_url: resolved.finalUrl,
     new_final_url_suffix: resolved.finalUrlSuffix,
     success: true
   })
   ```

**问题**: 当 URL 没有变化时（例如 suffix 相同），成功执行不会记录到 `swap_history`，但会更新统计计数器。

---

## 📊 场景分析

### 场景 1: URL 发生变化（成功）

- ✅ 更新统计计数器: `total_swaps++`, `success_swaps++`
- ✅ 记录换链历史: `swap_history.push({success: true, ...})`
- ✅ 数据一致

### 场景 2: URL 没有变化（成功）

- ✅ 更新统计计数器: `total_swaps++`, `success_swaps++`
- ❌ **不记录换链历史**
- ❌ **数据不一致**

### 场景 3: 执行失败

- ✅ 更新统计计数器: `total_swaps++`, `failed_swaps++`
- ✅ 记录换链历史: `swap_history.push({success: false, error_message: ...})`
- ✅ 数据一致

---

## 🔧 修复方案

### 方案 1: 所有执行都记录历史（推荐）

**修改**: 确保每次执行（无论成功失败、URL是否变化）都记录到 `swap_history`

**优点**:
- 数据口径完全一致
- 历史记录完整
- 便于审计和调试

**缺点**:
- `swap_history` 数据量增加
- 但已有限制（只保留最近100条）

**实施**:

1. 在 `updateTaskAfterManualAdvance` 中添加历史记录
2. 确保所有成功路径都调用 `recordSwapHistory`

---

### 方案 2: 统计计数器只统计有变化的执行

**修改**: 只有 URL 变化时才更新统计计数器

**优点**:
- 数据口径一致
- 统计更有意义（只统计实际换链）

**缺点**:
- 改变现有统计逻辑
- 可能影响现有报表

---

### 方案 3: 前端展示时对齐数据（临时方案）

**修改**: 前端展示时，使用 `swap_history.length` 作为"总执行次数"

**优点**:
- 不需要修改后端逻辑
- 快速修复

**缺点**:
- 治标不治本
- 数据仍然不一致

---

## ✅ 推荐实施方案 1

### 修改位置 1: 手动模式 URL 未变化时

**文件**: `src/lib/queue/executors/url-swap-executor.ts`

**当前代码**（第460-482行）:
```typescript
if (urlChanged) {
  // ... 记录历史
  await recordSwapHistory(taskId, {
    swapped_at: new Date().toISOString(),
    previous_final_url: currentUrlFromDb,
    previous_final_url_suffix: currentSuffixFromDb,
    new_final_url: resolved.finalUrl,
    new_final_url_suffix: resolved.finalUrlSuffix,
    success: true
  })
  await updateTaskAfterSwap(taskId, resolved.finalUrl, resolved.finalUrlSuffix, { manualSuffixCursor: nextCursor })
} else {
  // ❌ 没有记录历史
  await updateTaskAfterManualAdvance(taskId, nextCursor)
}
```

**修改后**:
```typescript
if (urlChanged) {
  await recordSwapHistory(taskId, {
    swapped_at: new Date().toISOString(),
    previous_final_url: currentUrlFromDb,
    previous_final_url_suffix: currentSuffixFromDb,
    new_final_url: resolved.finalUrl,
    new_final_url_suffix: resolved.finalUrlSuffix,
    success: true
  })
  await updateTaskAfterSwap(taskId, resolved.finalUrl, resolved.finalUrlSuffix, { manualSuffixCursor: nextCursor })
} else {
  // 🔥 添加历史记录，即使 URL 未变化
  await recordSwapHistory(taskId, {
    swapped_at: new Date().toISOString(),
    previous_final_url: currentUrlFromDb,
    previous_final_url_suffix: currentSuffixFromDb,
    new_final_url: resolved.finalUrl,
    new_final_url_suffix: resolved.finalUrlSuffix,
    success: true,
    // 可选：添加标记说明 URL 未变化
    // note: 'URL未变化，仅前进游标'
  })
  await updateTaskAfterManualAdvance(taskId, nextCursor)
}
```

---

### 修改位置 2: 自动模式 URL 未变化时

**文件**: `src/lib/queue/executors/url-swap-executor.ts`

需要检查自动模式是否也有类似问题，确保所有成功路径都记录历史。

---

## 📝 数据类型定义

**文件**: `src/lib/url-swap-types.ts`

可以考虑在 `SwapHistoryEntry` 中添加可选字段：

```typescript
export interface SwapHistoryEntry {
  swapped_at: string
  previous_final_url: string
  previous_final_url_suffix: string
  new_final_url: string
  new_final_url_suffix: string
  success: boolean
  error_message?: string
  note?: string  // 🔥 新增：用于记录额外信息（如"URL未变化"）
}
```

---

## 🧪 验证方法

修复后，验证数据一致性：

```sql
-- 查询任务统计
SELECT
  id,
  total_swaps,
  success_swaps,
  failed_swaps,
  jsonb_array_length(swap_history) as history_count
FROM url_swap_tasks
WHERE id = 'b9467b70-4ed5-42cc-9be0-36f0ff32b728';

-- 预期结果：
-- total_swaps = history_count
```

---

## 📊 影响评估

### 数据库影响

- `swap_history` 字段数据量增加
- 但已有限制（只保留最近100条），影响可控

### 性能影响

- 每次执行多一次 `recordSwapHistory` 调用
- 影响极小（只是一次数据库更新）

### 用户体验

- ✅ 数据口径一致
- ✅ 历史记录完整
- ✅ 便于审计和调试

---

## ✅ 总结

**问题**: 统计计数器和换链历史的更新逻辑不一致

**根本原因**: URL 未变化时，成功执行不记录历史

**推荐方案**: 确保每次执行都记录到 `swap_history`

**修改位置**: `src/lib/queue/executors/url-swap-executor.ts`

**影响**: 数据量略增，但数据口径一致，用户体验更好

---

**分析人**: Claude
**完成时间**: 2026-03-09
**状态**: 待实施
