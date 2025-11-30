# 关键词/标题/描述生成规则综合指南

## 📋 执行摘要

本文档系统整理了AutoAds中关键词、标题、描述的完整生成规则、约束条件和最佳实践。

---

## 第一部分：标题（Headlines）生成规则

### 1.1 基本约束

| 约束项 | 要求 | 优先级 | 备注 |
|--------|------|--------|------|
| **数量** | 15个必需（允许3-15个） | P0 | Google Ads最优实践 |
| **长度** | ≤30字符/条 | P0 | Google Ads硬限制 |
| **多样性** | 任意两条相似度≤20% | P0 | 质量评分维度 |
| **DKI格式** | 仅第一条可用{KeyWord:...} | P0 | Google Ads政策 |
| **禁止符号** | 不含★⭐©®™等 | P0 | Google Ads政策 |
| **禁止词汇** | 不含"100%", "best", "guarantee", "miracle" | P0 | Google Ads政策 |

### 1.2 类型覆盖要求

生成15条标题时，需要覆盖以下5种类型：

| 类型 | 数量 | 示例 | 焦点 |
|------|------|------|------|
| **Brand** | 2条 | "Official Eufy Store", "#1 Trusted Eufy" | 品牌认可、官方身份 |
| **Feature** | 4条 | "4K Resolution", "Extended Battery", "Smart Navigation", "Eco-Friendly" | 产品特性、技术规格 |
| **Promo** | 3条 | "Save 30% Today", "Limited Time Offer", "Free Shipping" | 优惠、促销、限时 |
| **CTA** | 3条 | "Shop Now", "Get Yours Today", "Claim Your Deal" | 行动号召、紧迫感 |
| **Urgency** | 2条 | "Only 5 Left in Stock", "Ends Tomorrow" | 稀缺性、时间限制 |

### 1.3 质量指标

生成的15条标题应满足以下质量指标：

- **关键词密度**：8+条含关键词（相关性评分）
- **数字密度**：5+条含数字（吸引力评分）
- **紧迫感**：3+条含紧迫词（转化优化）
- **长度分布**：5短(10-20) + 5中(20-25) + 5长(25-30)

### 1.4 生成流程

```
1. 分析产品特性和关键词
   ↓
2. 为每种类型生成候选标题
   - Brand: 基于品牌名和官方身份
   - Feature: 基于产品特性和技术规格
   - Promo: 基于优惠和促销信息
   - CTA: 基于行动号召词
   - Urgency: 基于稀缺性和时间限制
   ↓
3. 过滤和优化
   - 移除超过30字符的标题
   - 移除含禁止符号/词汇的标题
   - 修复DKI标签
   ↓
4. 多样性检查
   - 计算任意两条标题的相似度
   - 移除相似度>20%的标题
   ↓
5. 质量检查
   - 验证关键词密度、数字密度、紧迫感
   - 验证长度分布
   ↓
6. 最终输出
   - 确保15条标题
   - 覆盖5种类型
   - 满足所有约束条件
```

---

## 第二部分：描述（Descriptions）生成规则

### 2.1 基本约束

| 约束项 | 要求 | 优先级 | 备注 |
|--------|------|--------|------|
| **数量** | 4个必需（允许2-4个） | P0 | Google Ads最优实践 |
| **长度** | ≤90字符/条 | P0 | Google Ads硬限制 |
| **多样性** | 任意两条相似度≤20% | P0 | 质量评分维度 |
| **CTA要求** | 每条必须包含CTA | P1 | 转化优化 |
| **禁止符号** | 不含★⭐©®™等 | P0 | Google Ads政策 |
| **禁止词汇** | 不含"100%", "best", "guarantee", "miracle" | P0 | Google Ads政策 |

### 2.2 焦点类型覆盖

生成4条描述时，需要覆盖以下4种焦点类型：

| 焦点类型 | 数量 | 示例 | 内容要素 |
|---------|------|------|---------|
| **Value** | 1条 | "Award-Winning Tech. Rated 4.8 stars by 50K+ customers." | 价值主张、社会证明 |
| **Action** | 1条 | "Shop Now for Fast, Free Delivery. Easy Returns Guaranteed." | 行动号召、便利性 |
| **Feature** | 1条 | "4K Resolution. Solar Powered. Works Rain or Shine." | 产品特性、优势 |
| **Proof** | 1条 | "Trusted by 100K+ Buyers. 30-Day Money-Back Promise." | 信任建立、保证 |

### 2.3 CTA集成策略

每条描述都必须包含CTA，但要避免过度相似：

**推荐的CTA变体**：
- "Shop Now" - 直接购买
- "Get Yours Today" - 立即获取
- "Claim Your Deal" - 领取优惠
- "Buy Today" - 今天购买
- "Discover More" - 了解更多
- "Learn More" - 学习更多
- "Start Free Trial" - 开始免费试用
- "Order Now" - 立即订购

**CTA放置策略**：
- Value描述：CTA放在句尾
- Action描述：CTA作为主要内容
- Feature描述：CTA作为补充
- Proof描述：CTA作为行动号召

### 2.4 社会证明要求

至少1条描述必须包含社会证明数据：

- **评分**：4.8/5, 4.9/5等
- **评论数**：50K+, 100K+等
- **用户数**：Trusted by X+ customers
- **销售数**：X+ sold, X+ purchases

### 2.5 生成流程

```
1. 分析产品价值和用户需求
   ↓
2. 为每种焦点类型生成候选描述
   - Value: 基于产品价值和社会证明
   - Action: 基于行动号召和便利性
   - Feature: 基于产品特性和优势
   - Proof: 基于信任建立和保证
   ↓
3. 集成CTA
   - 为每条描述添加合适的CTA
   - 确保CTA多样性
   ↓
4. 过滤和优化
   - 移除超过90字符的描述
   - 移除含禁止符号/词汇的描述
   ↓
5. 多样性检查
   - 计算任意两条描述的相似度
   - 移除相似度>20%的描述
   ↓
6. 质量检查
   - 验证每条都有CTA
   - 验证至少1条有社会证明
   ↓
7. 最终输出
   - 确保4条描述
   - 覆盖4种焦点类型
   - 满足所有约束条件
```

---

## 第三部分：关键词（Keywords）生成规则

### 3.1 基本约束

| 约束项 | 要求 | 优先级 | 备注 |
|--------|------|--------|------|
| **数量** | 20-30个 | P0 | Google Ads最优实践 |
| **单词数** | 1-4个单词/条 | P0 | 搜索意图匹配 |
| **语言** | 必须使用目标语言，不能混英文 | P0 | 多语言支持 |
| **去重** | 不能重复已用关键词 | P1 | 创意多样性 |
| **禁止内容** | 无意义词、单一通用词、无关词 | P0 | 质量控制 |

### 3.2 优先级分布

生成20-30个关键词时，需要按以下优先级分布：

| 优先级 | 类型 | 数量 | 搜索量要求 | 示例 |
|--------|------|------|-----------|------|
| **Brand** | 品牌词 | 8-10个 | >1000/月 | "eufy", "eufy robot", "eufy vacuum" |
| **Core** | 核心词 | 6-8个 | >500/月 | "robot vacuum", "smart vacuum", "automated cleaning" |
| **Intent** | 意图词 | 3-5个 | >300/月 | "best robot vacuum", "robot vacuum for pets", "affordable robot vacuum" |
| **LongTail** | 长尾词 | 3-7个 | >100/月 | "robot vacuum with app control", "quiet robot vacuum for small apartments" |

### 3.3 语言特定约束

不同语言的关键词生成需要调整约束：

| 语言 | 单词数限制 | 搜索量要求 | 备注 |
|------|-----------|-----------|------|
| **英文** | 1-4 | Brand>1000, Core>500 | 基准 |
| **德语** | 1-3 | Brand>800, Core>400 | 复合词较长 |
| **意大利语** | 1-4 | Brand>600, Core>300 | 表达较冗长 |
| **日语** | 1-2 | Brand>500, Core>250 | 字符更紧凑 |
| **中文** | 1-3 | Brand>800, Core>400 | 字符更紧凑 |

### 3.4 关键词验证规则

生成的关键词必须通过以下验证：

```typescript
function validateKeyword(keyword: string, language: string): boolean {
  // 1. 检查单词数
  const wordCount = keyword.split(/\s+/).length
  const maxWords = getLanguageConstraint(language, 'maxWords')
  if (wordCount > maxWords) return false

  // 2. 检查语言纯净性
  if (hasEnglishWords(keyword) && language !== 'en') return false

  // 3. 检查禁止内容
  if (containsForbiddenContent(keyword)) return false

  // 4. 检查重复
  if (isDuplicate(keyword)) return false

  // 5. 检查搜索量
  const searchVolume = getSearchVolume(keyword)
  const minVolume = getLanguageConstraint(language, 'minSearchVolume')
  if (searchVolume < minVolume) return false

  return true
}
```

### 3.5 生成流程

```
1. 分析品牌和产品
   ↓
2. 生成品牌词（Brand）
   - 品牌名
   - 品牌+产品类别
   - 品牌+特性
   ↓
3. 生成核心词（Core）
   - 产品类别
   - 产品类别+特性
   - 产品类别+用途
   ↓
4. 生成意图词（Intent）
   - 最佳+产品类别
   - 产品类别+对比
   - 产品类别+价格
   ↓
5. 生成长尾词（LongTail）
   - 产品类别+特定场景
   - 产品类别+用户群体
   - 产品类别+问题解决
   ↓
6. 验证和过滤
   - 检查单词数
   - 检查语言纯净性
   - 检查禁止内容
   - 检查重复
   - 检查搜索量
   ↓
7. 最终输出
   - 确保20-30个关键词
   - 满足优先级分布
   - 满足所有约束条件
```

---

## 第四部分：其他元素生成规则

### 4.1 Callouts（4-6个）

| 约束项 | 要求 | 备注 |
|--------|------|------|
| **数量** | 4-6个 | Google Ads标准 |
| **长度** | ≤25字符 | Google Ads硬限制 |
| **内容** | Prime资格、库存状态、徽章等 | 必须包含 |
| **禁止符号** | 不含★⭐©®™等 | Google Ads政策 |

**示例**：
- "Free Shipping"
- "30-Day Returns"
- "Prime Eligible"
- "Award Winner"
- "Best Seller"

### 4.2 Sitelinks（6个）

| 元素 | 约束 | 备注 |
|------|------|------|
| **文本** | ≤25字符 | Google Ads硬限制 |
| **描述** | ≤35字符 | Google Ads硬限制 |
| **焦点** | 每个必须有独特焦点 | 创意多样性 |

**示例**：
| 文本 | 描述 | 焦点 |
|------|------|------|
| "Shop Vacuums" | "Browse our full vacuum collection" | 产品浏览 |
| "Robot Vacuums" | "Smart cleaning solutions" | 产品类别 |
| "Deals & Offers" | "Save on select items today" | 促销 |
| "Customer Reviews" | "See what customers say" | 社会证明 |
| "Support & Help" | "Get answers to your questions" | 客户服务 |
| "About Us" | "Learn our story and mission" | 品牌信息 |

---

## 第五部分：约束冲突处理

### 5.1 P0严重冲突

#### 冲突1：多样性 vs 类型覆盖
**问题**：同类型标题天然相似度高，难以满足≤20%多样性要求

**解决方案**：
- 优先保留多样性
- 如果无法满足5种类型，降级到3-4种类型
- 确保不同类型之间的多样性

#### 冲突2：关键词数量 vs 语言纯净性
**问题**：某些语言难以找到20-30个有效关键词

**解决方案**：
- 按语言调整关键词数量要求
- 允许长尾词数量增加
- 降低搜索量要求

#### 冲突3：描述多样性 vs CTA要求
**问题**：每条都加CTA会导致相似度高

**解决方案**：
- 使用多样的CTA表达
- CTA放置位置多样化
- 优先保留多样性

### 5.2 约束松弛策略

当无法满足所有约束时，按以下优先级松弛：

```
P0（必须满足）
├─ 字符长度限制
├─ 禁止符号和词汇
├─ 基本数量要求
└─ 语言要求

P1（尽量满足）
├─ 多样性≤20%（可放宽到25%）
├─ 类型覆盖（可部分覆盖）
├─ 搜索量要求（可降低）
└─ 长度分布（可不完全满足）

P2（可选）
├─ 社会证明数据
├─ 关键词优先级分布
└─ 其他质量指标
```

---

## 第六部分：最佳实践

### 6.1 标题生成最佳实践

1. **多样化表达**：避免重复使用相同的词汇和结构
2. **关键词融合**：在标题中自然融合关键词
3. **数字吸引力**：使用具体数字（如"4K", "30%"）
4. **紧迫感**：使用时间限制词（"Today", "Limited"）
5. **品牌一致性**：确保品牌标题准确反映品牌身份

### 6.2 描述生成最佳实践

1. **焦点清晰**：每条描述有明确的焦点
2. **CTA自然**：CTA融合自然，不显得生硬
3. **社会证明**：使用真实的评分和评论数据
4. **行动导向**：鼓励用户采取行动
5. **简洁有力**：在90字符内表达完整信息

### 6.3 关键词生成最佳实践

1. **搜索意图匹配**：关键词与用户搜索意图匹配
2. **语言本地化**：使用本地语言表达，避免直译
3. **竞争力平衡**：平衡高竞争词和低竞争词
4. **长尾策略**：包含足够的长尾词
5. **定期更新**：根据搜索趋势更新关键词

---

## 第七部分：故障排除

### 常见问题

**Q1：生成的标题数不足15条**
- A：检查多样性过滤是否过严格，考虑放宽到25%
- A：检查是否有过多的禁止词汇被过滤
- A：增加初始生成数量

**Q2：关键词数不足20个**
- A：检查搜索量要求是否过高，考虑降低
- A：检查单词数限制是否过严格
- A：增加长尾词的比例

**Q3：描述相似度过高**
- A：使用更多样的CTA表达
- A：改变CTA放置位置
- A：增加焦点类型的多样性

**Q4：某些语言的关键词生成困难**
- A：调整该语言的单词数限制
- A：降低搜索量要求
- A：增加长尾词比例

---

## 附录：约束条件速查表

### 标题约束速查
- 数量：15个
- 长度：≤30字符
- 多样性：≤20%相似度
- 类型：Brand(2) + Feature(4) + Promo(3) + CTA(3) + Urgency(2)

### 描述约束速查
- 数量：4个
- 长度：≤90字符
- 多样性：≤20%相似度
- 焦点：Value(1) + Action(1) + Feature(1) + Proof(1)
- CTA：每条必须有

### 关键词约束速查
- 数量：20-30个
- 单词数：1-4个
- 优先级：Brand(8-10) + Core(6-8) + Intent(3-5) + LongTail(3-7)
- 搜索量：Brand>1000, Core>500, LongTail>100

