-- Migration: 125_split_gemini_api_keys.pg.sql
-- Description: 将共用的 gemini_api_key 拆分为独立的服务商专用密钥
-- - gemini_official_api_key: Gemini 官方 API Key
-- - gemini_relay_api_key: 第三方中转服务 API Key
-- Date: 2025-12-30

DO $$
DECLARE
  column_exists BOOLEAN;
BEGIN
  -- 检查 gemini_official_api_key 是否存在
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_settings'
      AND column_name = 'gemini_official_api_key'
  ) INTO column_exists;

  IF NOT column_exists THEN
    ALTER TABLE system_settings ADD COLUMN gemini_official_api_key TEXT DEFAULT NULL;
    RAISE NOTICE 'Added column gemini_official_api_key';
  ELSE
    RAISE NOTICE 'Column gemini_official_api_key already exists, skipping';
  END IF;

  -- 检查 gemini_relay_api_key 是否存在
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_settings'
      AND column_name = 'gemini_relay_api_key'
  ) INTO column_exists;

  IF NOT column_exists THEN
    ALTER TABLE system_settings ADD COLUMN gemini_relay_api_key TEXT DEFAULT NULL;
    RAISE NOTICE 'Added column gemini_relay_api_key';
  ELSE
    RAISE NOTICE 'Column gemini_relay_api_key already exists, skipping';
  END IF;
END $$;

-- 迁移旧数据：如果用户配置了 gemini_api_key，将其迁移到新字段
-- 策略：如果 gemini_official_api_key 为空且 gemini_api_key 有值，则迁移
UPDATE system_settings
SET gemini_official_api_key = value
WHERE category = 'ai'
  AND key = 'gemini_api_key'
  AND value IS NOT NULL
  AND (gemini_official_api_key IS NULL OR gemini_official_api_key = '');

-- 添加注释
COMMENT ON COLUMN system_settings.gemini_official_api_key IS 'Gemini 官方 API Key（用于 official 服务商）';
COMMENT ON COLUMN system_settings.gemini_relay_api_key IS '第三方中转服务 API Key（用于 relay 服务商）';

-- 创建索引
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'system_settings'
      AND indexname = 'idx_system_settings_gemini_official_api_key'
  ) THEN
    CREATE INDEX idx_system_settings_gemini_official_api_key
    ON system_settings(category, key) WHERE gemini_official_api_key IS NOT NULL;
    RAISE NOTICE 'Created index idx_system_settings_gemini_official_api_key';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'system_settings'
      AND indexname = 'idx_system_settings_gemini_relay_api_key'
  ) THEN
    CREATE INDEX idx_system_settings_gemini_relay_api_key
    ON system_settings(category, key) WHERE gemini_relay_api_key IS NOT NULL;
    RAISE NOTICE 'Created index idx_system_settings_gemini_relay_api_key';
  END IF;
END $$;

-- 验证迁移
DO $$
DECLARE
  official_count INTEGER;
  relay_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO official_count
  FROM system_settings
  WHERE category = 'ai' AND key = 'gemini_official_api_key' AND value IS NOT NULL;

  SELECT COUNT(*) INTO relay_count
  FROM system_settings
  WHERE category = 'ai' AND key = 'gemini_relay_api_key' AND value IS NOT NULL;

  RAISE NOTICE 'Migration 125 complete:';
  RAISE NOTICE '  - gemini_official_api_key configured for % users', official_count;
  RAISE NOTICE '  - gemini_relay_api_key configured for % users', relay_count;
END $$;
