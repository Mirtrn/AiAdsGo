-- Migration 213: Fix INTEGER overflow in brand_core_keywords and brand_core_keyword_daily
-- Problem: impressions/clicks values from Google Ads can exceed PostgreSQL INTEGER max (2,147,483,647)
-- causing "value is out of range for type integer" errors during brand keyword sync.
-- Fix: Upgrade affected columns to BIGINT.

ALTER TABLE brand_core_keywords
  ALTER COLUMN impressions_total TYPE BIGINT,
  ALTER COLUMN clicks_total TYPE BIGINT,
  ALTER COLUMN search_volume TYPE BIGINT;

ALTER TABLE brand_core_keyword_daily
  ALTER COLUMN impressions TYPE BIGINT,
  ALTER COLUMN clicks TYPE BIGINT;
