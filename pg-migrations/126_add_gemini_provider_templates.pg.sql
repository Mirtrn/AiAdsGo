-- Migration: 126_add_gemini_provider_templates.pg.sql
-- Description: 补充 gemini_provider 和 gemini_endpoint 的全局模板记录
-- Date: 2025-12-30
-- 问题：gemini_provider 和 gemini_endpoint 在代码中添加，但缺少数据库全局模板
-- 遵循 docs/BasicPrinciples/MustKnowV1.md 第31条：模板+实例双层架构

-- PostgreSQL 版本

DO $$
BEGIN
  -- 1. 插入 gemini_provider 全局模板
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'gemini_provider', NULL, 'string', false, false, 'Gemini API 服务商（official/relay/vertex）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL
      AND category = 'ai'
      AND key = 'gemini_provider'
      AND value IS NULL
  );

  RAISE NOTICE 'Global template for gemini_provider inserted or already exists';

  -- 2. 插入 gemini_endpoint 全局模板
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'gemini_endpoint', NULL, 'string', false, false, 'Gemini API 端点（系统自动计算）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL
      AND category = 'ai'
      AND key = 'gemini_endpoint'
      AND value IS NULL
  );

  RAISE NOTICE 'Global template for gemini_endpoint inserted or already exists';
END $$;

-- 3. 验证：列出所有 AI 分类的全局模板
DO $$
DECLARE
  template_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO template_count
  FROM system_settings
  WHERE user_id IS NULL
    AND value IS NULL
    AND category = 'ai';

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 126 complete:';
  RAISE NOTICE '  - AI global templates count: %', template_count;
  RAISE NOTICE '========================================';
END $$;
