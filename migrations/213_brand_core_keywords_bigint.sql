-- Migration 213: Fix INTEGER overflow in brand_core_keywords and brand_core_keyword_daily (SQLite)
-- SQLite uses dynamic typing so INTEGER can hold large values, but we align schema for consistency.
-- No-op for SQLite: INTEGER in SQLite supports up to 8-byte signed integers natively.
-- This migration is a placeholder to keep migration numbering in sync with PostgreSQL.

SELECT 1; -- no-op
