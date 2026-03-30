-- Migration: 添加多 AI 提供商支持（OpenAI / Anthropic）
-- Date: 2026-03-30
-- Description: 新增 openai_api_key, anthropic_api_key, ai_provider, openai_model, anthropic_model
--              全局模板（user_id = NULL），用户可覆盖

DO $$
BEGIN

  -- 1. 主 AI 提供商选择（gemini / openai / anthropic）
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description)
  SELECT NULL, 'ai', 'ai_provider', NULL, 'string', false, false, 'gemini', 'AI 提供商选择：gemini（Gemini 官方/中转）、openai（OpenAI 官方）、anthropic（Anthropic 官方）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL AND category = 'ai' AND key = 'ai_provider'
  );

  -- 2. OpenAI 官方 API Key
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'openai_api_key', NULL, 'string', true, false, 'OpenAI 官方 API Key（sk-...）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL AND category = 'ai' AND key = 'openai_api_key'
  );

  -- 3. OpenAI 模型选择
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description)
  SELECT NULL, 'ai', 'openai_model', NULL, 'string', false, false, 'gpt-4o', 'OpenAI 模型名称（gpt-4o、gpt-4o-mini、o3 等）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL AND category = 'ai' AND key = 'openai_model'
  );

  -- 4. Anthropic Claude API Key
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'anthropic_api_key', NULL, 'string', true, false, 'Anthropic 官方 API Key（sk-ant-...）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL AND category = 'ai' AND key = 'anthropic_api_key'
  );

  -- 5. Anthropic 模型选择
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description)
  SELECT NULL, 'ai', 'anthropic_model', NULL, 'string', false, false, 'claude-opus-4-5', 'Anthropic 模型名称（claude-opus-4-5、claude-sonnet-4-5 等）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL AND category = 'ai' AND key = 'anthropic_model'
  );

  RAISE NOTICE '✅ 多 AI 提供商 settings 全局模板已插入';

END $$;
