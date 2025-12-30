-- Migration: 125_split_gemini_api_keys
-- Description: 将共用的 gemini_api_key 拆分为独立的服务商专用密钥
-- - gemini_official_api_key: Gemini 官方 API Key
-- - gemini_relay_api_key: 第三方中转服务 API Key
-- Date: 2025-12-30

-- 1. 重命名旧的 gemini_api_key 为 gemini_official_api_key（保留旧数据作为官方 Key）
-- SQLite 不支持 IF NOT EXISTS，需要检查是否存在
-- 注意：如果之前已经创建了 gemini_official_api_key，则跳过此步骤

-- 检查是否已有新字段
PRAGMA table_info(system_settings);

-- 如果存在旧的 gemini_api_key 记录，将其迁移到新字段
-- 如果新字段不存在，先创建
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS gemini_official_api_key TEXT DEFAULT NULL;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS gemini_relay_api_key TEXT DEFAULT NULL;

-- 迁移策略：
-- 1. 如果用户之前配置了 gemini_api_key 且选择了 official，将其复制到 gemini_official_api_key
-- 2. 如果用户之前配置了 gemini_api_key 且选择了 relay，将其复制到 gemini_relay_api_key
-- 3. 如果用户没有配置过，直接保留为 NULL

-- 迁移官方 Key（假设用户使用的是官方配置）
UPDATE system_settings
SET gemini_official_api_key = value
WHERE category = 'ai'
  AND key = 'gemini_api_key'
  AND value IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM system_settings s2
    WHERE s2.user_id = system_settings.user_id
      AND s2.category = 'ai'
      AND s2.key = 'gemini_official_api_key'
      AND s2.value IS NOT NULL
  );

-- 创建索引（可选，用于加速查询）
CREATE INDEX IF NOT EXISTS idx_system_settings_gemini_official_api_key
ON system_settings(category, key, gemini_official_api_key);

CREATE INDEX IF NOT EXISTS idx_system_settings_gemini_relay_api_key
ON system_settings(category, key, gemini_relay_api_key);

-- 验证迁移
SELECT
  'gemini_official_api_key' as field_name,
  COUNT(*) as total_users,
  SUM(CASE WHEN value IS NOT NULL THEN 1 ELSE 0 END) as configured
FROM system_settings
WHERE category = 'ai' AND key = 'gemini_official_api_key'
UNION ALL
SELECT
  'gemini_relay_api_key' as field_name,
  COUNT(*) as total_users,
  SUM(CASE WHEN value IS NOT NULL THEN 1 ELSE 0 END) as configured
FROM system_settings
WHERE category = 'ai' AND key = 'gemini_relay_api_key';
