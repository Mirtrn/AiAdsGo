-- ==========================================
-- Migration: 120_user_sessions
-- Purpose: Track user login sessions for account sharing detection
-- ==========================================

-- Drop table if exists (for clean re-creation)
DROP TABLE IF EXISTS user_sessions;

-- ==========================================
-- Table: user_sessions
-- ==========================================
CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL,  -- Hash of UA + IP prefix for device identification
  is_current INTEGER DEFAULT 1,      -- 1 = active session, 0 = expired/revoked
  is_suspicious INTEGER DEFAULT 0,   -- 1 = flagged as potential account sharing
  suspicious_reason TEXT,            -- Reason for flagging (e.g., "IP_CHANGED", "MULTI_IP")
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_device_fp ON user_sessions(device_fingerprint);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX idx_user_sessions_is_suspicious ON user_sessions(is_suspicious);
CREATE INDEX idx_user_sessions_created_at ON user_sessions(created_at);

-- ==========================================
-- Table: account_sharing_alerts
-- ==========================================
-- Records alerts for potential account sharing behavior
CREATE TABLE account_sharing_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  alert_type TEXT NOT NULL,          -- "IP_CHANGE", "MULTI_IP_LOGIN", "SUSPICIOUS_PATTERN"
  severity TEXT NOT NULL DEFAULT 'warning',  -- "info", "warning", "critical"
  description TEXT NOT NULL,
  ip_addresses TEXT,                 -- JSON array of involved IP addresses
  device_fingerprints TEXT,          -- JSON array of involved device fingerprints
  metadata TEXT,                     -- Additional context JSON
  is_resolved INTEGER DEFAULT 0,
  resolved_at TEXT,
  resolved_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

-- Indexes
CREATE INDEX idx_alerts_user_id ON account_sharing_alerts(user_id);
CREATE INDEX idx_alerts_created_at ON account_sharing_alerts(created_at);
CREATE INDEX idx_alerts_is_resolved ON account_sharing_alerts(is_resolved);

-- ==========================================
-- Table: trusted_devices
-- ==========================================
-- Users can mark devices as trusted to reduce false positives
CREATE TABLE trusted_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_fingerprint TEXT NOT NULL,
  device_name TEXT,                  -- User-assigned name (e.g., "My Work Laptop")
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, device_fingerprint)
);

CREATE INDEX idx_trusted_devices_user ON trusted_devices(user_id);
