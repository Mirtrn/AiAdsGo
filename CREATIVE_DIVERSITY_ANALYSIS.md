# 广告创意多样性问题分析与解决方案

**分析时间**: 2025-11-29
**问题**: Offer 237 的 3 个广告创意相似度过高 (>20%)
**目标**: 确保相似度 ≤20%

---

## 📋 问题描述

在 `/offers/237/launch` 下显示的 3 个广告创意在以下方面相似度太高：
- 标题 (Headlines)
- 描述 (Descriptions)
- 关键词 (Keywords)
- 附加信息 (Callouts)
- 附加链接 (Sitelinks)

**要求**: 所有元素的相似度都不高于 20%

---

## 🔍 根本原因分析

### 1. AI Prompt 中的多样性指导不足

**当前 Prompt** (第 500-614 行):
```typescript
### HEADLINES (15 required, ≤30 chars each)
Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)
Quality: 8+ with keywords, 5+ with numbers, 3+ with urgency, <20% text similarity
```

**问题**:
- ✗ 只有一个 `<20% text similarity` 的要求
- ✗ 没有具体的多样性策略
- ✗ 没有明确的类型分布要求
- ✗ 没有禁止重复短语的指导

### 2. 相似度计算算法不够精确

**当前算法** (第 722-730 行):
```typescript
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/))
  const words2 = new Set(text2.toLowerCase().split(/\s+/))

  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])

  return union.size > 0 ? intersection.size / union.size : 0
}
```

**问题**:
- ✗ 使用 Jaccard 相似度（词集合）
- ✗ 忽略词序和语义
- ✗ 对短文本不够敏感
- ✗ 无法检测同义词替换

### 3. 多样性验证缺失

**当前状态**:
- ✗ 生成后没有相似度检查
- ✗ 没有过滤相似度过高的创意
- ✗ 没有强制重新生成的机制

---

## 💡 解决方案

### 方案 1: 增强 AI Prompt 的多样性指导

**改进内容**:

```typescript
### HEADLINES (15 required, ≤30 chars each)
**DIVERSITY REQUIREMENT**:
- Maximum 20% text similarity between any two headlines
- Each headline must have a UNIQUE angle or focus
- Avoid repeating the same keywords, phrases, or structures

**Type Distribution (MANDATORY)**:
- Brand (2): Focus on brand name and trust signals
  * "Samsung Official Store"
  * "Trusted Samsung Retailer"
- Feature (4): Focus on different product features
  * "4K Resolution Display"
  * "Extended Battery Life"
  * "Smart Navigation System"
  * "Eco-Friendly Design"
- Promo (3): Focus on different promotional angles
  * "Save 40% Today"
  * "$100 Off This Week"
  * "Limited Time Offer"
- CTA (3): Focus on different call-to-action angles
  * "Shop Now"
  * "Get Yours Today"
  * "Claim Your Deal"
- Urgency (2): Focus on different urgency signals
  * "Only 5 Left in Stock"
  * "Ends Tomorrow"

**Uniqueness Checklist**:
- ✓ No headline should repeat more than 2 words from another
- ✓ Each headline should have a different primary keyword
- ✓ Vary the sentence structure (statement, question, command)
- ✓ Use different emotional triggers (trust, urgency, value, curiosity)
- ✓ Avoid using the same adjectives across headlines

**Examples of GOOD diversity**:
- "Samsung Galaxy S24" (brand focus)
- "4K Camera System" (feature focus)
- "Save 40% Today" (promo focus)
- "Shop Now" (CTA focus)
- "Limited Stock" (urgency focus)

**Examples of BAD diversity** (too similar):
- "Samsung Galaxy S24 Official"
- "Samsung Galaxy S24 Store"
- "Samsung Galaxy S24 Trusted"
(All focus on brand, repeat "Samsung Galaxy S24")
```

### 方案 2: 实现更精确的相似度计算

**改进算法** - 使用多种相似度指标:

```typescript
/**
 * 计算两个文本的综合相似度 (0-1)
 * 使用多种算法的加权平均
 */
function calculateAdvancedSimilarity(text1: string, text2: string): number {
  // 1. Jaccard 相似度 (词集合)
  const jaccardSimilarity = calculateJaccardSimilarity(text1, text2)

  // 2. Cosine 相似度 (词频向量)
  const cosineSimilarity = calculateCosineSimilarity(text1, text2)

  // 3. Levenshtein 相似度 (编辑距离)
  const levenshteinSimilarity = calculateLevenshteinSimilarity(text1, text2)

  // 4. 词序相似度 (N-gram)
  const ngramSimilarity = calculateNgramSimilarity(text1, text2)

  // 加权平均 (Jaccard 30%, Cosine 30%, Levenshtein 20%, N-gram 20%)
  const weightedSimilarity =
    jaccardSimilarity * 0.3 +
    cosineSimilarity * 0.3 +
    levenshteinSimilarity * 0.2 +
    ngramSimilarity * 0.2

  return Math.min(1, weightedSimilarity)
}

/**
 * Jaccard 相似度 (词集合)
 */
function calculateJaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/))
  const words2 = new Set(text2.toLowerCase().split(/\s+/))

  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])

  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * Cosine 相似度 (词频向量)
 */
function calculateCosineSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\s+/)
  const words2 = text2.toLowerCase().split(/\s+/)

  const allWords = new Set([...words1, ...words2])
  const vector1: Record<string, number> = {}
  const vector2: Record<string, number> = {}

  // 构建词频向量
  for (const word of allWords) {
    vector1[word] = words1.filter(w => w === word).length
    vector2[word] = words2.filter(w => w === word).length
  }

  // 计算点积
  let dotProduct = 0
  for (const word of allWords) {
    dotProduct += (vector1[word] || 0) * (vector2[word] || 0)
  }

  // 计算模
  const magnitude1 = Math.sqrt(Object.values(vector1).reduce((sum, val) => sum + val * val, 0))
  const magnitude2 = Math.sqrt(Object.values(vector2).reduce((sum, val) => sum + val * val, 0))

  return magnitude1 > 0 && magnitude2 > 0 ? dotProduct / (magnitude1 * magnitude2) : 0
}

/**
 * Levenshtein 相似度 (编辑距离)
 */
function calculateLevenshteinSimilarity(text1: string, text2: string): number {
  const distance = levenshteinDistance(text1, text2)
  const maxLength = Math.max(text1.length, text2.length)
  return maxLength > 0 ? 1 - distance / maxLength : 0
}

/**
 * 计算 Levenshtein 距离
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[str2.length][str1.length]
}

/**
 * N-gram 相似度 (词序)
 */
function calculateNgramSimilarity(text1: string, text2: string, n: number = 2): number {
  const ngrams1 = getNgrams(text1, n)
  const ngrams2 = getNgrams(text2, n)

  const intersection = ngrams1.filter(ng => ngrams2.includes(ng)).length
  const union = new Set([...ngrams1, ...ngrams2]).size

  return union > 0 ? intersection / union : 0
}

/**
 * 提取 N-gram
 */
function getNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().split(/\s+/)
  const ngrams: string[] = []

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '))
  }

  return ngrams
}
```

### 方案 3: 实现相似度检查和过滤

**在生成后添加验证**:

```typescript
/**
 * 检查创意集合中的相似度
 * 确保任意两个创意的相似度都 ≤ 20%
 */
function validateCreativeDiversity(
  creatives: GeneratedAdCreativeData[],
  maxSimilarity: number = 0.2
): {
  valid: boolean
  issues: string[]
  similarities: Array<{
    creative1Index: number
    creative2Index: number
    similarity: number
    type: 'headline' | 'description' | 'keyword' | 'callout' | 'sitelink'
  }>
} {
  const issues: string[] = []
  const similarities: any[] = []

  // 检查标题相似度
  for (let i = 0; i < creatives.length; i++) {
    for (let j = i + 1; j < creatives.length; j++) {
      const headlineSimilarity = calculateCreativeHeadlineSimilarity(
        creatives[i].headlines,
        creatives[j].headlines
      )

      if (headlineSimilarity > maxSimilarity) {
        issues.push(
          `创意 ${i} 和 ${j} 的标题相似度过高: ${(headlineSimilarity * 100).toFixed(1)}% > ${maxSimilarity * 100}%`
        )
        similarities.push({
          creative1Index: i,
          creative2Index: j,
          similarity: headlineSimilarity,
          type: 'headline'
        })
      }

      // 检查描述相似度
      const descriptionSimilarity = calculateCreativeDescriptionSimilarity(
        creatives[i].descriptions,
        creatives[j].descriptions
      )

      if (descriptionSimilarity > maxSimilarity) {
        issues.push(
          `创意 ${i} 和 ${j} 的描述相似度过高: ${(descriptionSimilarity * 100).toFixed(1)}% > ${maxSimilarity * 100}%`
        )
        similarities.push({
          creative1Index: i,
          creative2Index: j,
          similarity: descriptionSimilarity,
          type: 'description'
        })
      }

      // 检查关键词相似度
      const keywordSimilarity = calculateCreativeKeywordSimilarity(
        creatives[i].keywords,
        creatives[j].keywords
      )

      if (keywordSimilarity > maxSimilarity) {
        issues.push(
          `创意 ${i} 和 ${j} 的关键词相似度过高: ${(keywordSimilarity * 100).toFixed(1)}% > ${maxSimilarity * 100}%`
        )
        similarities.push({
          creative1Index: i,
          creative2Index: j,
          similarity: keywordSimilarity,
          type: 'keyword'
        })
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    similarities
  }
}

/**
 * 计算两个创意的标题相似度
 */
function calculateCreativeHeadlineSimilarity(
  headlines1: string[],
  headlines2: string[]
): number {
  let totalSimilarity = 0
  let comparisons = 0

  for (const h1 of headlines1) {
    for (const h2 of headlines2) {
      totalSimilarity += calculateAdvancedSimilarity(h1, h2)
      comparisons++
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 0
}

/**
 * 计算两个创意的描述相似度
 */
function calculateCreativeDescriptionSimilarity(
  descriptions1: string[],
  descriptions2: string[]
): number {
  let totalSimilarity = 0
  let comparisons = 0

  for (const d1 of descriptions1) {
    for (const d2 of descriptions2) {
      totalSimilarity += calculateAdvancedSimilarity(d1, d2)
      comparisons++
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 0
}

/**
 * 计算两个创意的关键词相似度
 */
function calculateCreativeKeywordSimilarity(
  keywords1: string[],
  keywords2: string[]
): number {
  const set1 = new Set(keywords1.map(k => k.toLowerCase()))
  const set2 = new Set(keywords2.map(k => k.toLowerCase()))

  const intersection = new Set([...set1].filter(k => set2.has(k)))
  const union = new Set([...set1, ...set2])

  return union.size > 0 ? intersection.size / union.size : 0
}
```

### 方案 4: 在生成流程中集成多样性检查

**修改生成函数**:

```typescript
/**
 * 生成多个广告创意，确保多样性
 */
export async function generateMultipleCreativesWithDiversityCheck(
  offerId: number,
  count: number = 3,
  maxSimilarity: number = 0.2,
  maxRetries: number = 3
): Promise<GeneratedAdCreativeData[]> {
  const creatives: GeneratedAdCreativeData[] = []
  let retries = 0

  while (creatives.length < count && retries < maxRetries) {
    // 生成一个新的创意
    const newCreative = await generateAdCreative(offerId, undefined, {
      skipCache: true,
      excludeKeywords: creatives.flatMap(c => c.keywords) // 排除已使用的关键词
    })

    // 检查与现有创意的相似度
    let isDiverse = true
    for (const existing of creatives) {
      const headlineSimilarity = calculateCreativeHeadlineSimilarity(
        newCreative.headlines,
        existing.headlines
      )
      const descriptionSimilarity = calculateCreativeDescriptionSimilarity(
        newCreative.descriptions,
        existing.descriptions
      )
      const keywordSimilarity = calculateCreativeKeywordSimilarity(
        newCreative.keywords,
        existing.keywords
      )

      if (
        headlineSimilarity > maxSimilarity ||
        descriptionSimilarity > maxSimilarity ||
        keywordSimilarity > maxSimilarity
      ) {
        isDiverse = false
        console.warn(
          `⚠️ 新创意与现有创意相似度过高，重新生成...`
        )
        break
      }
    }

    if (isDiverse) {
      creatives.push(newCreative)
      console.log(`✅ 创意 ${creatives.length} 通过多样性检查`)
    } else {
      retries++
    }
  }

  if (creatives.length < count) {
    console.warn(
      `⚠️ 仅生成了 ${creatives.length} 个多样化创意，未达到目标 ${count} 个`
    )
  }

  return creatives
}
```

---

## 📊 改进对比

### 相似度计算

| 算法 | 精确度 | 速度 | 优点 | 缺点 |
|------|--------|------|------|------|
| Jaccard | 中 | 快 | 简单 | 忽略词序 |
| Cosine | 高 | 中 | 考虑词频 | 计算复杂 |
| Levenshtein | 高 | 慢 | 考虑编辑距离 | 对长文本慢 |
| N-gram | 高 | 中 | 考虑词序 | 参数敏感 |
| **加权平均** | **很高** | **中** | **综合优点** | **计算量大** |

### 多样性检查

| 阶段 | 之前 | 之后 | 改进 |
|------|------|------|------|
| AI Prompt | ⚠️ 基础 | ✅ 详细 | +多样性指导 |
| 生成后验证 | ❌ 无 | ✅ 有 | +相似度检查 |
| 过滤机制 | ❌ 无 | ✅ 有 | +自动重新生成 |
| 相似度计算 | ⚠️ 简单 | ✅ 精确 | +多算法加权 |

---

## 🎯 实施计划

### 第 1 阶段: 增强 Prompt (立即)
- [ ] 更新 AI Prompt 中的多样性指导
- [ ] 添加具体的类型分布要求
- [ ] 添加禁止重复短语的指导

### 第 2 阶段: 改进相似度计算 (本周)
- [ ] 实现 `calculateAdvancedSimilarity()` 函数
- [ ] 实现多种相似度算法
- [ ] 添加加权平均逻辑

### 第 3 阶段: 实现验证和过滤 (本周)
- [ ] 实现 `validateCreativeDiversity()` 函数
- [ ] 实现 `generateMultipleCreativesWithDiversityCheck()` 函数
- [ ] 添加自动重新生成机制

### 第 4 阶段: 测试和优化 (本周末)
- [ ] 创建单元测试
- [ ] 测试 Offer 237
- [ ] 验证相似度 ≤20%

---

## ✅ 验证清单

### Prompt 改进
- [ ] 添加多样性要求
- [ ] 添加类型分布要求
- [ ] 添加禁止重复短语的指导
- [ ] 提供具体的好坏例子

### 相似度计算
- [ ] 实现 Jaccard 相似度
- [ ] 实现 Cosine 相似度
- [ ] 实现 Levenshtein 相似度
- [ ] 实现 N-gram 相似度
- [ ] 实现加权平均

### 验证和过滤
- [ ] 实现多样性验证
- [ ] 实现自动重新生成
- [ ] 添加详细的日志
- [ ] 添加错误处理

### 测试
- [ ] 单元测试
- [ ] 集成测试
- [ ] Offer 237 测试
- [ ] 性能测试

---

## 📈 预期效果

### 相似度改进
- **之前**: 相似度 > 20% (不符合要求)
- **之后**: 相似度 ≤ 20% (符合要求)

### 创意质量
- **多样性**: 从低到高
- **独特性**: 从低到高
- **用户体验**: 从差到好

### 系统性能
- **生成时间**: +20-30% (需要重新生成)
- **计算复杂度**: O(n²) → O(n² * m) (m 为相似度计算复杂度)
- **内存占用**: 略微增加

---

**分析完成**: 2025-11-29
**状态**: 准备实施
**下一步**: 开始第 1 阶段 - 增强 Prompt

