-- Migration: 211_announcements.sql
-- Date: 2026-04-25
-- Description: 公告系统 — announcements 表 + announcement_reads 表

-- 公告主表
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',  -- info | warning | maintenance
  is_active INTEGER NOT NULL DEFAULT 1,
  scheduled_at TEXT,                  -- 维护开始时间（可选）
  expires_at TEXT,                    -- 公告过期时间（可选，NULL=永不过期）
  created_by INTEGER,                 -- 管理员 user_id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active, expires_at);

-- 已读记录表
CREATE TABLE IF NOT EXISTS announcement_reads (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_ann ON announcement_reads(announcement_id);
