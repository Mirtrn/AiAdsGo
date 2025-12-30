-- Migration: 125_split_gemini_api_keys
-- Description: 添加 gemini_relay_api_key 字段和全局模板记录
-- Date: 2025-12-30
-- 遵循 docs/BasicPrinciples/MustKnowV1.md 第31条：模板+实例双层架构

-- 1. 添加新字段
ALTER TABLE system_settings ADD COLUMN gemini_relay_api_key TEXT DEFAULT NULL;

-- 2. 创建索引（加速查询）
CREATE INDEX IF NOT EXISTS idx_system_settings_gemini_relay_api_key
ON system_settings(category, key) WHERE gemini_relay_api_key IS NOT NULL;

-- 3. 插入全局模板记录（user_id=NULL, value=NULL）
-- SQLite: INSERT OR IGNORE 实现幂等插入，布尔值使用 0/1
INSERT OR IGNORE INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
VALUES (NULL, 'ai', 'gemini_relay_api_key', NULL, 'string', 1, 0, '第三方中转服务 API Key');

-- 4. 验证：检查全局模板是否存在
SELECT
  'global_template' as record_type,
  category,
  key,
  description
FROM system_settings
WHERE user_id IS NULL
  AND value IS NULL
  AND category = 'ai'
  AND key = 'gemini_relay_api_key';
