-- Migration: 216_ai_models_force_stream.pg.sql
-- Date: 2026-05-25
-- Description: ai_models 表新增 force_stream 列
--              允许 Admin 后台按模型粒度控制是否强制使用流式（stream=true）请求
--              OpenLLM 渠道强制要求 stream=true，其他官方渠道不受影响

ALTER TABLE ai_models
  ADD COLUMN IF NOT EXISTS force_stream BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN ai_models.force_stream IS
  '是否强制使用流式请求（stream=true）。OpenLLM 中转网关仅支持流式，默认 true。'
  '官方 Gemini/OpenAI 直连不受此字段控制（始终走非流式路径）。';

-- 更新已有模型，全部默认 true（OpenLLM 要求）
UPDATE ai_models SET force_stream = true WHERE force_stream IS DISTINCT FROM true;

DO $$ BEGIN
  RAISE NOTICE '✅ ai_models.force_stream 列添加完成';
END; $$;
