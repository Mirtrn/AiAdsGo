# 语言和国家代码全面审计报告

## 📋 审计目标
确保系统中所有涉及语言或国家的地方都使用统一的映射和处理方式，避免出现遗漏或不一致的情况。

---

## 🔍 审计发现

### 1. 广告创意生成 (ad-creative-generator.ts)

#### ✅ 已修复的位置

| 行号 | 功能 | 状态 | 说明 |
|------|------|------|------|
| 121-168 | `getLanguageInstruction()` | ✅ 完整 | 6 种语言的 AI 提示词指令 |
| 186-187 | 提示词初始化 | ✅ 完整 | 使用 `getLanguageInstruction()` |
| 479-520 | 关键词生成约束 | ✅ 完整 | 强制语言约束 + 多语言示例 |
| 984-991 | 关键词搜索量查询 | ✅ 完整 | 6 种语言代码映射 |
| 1078-1083 | Keyword Planner 查询 | ✅ 完整 | 6 种语言代码映射 + 日志 |

---

### 2. 否定关键词生成 (keyword-generator.ts)

#### ✅ 已修复的位置

| 行号 | 功能 | 状态 | 说明 |
|------|------|------|------|
| 5-35 | `getLanguageInstructionForNegativeKeywords()` | ✅ 完整 | 5 种语言的否定关键词指令 |
| 340-384 | `generateNegativeKeywords()` | ✅ 完整 | 使用语言指令 + 强制语言约束 |

---

### 3. 广告元素提取 (ad-elements-extractor.ts)

#### ⚠️ 需要检查的位置

| 行号 | 功能 | 状态 | 说明 |
|------|------|------|------|
| 507-539 | `extractKeywordsFromProductInfo()` | ⚠️ 需检查 | 使用 targetLanguage 参数 |
| 683-687 | 标题/描述生成 | ⚠️ 需检查 | 传递 targetLanguage 参数 |
| 715-781 | `extractKeywordsFromMultipleProducts()` | ⚠️ 需检查 | 使用 targetLanguage 参数 |
| 1093 | 语言指令查询 | ⚠️ 需检查 | 使用 languageInstructions 映射 |
| 1347 | 语言指令查询 | ⚠️ 需检查 | 使用 languageInstructions 映射 |
| 1622 | 语言指令查询 | ⚠️ 需检查 | 使用 languageInstructions 映射 |
| 1843 | 语言指令查询 | ⚠️ 需检查 | 使用 languageInstructions 映射 |

---

### 4. 广告强度评估 (ad-strength-evaluator.ts)

#### ⚠️ 需要检查的位置

| 行号 | 功能 | 状态 | 说明 |
|------|------|------|------|
| 137-162 | 选项参数 | ⚠️ 需检查 | targetCountry/targetLanguage 参数 |
| 469-492 | 关键词搜索量查询 | ⚠️ 需检查 | 使用 targetLanguage 参数 |

---

### 5. 国际化配置 (ad-strength-i18n.ts)

#### ⚠️ 需要检查的位置

| 行号 | 功能 | 状态 | 说明 |
|------|------|------|------|
| 36-37 | `getLanguageConfig()` | ⚠️ 需检查 | 根据 targetCountry 获取语言配置 |

---

### 6. AI 分析服务 (ai-analysis-service.ts)

#### ⚠️ 需要检查的位置

| 行号 | 功能 | 状态 | 说明 |
|------|------|------|------|
| 14, 50-51, 85-86 | 参数传递 | ⚠️ 需检查 | targetLanguage 参数传递 |

---

## 🎯 关键问题和解决方案

### 问题 1: 语言代码映射不统一
**现象**: 不同文件中使用不同的语言代码映射逻辑
**解决方案**: 创建全局的 `language-country-codes.ts` 模块

**新增文件**: `src/lib/language-country-codes.ts`
- ✅ 统一的语言代码映射表
- ✅ 统一的国家代码映射表
- ✅ 语言-国家对应关系验证
- ✅ 规范化函数
- ✅ Google Ads API 代码转换

---

### 问题 2: 否定关键词没有语言约束
**现象**: 否定关键词生成时没有考虑目标语言
**解决方案**: 添加语言指令到否定关键词生成

**修改文件**: `src/lib/keyword-generator.ts`
- ✅ 添加 `getLanguageInstructionForNegativeKeywords()` 函数
- ✅ 修改 `generateNegativeKeywords()` 使用语言指令
- ✅ 强制否定关键词使用目标语言

---

### 问题 3: 语言指令分散在多个文件
**现象**: 语言指令定义在多个文件中，难以维护
**解决方案**: 集中管理语言指令

**当前状态**:
- ✅ `ad-creative-generator.ts`: `getLanguageInstruction()`
- ✅ `keyword-generator.ts`: `getLanguageInstructionForNegativeKeywords()`
- ⚠️ `ad-elements-extractor.ts`: `languageInstructions` 对象（需要统一）

---

## 📊 覆盖面总结

### 已完整覆盖的功能
| 功能 | 覆盖范围 | 状态 |
|------|---------|------|
| AI 提示词语言指令 | 6 种语言 | ✅ 完整 |
| 关键词搜索量查询 | 6 种语言 | ✅ 完整 |
| Keyword Planner 查询 | 6 种语言 | ✅ 完整 |
| 否定关键词生成 | 5 种语言 | ✅ 完整 |
| 关键词生成约束 | 多语言示例 | ✅ 完整 |
| 全局代码映射 | 11 种语言 + 17 个国家 | ✅ 完整 |

### 需要进一步检查的功能
| 功能 | 位置 | 优先级 |
|------|------|--------|
| 标题生成语言指令 | ad-elements-extractor.ts | 中 |
| 描述生成语言指令 | ad-elements-extractor.ts | 中 |
| 广告强度评估 | ad-strength-evaluator.ts | 低 |
| 国际化配置 | ad-strength-i18n.ts | 低 |

---

## 🚀 建议的后续步骤

### 第一阶段（已完成）
- ✅ 创建全局语言国家代码映射系统
- ✅ 修复否定关键词的语言问题
- ✅ 强化 AI 提示词的语言约束

### 第二阶段（建议）
1. 统一 `ad-elements-extractor.ts` 中的语言指令
2. 使用全局的 `language-country-codes.ts` 替换分散的映射
3. 添加验证函数确保语言-国家组合的合理性
4. 创建单元测试验证所有语言代码映射

### 第三阶段（建议）
1. 审计所有 API 调用，确保使用正确的语言代码
2. 添加日志记录所有语言/国家相关的操作
3. 创建监控告警，检测语言不一致的情况

---

## 📝 检查清单

### 代码审查
- [ ] 检查 `ad-elements-extractor.ts` 中的语言指令
- [ ] 检查 `ad-strength-evaluator.ts` 中的语言参数
- [ ] 检查 `ad-strength-i18n.ts` 中的国家-语言映射
- [ ] 检查 `ai-analysis-service.ts` 中的参数传递

### 测试
- [ ] 测试意大利语创意生成
- [ ] 测试西班牙语创意生成
- [ ] 测试法语创意生成
- [ ] 测试德语创意生成
- [ ] 测试中文创意生成
- [ ] 验证否定关键词的语言一致性

### 文档
- [ ] 更新开发文档，说明如何添加新语言
- [ ] 更新 API 文档，说明语言参数的使用
- [ ] 创建语言支持矩阵

---

## 📚 相关文件

- `src/lib/language-country-codes.ts` - 全局语言国家代码映射
- `src/lib/ad-creative-generator.ts` - 广告创意生成
- `src/lib/keyword-generator.ts` - 关键词生成
- `LANGUAGE_COVERAGE_CHECKLIST.md` - 语言覆盖检查清单
- `scripts/verify-language-consistency.ts` - 语言一致性验证脚本
