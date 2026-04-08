-- Migration: 208_add_multi_ai_provider_settings.sql
-- Date: 2026-03-30
-- Description: 新增 openai_api_key, anthropic_api_key, ai_provider, openai_model, anthropic_model
--              全局模板（user_id = NULL），用户可覆盖
-- Note: SQLite 版本，使用 INSERT OR IGNORE 保持幂等

INSERT OR IGNORE INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
) VALUES
  -- 1. 主 AI 提供商选择
  (NULL, 'ai', 'ai_provider', NULL, 'string', 0, 0, 'gemini',
   'AI 提供商选择：gemini（Gemini 官方/中转）、openai（OpenAI 官方）、anthropic（Anthropic 官方）、litellm（LiteLLM Gateway）'),

  -- 2. OpenAI 官方 API Key
  (NULL, 'ai', 'openai_api_key', NULL, 'string', 1, 0, NULL,
   'OpenAI 官方 API Key（sk-...）'),

  -- 3. OpenAI 模型选择
  (NULL, 'ai', 'openai_model', NULL, 'string', 0, 0, 'gpt-4o',
   'OpenAI 模型名称（gpt-4o、gpt-4o-mini、o3 等）'),

  -- 4. Anthropic Claude API Key
  (NULL, 'ai', 'anthropic_api_key', NULL, 'string', 1, 0, NULL,
   'Anthropic 官方 API Key（sk-ant-...）'),

  -- 5. Anthropic 模型选择
  (NULL, 'ai', 'anthropic_model', NULL, 'string', 0, 0, 'claude-sonnet-4-6',
   'Anthropic 模型名称（claude-sonnet-4-6、claude-opus-4-6 等）');
