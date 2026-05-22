-- Migration: 215_add_missing_official_model_settings.sql
-- Date: 2026-05-22
-- Description: 添加缺失的 gemini_official_model 和 openai_official_model 配置项
--              修复前端 settings/page.tsx 中引用的配置项与数据库不一致的问题
-- Note: SQLite 版本，使用 INSERT OR IGNORE 保持幂等

INSERT OR IGNORE INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
) VALUES
  -- 1. Gemini 官方模型选择
  (NULL, 'ai', 'gemini_official_model', NULL, 'string', 0, 0, 'gemini-3-flash-preview',
   'Gemini 官方 API 模型选择（通过 Google AI Studio）'),

  -- 2. OpenAI 官方模型选择
  (NULL, 'ai', 'openai_official_model', NULL, 'string', 0, 0, 'gpt-4o',
   'OpenAI 官方 API 模型选择（通过 OpenAI 官方接口）');
