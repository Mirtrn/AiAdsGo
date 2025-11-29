# 广告创意生成中的语言覆盖检查清单

## 📋 检查项目

### 1. AI 提示词语言指令 ✅
**文件**: `src/lib/ad-creative-generator.ts:121-168`
**函数**: `getLanguageInstruction(targetLanguage: string)`

**覆盖的语言**:
- ✅ Italian (意大利语)
- ✅ Spanish (西班牙语)
- ✅ French (法语)
- ✅ German (德语)
- ✅ Chinese (中文)
- ✅ English (英文，默认)

**功能**: 在 AI 提示词最开始添加强制语言指令，确保 AI 生成指定语言的所有内容（标题、描述、关键词、附加信息、附加链接）

---

### 2. 关键词搜索量查询语言映射 ✅
**文件**: `src/lib/ad-creative-generator.ts:985-991`
**位置**: `generateAdCreative()` 函数中获取关键词搜索量

**语言映射**:
```typescript
const language = lang === 'en' ? 'en'
  : lang === 'zh' ? 'zh'
  : lang === 'es' ? 'es'
  : lang === 'it' ? 'it'
  : lang === 'fr' ? 'fr'
  : lang === 'de' ? 'de'
  : 'en'
```

**覆盖的语言**:
- ✅ English (en)
- ✅ Chinese (zh)
- ✅ Spanish (es)
- ✅ Italian (it)
- ✅ French (fr)
- ✅ German (de)

---

### 3. Keyword Planner 扩展查询语言映射 ✅
**文件**: `src/lib/ad-creative-generator.ts:1077-1083`
**位置**: Keyword Planner 多轮查询中

**语言映射**:
```typescript
const language = lang === 'en' ? 'en'
  : lang === 'zh' ? 'zh'
  : lang === 'es' ? 'es'
  : lang === 'it' ? 'it'
  : lang === 'fr' ? 'fr'
  : lang === 'de' ? 'de'
  : 'en'
```

**覆盖的语言**:
- ✅ English (en)
- ✅ Chinese (zh)
- ✅ Spanish (es)
- ✅ Italian (it)
- ✅ French (fr)
- ✅ German (de)

---

### 4. AI 提示词中的关键词生成约束 ✅
**文件**: `src/lib/ad-creative-generator.ts:479-520`
**位置**: `buildAdCreativePrompt()` 函数中的关键词生成策略

**强制约束**:
- ✅ 所有关键词必须使用目标语言
- ✅ 不能混合使用英文和目标语言
- ✅ 不能使用英文关键词
- ✅ 提供了多语言示例（英文、意大利语）

**示例**:
- 英文: "robot vacuum mop", "self emptying vacuum"
- 意大利语: "robot aspirapolvere e lavapavimenti", "aspirapolvere svuotamento automatico"

---

## 🎯 强制约束总结

### 关键词语言约束
1. **品牌词约束**: 必须保留品牌词（不管搜索量）
2. **搜索量约束**: 非品牌词搜索量必须 >= 500
3. **数量约束**: 最终关键词数量 >= 10 个
4. **语言约束**: 生成的关键词语言必须与 offer 的推广语言一致 ✅

### 所有文本元素语言约束
- ✅ 标题 (Headlines): 必须是目标语言
- ✅ 描述 (Descriptions): 必须是目标语言
- ✅ 关键词 (Keywords): 必须是目标语言
- ✅ 附加信息 (Callouts): 必须是目标语言
- ✅ 附加链接 (Sitelinks): 必须是目标语言

---

## 📊 验证脚本

### 关键词约束验证
**脚本**: `scripts/verify-keyword-constraints.ts`
**功能**: 检查关键词是否满足所有约束条件
- ✅ 包含品牌词
- ✅ 非品牌词搜索量 >= 500
- ✅ 关键词总数 >= 10

### 语言一致性验证
**脚本**: `scripts/verify-language-consistency.ts`
**功能**: 检查所有文本元素的语言一致性
- ✅ 标题语言检测
- ✅ 描述语言检测
- ✅ 关键词语言检测
- ✅ 附加信息语言检测
- ✅ 附加链接语言检测

---

## ✅ 覆盖面总结

| 项目 | 覆盖范围 | 状态 |
|------|---------|------|
| AI 提示词语言指令 | 6 种语言 | ✅ 完整 |
| 关键词搜索量查询 | 6 种语言 | ✅ 完整 |
| Keyword Planner 查询 | 6 种语言 | ✅ 完整 |
| 关键词生成约束 | 多语言示例 | ✅ 完整 |
| 验证脚本 | 关键词 + 语言 | ✅ 完整 |

---

## 🚀 下一步

1. 在 UI 上生成新的创意，测试所有修复
2. 验证生成的创意中所有文本元素都是目标语言
3. 运行验证脚本确保满足所有约束条件
