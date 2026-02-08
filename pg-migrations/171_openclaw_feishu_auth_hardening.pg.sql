-- Migration: 171_openclaw_feishu_auth_hardening.pg.sql
-- Description: Add strict Feishu auth templates and binding uniqueness indexes
-- Date: 2026-02-08
-- Database: PostgreSQL

-- ---------------------------------------------------------------------
-- 1) OpenClaw strict Feishu auth templates
-- ---------------------------------------------------------------------
INSERT INTO system_settings (user_id, category, key, data_type, is_sensitive, is_required, default_value, description)
VALUES
  (NULL, 'openclaw', 'feishu_auth_mode', 'string', false, false, 'strict', 'Feishu auth mode (strict/compat)'),
  (NULL, 'openclaw', 'feishu_require_tenant_key', 'boolean', false, false, 'true', 'Require tenant_key in strict auth mode'),
  (NULL, 'openclaw', 'feishu_strict_auto_bind', 'boolean', false, false, 'true', 'Auto-bind sender to current account in strict auth mode when no binding exists')
ON CONFLICT (user_id, category, key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2) openclaw_user_bindings uniqueness hardening
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_bindings_channel_tenant_open_unique
  ON openclaw_user_bindings(channel, tenant_key, open_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_bindings_channel_tenant_union_unique
  ON openclaw_user_bindings(channel, tenant_key, union_id)
  WHERE union_id IS NOT NULL;

