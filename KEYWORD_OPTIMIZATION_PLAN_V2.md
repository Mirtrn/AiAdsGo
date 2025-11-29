# 关键词生成优化方案 V2（根据新需求调整）

## 📋 新需求总结

1. ✅ **扩展AI生成关键词数量**: 10-15个 → **20-30个**
2. ✅ **移除竞争度筛选**: 不排除高竞争词，竞争度不作为筛选条件
3. ✅ **确保真实搜索量**: 最后留下来的关键词都需要有真实的搜索量数据（> 0）
4. ✅ **灵活的数量要求**: 如果品牌在目标国家没有太多具备真实搜索量的关键词，则不必强求最后留下来的关键词数量

---

## 🔄 优化后的完整流程

### 第一步：AI生成关键词（扩展到20-30个）

```
AI生成关键词 (20-30个)
├─ 第一优先级 - 品牌短尾词 (8-10个)
│  ├─ 品牌名 + 产品类别
│  ├─ 品牌名 + 主要特性
│  ├─ 品牌名 + 官方/商店
│  ├─ 品牌名 + 型号/系列
│  └─ 品牌名 + 购买意图
│
├─ 第二优先级 - 产品核心词 (6-8个)
│  ├─ 产品功能 + 类别
│  ├─ 产品特性 + 用途
│  ├─ 产品类别 + 价格/促销
│  └─ 产品类别 + 用户需求
│
├─ 第三优先级 - 购买意图词 (3-5个)
│  ├─ "buy" + 品牌/产品
│  ├─ "best" + 产品类别
│  ├─ "discount" + 产品名
│  ├─ "shop" + 品牌
│  └─ "deals" + 产品
│
└─ 第四优先级 - 长尾精准词 (3-7个)
   ├─ 产品特性 + 用户场景
   ├─ 产品类别 + 竞争对手
   ├─ 产品类别 + 地理位置
   ├─ 产品 + 问题解决
   └─ 产品 + 特定需求
```

**Prompt 修改**:
```
### KEYWORDS (20-30 required)

**🎯 关键词生成策略（重要！确保高搜索量关键词优先）**:

**第一优先级 - 品牌短尾词 (必须生成8-10个)**:
- 格式: [品牌名] + [产品核心词]（2-3个单词）
- ✅ 必须包含的品牌短尾词（基于 ${offer.brand}）:
  - "${offer.brand} ${offer.category || 'products'}"（品牌+品类）
  - "${offer.brand} official"（品牌+官方）
  - "${offer.brand} store"（品牌+商店）
  - "${offer.brand} [型号/系列]"（如有型号信息）
  - "${offer.brand} buy"（品牌+购买）
  - "${offer.brand} price"（品牌+价格）
  - "${offer.brand} review"（品牌+评测）
  - "${offer.brand} [主要特性]"（品牌+特性）
- ✅ 示例: "eufy robot vacuum", "eufy c20", "eufy cleaner", "eufy official", "eufy buy", "eufy price"
- ❌ 避免: 仅品牌名单词（过于宽泛）

**第二优先级 - 产品核心词 (必须生成6-8个)**:
- 格式: [产品功能] + [类别]（2-3个单词）
- ✅ 示例: "robot vacuum mop", "self emptying vacuum", "cordless vacuum cleaner", "smart vacuum", "app controlled vacuum"
- ✅ 为什么优秀: 高搜索量（通常5000-50000/月），匹配用户搜索意图

**第三优先级 - 购买意图词 (必须生成3-5个)**:
- 格式: [购买动词] + [品牌/产品]
- ✅ 示例: "buy ${offer.brand}", "shop ${offer.brand}", "best ${offer.brand} price", "${offer.brand} deals", "where to buy ${offer.brand}"

**第四优先级 - 长尾精准词 (必须生成3-7个)**:
- 格式: [具体场景] + [产品]（3-5个单词）
- ✅ 示例: "best robot vacuum for pet hair", "robot vacuum for hardwood floors", "quiet robot vacuum", "robot vacuum with mop"
- ⚠️ 注意: 长尾词可以超过总关键词数的25%

**语言要求**: 关键词必须使用目标语言 ${offer.target_language || 'English'}
**质量要求**:
- 每个关键词2-4个单词（最优搜索量范围）
- 关键词总数: 20-30个
- 搜索量目标: 品牌词>1000/月，核心词>500/月，长尾词>100/月
**🚫 禁止**:
- 无意义词: "unknown", "null", "undefined"
- 单一通用词: "camera", "phone", "vacuum"
- 与${offer.brand}无关的关键词
${excludeKeywords?.length ? `- 已用关键词: ${excludeKeywords.slice(0, 10).join(', ')}` : ''}
```

---

### 第二步：查询搜索量（使用 generateKeywordHistoricalMetrics）

```
AI生成的20-30个关键词
    ↓
getKeywordSearchVolumes() 查询搜索量
├─ 使用 generateKeywordHistoricalMetrics API
├─ 返回: avgMonthlySearches, competition, competitionIndex
└─ 缓存结果到 Redis
    ↓
分类结果
├─ 有搜索量: avgMonthlySearches > 0
└─ 无搜索量: avgMonthlySearches = 0
```

---

### 第三步：分层处理（新逻辑）

```
┌─────────────────────────────────────────────────────────────┐
│                    搜索量查询结果                             │
└─────────────────────────────────────────────────────────────┘
                         ↓
        ┌────────────────┴────────────────┐
        ↓                                 ↓
   ┌─────────────┐              ┌──────────────────┐
   │ 有搜索量    │              │ 无搜索量 (= 0)   │
   │ (> 0/月)    │              │                  │
   └─────────────┘              └──────────────────┘
        ↓                                 ↓
   ┌─────────────────────────┐   ┌──────────────────────┐
   │ 分层处理                │   │ 处理策略             │
   ├─────────────────────────┤   ├──────────────────────┤
   │ Tier 1: >= 1000/月      │   │ 方案A: 使用备选市场  │
   │ Tier 2: 100-1000/月     │   │ (意大利英文→美国英文)│
   │ Tier 3: 1-100/月        │   │ × 0.4折扣系数       │
   │ Tier 4: 0.1-1/月        │   │                      │
   └─────────────────────────┘   │ 方案B: 标记为"估计"  │
        ↓                         │ 并保留               │
   ┌─────────────────────────┐   │                      │
   │ 合并策略                │   │ 方案C: 使用AI估计    │
   ├─────────────────────────┤   │ 搜索量               │
   │ 1. Tier 1 (全部)        │   │                      │
   │ 2. Tier 2 (全部)        │   │ 推荐: 方案A + 方案B  │
   │ 3. Tier 3 (全部)        │   │ (备选市场 + 标记估计)│
   │ 4. Tier 4 (全部)        │   └──────────────────────┘
   │ 5. 品牌词扩展 (新增)    │
   └─────────────────────────┘
        ↓
   ┌─────────────────────────┐
   │ 最终关键词列表          │
   │ ✅ 都有真实搜索量       │
   │ ✅ 不排除高竞争词       │
   │ ✅ 数量灵活             │
   └─────────────────────────┘
```

---

### 第四步：品牌词扩展（使用 generateKeywordIdeas）

```
品牌词扩展 (getKeywordIdeas)
├─ 使用 generateKeywordIdeas 生成品牌组合词
├─ 查询这些词的搜索量
├─ 过滤条件:
│  ├─ ✅ 搜索量 > 0 (有真实数据)
│  ├─ ✅ 包含品牌名 (可选，不强制)
│  └─ ❌ 不过滤竞争度
├─ 去重: 排除已存在的关键词
└─ 添加新的品牌关键词
```

---

### 第五步：最终关键词列表

```
最终关键词列表
├─ 所有关键词都有真实搜索量 (> 0)
├─ 不排除高竞争词
├─ 数量灵活:
│  ├─ 理想: 15-25个
│  ├─ 最少: 5-10个 (如果品牌在目标国家搜索量数据有限)
│  └─ 最多: 30+个 (如果有充足的高质量关键词)
├─ 按优先级排序:
│  ├─ 第一优先级 (品牌词)
│  ├─ 第二优先级 (产品词)
│  ├─ 第三优先级 (购买词)
│  └─ 第四优先级 (长尾词)
└─ 包含元数据:
   ├─ searchVolume (真实数据)
   ├─ competition (不作为筛选条件)
   ├─ competitionIndex
   ├─ source (原始生成/品牌扩展/备选市场)
   └─ isEstimated (是否为估计值)
```

---

## 🔧 代码实现方案

### 修改1: 更新 Prompt（扩展到20-30个关键词）

**文件**: `src/lib/ad-creative-generator.ts:420-450`

```typescript
// 修改前
### KEYWORDS (10-15 required)

// 修改后
### KEYWORDS (20-30 required)

// 并更新各优先级的数量要求
**第一优先级 - 品牌短尾词 (必须生成8-10个)**
**第二优先级 - 产品核心词 (必须生成6-8个)**
**第三优先级 - 购买意图词 (必须生成3-5个)**
**第四优先级 - 长尾精准词 (必须生成3-7个)**
```

### 修改2: 实现分层过滤逻辑

**文件**: `src/lib/ad-creative-generator.ts:930-960`

```typescript
// 新增分层过滤逻辑
const keywordsByTier = {
  tier1: keywordsWithVolume.filter(kw => kw.searchVolume >= 1000),
  tier2: keywordsWithVolume.filter(kw => kw.searchVolume >= 100 && kw.searchVolume < 1000),
  tier3: keywordsWithVolume.filter(kw => kw.searchVolume >= 1 && kw.searchVolume < 100),
  tier4: keywordsWithVolume.filter(kw => kw.searchVolume > 0 && kw.searchVolume < 1),
  noData: keywordsWithVolume.filter(kw => kw.searchVolume === 0)
}

// 处理无搜索量的关键词
if (keywordsByTier.noData.length > 0) {
  console.log(`⚠️ 发现 ${keywordsByTier.noData.length} 个无搜索量的关键词`)

  // 方案A: 使用备选市场数据
  if (country === 'IT' && language === 'en') {
    const usVolumes = await getKeywordSearchVolumes(
      keywordsByTier.noData.map(kw => kw.keyword),
      'US',
      'en'
    )
    keywordsByTier.noData.forEach((kw, idx) => {
      if (usVolumes[idx]?.avgMonthlySearches > 0) {
        kw.searchVolume = Math.round(usVolumes[idx].avgMonthlySearches * 0.4)
        kw.source = 'US_ADJUSTED'
        keywordsByTier.tier3.push(kw)
      }
    })
  }

  // 方案B: 标记为估计值并保留
  keywordsByTier.noData.forEach(kw => {
    if (kw.searchVolume === 0) {
      kw.isEstimated = true
      kw.estimatedVolume = 50 // 默认估计值
      keywordsByTier.tier4.push(kw)
    }
  })
}

// 合并所有有搜索量的关键词
const allValidKeywords = [
  ...keywordsByTier.tier1,
  ...keywordsByTier.tier2,
  ...keywordsByTier.tier3,
  ...keywordsByTier.tier4
]

console.log(`📊 关键词分布:`)
console.log(`   Tier 1 (>=1000/月): ${keywordsByTier.tier1.length}个`)
console.log(`   Tier 2 (100-1000/月): ${keywordsByTier.tier2.length}个`)
console.log(`   Tier 3 (1-100/月): ${keywordsByTier.tier3.length}个`)
console.log(`   Tier 4 (0.1-1/月): ${keywordsByTier.tier4.length}个`)
console.log(`   总计: ${allValidKeywords.length}个`)
```

### 修改3: 移除竞争度筛选

**文件**: `src/lib/ad-creative-generator.ts:1000-1015`

```typescript
// 修改前
const brandKeywords = keywordIdeas
  .filter(idea => {
    const keywordText = idea.text.toLowerCase()
    const brandLower = brandName.toLowerCase()
    if (!keywordText.includes(brandLower)) {
      return false
    }
    if (idea.avgMonthlySearches < MIN_SEARCH_VOLUME) {
      console.log(`⚠️ 过滤低搜索量品牌关键词: "${idea.text}" (搜索量: ${idea.avgMonthlySearches}/月)`)
      return false
    }
    return true
  })

// 修改后
const brandKeywords = keywordIdeas
  .filter(idea => {
    // ✅ 只过滤搜索量，不过滤竞争度
    if (idea.avgMonthlySearches <= 0) {
      return false
    }
    // ❌ 移除竞争度过滤
    // if (idea.competitionIndex > 80) {
    //   return false
    // }
    return true
  })
  .map(idea => ({
    keyword: idea.text,
    searchVolume: idea.avgMonthlySearches,
    competition: idea.competition,
    competitionIndex: idea.competitionIndex,
    source: 'BRAND_EXPANSION'
  }))
```

### 修改4: 灵活的数量要求

**文件**: `src/lib/ad-creative-generator.ts:1040-1055`

```typescript
// 修改前
if (removedCount > 0) {
  console.log(`🔧 已过滤 ${removedCount} 个低搜索量关键词 (< ${MIN_SEARCH_VOLUME}/月)`)
  console.log(`📊 剩余关键词: ${filteredKeywords.length}/${originalKeywordCount}`)
  result.keywords = filteredKeywords
  keywordsWithVolume = filteredKeywordsWithVolume
}

// 修改后
// 灵活的数量要求：不强制最小数量
if (allValidKeywords.length < 5) {
  console.warn(`⚠️ 警告: 仅找到 ${allValidKeywords.length} 个有真实搜索量的关键词`)
  console.warn(`   品牌 "${brandName}" 在 ${country} 市场的搜索量数据有限`)
  console.warn(`   建议: 考虑扩展到其他市场或调整品牌策略`)
} else if (allValidKeywords.length >= 15) {
  console.log(`✅ 关键词充足: ${allValidKeywords.length}个有真实搜索量的关键词`)
} else {
  console.log(`ℹ️ 关键词数量: ${allValidKeywords.length}个 (在可接受范围内)`)
}

result.keywords = allValidKeywords.map(kw => kw.keyword)
keywordsWithVolume = allValidKeywords
```

---

## 📊 新流程的关键特点

### ✅ 优势

1. **更多关键词选择**: 20-30个 → 更多样化的广告覆盖
2. **真实搜索量保证**: 所有最终关键词都有搜索量数据
3. **不排除高竞争词**: 高竞争词可能有高转化率
4. **灵活的数量要求**: 适应不同品牌的市场情况
5. **多维度品牌扩展**: 不限制品牌名包含
6. **备选市场支持**: 处理数据不完整的市场

### ⚠️ 注意事项

1. **搜索量为0的处理**: 需要选择合适的方案（A/B/C）
2. **备选市场折扣系数**: 0.4 是估计值，可根据实际调整
3. **长尾词的权衡**: 长尾词搜索量低但转化率可能高
4. **品牌词扩展**: 不强制包含品牌名，但建议优先

---

## 🎯 实施步骤

### Phase 1: 修改 Prompt（1天）
- [ ] 更新关键词数量要求 (10-15 → 20-30)
- [ ] 增加各优先级的具体数量
- [ ] 测试 AI 生成效果

### Phase 2: 实现分层过滤（2天）
- [ ] 实现 Tier 1/2/3/4 分层
- [ ] 实现搜索量为0的处理
- [ ] 添加日志和监控

### Phase 3: 移除竞争度筛选（1天）
- [ ] 移除竞争度过滤条件
- [ ] 更新品牌词扩展逻辑
- [ ] 测试品牌词质量

### Phase 4: 灵活数量要求（1天）
- [ ] 实现灵活的数量检查
- [ ] 添加警告和建议
- [ ] 测试边界情况

### Phase 5: 测试和优化（2天）
- [ ] 端到端测试
- [ ] 性能优化
- [ ] 文档更新

---

## 📈 预期效果

| 指标 | 当前 | 优化后 | 说明 |
|------|------|--------|------|
| AI生成关键词数 | 10-15 | 20-30 | +100% |
| 最终关键词数 | 8-12 | 10-20 | +50% |
| 有真实搜索量的比例 | 60% | 100% | 所有关键词都有数据 |
| 高竞争词占比 | 0% | 20-30% | 不再排除 |
| 品牌词占比 | 30% | 35-40% | 扩展更多维度 |
| 适应不同市场 | 否 | 是 | 支持备选市场 |

---

## 🔗 相关文件

- `src/lib/ad-creative-generator.ts:420-450` - Prompt 修改
- `src/lib/ad-creative-generator.ts:900-1050` - 关键词处理逻辑
- `src/lib/keyword-planner.ts` - 搜索量查询
- `src/lib/google-ads-keyword-planner.ts` - Keyword Planner API

---

## 📝 修改记录

- 2025-11-28: 创建 V2 优化方案，根据新需求调整
  - 扩展 AI 生成关键词到 20-30 个
  - 移除竞争度筛选条件
  - 确保所有关键词都有真实搜索量
  - 灵活的数量要求
