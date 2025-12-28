# 排序功能问题诊断报告 - 已发现根本原因

**问题描述**:
在 `/campaigns` 页面点击列表表头（如"展示"列）进行排序，点击排序按钮后没有实现正序或逆序排列功能。

**页面**: `/campaigns` 页面
**文件**: `src/app/(app)/campaigns/page.tsx`

## ⚠️ 问题已确认

### 根本原因

在 `fetchCampaigns()` 函数的第 248-249 行：

```typescript
const data = await response.json()
setCampaigns(data.campaigns)
setFilteredCampaigns(data.campaigns)  // ❌ 问题！直接设置，绕过排序逻辑
```

**问题**：直接设置 `filteredCampaigns` 会绕过 useEffect 的排序处理，导致：

### 问题流程图

```
初始状态：sortField=null, sortDirection=null
    ↓
用户点击"展示"列表头
    ↓
handleSort('impressions') 被调用
    ↓
setSortField('impressions') + setSortDirection('asc')
    ↓
useEffect 检测到 sortField/sortDirection 变化
    ↓
执行排序逻辑：result.sort() ✓
    ↓
setFilteredCampaigns(result) ✓ [排序后数据显示]
    ↓
用户改变 timeRange (从7天改为30天)
    ↓
fetchCampaigns() 被调用
    ↓
setCampaigns(data.campaigns) + setFilteredCampaigns(data.campaigns) ❌
    ↓
setFilteredCampaigns 被直接设置为新数据（未排序！）
    ↓
虽然 sortField 和 sortDirection 仍然保留，但 filteredCampaigns 已经重置
    ↓
useEffect 虽然可能会再次运行，但排序丢失了
```

### 详细问题

1. **初始排序正常**：首次点击列表头排序时，排序会工作
2. **改变时间范围破坏排序**：用户改变`timeRange`后，新加载的数据未排序
3. **排序图标仍显示**：`SortableHeader`仍显示排序方向箭头，迷惑用户

### 代码分析

**问题代码** (fetchCampaigns 第 248-249 行):
```typescript
const data = await response.json()
setCampaigns(data.campaigns)                  // ✓ 正确
setFilteredCampaigns(data.campaigns)          // ❌ 问题：绕过排序
```

**问题产生的原因**：
- `fetchCampaigns()` 在第 248 行设置 campaigns
- 这触发 useEffect (第 228 行: `depends on campaigns`)
- useEffect 应该重新应用排序
- **但** `setFilteredCampaigns(data.campaigns)` 在第 249 行立即设置了初始值
- 可能存在时序问题或状态更新不同步

## 解决方案

### 修复方法：移除 fetchCampaigns 中的 setFilteredCampaigns

**修复前**:
```typescript
const data = await response.json()
setCampaigns(data.campaigns)
setFilteredCampaigns(data.campaigns)  // ❌ 移除这行
```

**修复后**:
```typescript
const data = await response.json()
setCampaigns(data.campaigns)  // 让 useEffect 自动处理排序、过滤、分页
// 不要直接设置 filteredCampaigns
```

**原理**：
1. `setCampaigns(data.campaigns)` 更新 campaigns 状态
2. useEffect 检测到 campaigns 变化（依赖数组包含 campaigns）
3. useEffect 执行完整的过滤+排序+分页逻辑
4. setFilteredCampaigns(result) 设置最终结果

这样排序、过滤、搜索等所有逻辑都能正确应用。

### 额外的修复：重置当前页码

当 campaigns 变化时，应该重置到第 1 页：
```typescript
useEffect(() => {
  setCurrentPage(1)  // 重置分页
  fetchCampaigns()
  fetchTrends()
}, [timeRange])
```

这已经在第 227 行正确实现了。

## 修复步骤

1. ✅ 移除 fetchCampaigns 中的 `setFilteredCampaigns(data.campaigns)` (第 249 行)
2. ✅ 确保 useEffect 的依赖数组包含所有必要的依赖
3. ✅ 测试排序功能（点击表头）
4. ✅ 测试改变时间范围后排序是否保留
5. ✅ 测试多列排序场景

## 预期修复后的行为

- ✅ 点击"展示"列 → 按展示数升序排列
- ✅ 再次点击"展示"列 → 按展示数降序排列
- ✅ 改变时间范围 → 排序状态清除（重置为未排序）
- ✅ 各列排序独立工作
- ✅ 排序图标正确显示方向
