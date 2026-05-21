-- Migration: 214_add_ai_models_table.sql
-- Date: 2026-05-16
-- Description: 新增 ai_models 表，支持 Admin 后台动态管理模型列表
--              替代 gemini-models.ts 中硬编码的 LITELLM_SUPPORTED_MODELS 静态数组

CREATE TABLE IF NOT EXISTS ai_models (
  id           INTEGER     PRIMARY KEY AUTOINCREMENT,
  model_id     TEXT        NOT NULL UNIQUE,       -- 实际调用 ID，如 'gpt-5.4', 'google/gemini-3-flash-preview'
  display_name TEXT        NOT NULL,              -- 前端展示名，如 'Blaze-D', 'Spark'
  cost_label   TEXT        NOT NULL DEFAULT '',   -- 价格文字，如 '≈¥1.5/条'
  is_enabled   INTEGER     NOT NULL DEFAULT 1,    -- 是否在用户下拉列表中显示（SQLite: 1=true, 0=false）
  sort_order   INTEGER     NOT NULL DEFAULT 100,  -- 排序权重，越小越靠前
  notes        TEXT        NOT NULL DEFAULT '',   -- 内部备注，不展示给用户
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 初始数据：从 LITELLM_SUPPORTED_MODELS + LITELLM_MODEL_ALIAS + LITELLM_MODEL_COST 导入
INSERT OR IGNORE INTO ai_models (model_id, display_name, cost_label, is_enabled, sort_order, notes) VALUES
  ('minimax/minimax-m2.7',          'minimax-m2.7', '≈¥0.8/条', 1,  10, 'MiniMax 最新旗舰对话模型'),
  ('minimax/minimax-m2.5',          'minimax-m2.5', '≈¥0.5/条', 1,  20, 'MiniMax 稳定版对话模型'),
  ('gpt-5.2',                       'Swift',        '≈¥0.8/条', 1,  30, 'openllmapi 新渠道直连，2026-05 上线'),
  ('gpt-5.3-codex',                 'Codex',        '≈¥1.0/条', 1,  40, 'openllmapi 新渠道直连，2026-05 上线'),
  ('gpt-5.4',                       'Blaze-D',      '≈¥1.5/条', 1,  50, 'openllmapi 新渠道直连，2026-05 上线'),
  ('gpt-5.5',                       'Surge',        '≈¥2.5/条', 1,  60, 'openllmapi 新渠道直连，2026-05 上线'),
  ('google/gemini-3.1-pro-preview', 'Nova',         '≈¥0.6/条', 1,  70, 'Google Gemini 3.1 Pro 预览版'),
  ('google/gemini-3-flash-preview', 'Spark',        '≈¥0.3/条', 1,  80, 'Google Gemini 3 Flash 预览版，默认模型');
