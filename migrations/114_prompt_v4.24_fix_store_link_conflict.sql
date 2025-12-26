-- Migration: 114_prompt_v4.24_fix_store_link_conflict.sql
-- Description: 修复v4.23与店铺链接冲突：5+5+5结构仅适用于单品链接
-- Date: 2025-12-26
-- Changes:
--   1. 明确v4.23的5+5+5结构仅适用于单品链接（product link）
--   2. 店铺链接（store link）继续遵循v4.16的桶A/B/C/D/S规则
--   3. 避免店铺链接强制要求产品型号导致的冲突

-- SQLite & PostgreSQL通用版本
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '## 🎯 v4.23 单个创意内部多样性 (CRITICAL - 2025-12-26)

### ⚠️ 强制规则：15个Headlines必须分为3类，每类5个',
    '## 🎯 v4.23 单个创意内部多样性 (CRITICAL - 2025-12-26)

### ⚠️ 适用范围：仅适用于单品链接（product link）

**如果是店铺链接（store link）**：
- 遵循 v4.16 店铺链接特殊规则（桶A/B/C/D/S）
- 不适用5+5+5结构
- 参考 {{store_creative_instructions}} 中的创意类型要求

**如果是单品链接（product link）**：
- 强制执行以下5+5+5结构

### ⚠️ 强制规则：15个Headlines必须分为3类，每类5个'
  ),
  version = 'v4.24',
  change_notes = '修复v4.23与店铺链接冲突：5+5+5结构仅适用于单品链接，店铺链接遵循v4.16规则'
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;
