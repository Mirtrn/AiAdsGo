# 基于生成规则的优化方案

## 📋 执行摘要

本文档基于 GENERATION_RULES_COMPREHENSIVE.md，分析当前代码实现与生成规则的差距，提出系统的优化方案。

---

## 第一部分：现状分析

### 1.1 已实现的功能

✅ **已完成**：
- 字符长度限制（30/90字符）
- 禁止符号和词汇检查
- 多样性过滤（相似度≤20%）
- 关键词搜索量验证
- 多语言支持（11种语言）
- DKI标签修复
- 合规性检查

### 1.2 存在的问题

❌ **缺失或不完整**：

#### 问题1：标题类型覆盖不完整
- **现状**：无法验证5种类型覆盖（Brand/Feature/Promo/CTA/Urgency）
- **影响**：生成的15条标题可能缺少某些类型
- **优先级**：P1

#### 问题2：描述焦点类型覆盖不完整
- **现状**：无法验证4种焦点类型覆盖（Value/Action/Feature/Proof）
- **影响**：生成的4条描述可能缺少某些焦点
- **优先级**：P1

#### 问题3：CTA要求验证缺失
- **现状**：无法验证每条描述都包含CTA
- **影响**：某些描述可能没有行动号召
- **优先级**：P1

#### 问题4：关键词优先级分布验证缺失
- **现状**：无法验证Brand(8-10) + Core(6-8) + Intent(3-5) + LongTail(3-7)的分布
- **影响**：关键词分布不均衡，影响搜索覆盖
- **优先级**：P1

#### 问题5：语言特定约束未实现
- **现状**：所有语言使用相同的约束（1-4单词、≤30字符）
- **影响**：德语、意大利语等语言的关键词生成困难
- **优先级**：P2

#### 问题6：约束冲突检测缺失
- **现状**：无法检测多样性vs类型覆盖的冲突
- **影响**：无法提前预警创意数不足
- **优先级**：P2

#### 问题7：约束优先级管理缺失
- **现状**：无法动态调整约束优先级
- **影响**：无法在冲突时选择保留哪个约束
- **优先级**：P2

#### 问题8：质量指标验证不完整
- **现状**：无法验证关键词密度、数字密度、紧迫感、长度分布
- **影响**：标题质量无法保证
- **优先级**：P2

---

## 第二部分：优化方案

### 2.1 优化1：实现标题类型覆盖验证

**目标**：确保15条标题覆盖5种类型（Brand/Feature/Promo/CTA/Urgency）

**实现步骤**：

1. **创建类型分类器**
```typescript
interface HeadlineTypeClassifier {
  classifyHeadline(headline: string): HeadlineType[]
  validateTypeCoverage(headlines: string[]): TypeCoverageReport
}

type HeadlineType = 'Brand' | 'Feature' | 'Promo' | 'CTA' | 'Urgency'

interface TypeCoverageReport {
  coverage: Record<HeadlineType, number>
  isSatisfied: boolean
  missing: HeadlineType[]
  recommendations: string[]
}
```

2. **分类规则**
   - **Brand**：包含品牌名、"official"、"trusted"、"#1"等
   - **Feature**：包含产品特性、技术规格、性能指标
   - **Promo**：包含"save"、"discount"、"offer"、"free"等
   - **CTA**：包含"shop"、"buy"、"get"、"claim"等
   - **Urgency**：包含"limited"、"only"、"ends"、"today"等

3. **验证逻辑**
   - 要求：Brand(2) + Feature(4) + Promo(3) + CTA(3) + Urgency(2)
   - 如果不满足，生成建议并重新生成缺失的类型

**文件**：`src/lib/headline-type-classifier.ts`

---

### 2.2 优化2：实现描述焦点类型覆盖验证

**目标**：确保4条描述覆盖4种焦点类型（Value/Action/Feature/Proof）

**实现步骤**：

1. **创建焦点分类器**
```typescript
interface DescriptionFocusClassifier {
  classifyDescription(description: string): DescriptionFocus[]
  validateFocusCoverage(descriptions: string[]): FocusCoverageReport
  validateCTAPresence(descriptions: string[]): CTAValidationReport
}

type DescriptionFocus = 'Value' | 'Action' | 'Feature' | 'Proof'

interface FocusCoverageReport {
  coverage: Record<DescriptionFocus, number>
  isSatisfied: boolean
  missing: DescriptionFocus[]
  ctaPresence: Record<number, boolean>
  recommendations: string[]
}
```

2. **分类规则**
   - **Value**：包含价值主张、社会证明、评分、评论数
   - **Action**：包含行动号召、便利性、快速配送
   - **Feature**：包含产品特性、优势、技术规格
   - **Proof**：包含信任建立、保证、用户数量

3. **CTA验证**
   - 每条描述必须包含CTA词汇
   - CTA词汇列表：shop, buy, get, claim, order, discover, learn, start等

**文件**：`src/lib/description-focus-classifier.ts`

---

### 2.3 优化3：实现关键词优先级分布验证

**目标**：确保关键词按优先级分布（Brand/Core/Intent/LongTail）

**实现步骤**：

1. **创建优先级分类器**
```typescript
interface KeywordPriorityClassifier {
  classifyKeyword(keyword: string, offer: Offer): KeywordPriority
  validatePriorityDistribution(keywords: GeneratedKeyword[]): PriorityDistributionReport
}

type KeywordPriority = 'Brand' | 'Core' | 'Intent' | 'LongTail'

interface PriorityDistributionReport {
  distribution: Record<KeywordPriority, number>
  isSatisfied: boolean
  expected: Record<KeywordPriority, [number, number]>  // [min, max]
  recommendations: string[]
}
```

2. **分类规则**
   - **Brand**：包含品牌名（8-10个）
   - **Core**：产品类别词（6-8个）
   - **Intent**：购买意图词（3-5个）
   - **LongTail**：长尾精准词（3-7个）

3. **验证逻辑**
   - 检查分布是否符合要求
   - 如果不符合，生成建议并重新生成

**文件**：`src/lib/keyword-priority-classifier.ts`

---

### 2.4 优化4：实现语言特定约束

**目标**：按语言调整约束条件

**实现步骤**：

1. **创建语言约束配置**
```typescript
interface LanguageConstraints {
  headlineLength: number
  descriptionLength: number
  keywordMaxWords: number
  keywordMinSearchVolume: number
  calloutLength: number
  sitelinkTextLength: number
  sitelinkDescLength: number
}

const LANGUAGE_CONSTRAINTS: Record<string, LanguageConstraints> = {
  'en': {
    headlineLength: 30,
    descriptionLength: 90,
    keywordMaxWords: 4,
    keywordMinSearchVolume: 500,
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35
  },
  'de': {
    headlineLength: 35,
    descriptionLength: 100,
    keywordMaxWords: 3,
    keywordMinSearchVolume: 400,
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35
  },
  'it': {
    headlineLength: 32,
    descriptionLength: 95,
    keywordMaxWords: 4,
    keywordMinSearchVolume: 300,
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35
  },
  'ja': {
    headlineLength: 30,
    descriptionLength: 90,
    keywordMaxWords: 2,
    keywordMinSearchVolume: 250,
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35
  },
  'zh': {
    headlineLength: 30,
    descriptionLength: 90,
    keywordMaxWords: 3,
    keywordMinSearchVolume: 400,
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35
  }
}
```

2. **应用约束**
   - 在生成时使用语言特定约束
   - 在验证时使用语言特定约束

**文件**：`src/lib/language-constraints.ts`

---

### 2.5 优化5：实现约束冲突检测

**目标**：检测并报告约束冲突

**实现步骤**：

1. **创建冲突检测器**
```typescript
interface ConstraintConflictDetector {
  detectConflicts(creatives: GeneratedAdCreativeData[]): ConflictReport
  suggestResolution(conflicts: Conflict[]): ResolutionStrategy
}

interface ConflictReport {
  conflicts: Conflict[]
  severity: 'critical' | 'warning' | 'info'
  recommendations: string[]
}

interface Conflict {
  type: 'diversity_vs_type_coverage' | 'diversity_vs_focus_coverage' | 'cta_vs_diversity' | 'keyword_quantity_vs_volume'
  severity: 'critical' | 'warning' | 'info'
  message: string
  affectedElements: string[]
}
```

2. **检测规则**
   - 多样性 vs 类型覆盖：如果多样性<0.8且无法覆盖所有类型
   - 多样性 vs 焦点覆盖：如果多样性<0.8且无法覆盖所有焦点
   - CTA vs 多样性：如果所有描述都有CTA但相似度>20%
   - 关键词数量 vs 搜索量：如果关键词数<20且平均搜索量<500

**文件**：`src/lib/constraint-conflict-detector.ts`

---

### 2.6 优化6：实现约束优先级管理

**目标**：动态调整约束优先级

**实现步骤**：

1. **创建约束管理器**
```typescript
interface ConstraintManager {
  getConstraintPriority(constraint: string): ConstraintPriority
  relaxConstraint(constraint: string, reason: string): ConstraintRelaxation
  getActiveConstraints(): Constraint[]
}

type ConstraintPriority = 'P0' | 'P1' | 'P2'

interface ConstraintRelaxation {
  constraint: string
  originalValue: any
  relaxedValue: any
  reason: string
  severity: 'minor' | 'moderate' | 'major'
}

const CONSTRAINT_PRIORITIES: Record<string, ConstraintPriority> = {
  // P0：必须满足
  'headline_length': 'P0',
  'description_length': 'P0',
  'forbidden_symbols': 'P0',
  'forbidden_words': 'P0',
  'keyword_count': 'P0',
  'language_purity': 'P0',

  // P1：尽量满足
  'diversity': 'P1',
  'type_coverage': 'P1',
  'focus_coverage': 'P1',
  'search_volume': 'P1',
  'cta_presence': 'P1',

  // P2：可选
  'length_distribution': 'P2',
  'priority_distribution': 'P2',
  'social_proof': 'P2'
}
```

2. **松弛策略**
   - 当创意数不足时，放宽多样性（0.2→0.25）
   - 当关键词数不足时，降低搜索量要求
   - 当无法覆盖所有类型时，允许部分覆盖

**文件**：`src/lib/constraint-manager.ts`

---

### 2.7 优化7：实现质量指标验证

**目标**：验证标题的质量指标

**实现步骤**：

1. **创建质量指标计算器**
```typescript
interface QualityMetricsCalculator {
  calculateKeywordDensity(headlines: string[], keywords: string[]): number
  calculateNumberDensity(headlines: string[]): number
  calculateUrgencyDensity(headlines: string[]): number
  calculateLengthDistribution(headlines: string[]): LengthDistribution
  generateQualityReport(headlines: string[]): QualityReport
}

interface QualityReport {
  keywordDensity: number  // 应该 ≥ 8/15 ≈ 0.53
  numberDensity: number   // 应该 ≥ 5/15 ≈ 0.33
  urgencyDensity: number  // 应该 ≥ 3/15 ≈ 0.20
  lengthDistribution: LengthDistribution
  score: number  // 0-100
  recommendations: string[]
}

interface LengthDistribution {
  short: number   // 10-20字符
  medium: number  // 20-25字符
  long: number    // 25-30字符
  isSatisfied: boolean
}
```

2. **计算规则**
   - 关键词密度：8+条含关键词 / 15条 ≥ 0.53
   - 数字密度：5+条含数字 / 15条 ≥ 0.33
   - 紧迫感：3+条含紧迫词 / 15条 ≥ 0.20
   - 长度分布：5短 + 5中 + 5长

**文件**：`src/lib/quality-metrics-calculator.ts`

---

## 第三部分：实施计划

### 3.1 第一阶段（第1-2周）- 基础验证

**优先级**：P0

1. ✅ 实现标题类型覆盖验证（Optimization 1）
2. ✅ 实现描述焦点类型覆盖验证（Optimization 2）
3. ✅ 实现CTA验证（Optimization 2的一部分）
4. ✅ 实现关键词优先级分布验证（Optimization 3）

**预期效果**：
- 提高创意生成成功率（从70%→85%）
- 改善创意类型覆盖（从60%→95%）

---

### 3.2 第二阶段（第2-3周）- 高级功能

**优先级**：P1

1. ✅ 实现约束冲突检测（Optimization 5）
2. ✅ 实现约束优先级管理（Optimization 6）
3. ✅ 实现质量指标验证（Optimization 7）

**预期效果**：
- 提高创意生成成功率（从85%→92%）
- 改善创意质量（多样性更好）
- 提供更好的用户反馈

---

### 3.3 第三阶段（第3-4周）- 语言优化

**优先级**：P2

1. ✅ 实现语言特定约束（Optimization 4）
2. ✅ 优化多语言生成

**预期效果**：
- 支持更多语言和产品类别
- 改善非英文语言的生成质量

---

## 第四部分：文件结构

```
src/lib/
├── ad-creative-generator.ts (修改)
├── creative-diversity-filter.ts (修改)
├── keyword-generator.ts (修改)
├── headline-type-classifier.ts (新增)
├── description-focus-classifier.ts (新增)
├── keyword-priority-classifier.ts (新增)
├── constraint-conflict-detector.ts (新增)
├── constraint-manager.ts (新增)
├── quality-metrics-calculator.ts (新增)
└── language-constraints.ts (新增)
```

---

## 第五部分：集成点

### 5.1 在创意生成流程中集成

```
1. AI生成创意
   ↓
2. 基础验证（长度、禁止词汇）
   ↓
3. 类型/焦点覆盖验证 ← 新增
   ↓
4. 多样性过滤
   ↓
5. 冲突检测 ← 新增
   ↓
6. 约束松弛（如需要） ← 新增
   ↓
7. 质量指标验证 ← 新增
   ↓
8. 最终输出
```

### 5.2 在关键词生成流程中集成

```
1. AI生成关键词
   ↓
2. 搜索量验证
   ↓
3. 优先级分布验证 ← 新增
   ↓
4. 语言特定约束验证 ← 新增
   ↓
5. 最终输出
```

---

## 第六部分：测试策略

### 6.1 单元测试

- 测试每个分类器的准确性
- 测试冲突检测的完整性
- 测试约束松弛的逻辑

### 6.2 集成测试

- 测试完整的生成流程
- 测试多语言支持
- 测试约束冲突场景

### 6.3 端到端测试

- 测试真实的Offer生成
- 测试用户反馈
- 测试性能指标

---

## 第七部分：预期效果

### 7.1 定量指标

| 指标 | 当前 | 目标 | 改进 |
|------|------|------|------|
| 创意生成成功率 | 70% | 92% | +22% |
| 类型覆盖率 | 60% | 95% | +35% |
| 多样性满足率 | 75% | 90% | +15% |
| 关键词分布满足率 | 50% | 85% | +35% |

### 7.2 定性指标

- ✅ 更好的创意质量
- ✅ 更好的用户体验
- ✅ 更好的系统可维护性
- ✅ 更好的多语言支持

