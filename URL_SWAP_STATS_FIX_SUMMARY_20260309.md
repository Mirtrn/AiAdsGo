# 换链接任务统计数据口径修复总结

**日期**: 2026-03-09
**问题**: 统计计数器显示"总执行6次，成功5次"，但历史记录只有1条
**状态**: ✅ 已修复

---

## 🔍 问题根源

**统计计数器** 和 **换链历史** 的更新逻辑不一致：

- **统计计数器**: 每次执行都更新（无论 URL 是否变化）
- **换链历史**: 只在 URL 变化或失败时记录

导致：当 URL 未变化时，成功执行会更新计数器，但不记录历史。

---

## 🔧 修复内容

### 修改文件

`src/lib/queue/executors/url-swap-executor.ts`

### 修改位置

第475-482行（手动模式 URL 未变化时）

### 修改前

```typescript
} else {
  const hasUpdates = targetsToUpdate.length > 0
  const hasSuccess = (updateResult?.successCount ?? 0) > 0
  if (hasUpdates && !hasSuccess) {
    throw new Error('Google Ads 更新失败（所有目标均未更新成功）')
  }
  await updateTaskAfterManualAdvance(taskId, nextCursor)  // ❌ 没有记录历史
}
```

### 修改后

```typescript
} else {
  const hasUpdates = targetsToUpdate.length > 0
  const hasSuccess = (updateResult?.successCount ?? 0) > 0
  if (hasUpdates && !hasSuccess) {
    throw new Error('Google Ads 更新失败（所有目标均未更新成功）')
  }

  // 🔥 修复：即使 URL 未变化，也记录历史，确保统计数据口径一致
  await recordSwapHistory(taskId, {
    swapped_at: new Date().toISOString(),
    previous_final_url: currentUrlFromDb,
    previous_final_url_suffix: currentSuffixFromDb,
    new_final_url: resolved.finalUrl,
    new_final_url_suffix: resolved.finalUrlSuffix,
    success: true
  })

  await updateTaskAfterManualAdvance(taskId, nextCursor)
}
```

---

## ✅ 修复效果

### 修复前

| 场景 | 统计计数器 | 换链历史 | 一致性 |
|------|----------|---------|--------|
| URL 变化（成功） | ✅ 更新 | ✅ 记录 | ✅ 一致 |
| URL 未变化（成功） | ✅ 更新 | ❌ 不记录 | ❌ 不一致 |
| 执行失败 | ✅ 更新 | ✅ 记录 | ✅ 一致 |

### 修复后

| 场景 | 统计计数器 | 换链历史 | 一致性 |
|------|----------|---------|--------|
| URL 变化（成功） | ✅ 更新 | ✅ 记录 | ✅ 一致 |
| URL 未变化（成功） | ✅ 更新 | ✅ 记录 | ✅ 一致 |
| 执行失败 | ✅ 更新 | ✅ 记录 | ✅ 一致 |

---

## 🧪 验证方法

### SQL 验证

```sql
SELECT
  id,
  total_swaps,
  success_swaps,
  failed_swaps,
  jsonb_array_length(swap_history) as history_count
FROM url_swap_tasks
WHERE id = 'b9467b70-4ed5-42cc-9be0-36f0ff32b728';
```

**预期结果**:
```
total_swaps = history_count
success_swaps + failed_swaps = total_swaps
```

### 前端验证

1. 查看任务详情页的统计数据
2. 查看"换链历史记录"
3. 确认两者数据一致

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

## 📝 相关文档

- `URL_SWAP_STATS_INCONSISTENCY_FIX_20260309.md` - 详细问题分析

---

**问题发现**: 用户
**分析**: Claude
**修复**: Claude
**完成时间**: 2026-03-09
**状态**: ✅ 已完成，待部署验证
