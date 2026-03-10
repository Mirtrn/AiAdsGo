# 日期范围选择器优化

## 问题描述

在多个页面的自定义时间选择功能中存在两个用户体验问题：

1. **页面跳动问题**：用户选择开始日期后，页面会自动打开结束日期选择器，导致页面"跳一下"，用户体验不佳
2. **缺少日期范围预览**：使用原生 `<input type="date">` 控件，无法在选择结束日期时显示淡淡的背景来预览日期区间

## 受影响的页面

以下页面已修复：

- ✅ `/campaigns` - CampaignsClientPage.tsx（已完成优化）
- ✅ `/dashboard` - DashboardClientPage.tsx（已完成优化）
- ✅ `/creatives` - page.tsx（已完成优化）
- ⚠️ `/analytics/roi` - page.tsx（需要完成修复）
- ⚠️ `/analytics/budget` - page.tsx（需要完成修复）

其他页面（products, openclaw, strategy-center, admin/users, campaigns/new, test/campaign-params）使用了 `type="date"` 但可能不需要修复，需要进一步确认。

## 解决方案

### 1. 快速修复（已完成）
- 移除了 `handleCustomStartDateChange` 函数中自动打开结束日期选择器的逻辑
- 让用户自主决定何时选择结束日期，避免页面跳动

### 2. 完整解决方案（已完成）
- 安装了 `react-day-picker` 和 `date-fns` 库
- 创建了新的 `DateRangePicker` 组件 (`src/components/ui/date-range-picker.tsx`)
- 创建了 `Popover` 组件 (`src/components/ui/popover.tsx`)
- 更新了受影响的页面使用新的日期范围选择器

### 3. 进一步优化（✨ 新增）

#### 快捷日期范围选项
在日期选择器左侧添加了快捷选择面板：
- 今天
- 昨天
- 最近7天
- 最近30天
- 本月
- 上月

#### 清除按钮
- 选择日期后，按钮右侧显示 X 图标
- 点击可快速清除已选择的日期范围

#### 日期限制
- 添加 `maxDate` 属性，防止选择未来日期
- 添加 `minDate` 属性，可限制最早可选日期
- 禁用的日期显示为灰色且不可点击

#### 代码清理
- 移除了废弃的空函数（`openNativeDatePicker`, `openTrendCustomDateRange`, `handleCustomStartDateChange`, `handleCustomEndDateChange`）
- 代码更简洁，易于维护

## 新功能特性

### 基础功能
1. **日期范围预览**：
   - 选择开始日期后，鼠标悬浮在其他日期上会显示淡淡的背景，预览日期区间
   - 使用 `day_range_middle` 样式类实现中间日期的背景高亮

2. **更好的用户体验**：
   - 双月份显示，方便跨月选择
   - 中文本地化支持
   - 选择完整日期范围后自动关闭弹窗
   - 与现有按钮样式保持一致

3. **无页面跳动**：
   - 使用 Popover 弹窗，不会触发页面重排
   - 流畅的动画过渡

### 增强功能（✨ 新增）
4. **快捷选择**：
   - 左侧快捷选择面板，一键选择常用日期范围
   - 支持自定义快捷选项

5. **清除功能**：
   - 一键清除已选择的日期范围
   - 可通过 `showClearButton` 属性控制显示

6. **日期限制**：
   - 防止选择无效日期（如未来日期）
   - 提升数据准确性

7. **可配置性**：
   - `showPresets` - 控制是否显示快捷选择面板
   - `showClearButton` - 控制是否显示清除按钮
   - `maxDate` / `minDate` - 限制可选日期范围

## 技术实现

### 依赖包
```json
{
  "react-day-picker": "^8.x",
  "date-fns": "^2.x",
  "@radix-ui/react-popover": "^1.x"
}
```

### 核心组件

#### DateRangePicker Props
```typescript
interface DateRangePickerProps {
  value?: DateRange                    // 当前选中的日期范围
  onChange?: (range: DateRange | undefined) => void  // 日期变化回调
  placeholder?: string                 // 占位文本
  className?: string                   // 自定义样式类
  variant?: 'default' | 'ghost'       // 按钮变体
  size?: 'default' | 'sm' | 'lg'      // 按钮尺寸
  maxDate?: Date                       // 最大可选日期
  minDate?: Date                       // 最小可选日期
  showPresets?: boolean                // 是否显示快捷选择（默认 true）
  showClearButton?: boolean            // 是否显示清除按钮（默认 true）
}
```

#### 样式优化
- 日期范围中间的日期使用 `bg-accent/50` 显示淡淡的背景
- 开始和结束日期使用 `bg-primary` 高亮显示
- 今天的日期使用 `bg-accent` 和粗体字体标识
- 悬浮效果使用 `hover:bg-accent`
- 禁用日期使用 `opacity-50` 和 `cursor-not-allowed`

## 修改模式

对于每个受影响的页面，需要进行以下修改：

### 1. 添加导入
```tsx
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'
```

### 2. 更新状态
```tsx
// 移除
const [customStartDate, setCustomStartDate] = useState('')
const [customEndDate, setCustomEndDate] = useState('')
const customStartDateInputRef = useRef<HTMLInputElement | null>(null)
const customEndDateInputRef = useRef<HTMLInputElement | null>(null)

// 添加
const [dateRange, setDateRange] = useState<DateRange | undefined>()
```

### 3. 更新处理函数
```tsx
const handleDateRangeChange = (range: DateRange | undefined) => {
  if (!range?.from || !range?.to) {
    setDateRange(range)
    return
  }

  const startDate = formatDateInputValue(range.from)
  const endDate = formatDateInputValue(range.to)

  if (startDate > endDate) {
    showError('时间范围无效', '结束日期不能早于开始日期')
    return
  }

  setDateRange(range)
  setAppliedCustomRange({
    startDate,
    endDate,
  })
  setTimeRange('custom')
}

// 移除废弃函数
// - openNativeDatePicker
// - openTrendCustomDateRange / openCustomRange
// - handleCustomStartDateChange
// - handleCustomEndDateChange
```

### 4. 替换 UI
```tsx
<DateRangePicker
  value={dateRange}
  onChange={handleDateRangeChange}
  placeholder={customRangeLabel}
  variant={timeRange === 'custom' ? 'default' : 'ghost'}
  size="sm"
  maxDate={new Date()}              // 防止选择未来日期
  showPresets={true}                // 显示快捷选择
  showClearButton={true}            // 显示清除按钮
  className="w-auto"
/>
```

## 使用示例

### 基础用法
```tsx
<DateRangePicker
  value={dateRange}
  onChange={handleDateRangeChange}
  placeholder="选择日期范围"
/>
```

### 完整配置
```tsx
<DateRangePicker
  value={dateRange}
  onChange={handleDateRangeChange}
  placeholder="自定义"
  variant="ghost"
  size="sm"
  maxDate={new Date()}              // 不能选择未来日期
  minDate={new Date('2024-01-01')}  // 不能选择2024年之前
  showPresets={true}                // 显示快捷选择
  showClearButton={true}            // 显示清除按钮
/>
```

### 禁用快捷选择
```tsx
<DateRangePicker
  value={dateRange}
  onChange={handleDateRangeChange}
  showPresets={false}  // 不显示快捷选择面板
/>
```

## 测试建议

### 基础功能测试
1. 打开受影响的页面（如 `/campaigns`）
2. 点击"自定义"按钮
3. 选择开始日期
4. 鼠标悬浮在其他日期上，观察日期范围预览效果
5. 选择结束日期，确认弹窗自动关闭
6. 验证选择的日期范围正确应用到数据筛选

### 新增功能测试
7. **快捷选择测试**：
   - 点击左侧快捷选项（如"最近7天"）
   - 验证日期范围正确设置并自动关闭弹窗
   - 验证数据正确刷新

8. **清除按钮测试**：
   - 选择一个日期范围
   - 点击按钮右侧的 X 图标
   - 验证日期范围被清除
   - 验证数据恢复到默认状态

9. **日期限制测试**：
   - 尝试选择未来日期，验证被禁用
   - 验证禁用日期显示为灰色且不可点击
   - 验证只能选择有效日期范围

10. **边界情况测试**：
    - 选择同一天作为开始和结束日期
    - 跨月选择日期范围
    - 选择跨年的日期范围

## 后续工作

### 待完成的页面修复
1. `/analytics/roi` - 需要完成状态更新和UI替换
2. `/analytics/budget` - 需要完成状态更新和UI替换

### 后续优化建议
1. ✅ ~~添加快捷日期范围选项~~ （已完成）
2. ✅ ~~添加清除按钮~~ （已完成）
3. ✅ ~~添加日期限制功能~~ （已完成）
4. ✅ ~~代码清理，移除废弃函数~~ （已完成）
5. 考虑添加时间选择功能（如果需要精确到小时）
6. 添加单元测试覆盖
7. 考虑将日期范围选择器逻辑提取为自定义 Hook，减少代码重复
8. 添加键盘快捷键支持（如 ESC 关闭、方向键导航）
9. 响应式优化：小屏幕显示单月
10. 添加动画效果，提升交互体验

## 性能优化

- 使用 `React.memo` 优化组件渲染
- 快捷选项使用函数生成，避免重复计算
- 日期格式化使用 `date-fns`，性能优于原生方法
- Popover 使用 Portal 渲染，避免影响主文档流

## 可访问性

- 支持键盘导航（Tab、Enter、Space）
- 使用语义化 HTML 标签
- 添加适当的 ARIA 属性
- 禁用状态有明确的视觉反馈
- 支持屏幕阅读器

## 总结

通过这次优化，日期选择器的用户体验得到了显著提升：
- ✅ 解决了页面跳动问题
- ✅ 添加了日期范围预览
- ✅ 提供了快捷选择功能
- ✅ 支持一键清除
- ✅ 添加了日期限制
- ✅ 清理了冗余代码
- ✅ 提升了可配置性

所有修改已通过 TypeScript 类型检查，代码质量和可维护性都得到了提升。

