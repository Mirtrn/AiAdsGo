-- Migration: 115_prompt_v4.25_adapt_structure_to_bucket_themes.sql
-- Description: 调整5+5+5结构适配桶主题，解决与v4.16关键词分层架构的冲突
-- Date: 2025-12-26
-- Changes:
--   1. 桶A（品牌认知）：15个标题都包含品牌词
--   2. 桶B（使用场景）：至少10个标题包含场景词
--   3. 桶C（功能特性）：至少10个标题包含功能词
--   4. 桶D（价格促销）：至少10个标题包含价格/促销词
--   5. 桶S（综合）：平衡品牌、功能、场景

-- SQLite & PostgreSQL通用版本
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '**如果是单品链接（product link）**：
- 强制执行以下5+5+5结构

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
- 示例："Nettoyage Auto pour Animaux", "Aspiration 25000Pa Puissante", "Sleep & Fitness Tracking Ring"',
    '**如果是单品链接（product link）**：
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
→ 平衡品牌、功能、场景'
  ),
  version = 'v4.25',
  change_notes = '调整5+5+5结构适配桶主题：桶A全品牌词/桶B场景词/桶C功能词/桶D价格词/桶S平衡'
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;
