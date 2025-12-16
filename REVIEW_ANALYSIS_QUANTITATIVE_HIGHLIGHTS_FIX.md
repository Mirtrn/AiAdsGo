# 评论分析"量化亮点"增强修复

## 问题描述

生产环境 `/offers/156` 的评论分析中，"量化亮点"数据过于简短：
- 只有3个时间维度数据："10 months"、"1 week"、"each week"
- 缺少性能指标、使用频率、对比数据、满意度等关键量化信息

## 根本原因

`review_analysis` prompt (v3.2) 对"Quantitative Highlights"的描述过于简短：
```
8. **Quantitative Highlights** (NEW - numbers from reviews)
```

没有给出具体示例和提取要求，导致AI只提取了最明显的时间数据。

## 修复方案

### 1. Prompt升级：v3.2 → v3.3

更新 `prompt_versions` 表中的 `review_analysis` prompt，增强"量化亮点"提取指令。

### 2. 新增6大量化亮点类别

#### Performance Metrics（性能指标）
- 电池续航："8 hours", "lasts all day", "3 days on single charge"
- 吸力："2000Pa", "powerful suction", "picks up everything"
- 覆盖面积："2000 sq ft", "whole house", "3 bedrooms"
- 速度/时间："cleans in 30 minutes", "charges in 2 hours"
- 容量："500ml dustbin", "holds a week of dirt"

#### Usage Duration（使用时长）
- "used for 6 months", "owned for 2 years", "after 3 weeks"
- "daily use for 1 year", "10 months flawless operation"

#### Frequency（使用频率）
- "runs 3 times per week", "daily cleaning", "every other day"
- "cleans twice a day", "scheduled for weekdays"

#### Comparison Numbers（对比数据）
- "50% quieter than old one", "2x more powerful"
- "saves 2 hours per week", "replaces $500 vacuum"

#### Satisfaction Metrics（满意度）
- "5 stars", "10/10 recommend", "100% satisfied"
- "would buy again", "best purchase this year"

#### Cost/Value（成本价值）
- "worth every penny", "saved $200", "paid $699"
- "cheaper than competitors", "half the price"

### 3. 输出格式要求

每个量化亮点包含4个字段：
```json
{
  "metric": "Battery Life",
  "value": "8 hours",
  "context": "The battery lasts 8 hours on a single charge, perfect for my whole house",
  "adCopy": "8-Hour Battery Life"
}
```

### 4. 提取目标

- **数量**：从3个增加到 **8-12个量化亮点**
- **覆盖面**：多个维度，不仅限于时间
- **广告就绪**：提供 `adCopy` 字段，可直接用于广告文案

## 修复执行

```sql
UPDATE prompt_versions
SET
  prompt_content = '...(详细的增强prompt)...',
  version = 'v3.3',
  change_notes = 'Enhanced quantitativeHighlights extraction with detailed examples and requirements. Added comprehensive categories: performance metrics, usage duration, frequency, comparisons, satisfaction, cost/value. Increased expected output from 3 to 8-12 highlights.'
WHERE prompt_id = 'review_analysis' AND is_active = true;
```

## 验证结果

```bash
# 查询更新后的prompt版本
SELECT prompt_id, version, change_notes
FROM prompt_versions
WHERE prompt_id = 'review_analysis' AND is_active = true;

# 结果
prompt_id    | version | change_notes
-------------+---------+-------------
review_analysis | v3.3 | Enhanced quantitativeHighlights extraction...
```

## 影响范围

- ✅ 更新 `prompt_versions` 表：review_analysis v3.2 → v3.3
- ✅ 向后兼容：已有数据不受影响
- ✅ 新抓取的评论分析将包含更丰富的量化亮点

## 测试建议

1. **重新抓取 offer 156 的评论分析**
   - 通过"重建Offer"功能触发重新分析
   - 或通过API手动触发评论分析

2. **验证量化亮点数量**
   - 期望：8-12个量化亮点
   - 实际：查询 `offers.review_analysis->>'quantitativeHighlights'`

3. **验证量化亮点类别**
   - 性能指标（Battery Life, Suction Power等）
   - 使用频率（daily, 3 times per week等）
   - 对比数据（50% quieter, 2x more powerful等）
   - 满意度（5 stars, 10/10 recommend等）

## 预期效果

### 修复前（v3.2）
```json
"quantitativeHighlights": [
  {
    "metric": "10 months",
    "context": "The duration of flawless operation reported by a satisfied user."
  },
  {
    "metric": "1 week",
    "context": "The time it took for a new user to realize how much they needed the product."
  },
  {
    "metric": "each week",
    "context": "The frequency of cleaning for a user maintaining their garage floor."
  }
]
```

### 修复后（v3.3）
```json
"quantitativeHighlights": [
  {
    "metric": "Battery Life",
    "value": "8 hours",
    "context": "Battery lasts 8 hours on single charge",
    "adCopy": "8-Hour Battery Life"
  },
  {
    "metric": "Suction Power",
    "value": "12,000Pa",
    "context": "12,000Pa suction picks up everything",
    "adCopy": "Powerful 12,000Pa Suction"
  },
  {
    "metric": "Usage Duration",
    "value": "10 months",
    "context": "10 months of flawless operation",
    "adCopy": "Trusted for 10+ Months"
  },
  {
    "metric": "Cleaning Frequency",
    "value": "3 times per week",
    "context": "Runs 3 times per week automatically",
    "adCopy": "Cleans 3x Weekly"
  },
  {
    "metric": "Time Savings",
    "value": "2 hours per week",
    "context": "Saves 2 hours of manual cleaning per week",
    "adCopy": "Save 2 Hours Weekly"
  },
  {
    "metric": "Satisfaction",
    "value": "5 stars",
    "context": "Rated 5 stars by verified buyers",
    "adCopy": "5-Star Rated"
  },
  {
    "metric": "Value",
    "value": "$699",
    "context": "Worth every penny at $699",
    "adCopy": "Premium Quality at $699"
  },
  {
    "metric": "Coverage",
    "value": "2000 sq ft",
    "context": "Cleans 2000 sq ft in one session",
    "adCopy": "Covers 2000 Sq Ft"
  }
]
```

## 广告文案应用

量化亮点可直接用于：

1. **广告标题（Headlines）**
   - "8-Hour Battery Life"
   - "Powerful 12,000Pa Suction"
   - "5-Star Rated by Users"

2. **广告描述（Descriptions）**
   - "Trusted for 10+ months by satisfied customers"
   - "Save 2 hours of cleaning time every week"
   - "Covers 2000 sq ft in a single cleaning session"

3. **摘录扩展（Callouts）**
   - "8-Hour Battery"
   - "12,000Pa Suction"
   - "5-Star Rated"

4. **站点链接（Sitelinks）**
   - "See Performance Specs" → 链接到性能指标页面
   - "Read Customer Reviews" → 链接到评论页面

## 相关文件

- **Prompt定义**：`prompt_versions` 表，`prompt_id = 'review_analysis'`
- **数据结构**：`src/lib/review-analyzer.ts` - `QuantitativeHighlight` 接口
- **前端显示**：`src/app/(app)/offers/[id]/page.tsx` - 评论分析展示组件

## 修复日期

2025-12-16

## 修复人员

Claude Code (AI Assistant)
