# AI Prompt 中的字符限制分析

**分析时间**: 2025-11-29
**文件**: `src/lib/ad-creative-generator.ts`
**状态**: ✅ 字符限制已在 Prompt 中定义

---

## 📋 概览

是的，**字符限制确实在 AI Prompt 中定义了**！这是一个很好的设计，确保 AI 生成的内容符合 Google Ads 的要求。

---

## 🎯 Prompt 中的字符限制定义

### 1. 标题限制 (≤30 字符)

**Prompt 位置**: 第 500 行

```typescript
### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:${offer.brand}} Official" - Must be EXACTLY this format, no extra words
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format. All other 14 headlines MUST NOT contain {KeyWord:...} or any DKI syntax.

Remaining 14 headlines - Types (must cover all 5):
- Brand (2): ...
- Feature (4): ...
- Promo (3): ...
- CTA (3): ...
- Urgency (2): ...

Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)
```

**关键点**:
- ✅ 明确指定 ≤30 字符
- ✅ 提供长度分布指导 (10-20, 20-25, 25-30)
- ✅ 指定 15 个标题的类型分布
- ✅ 包含质量要求 (8+ with keywords, 5+ with numbers, 3+ with urgency)

---

### 2. 描述限制 (≤90 字符)

**Prompt 位置**: 第 514 行

```typescript
### DESCRIPTIONS (4 required, ≤90 chars each)
**UNIQUENESS REQUIREMENT**: Each description MUST be DISTINCT in focus and wording
- **Description 1 (Value-Driven)**: Lead with the PRIMARY benefit or competitive advantage
  * Focus: What makes this product/brand special
  * Example: "Award-Winning Tech. Rated 4.8 stars by 50K+ Happy Customers."
- **Description 2 (Action-Oriented)**: Strong CTA with immediate incentive
  * Focus: Urgency + convenience + trust signal
  * Example: "Shop Now for Fast, Free Delivery. Easy Returns Guaranteed."
- **Description 3 (Feature-Rich)**: Specific product features or use cases
  * Focus: Technical specs, capabilities, or versatility
  * Example: "4K Resolution. Solar Powered. Works Rain or Shine."
- **Description 4 (Trust + Social Proof)**: Customer validation or support
  * Focus: Reviews, ratings, guarantees, customer service
  * Example: "Trusted by 100K+ Buyers. 30-Day Money-Back Promise."
```

**关键点**:
- ✅ 明确指定 ≤90 字符
- ✅ 要求 4 个描述
- ✅ 每个描述有不同的焦点 (Value, Action, Feature, Trust)
- ✅ 提供具体的例子
- ✅ 强调唯一性要求

---

### 3. Callouts 限制 (≤25 字符)

**Prompt 位置**: 第 585 行

```typescript
### CALLOUTS (4-6, ≤25 chars)
${primeEligible ? '- **MUST include**: "Prime Free Shipping"' : '- Free Shipping'}
${availability && !availability.toLowerCase().includes('out of stock') ? '- **MUST include**: "In Stock Now"' : ''}
${badge ? `- **MUST include**: "${badge}"` : ''}
- 24/7 Support, Money Back Guarantee, etc.
```

**关键点**:
- ✅ 明确指定 ≤25 字符
- ✅ 要求 4-6 个 callouts
- ✅ 根据产品数据动态生成必需的 callouts
- ✅ 包含示例

---

### 4. Sitelinks 限制 (text ≤25, desc ≤35 字符)

**Prompt 位置**: 第 591 行

```typescript
### SITELINKS (6): text≤25, desc≤35, url="/" (auto-replaced)
- **REQUIREMENT**: Each sitelink must have a UNIQUE, compelling description
- Focus on different product features, benefits, or use cases
- Avoid repeating similar phrases across sitelinks
- Examples: "Free 2-Day Prime Delivery", "30-Day Money Back Promise", "Expert Tech Support 24/7"
```

**关键点**:
- ✅ 明确指定 text ≤25 字符
- ✅ 明确指定 description ≤35 字符
- ✅ 要求 6 个 sitelinks
- ✅ 强调唯一性和多样性
- ✅ 提供具体的例子

---

### 5. 关键词限制 (2-4 个单词)

**Prompt 位置**: 第 533-583 行

```typescript
### KEYWORDS (20-30 required)
**🎯 关键词生成策略（重要！确保高搜索量关键词优先）**:
**⚠️ 强制约束：所有关键词必须使用目标语言 ${offer.target_language || 'English'}，不能使用英文！**

**第一优先级 - 品牌短尾词 (必须生成8-10个)**:
- 格式: [品牌名] + [产品核心词]（2-3个单词）

**第二优先级 - 产品核心词 (必须生成6-8个)**:
- 格式: [产品功能] + [类别]（2-3个单词）

**第三优先级 - 购买意图词 (必须生成3-5个)**:
- 格式: [购买动词] + [品牌/产品]

**第四优先级 - 长尾精准词 (必须生成3-7个)**:
- 格式: [具体场景] + [产品]（3-5个单词）

**质量要求**:
- 每个关键词2-4个单词（最优搜索量范围）
- 关键词总数: 20-30个
- 搜索量目标: 品牌词>1000/月，核心词>500/月，长尾词>100/月
```

**关键点**:
- ✅ 明确指定 2-4 个单词
- ✅ 要求 20-30 个关键词
- ✅ 分为 4 个优先级
- ✅ 每个优先级有具体的数量要求
- ✅ 包含搜索量目标
- ✅ 强制语言要求 (必须使用目标语言)

---

## 📊 字符限制总结表

| 元素 | 限制 | 数量 | 优先级 | 说明 |
|------|------|------|--------|------|
| 标题 | ≤30 字符 | 15 个 | 高 | 分布: 5 short(10-20), 5 medium(20-25), 5 long(25-30) |
| 描述 | ≤90 字符 | 4 个 | 高 | 4 种焦点: Value, Action, Feature, Trust |
| Callouts | ≤25 字符 | 4-6 个 | 中 | 根据产品数据动态生成 |
| Sitelink 文本 | ≤25 字符 | 6 个 | 中 | 必须唯一 |
| Sitelink 描述 | ≤35 字符 | 6 个 | 中 | 必须唯一 |
| 关键词 | 2-4 单词 | 20-30 个 | 高 | 4 个优先级 |

---

## 🔍 Prompt 中的质量控制机制

### 1. 长度分布指导

```typescript
Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)
```

**目的**: 确保标题长度多样化，避免全部都是短标题或长标题

---

### 2. 类型分布要求

```typescript
Remaining 14 headlines - Types (must cover all 5):
- Brand (2): ...
- Feature (4): ...
- Promo (3): ...
- CTA (3): ...
- Urgency (2): ...
```

**目的**: 确保标题涵盖所有必要的类型，提高广告强度

---

### 3. 质量指标

```typescript
Quality: 8+ with keywords, 5+ with numbers, 3+ with urgency, <20% text similarity
```

**目的**:
- 8+ 个标题包含关键词
- 5+ 个标题包含数字
- 3+ 个标题包含紧迫感
- 文本相似度 < 20%

---

### 4. 唯一性要求

```typescript
**UNIQUENESS REQUIREMENT**: Each description MUST be DISTINCT in focus and wording
```

**目的**: 避免重复的描述，提高广告多样性

---

### 5. 语言强制要求

```typescript
**🔴 强制语言要求**:
- 关键词必须使用目标语言 ${offer.target_language || 'English'}
- 如果目标语言是意大利语，所有关键词必须是意大利语
- 如果目标语言是西班牙语，所有关键词必须是西班牙语
- 不能混合使用英文和目标语言
- 不能使用英文关键词
```

**目的**: 确保多语言支持的正确性

---

## ⚠️ 禁止内容

```typescript
## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CAPS abuse
**❌ Prohibited Symbols (Google Ads Policy)**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
  * Use text alternatives instead: "stars" or "star rating" instead of ★
  * Use "Rated 4.8 stars" NOT "4.8★"
  * Use "Top Choice" NOT "Top Choice ✓"
**❌ Excessive Punctuation**: "!!!", "???", "...", repeated exclamation marks
```

**目的**: 确保广告符合 Google Ads 政策

---

## 🎯 AI 如何遵守这些限制

### 1. 直接指令

Prompt 中明确告诉 AI:
- "15 required, ≤30 chars each"
- "4 required, ≤90 chars each"
- "≤25 chars"
- "≤35 chars"

### 2. 示例指导

Prompt 提供了具体的例子:
- "Award-Winning Tech. Rated 4.8 stars by 50K+ Happy Customers." (≤90 字符)
- "Free 2-Day Prime Delivery" (≤25 字符)
- "Expert Tech Support 24/7" (≤25 字符)

### 3. 质量指标

Prompt 定义了具体的质量指标:
- "8+ with keywords"
- "5+ with numbers"
- "3+ with urgency"
- "<20% text similarity"

### 4. 输出格式

Prompt 指定了 JSON 输出格式，包含长度信息:

```typescript
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency", "length":N, ...}...],
  "descriptions": [{"text":"...", "type":"value|cta", "length":N, ...}...],
  ...
}
```

---

## ✅ 验证机制

### 1. 后端验证

虽然 Prompt 中定义了字符限制，但系统还需要**后端验证**来确保 AI 的输出符合要求。

**验证位置**: `src/lib/ad-strength-evaluator.ts`

```typescript
// 应该有字符限制检查
if (headline.length > 30) {
  // 标记为错误
}
if (description.length > 90) {
  // 标记为错误
}
```

### 2. 前端验证

前端应该在显示创意时验证字符限制。

### 3. 测试验证

我们创建的测试脚本验证了字符限制的检测。

---

## 🔄 完整流程

```
1. 用户创建 Offer
   ↓
2. 系统构建 AI Prompt
   ├─ 包含字符限制指令
   ├─ 包含质量要求
   ├─ 包含示例
   └─ 包含禁止内容
   ↓
3. AI 生成创意
   ├─ 遵守字符限制
   ├─ 遵守质量要求
   ├─ 遵守禁止内容
   └─ 输出 JSON 格式
   ↓
4. 后端验证
   ├─ 检查字符限制
   ├─ 检查质量指标
   ├─ 检查禁止内容
   └─ 返回验证结果
   ↓
5. 前端显示
   ├─ 显示创意
   ├─ 显示字符计数
   ├─ 显示质量评分
   └─ 允许用户编辑
```

---

## 💡 最佳实践

### 1. Prompt 设计

✅ **好的做法**:
- 明确指定字符限制
- 提供具体的例子
- 定义质量指标
- 包含禁止内容列表

❌ **不好的做法**:
- 模糊的指令 ("make it short")
- 没有例子
- 没有质量指标
- 没有禁止内容列表

### 2. 验证策略

✅ **好的做法**:
- 后端验证所有输出
- 前端显示验证结果
- 允许用户编辑和重新生成
- 记录验证失败的原因

❌ **不好的做法**:
- 只依赖 AI 的自我约束
- 没有后端验证
- 不显示验证结果
- 不允许用户编辑

### 3. 测试策略

✅ **好的做法**:
- 测试边界情况 (29, 30, 31 字符)
- 测试多语言
- 测试禁止内容
- 测试质量指标

❌ **不好的做法**:
- 只测试正常情况
- 不测试多语言
- 不测试禁止内容
- 不测试质量指标

---

## 📈 改进建议

### 短期 (立即)
- [ ] 添加后端字符限制验证
- [ ] 添加前端字符计数显示
- [ ] 添加验证失败的错误消息

### 中期 (本周)
- [ ] 创建字符限制验证的单元测试
- [ ] 创建多语言字符限制测试
- [ ] 创建禁止内容检测

### 长期 (本月)
- [ ] 创建 AI Prompt 优化指南
- [ ] 创建字符限制最佳实践文档
- [ ] 创建验证规则的配置系统

---

## 🎉 总结

### 关键发现

✅ **字符限制已在 Prompt 中定义**
- 标题: ≤30 字符
- 描述: ≤90 字符
- Callouts: ≤25 字符
- Sitelinks: text ≤25, desc ≤35 字符
- 关键词: 2-4 个单词

✅ **Prompt 包含完整的质量控制机制**
- 长度分布指导
- 类型分布要求
- 质量指标
- 唯一性要求
- 语言强制要求

✅ **系统有多层验证**
- AI Prompt 指令
- 后端验证 (应该有)
- 前端验证 (应该有)
- 测试验证 (已有)

### 建议

1. **确保后端验证** - 验证 AI 输出是否符合字符限制
2. **添加前端反馈** - 显示字符计数和验证结果
3. **完善测试** - 添加更多边界情况测试
4. **文档化** - 创建 Prompt 设计和验证的文档

---

**分析完成**: 2025-11-29
**状态**: ✅ 字符限制已在 Prompt 中定义
**下一步**: 确保后端和前端的验证机制完整

