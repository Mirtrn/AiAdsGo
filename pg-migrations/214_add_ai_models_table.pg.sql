-- Migration: 214_add_ai_models_table.pg.sql
-- Date: 2026-05-16
-- Description: 新增 ai_models 表，支持 Admin 后台动态管理模型列表
--              替代 gemini-models.ts 中硬编码的 LITELLM_SUPPORTED_MODELS 静态数组

CREATE TABLE IF NOT EXISTS ai_models (
  id          SERIAL PRIMARY KEY,
  model_id    TEXT        NOT NULL UNIQUE,   -- 实际调用 ID，如 'gpt-5.4', 'google/gemini-3-flash-preview'
  display_name TEXT       NOT NULL,          -- 前端展示名，如 'Blaze-D', 'Spark'
  cost_label  TEXT        NOT NULL DEFAULT '',  -- 价格文字，如 '≈¥1.5/条'
  is_enabled  BOOLEAN     NOT NULL DEFAULT true, -- 是否在用户下拉列表中显示
  sort_order  INTEGER     NOT NULL DEFAULT 100,  -- 排序权重，越小越靠前
  notes       TEXT        NOT NULL DEFAULT '',   -- 内部备注，不展示给用户
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 初始数据：从 LITELLM_SUPPORTED_MODELS + LITELLM_MODEL_ALIAS + LITELLM_MODEL_COST 导入
INSERT INTO ai_models (model_id, display_name, cost_label, is_enabled, sort_order, notes) VALUES
  ('minimax/minimax-m2.7',          'minimax-m2.7', '≈¥0.8/条', true,  10, 'MiniMax 最新旗舰对话模型'),
  ('minimax/minimax-m2.5',          'minimax-m2.5', '≈¥0.5/条', true,  20, 'MiniMax 稳定版对话模型'),
  ('gpt-5.2',                       'Swift',        '≈¥0.8/条', true,  30, 'openllmapi 新渠道直连，2026-05 上线'),
  ('gpt-5.3-codex',                 'Codex',        '≈¥1.0/条', true,  40, 'openllmapi 新渠道直连，2026-05 上线'),
  ('gpt-5.4',                       'Blaze-D',      '≈¥1.5/条', true,  50, 'openllmapi 新渠道直连，2026-05 上线'),
  ('gpt-5.5',                       'Surge',        '≈¥2.5/条', true,  60, 'openllmapi 新渠道直连，2026-05 上线'),
  ('google/gemini-3.1-pro-preview', 'Nova',         '≈¥0.6/条', true,  70, 'Google Gemini 3.1 Pro 预览版'),
  ('google/gemini-3-flash-preview', 'Spark',        '≈¥0.3/条', true,  80, 'Google Gemini 3 Flash 预览版，默认模型')
ON CONFLICT (model_id) DO NOTHING;

-- 自动更新 updated_at 触发器
CREATE OR REPLACE FUNCTION update_ai_models_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_models_updated_at ON ai_models;
CREATE TRIGGER trg_ai_models_updated_at
  BEFORE UPDATE ON ai_models
  FOR EACH ROW EXECUTE FUNCTION update_ai_models_updated_at();

DO $$ BEGIN
  RAISE NOTICE '✅ ai_models 表创建完成，已插入 8 条初始模型记录';
END; $$;
