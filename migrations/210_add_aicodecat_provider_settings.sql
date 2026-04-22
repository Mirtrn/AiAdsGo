-- Migration: 210_add_aicodecat_provider_settings.sql
-- Date: 2026-04-22
-- Description: 新增 aicodecat_api_key, aicodecat_model 全局模板行
--              AiCodeCat 为 OpenAI 兼容第三方中转网关（aicode.cat）
--              同时将 litellm_model 默认值更新为 deepseek/deepseek-v3.2（推理友好，性价比最高）
-- Note: SQLite 版本，使用 INSERT OR IGNORE 保持幂等

INSERT OR IGNORE INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
) VALUES
  -- 1. AiCodeCat API Key（敏感，加密存储）
  (NULL, 'ai', 'aicodecat_api_key', NULL, 'string', 1, 0, NULL,
   'AiCodeCat API Key（sk-...），通过 aicode.cat 获取'),

  -- 2. AiCodeCat 模型选择（默认 gemini-3.1-pro-preview）
  (NULL, 'ai', 'aicodecat_model', NULL, 'string', 0, 0, 'gemini-3.1-pro-preview',
   'AiCodeCat 模型名称（gemini-3.1-pro-preview、claude-sonnet-4-6、gpt-5.4 等）');

-- 更新 litellm_model 默认值为 deepseek/deepseek-v3.2（移除推理模型后的新默认）
UPDATE system_settings
SET default_value = 'deepseek/deepseek-v3.2',
    description = 'OpenLLM 模型名称（deepseek/deepseek-v3.2、openai/gpt-4o、anthropic/claude-sonnet-4.6 等对话模型）',
    updated_at = datetime('now')
WHERE category = 'ai' AND key = 'litellm_model' AND user_id IS NULL;

-- 更新 ai_provider 描述以包含 aicodecat 选项
UPDATE system_settings
SET description = 'AI 提供商选择：gemini（Gemini 官方/中转）、openai（OpenAI 官方）、anthropic（Anthropic 官方）、litellm（OpenLLM Gateway）、aicodecat（AiCodeCat 中转）',
    updated_at = datetime('now')
WHERE category = 'ai' AND key = 'ai_provider' AND user_id IS NULL;
