# 关键词优化 V3 - 快速参考指南

## 🎯 核心需求（6个）

| # | 需求 | 状态 | 说明 |
|---|------|------|------|
| 1 | 扩展AI生成关键词到20-30个 | ✅ | 原10-15个 → 新20-30个 |
| 2 | 移除竞争度筛选 | ✅ | 不排除高竞争词 |
| 3 | 确保真实搜索量 | ✅ | 所有关键词 > 0/月 |
| 4 | 灵活的数量要求 | ✅ | 5-30个，根据市场情况 |
| 5 | 不需要无搜索量关键词 | ✅ | 直接过滤，不用备选市场 |
| 6 | 品牌词扩展包含品牌词 | ✅ | 必须包含品牌名 |

---

## 🔄 简化的V3流程

```
AI生成 (20-30)
    ↓
查询搜索量
    ↓
过滤 = 0 ❌ 直接删除
    ↓
保留 > 0 ✅ 全部保留
    ↓
品牌词扩展 (必须包含品牌名)
    ↓
最终关键词 (5-30个)
```

---

## 📝 代码修改清单

### 修改1: Prompt (第420-450行)

```diff
- ### KEYWORDS (10-15 required)
+ ### KEYWORDS (20-30 required)

- **第一优先级 - 品牌短尾词 (必须生成4-6个)**
+ **第一优先级 - 品牌短尾词 (必须生成8-10个)**

- **第二优先级 - 产品核心词 (必须生成3-5个)**
+ **第二优先级 - 产品核心词 (必须生成6-8个)**

- **第三优先级 - 购买意图词 (必须生成2-3个)**
+ **第三优先级 - 购买意图词 (必须生成3-5个)**

- **第四优先级 - 长尾精准词 (可选，最多2-3个)**
+ **第四优先级 - 长尾精准词 (必须生成3-7个)**
```

### 修改2: 过滤逻辑 (第930-960行)

```diff
- // 分层处理
- const keywordsByTier = {
-   tier1: keywordsWithVolume.filter(kw => kw.searchVolume >= 1000),
-   tier2: keywordsWithVolume.filter(kw => kw.searchVolume >= 100 && kw.searchVolume < 1000),
-   tier3: keywordsWithVolume.filter(kw => kw.searchVolume >= 1 && kw.searchVolume < 100),
-   tier4: keywordsWithVolume.filter(kw => kw.searchVolume > 0 && kw.searchVolume < 1),
-   noData: keywordsWithVolume.filter(kw => kw.searchVolume === 0)
- }

+ // 简化过滤：只过滤搜索量为0
+ const validKeywords = keywordsWithVolume.filter(kw => {
+   if (kw.searchVolume <= 0) {
+     console.log(`⚠️ 过滤无搜索量关键词: "${kw.keyword}"`)
+     return false
+   }
+   return true
+ })

- // 处理无搜索量的关键词（移除所有备选市场和估计逻辑）
- if (keywordsByTier.noData.length > 0) {
-   // 方案A: 使用备选市场 ❌ 删除
-   // 方案B: 标记为估计 ❌ 删除
-   // 方案C: 使用AI估计 ❌ 删除
- }

- // 合并所有有搜索量的关键词
- const allValidKeywords = [
-   ...keywordsByTier.tier1,
-   ...keywordsByTier.tier2,
-   ...keywordsByTier.tier3,
-   ...keywordsByTier.tier4
- ]

+ const removedCount = keywordsWithVolume.length - validKeywords.length
+ if (removedCount > 0) {
+   console.log(`🔧 已过滤 ${removedCount} 个无搜索量关键词`)
+ }

- result.keywords = allValidKeywords.map(kw => kw.keyword)
- keywordsWithVolume = allValidKeywords
+ result.keywords = validKeywords.map(kw => kw.keyword)
+ keywordsWithVolume = validKeywords
```

### 修改3: 品牌词扩展 (第1000-1015行)

```diff
  const brandKeywords = keywordIdeas
    .filter(idea => {
+     // ✅ 必须有搜索量
      if (idea.avgMonthlySearches <= 0) {
+       console.log(`⚠️ 过滤无搜索量品牌关键词: "${idea.text}"`)
        return false
      }
+
+     // ✅ 必须包含品牌名
+     const keywordText = idea.text.toLowerCase()
+     const brandLower = brandName.toLowerCase()
+     if (!keywordText.includes(brandLower)) {
+       console.log(`⚠️ 过滤不包含品牌名的关键词: "${idea.text}"`)
+       return false
+     }
+
+     // ❌ 不过滤竞争度
      return true
    })
```

### 修改4: 数量检查 (第1040-1055行)

```diff
- // 强制最小数量
- if (removedCount > 0) {
-   console.log(`🔧 已过滤 ${removedCount} 个低搜索量关键词`)
- }

+ // 灵活的数量要求
+ if (result.keywords.length < 5) {
+   console.warn(`⚠️ 警告: 仅找到 ${result.keywords.length} 个有真实搜索量的关键词`)
+   console.warn(`   品牌 "${brandName}" 在 ${country} 市场的搜索量数据有限`)
+ } else if (result.keywords.length >= 15) {
+   console.log(`✅ 关键词充足: ${result.keywords.length}个有真实搜索量的关键词`)
+ } else {
+   console.log(`ℹ️ 关键词数量: ${result.keywords.length}个`)
+ }
```

---

## 📊 关键词分布示例

### 高搜索量品牌（如 Apple）

```
AI生成: 25个
  ├─ 品牌词: 9个
  ├─ 产品词: 7个
  ├─ 购买词: 4个
  └─ 长尾词: 5个

查询搜索量:
  ├─ > 0: 24个 ✅ 保留
  └─ = 0: 1个 ❌ 过滤

品牌词扩展:
  ├─ 包含品牌名: 8个 ✅ 保留
  └─ 不包含品牌名: 2个 ❌ 过滤

最终: 32个关键词
  ├─ >= 1000/月: 15个
  ├─ 100-1000/月: 10个
  ├─ 1-100/月: 5个
  └─ 0.1-1/月: 2个
```

### 低搜索量品牌（如小众品牌）

```
AI生成: 25个
  ├─ 品牌词: 9个
  ├─ 产品词: 7个
  ├─ 购买词: 4个
  └─ 长尾词: 5个

查询搜索量:
  ├─ > 0: 12个 ✅ 保留
  └─ = 0: 13个 ❌ 过滤

品牌词扩展:
  ├─ 包含品牌名: 5个 ✅ 保留
  └─ 不包含品牌名: 3个 ❌ 过滤

最终: 17个关键词 ✅ 灵活数量
  ├─ >= 1000/月: 2个
  ├─ 100-1000/月: 4个
  ├─ 1-100/月: 6个
  └─ 0.1-1/月: 5个
```

---

## ✅ 测试检查清单

- [ ] AI生成关键词数量是否为20-30个？
- [ ] 所有最终关键词的搜索量是否都 > 0？
- [ ] 是否过滤掉了所有搜索量为0的关键词？
- [ ] 品牌词扩展的关键词是否都包含品牌名？
- [ ] 是否保留了高竞争词（没有过滤竞争度）？
- [ ] 数量是否灵活（5-30个，根据市场情况）？
- [ ] 日志输出是否清晰？

---

## 🔗 相关文件

| 文件 | 说明 |
|------|------|
| `src/lib/ad-creative-generator.ts:420-450` | Prompt 修改 |
| `src/lib/ad-creative-generator.ts:930-960` | 过滤逻辑修改 |
| `src/lib/ad-creative-generator.ts:1000-1015` | 品牌词扩展修改 |
| `src/lib/ad-creative-generator.ts:1040-1055` | 数量检查修改 |
| `KEYWORD_OPTIMIZATION_PLAN_V3.md` | 完整优化方案 |

---

## 📈 预期效果

| 指标 | 原方案 | V3方案 | 改进 |
|------|--------|--------|------|
| AI生成数量 | 10-15 | 20-30 | +100% |
| 最终数量 | 8-12 | 5-20 | +50% |
| 真实搜索量比例 | 60% | 100% | +67% |
| 高竞争词占比 | 0% | 20-30% | 新增 |
| 品牌词质量 | 中等 | 高 | 改进 |

---

## 🚀 快速开始

1. **阅读完整方案**: `KEYWORD_OPTIMIZATION_PLAN_V3.md`
2. **按照修改清单**: 修改4个位置的代码
3. **运行测试**: 验证关键词生成效果
4. **监控日志**: 确保过滤和扩展逻辑正确
5. **上线部署**: 逐步推出到生产环境

---

## 📝 修改记录

- 2025-11-28: 创建 V3 快速参考指南
