-- Migration: 210_add_aicodecat_provider_settings.pg.sql
-- Date: 2026-04-22
-- Description: 新增 aicodecat_api_key, aicodecat_model 全局模板行
--              AiCodeCat 为 OpenAI 兼容第三方中转网关（aicode.cat）
--              同时更新 litellm_model 默认值为 deepseek/deepseek-v3.2

DO $$
BEGIN

  -- 1. AiCodeCat API Key（敏感，加密存储）
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'aicodecat_api_key', NULL, 'string', true, false, 'AiCodeCat API Key（sk-...），通过 aicode.cat 获取'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL AND category = 'ai' AND key = 'aicodecat_api_key'
  );

  -- 2. AiCodeCat 模型选择（默认 gemini-3.1-pro-preview）
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description)
  SELECT NULL, 'ai', 'aicodecat_model', NULL, 'string', false, false, 'gemini-3.1-pro-preview', 'AiCodeCat 模型名称（gemini-3.1-pro-preview、claude-sonnet-4-6、gpt-5.4 等）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL AND category = 'ai' AND key = 'aicodecat_model'
  );

  -- 3. 更新 litellm_model 默认值为 deepseek/deepseek-v3.2（推理友好，性价比最高）
  UPDATE system_settings
  SET default_value = 'deepseek/deepseek-v3.2',
      description = 'OpenLLM 模型名称（deepseek/deepseek-v3.2、openai/gpt-4o、anthropic/claude-sonnet-4.6 等对话模型）',
      updated_at = NOW()
  WHERE category = 'ai' AND key = 'litellm_model' AND user_id IS NULL;

  -- 4. 更新 ai_provider 描述以包含 aicodecat 选项
  UPDATE system_settings
  SET description = 'AI 提供商选择：gemini（Gemini 官方/中转）、openai（OpenAI 官方）、anthropic（Anthropic 官方）、litellm（OpenLLM Gateway）、aicodecat（AiCodeCat 中转）',
      updated_at = NOW()
  WHERE category = 'ai' AND key = 'ai_provider' AND user_id IS NULL;

  RAISE NOTICE '✅ AiCodeCat settings 全局模板已插入，litellm_model 默认值已更新';

END $$;
