-- Migration: 添加 LiteLLM Gateway 提供商支持
-- Date: 2026-04-05
-- Description: 新增 litellm_api_key, litellm_model
--              全局模板（user_id = NULL），用户可覆盖
--              LiteLLM 为 OpenAI 兼容网关，可托管多个开源/本地模型
-- Note: litellm_base_url 已于 2026-05 移除，网关地址硬编码为 openllmapi.com

DO $$
BEGIN

  -- 1. LiteLLM Gateway API Key（主密钥，所有模型共用）
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'litellm_api_key', NULL, 'string', true, false, 'LiteLLM Gateway API Key（sk-...），所有托管模型共用同一个 Key'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL AND category = 'ai' AND key = 'litellm_api_key'
  );

  -- 2. litellm_base_url 已移除：网关地址硬编码为 openllmapi.com，不再存入数据库
  -- （旧数据库如有残留行，可手动执行：DELETE FROM system_settings WHERE key = 'litellm_base_url';）

  -- 3. LiteLLM 模型选择
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description)
  SELECT NULL, 'ai', 'litellm_model', NULL, 'string', false, false, 'gemma4-26b', 'LiteLLM 托管模型名称（gemma4-26b、qwen-coder-32b、qwen3.5-27b、mistral-small-24b）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL AND category = 'ai' AND key = 'litellm_model'
  );

  RAISE NOTICE '✅ LiteLLM Gateway settings 全局模板已插入';

END $$;
