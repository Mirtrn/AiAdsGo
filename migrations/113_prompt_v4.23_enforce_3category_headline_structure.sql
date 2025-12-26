-- Migration: 113_prompt_v4.23_enforce_3category_headline_structure.sql
-- Description: 强制3类headline结构(5+5+5)，提升单个创意内部多样性
-- Date: 2025-12-26
-- Changes:
--   1. Headlines: 强制分为3类，每类恰好5个
--      - 类别1: 产品型号聚焦 (5个)
--      - 类别2: 品牌+品类聚焦 (5个)
--      - 类别3: 场景+功能聚焦 (5个)
--   2. Descriptions: 2个型号+2个品牌品类+1个纯功能
--   3. Sitelinks: 2个型号+2个品牌品类+2个功能场景

-- SQLite版本
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '## 🎯 v4.21 单品聚焦要求 (CRITICAL - 2025-12-25)

### ⚠️ 强制规则：所有创意元素必须100%聚焦单品',
    '## 🎯 v4.23 单个创意内部多样性 (CRITICAL - 2025-12-26)

### ⚠️ 强制规则：15个Headlines必须分为3类，每类5个

**类别1：产品型号聚焦 (恰好5个)**
- 必须包含完整产品型号（如"Qrevo Curv 2 Pro", "Gen 2", "Air 3 Pro"）
- 突出具体型号的技术参数或独特功能
- 示例："Qrevo Curv 2 Pro: 25000 Pa", "Gen 2: Sleep Tracking"

**类别2：品牌+品类聚焦 (恰好5个)**
- 只提品牌名+品类名，不提具体型号
- 适合品牌认知用户和广泛受众
- 示例："Roborock Robot Vacuum Sale", "Aspirateur Roborock Officiel", "RingConn Smart Ring"

**类别3：场景+功能聚焦 (恰好5个)**
- 聚焦使用场景、核心功能或用户痛点
- 可以不提品牌，强调通用价值
- 示例："Nettoyage Auto pour Animaux", "Aspiration 25000Pa Puissante", "Sleep & Fitness Tracking Ring"

**✅ 验证检查**：
- 生成后统计每类数量，必须恰好5+5+5=15
- 如果不符合，重新生成直到满足要求

## 🎯 v4.21 单品聚焦要求 (已废弃 - 被v4.23替代)'
  ),
  version = 'v4.23',
  change_notes = '强制3类headline结构(5+5+5)：产品型号/品牌品类/场景功能，提升单个创意内部多样性'
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

-- 更新Descriptions规则
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '#### 规则2: Descriptions聚焦

**要求**：
 - ✅ **必须**描述单品的具体功能/特性/优势
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

-- 更新Sitelinks规则
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

-- 更新Headlines规则1
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
    '#### 规则1: Headlines三类结构 (已整合到v4.23主规则)

**参考v4.23主规则**：15个headlines必须严格按照5+5+5结构生成'
  )
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;
