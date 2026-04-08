-- Migration: 209_add_litellm_provider_settings.sql
-- Date: 2026-04-05
-- Description: 新增 litellm_api_key, litellm_base_url, litellm_model
--              全局模板（user_id = NULL），用户可覆盖
--              LiteLLM 为 OpenAI 兼容网关，可托管多个开源/本地模型
-- Note: SQLite 版本，使用 INSERT OR IGNORE 保持幂等

INSERT OR IGNORE INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
) VALUES
  -- 1. LiteLLM Gateway API Key（主密钥，所有模型共用）
  (NULL, 'ai', 'litellm_api_key', NULL, 'string', 1, 0, NULL,
   'LiteLLM Gateway API Key（sk-...），所有托管模型共用同一个 Key'),

  -- 2. LiteLLM Gateway 网关地址（固定为 openllmapi.com，不允许用户修改）
  (NULL, 'ai', 'litellm_base_url', NULL, 'string', 0, 0, 'https://openllmapi.com',
   'LiteLLM Gateway 网关地址（不含 /v1 路径），默认 https://openllmapi.com'),

  -- 3. LiteLLM 模型选择（默认 qwen3.5-35b）
  (NULL, 'ai', 'litellm_model', NULL, 'string', 0, 0, 'qwen3.5-35b',
   'LiteLLM 托管模型名称（qwen3.5-35b、gemma4-26b、qwen3.5-27b、qwen3-30b、qwen3-coder-30b 等）');
