-- 创建审计日志表 (PostgreSQL版本)
-- 用于记录安全相关事件和用户操作日志

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  event_type TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  details JSONB, -- PostgreSQL使用JSONB类型
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 创建索引以优化查询性能
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address ON audit_logs(ip_address);

-- GIN索引用于JSONB字段查询优化
CREATE INDEX IF NOT EXISTS idx_audit_logs_details ON audit_logs USING GIN(details);
