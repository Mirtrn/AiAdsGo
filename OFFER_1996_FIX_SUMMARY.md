# Offer 1996 问题修复方案（业务逻辑优化版）

## 问题总结

### 问题 1：品牌描述出现 "About this item" 等产品特性内容
**根本原因**：
- AI prompt 指导生成 "Detailed description emphasizing technical specs and reviews"
- AI 将产品特性内容（About this item）输出到 `productDescription` 字段
- 代码将 `productDescription` 映射为 `brand_description`
- 结果：品牌描述字段包含了产品特性列表，而不是品牌故事

### 问题 2：评论分析无数据
**根本原因**：
- 评论抓取时 `topReviews` 为空数组（可能是懒加载未完成）
- 空的 `topReviews` 传给 AI 分析
- AI 返回空的评论分析结果（totalReviews: 0）

## 已完成的修复

### ✅ 修复 1：优化 AI Prompt（v4.17）

**修改内容**：
1. 明确 `productDescription` 的定义：
   - ✅ **正确**：品牌故事和定位（2-3句话）
   - ❌ **错误**：产品特性列表（About this item）

2. 添加明确的正反例：
   ```
   ✅ CORRECT: "SIHOO is a leading ergonomic furniture brand trusted by millions..."
   ❌ WRONG: "About this item【Adjusts to You, From Bottom to Top】..."
   ```

3. 新增 "CRITICAL FIELD CLARIFICATIONS" 章节：
   - `productDescription` = 品牌故事
   - `productHighlights` = 产品特性（About this item 内容应该放这里）

**部署状态**：
- ✅ 新 prompt v4.17 已插入数据库并激活
- ✅ 旧 prompt v4.16 已停用

### ✅ 修复 2：移除错误的兜底赋值逻辑

**修改文件**：`src/lib/offer-extraction.ts:336`

**修改内容**：
```typescript
// 🔥 之前（错误）：
brand_description: result.data!.productDescription || undefined

// 🔥 现在（正确）：
// 注释掉，只依赖 AI 分析生成 brand_description
// 不直接使用 productDescription 作为兜底
```

**效果**：
- 如果 AI 分析失败，`brand_description` 会是 `NULL`
- 不会再出现 "About this item" 被直接赋值的问题

## 待优化：评论抓取增强

### 方案 1：改进评论区懒加载等待（推荐）

**问题**：`topReviews` 抓取时评论区可能未加载完成

**解决方案**：在 `src/lib/stealth-scraper/amazon-product.ts` 中：
1. 增加评论区滚动和等待时间（已有部分实现，在 362-395 行）
2. 确保 `[data-hook="review"]` 元素可见后再抓取
3. 添加重试机制

**优先级**：高

### 方案 2：评论数据质量验证

**问题**：即使抓取到评论，也可能是无效数据（JavaScript代码）

**解决方案**：
1. 在 `topReviews` 提取后验证数据质量
2. 如果抓取的评论包含 "function()" 等代码片段，重试抓取
3. 记录评论抓取失败的详细日志

**优先级**：中

### 方案 3：添加降级策略

**问题**：如果评论抓取失败，应该有合理的降级

**解决方案**：
1. 如果 `topReviews` 为空，尝试从 `reviewHighlights` 提取关键信息
2. 或者标记为"评论数据不可用"，而不是生成空的分析结果

**优先级**：低

## 数据质量验证机制（建议新增）

### 验证点 1：brandDescription 质量检查

```typescript
function validateBrandDescription(description: string): boolean {
  // 检查是否包含 "About this item"
  if (description.includes('About this item')) {
    console.warn('⚠️ brandDescription 包含产品特性内容，质量不合格')
    return false
  }

  // 检查是否包含明显的特性列表标记
  const featureMarkers = ['【', '】', '✓', '•', 'Item 1', 'Item 2']
  for (const marker of featureMarkers) {
    if (description.includes(marker)) {
      console.warn(`⚠️ brandDescription 包含特性列表标记: ${marker}`)
      return false
    }
  }

  // 检查长度是否合理（品牌描述不应该超过500字符）
  if (description.length > 500) {
    console.warn(`⚠️ brandDescription 过长: ${description.length} 字符`)
    return false
  }

  return true
}
```

### 验证点 2：reviewAnalysis 质量检查

```typescript
function validateReviewAnalysis(analysis: any): boolean {
  // 检查是否是空分析
  if (analysis.totalReviews === 0) {
    console.warn('⚠️ reviewAnalysis 无数据')
    return false
  }

  // 检查关键字段是否有效
  const hasValidData =
    analysis.topPositiveKeywords?.length > 0 ||
    analysis.topNegativeKeywords?.length > 0 ||
    analysis.realUseCases?.length > 0

  if (!hasValidData) {
    console.warn('⚠️ reviewAnalysis 关键字段均为空')
    return false
  }

  return true
}
```

## 下一步操作建议

1. **立即生效**：
   - ✅ 新 prompt v4.17 已激活，未来创建的 offers 将使用正确的品牌描述生成逻辑

2. **数据修复**（可选）：
   - 对于已有的 39 个 offers，可以触发重新 AI 分析
   - 或者手动清空错误的 `brand_description`，等待下次更新时重新生成

3. **评论抓取优化**（推荐）：
   - 改进评论区懒加载等待逻辑
   - 添加数据质量验证机制

4. **监控和日志**：
   - 添加 `brandDescription` 质量监控
   - 记录评论抓取失败的详细原因

## 相关文件

- ✅ AI Prompt: `src/lib/prompts/product-analysis-single-v4.17.txt`
- ✅ 数据库更新: prompt_versions 表中 v4.17 已激活
- ✅ 代码修改: `src/lib/offer-extraction.ts:336-338`
- 📝 验证脚本: `scripts/update-product-analysis-prompt.sql`
- 📝 问题报告: `OFFER_1996_ISSUE_REPORT.md`
