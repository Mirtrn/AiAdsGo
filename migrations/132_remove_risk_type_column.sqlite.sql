-- Migration: Remove risk_type field from risk_alerts table (SQLite)
-- Date: 2026-01-06
-- Description: risk_type 和 alert_type 是重复字段，删除 risk_type 简化数据结构
-- Note: SQLite 不支持直接删除列，使用重命名表的方式

-- Step 1: 创建新表（不含 risk_type）
CREATE TABLE risk_alerts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  alert_type TEXT,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_type TEXT,
  related_id INTEGER,
  related_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  resolved_at TEXT,
  resolved_by INTEGER,
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resource_type TEXT,
  resource_id INTEGER,
  details TEXT,
  acknowledged_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

-- Step 2: 复制数据
INSERT INTO risk_alerts_new (
  id, user_id, alert_type, severity, title, message,
  related_type, related_id, related_name, status,
  resolved_at, resolved_by, detected_at, created_at, updated_at,
  resource_type, resource_id, details, acknowledged_at
)
SELECT
  id, user_id, alert_type, severity, title, message,
  related_type, related_id, related_name, status,
  resolved_at, resolved_by, detected_at, created_at, updated_at,
  resource_type, resource_id, details, acknowledged_at
FROM risk_alerts;

-- Step 3: 删除旧表
DROP TABLE risk_alerts;

-- Step 4: 重命名新表
ALTER TABLE risk_alerts_new RENAME TO risk_alerts;

-- Step 5: 重建索引
CREATE INDEX IF NOT EXISTS idx_risk_alerts_alert_type ON risk_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_resource ON risk_alerts(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_severity ON risk_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_type ON risk_alerts(alert_type, status);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_user_severity_status ON risk_alerts(user_id, severity, status);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_user_status ON risk_alerts(user_id, status);
