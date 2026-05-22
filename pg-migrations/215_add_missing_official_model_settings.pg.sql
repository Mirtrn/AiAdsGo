-- Migration: 215_add_missing_official_model_settings.pg.sql
-- Date: 2026-05-22
-- Description: 添加缺失的 gemini_official_model 和 openai_official_model 配置项
--              修复前端 settings/page.tsx 中引用的配置项与数据库不一致的问题
-- Note: PostgreSQL 版本，使用 WHERE NOT EXISTS 保持幂等（system_settings 无唯一约束）

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gemini_official_model', NULL, 'string', false, false, 'gemini-3-flash-preview',
       'Gemini 官方 API 模型选择（通过 Google AI Studio）'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE user_id IS NULL AND category = 'ai' AND key = 'gemini_official_model'
);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'openai_official_model', NULL, 'string', false, false, 'gpt-4o',
       'OpenAI 官方 API 模型选择（通过 OpenAI 官方接口）'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE user_id IS NULL AND category = 'ai' AND key = 'openai_official_model'
);
