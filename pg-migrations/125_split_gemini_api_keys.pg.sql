-- Migration: 125_split_gemini_api_keys.pg.sql
-- Description: 添加 gemini_relay_api_key 字段和全局模板记录
-- Date: 2025-12-30
-- 遵循 docs/BasicPrinciples/MustKnowV1.md 第31条：模板+实例双层架构

DO $$
DECLARE
  column_exists BOOLEAN;
BEGIN
  -- 1. 检查并添加字段
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

  -- 2. 添加字段注释
  COMMENT ON COLUMN system_settings.gemini_relay_api_key IS '第三方中转服务 API Key（用于 relay 服务商）';

  -- 3. 插入全局模板记录（user_id=NULL, value=NULL）
  -- PostgreSQL: INSERT ... WHERE NOT EXISTS 实现幂等插入，布尔值使用 false/true
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'gemini_relay_api_key', NULL, 'string', true, false, '第三方中转服务 API Key'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL
      AND category = 'ai'
      AND key = 'gemini_relay_api_key'
      AND value IS NULL
  );

  RAISE NOTICE 'Global template for gemini_relay_api_key inserted or already exists';
END $$;

-- 4. 创建索引（加速查询）
DO $$
BEGIN
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

-- 5. 验证迁移结果
DO $$
DECLARE
  template_exists INTEGER;
  user_config_count INTEGER;
BEGIN
  -- 检查全局模板
  SELECT COUNT(*) INTO template_exists
  FROM system_settings
  WHERE user_id IS NULL
    AND category = 'ai'
    AND key = 'gemini_relay_api_key'
    AND value IS NULL;

  -- 检查用户配置
  SELECT COUNT(*) INTO user_config_count
  FROM system_settings
  WHERE user_id IS NOT NULL
    AND category = 'ai'
    AND key = 'gemini_relay_api_key'
    AND value IS NOT NULL;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 125 complete:';
  RAISE NOTICE '  - Global template exists: %', template_exists;
  RAISE NOTICE '  - User configurations: %', user_config_count;
  RAISE NOTICE '========================================';
END $$;
