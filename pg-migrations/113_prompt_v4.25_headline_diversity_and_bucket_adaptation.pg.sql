-- Migration: 113_prompt_v4.25_headline_diversity_and_bucket_adaptation.sql
-- Description: 整合v4.23-v4.25：强制5+5+5结构 + 店铺链接例外 + 桶主题适配
-- Date: 2025-12-26
-- Changes:
--   v4.23: 强制3类headline结构(5+5+5)，提升单个创意内部多样性
--   v4.24: 修复店铺链接冲突，5+5+5仅适用单品链接
--   v4.25: 调整5+5+5结构适配桶主题（桶A全品牌/桶B场景/桶C功能/桶D价格/桶S平衡）

-- SQLite & PostgreSQL通用版本

-- Step 1: 更新主规则（v4.23 → v4.25，整合店铺链接例外和桶适配）
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '## 🎯 v4.21 单品聚焦要求 (CRITICAL - 2025-12-25)

### ⚠️ 强制规则：所有创意元素必须100%聚焦单品',
    '## 🎯 v4.25 单个创意内部多样性 (CRITICAL - 2025-12-26)

### ⚠️ 适用范围：仅适用于单品链接（product link）

**如果是店铺链接（store link）**：
- 遵循 v4.16 店铺链接特殊规则（桶A/B/C/D/S）
- 不适用5+5+5结构
- 参考 {{store_creative_instructions}} 中的创意类型要求

**如果是单品链接（product link）**：
- 强制执行以下5+5+5结构，并根据当前桶主题调整

### ⚠️ 强制规则：15个Headlines必须分为3类，每类5个（适配桶主题）

**桶A（品牌认知 - {{bucket_intent}}）**：
- 类别1 (5个): 品牌+型号（如"Roborock Qrevo Curv 2 Pro: Official"）
- 类别2 (5个): 品牌+品类（如"Roborock Robot Vacuum Sale"）
- 类别3 (5个): 品牌+场景（如"Roborock for Pet Owners"）
→ 确保15个标题都包含品牌词

**桶B（使用场景 - {{bucket_intent}}）**：
- 类别1 (5个): 场景+型号（如"Pet Hair: Qrevo Curv 2 Pro"）
- 类别2 (5个): 场景+品牌（如"Home Cleaning: Roborock"）
- 类别3 (5个): 纯场景描述（如"Pet Hair Solution"）
→ 确保至少10个标题包含场景词

**桶C（功能特性 - {{bucket_intent}}）**：
- 类别1 (5个): 型号+功能（如"Qrevo Curv 2 Pro: 25000Pa"）
- 类别2 (5个): 品牌+功能（如"Roborock: Auto-Empty"）
- 类别3 (5个): 纯功能描述（如"25000Pa Suction Power"）
→ 确保至少10个标题包含功能词

**桶D（价格促销 - {{bucket_intent}}）**：
- 类别1 (5个): 型号+价格（如"Qrevo Curv 2 Pro: -23% Off"）
- 类别2 (5个): 品牌+促销（如"Roborock Sale: Save Now"）
- 类别3 (5个): 纯价格优惠（如"Limited Time Discount"）
→ 确保至少10个标题包含价格/促销词

**桶S（综合 - {{bucket_intent}}）**：
- 类别1 (5个): 产品型号聚焦（如"Qrevo Curv 2 Pro: 25000 Pa"）
- 类别2 (5个): 品牌+品类聚焦（如"Roborock Robot Vacuum"）
- 类别3 (5个): 场景+功能聚焦（如"Pet Hair Cleaning Solution"）
→ 平衡品牌、功能、场景

**✅ 验证检查**：
- 生成后统计每类数量，必须恰好5+5+5=15
- 检查桶主题关键词覆盖率是否达标

## 🎯 v4.21 单品聚焦要求 (已废弃 - 被v4.25替代)'
  ),
  version = 'v4.25',
  change_notes = '整合v4.23-v4.25：5+5+5结构 + 店铺链接例外 + 桶主题适配（桶A全品牌/桶B场景/桶C功能/桶D价格/桶S平衡）'
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

-- Step 2: 更新Descriptions规则
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '#### 规则2: Descriptions聚焦

**要求**：
 - ✅ **必须**描述单品的具体功能/特���/优势
 - ✅ **🆕 v4.22: 建议1-2个描述包含产品型号**
 - ✅ 可以使用产品应用场景
 - ❌ **禁止**提到"browse our collection"（暗示多商品）
 - ❌ **禁止**提到其他品类名称',
    '#### 规则2: Descriptions多样性

**要求**：
 - ✅ 2个描述：包含产品型号+核心功能
 - ✅ 2个描述：品牌+品类+应用场景
 - ✅ 1个描述：纯功能/痛点解决方案
 - ❌ **禁止**提到"browse our collection"（暗示多商品）'
  )
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

-- Step 3: 更新Sitelinks规则
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '#### 规则3: Sitelinks聚焦（单品链接）

**要求**：
 - ✅ **必须**每个Sitelink都与单品相关
 - ✅ **🆕 v4.22: 建议1-2个Sitelink的text包含产品型号**
   * 示例："Gen 2 Details", "Gen 2 Tech Specs", "Gen 2 vs Gen 1"
 - ✅ 可以是：产品详情、技术规格、用户评价、安装指南、保修信息、型号对比
 - ❌ **禁止**指向产品列表页（如"Shop All Cameras"）
 - ❌ **禁止**指向其他品类页

**数量要求**：恰好6个Sitelinks',
    '#### 规则3: Sitelinks多样性

**要求**：
 - ✅ 2个Sitelinks：包含产品型号（如"Gen 2 Details", "Curv 2 Pro Specs"）
 - ✅ 2个Sitelinks：品牌+品类（如"Roborock Collection", "Smart Ring Guide"）
 - ✅ 2个Sitelinks：功能/场景（如"Sleep Tracking", "Pet Hair Solution"）
 - ❌ **禁止**指向产品列表页（如"Shop All Cameras"）

**数量要求**：恰好6个Sitelinks'
  )
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

-- Step 4: 更新Headlines规则1
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '#### 规则1: Headlines聚焦

**要求**：
 - ✅ **必须**提到具体产品名称或主品类
 - ✅ **必须**突出产品型号/规格/独特功能
 - ✅ **🆕 v4.22: 建议40-60% (6-9个)标题包含完整产品型号**
   * 如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），建议6-9个标题包含该型号，其余标题可聚焦品牌、功能、场景
 - ❌ **禁止**提到其他品类名称
 - ❌ **禁止**使用过于通用的品牌描述

**🎯 型号平衡策略**：
 - 6-9个标题：包含完整产品型号（强调具体产品）
 - 6-9个标题：聚焦品牌、功能、场景（扩大受众覆盖）
 - 保持整体多样性，避免过度重复型号',
    '#### 规则1: Headlines三类结构 (已整合到v4.25主规则)

**参考v4.25主规则**：15个headlines必须严格按照5+5+5结构生成，并根据桶主题调整'
  )
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;
