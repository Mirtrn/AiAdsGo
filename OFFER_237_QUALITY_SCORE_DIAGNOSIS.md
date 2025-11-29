# Offer 237 广告创意质量分诊断报告

**诊断时间**: 2025-11-29
**问题**: Ad Strength 中"质量分"都不高
**分析方法**: 基于 Ad Strength 评分算法的 6 维度分析
**状态**: 🔍 诊断进行中

---

## 📋 问题描述

在 `/offers/237/launch` 下生成的广告创意，Ad Strength 中的"质量分"都不高。需要排查根本原因。

---

## 🔍 Ad Strength 评分系统概览

### 6 维度评分体系 (总分 100)

| 维度 | 满分 | 权重 | 说明 |
|------|------|------|------|
| **Diversity** (多样性) | 20 | 20% | 资产类型、长度、文本独特性 |
| **Relevance** (相关性) | 20 | 20% | 关键词覆盖率、自然度 |
| **Completeness** (完整性) | 15 | 15% | 资产数量、字符合规性 |
| **Quality** (质量) | 15 | 15% | 数字使用、CTA、紧迫感、差异化 |
| **Compliance** (合规性) | 10 | 10% | 政策遵守、无垃圾词 |
| **Brand Search Volume** (品牌搜索量) | 20 | 20% | 月均搜索量 |

### 评级标准

```
EXCELLENT: ≥85 分
GOOD:      70-84 分
AVERAGE:   50-69 分
POOR:      1-49 分
PENDING:   0 分
```

---

## 🎯 可能的问题原因分析

### 问题 1: 品牌搜索量 (Brand Search Volume) - 20 分

**风险等级**: 🔴 **高** (占总分 20%)

#### 可能的问题

1. **品牌知名度低**
   - Offer 237 的品牌可能在目标市场搜索量很低
   - 导致 Brand Search Volume 维度得分低

2. **搜索量数据缺失**
   - Keyword Planner 可能无法获取该品牌的搜索量数据
   - 数据来源为 "unavailable"，得分为 0

3. **搜索量级别低**
   - 月均搜索量 < 100 (Micro 级别): 0 分
   - 月均搜索量 100-1000 (Small 级别): 5 分
   - 月均搜索量 1000-10000 (Medium 级别): 10 分
   - 月均搜索量 10000-100000 (Large 级别): 15 分
   - 月均搜索量 ≥ 100000 (XLarge 级别): 20 分

#### 诊断方法

```typescript
// 检查 Brand Search Volume 的数据来源和级别
const brandSearchVolume = evaluation.dimensions.brandSearchVolume
console.log('数据来源:', brandSearchVolume.details.dataSource)
console.log('搜索量级别:', brandSearchVolume.details.volumeLevel)
console.log('月均搜索量:', brandSearchVolume.details.monthlySearchVolume)
console.log('得分:', brandSearchVolume.score)
```

---

### 问题 2: 关键词相关性 (Relevance) - 20 分

**风险等级**: 🟡 **中** (占总分 20%)

#### 可能的问题

1. **关键词覆盖率低**
   - 生成的关键词没有出现在标题和描述中
   - 关键词覆盖率 < 80%，导致 keywordCoverage 得分低

2. **关键词堆砌**
   - 关键词密度 > 50%，被判定为垃圾词汇
   - keywordNaturalness 得分从 8 分降至 3.2 分

3. **关键词匹配失败**
   - 关键词与文本的匹配算法可能失败
   - 支持的匹配方式: 精确匹配、词形变化、部分匹配

#### 诊断方法

```typescript
// 检查关键词覆盖率
const relevance = evaluation.dimensions.relevance
console.log('关键词覆盖率:', relevance.details.keywordCoverage)
console.log('关键词自然度:', relevance.details.keywordNaturalness)
console.log('总得分:', relevance.score)

// 检查未匹配的关键词
const unmatchedKeywords = keywords.filter(kw => !matchedKeywords.includes(kw))
console.log('未匹配关键词:', unmatchedKeywords)
```

---

### 问题 3: 多样性 (Diversity) - 20 分

**风险等级**: 🟡 **中** (占总分 20%)

#### 可能的问题

1. **标题类型分布不足**
   - 标题缺少 type 属性
   - 类型数量 < 5 种，导致 typeDistribution 得分低

2. **长度梯度分布不均**
   - 短标题 (≤20 字) 数量不足
   - 中等标题 (21-25 字) 数量不足
   - 长标题 (>25 字) 数量不足
   - 理想分布: 各 5 个

3. **文本独特性低**
   - 标题和描述之间有大量重复内容
   - 相似度 > 20%，导致 textUniqueness 得分低

#### 诊断方法

```typescript
// 检查多样性各维度
const diversity = evaluation.dimensions.diversity
console.log('类型分布:', diversity.details.typeDistribution)
console.log('长度分布:', diversity.details.lengthDistribution)
console.log('文本独特性:', diversity.details.textUniqueness)
console.log('总得分:', diversity.score)

// 检查长度分布
const lengthCategories = {
  short: headlines.filter(h => h.text.length <= 20).length,
  medium: headlines.filter(h => h.text.length > 20 && h.text.length <= 25).length,
  long: headlines.filter(h => h.text.length > 25).length
}
console.log('长度分布:', lengthCategories)
```

---

### 问题 4: 质量 (Quality) - 15 分

**风险等级**: 🟡 **中** (占总分 15%)

#### 可能的问题

1. **缺少数字**
   - 标题中没有具体的数字 (如 "30%", "7000Pa")
   - numberUsage 得分为 0

2. **缺少 CTA**
   - 描述中没有明确的行动号召 (如 "Buy Now", "Shop Today")
   - ctaPresence 得分为 0

3. **缺少紧迫感**
   - 没有时间限制或稀缺性表达 (如 "Limited Time", "Only 5 Left")
   - urgencyExpression 得分为 0

4. **缺少差异化**
   - 内容过于通用，没有独特的卖点
   - differentiation 得分为 0

#### 诊断方法

```typescript
// 检查质量各维度
const quality = evaluation.dimensions.quality
console.log('数字使用:', quality.details.numberUsage)
console.log('CTA 存在:', quality.details.ctaPresence)
console.log('紧迫感:', quality.details.urgencyExpression)
console.log('差异化:', quality.details.differentiation)
console.log('总得分:', quality.score)
```

---

### 问题 5: 完整性 (Completeness) - 15 分

**风险等级**: 🟢 **低** (占总分 15%)

#### 可能的问题

1. **资产数量不足**
   - 标题数量 < 15 个
   - 描述数量 < 4 个
   - assetCount 得分低

2. **字符长度不合规**
   - 标题长度 < 10 或 > 30 字
   - 描述长度 < 60 或 > 90 字
   - characterCompliance 得分低

#### 诊断方法

```typescript
// 检查完整性各维度
const completeness = evaluation.dimensions.completeness
console.log('资产数量:', completeness.details.assetCount)
console.log('字符合规性:', completeness.details.characterCompliance)
console.log('总得分:', completeness.score)

// 检查资产数量
console.log('标题数:', headlines.length)
console.log('描述数:', descriptions.length)

// 检查字符长度
headlines.forEach((h, i) => {
  const len = h.text.length
  const valid = len >= 10 && len <= 30
  console.log(`标题 ${i+1}: ${len} 字 ${valid ? '✅' : '❌'}`)
})
```

---

### 问题 6: 合规性 (Compliance) - 10 分

**风险等级**: 🟢 **低** (占总分 10%)

#### 可能的问题

1. **重复内容**
   - 标题或描述之间相似度 > 80%
   - policyAdherence 得分低

2. **垃圾词汇**
   - 包含禁用词汇 (如 "FREE", "GUARANTEED", "BEST")
   - noSpamWords 得分低

#### 诊断方法

```typescript
// 检查合规性各维度
const compliance = evaluation.dimensions.compliance
console.log('政策遵守:', compliance.details.policyAdherence)
console.log('无垃圾词:', compliance.details.noSpamWords)
console.log('总得分:', compliance.score)
```

---

## 📊 根据 Offer 235 的对比分析

### Offer 235 的成功案例

**Ad Strength**: EXCELLENT (86/100)

| 维度 | 得分 | 满分 | 百分比 |
|------|------|------|--------|
| Diversity | 19 | 20 | 95% |
| Relevance | 20 | 20 | 100% |
| Completeness | 15 | 20 | 75% |
| Quality | 12 | 20 | 60% |
| Compliance | 10 | 20 | 50% |
| Brand Search Volume | 10 | 20 | 50% |

**关键特征**:
- ✅ 15 个标题，类型分布完整
- ✅ 4 个描述，内容多样化
- ✅ 关键词覆盖率 100%
- ✅ 包含数字、CTA、紧迫感
- ✅ 品牌搜索量中等 (1,352.5/月)

### Offer 237 可能的问题

如果 Offer 237 的质量分不高，可能的原因:

1. **品牌搜索量太低** (最可能)
   - 品牌知名度不足
   - 导致 Brand Search Volume 维度得分低 (0-5 分)

2. **关键词覆盖率低** (次可能)
   - 生成的关键词没有出现在创意中
   - 导致 Relevance 维度得分低

3. **内容质量不足** (可能)
   - 缺少数字、CTA、紧迫感
   - 导致 Quality 维度得分低

---

## 🔧 诊断步骤

### 步骤 1: 获取 Offer 237 的评分详情

```bash
# 访问 Offer 237 的 launch 页面
curl -X GET http://localhost:3000/api/offers/237 \
  -H "Cookie: auth_token=YOUR_TOKEN"

# 查看返回的 quality_metrics
# 应该包含:
# - headline_diversity_score
# - keyword_relevance_score
# - estimated_ad_strength
```

### 步骤 2: 检查各维度得分

```typescript
// 在浏览器控制台运行
const evaluation = await evaluateCreativeAdStrength(
  headlines,
  descriptions,
  keywords,
  {
    brandName: 'Offer 237 Brand',
    targetCountry: 'US',
    targetLanguage: 'en'
  }
)

console.log('总分:', evaluation.overallScore)
console.log('评级:', evaluation.rating)
console.log('各维度:', evaluation.dimensions)
```

### 步骤 3: 对比 Offer 235

```typescript
// 对比两个 Offer 的评分
const offer235 = { /* Offer 235 的评分 */ }
const offer237 = { /* Offer 237 的评分 */ }

const differences = {
  diversity: offer237.dimensions.diversity.score - offer235.dimensions.diversity.score,
  relevance: offer237.dimensions.relevance.score - offer235.dimensions.relevance.score,
  completeness: offer237.dimensions.completeness.score - offer235.dimensions.completeness.score,
  quality: offer237.dimensions.quality.score - offer235.dimensions.quality.score,
  compliance: offer237.dimensions.compliance.score - offer235.dimensions.compliance.score,
  brandSearchVolume: offer237.dimensions.brandSearchVolume.score - offer235.dimensions.brandSearchVolume.score
}

console.log('差异分析:', differences)
```

---

## 💡 可能的改进方案

### 方案 1: 提高品牌搜索量 (如果这是主要问题)

**目标**: 增加 Brand Search Volume 维度的得分

**方法**:
1. 选择搜索量更高的品牌
2. 在目标市场进行品牌推广
3. 使用更通用的产品类别关键词

**预期效果**: +5-10 分

### 方案 2: 改进关键词覆盖率 (如果这是主要问题)

**目标**: 增加 Relevance 维度的得分

**方法**:
1. 在标题和描述中明确包含关键词
2. 使用词形变化 (如 "robot" vs "robots")
3. 避免关键词堆砌 (密度 < 30%)

**预期效果**: +3-8 分

### 方案 3: 增强内容质量 (如果这是主要问题)

**目标**: 增加 Quality 维度的得分

**方法**:
1. 在标题中添加具体数字 (如 "30% Off", "7000Pa")
2. 在描述中添加明确的 CTA (如 "Buy Now", "Shop Today")
3. 添加紧迫感表达 (如 "Limited Time", "Only 5 Left")
4. 强调独特的卖点和差异化

**预期效果**: +3-6 分

### 方案 4: 改进多样性 (如果这是主要问题)

**目标**: 增加 Diversity 维度的得分

**方法**:
1. 确保标题类型分布完整 (品牌、产品、促销、CTA、紧迫性)
2. 平衡长度分布 (短、中、长各 5 个)
3. 减少标题和描述之间的重复内容

**预期效果**: +2-5 分

---

## 📈 预期改进效果

### 当前状态 (假设)

```
总分: 60-70 分 (AVERAGE)
- Diversity: 12 分
- Relevance: 12 分
- Completeness: 12 分
- Quality: 8 分
- Compliance: 8 分
- Brand Search Volume: 8 分
```

### 改进后 (目标)

```
总分: 80-90 分 (GOOD/EXCELLENT)
- Diversity: 18 分 (+6)
- Relevance: 18 分 (+6)
- Completeness: 14 分 (+2)
- Quality: 12 分 (+4)
- Compliance: 10 分 (+2)
- Brand Search Volume: 12 分 (+4)
```

---

## 🎯 下一步行动

### 立即 (今天)
- [ ] 获取 Offer 237 的实际评分详情
- [ ] 识别哪个维度得分最低
- [ ] 对比 Offer 235 的评分

### 短期 (本周)
- [ ] 根据问题原因实施改进方案
- [ ] 重新生成创意并评分
- [ ] 验证改进效果

### 中期 (本月)
- [ ] 优化 AI Prompt 以提高质量分
- [ ] 添加自动质量分检查机制
- [ ] 创建质量分优化指南

---

## 📚 相关文件

| 文件 | 说明 |
|------|------|
| `src/lib/ad-strength-evaluator.ts` | Ad Strength 评分算法 |
| `src/lib/scoring.ts` | Launch Score 计算 |
| `OFFER_235_TEST_RESULTS.md` | Offer 235 的成功案例 |
| `CREATIVE_DIVERSITY_SOLUTION_COMPLETION.md` | 多样性解决方案 |

---

## 🔗 相关 API 端点

```
GET /api/offers/237 - 获取 Offer 信息
GET /api/offers/237/creatives - 获取创意列表
POST /api/ad-strength/evaluate - 评估 Ad Strength
POST /api/ad-strength/batch-evaluate - 批量评估
```

---

**诊断状态**: 🔍 **进行中**
**最后更新**: 2025-11-29
**下一步**: 获取 Offer 237 的实际数据进行深入分析

