-- Migration: Add unique constraint to system_settings (PostgreSQL)
-- Purpose: Prevent duplicate (category, key) entries with non-empty values
-- Date: 2025-12-20

-- Step 1: Clean up duplicate records
-- Remove records with NULL or empty values first
DELETE FROM system_settings
WHERE value IS NULL OR value = '';

-- Remove duplicate records, keeping only the latest one per (category, key)
-- PostgreSQL supports table aliases in DELETE statements
DELETE FROM system_settings s1
WHERE EXISTS (
  SELECT 1 FROM system_settings s2
  WHERE s2.category = s1.category
    AND s2.key = s1.key
    AND s2.value IS NOT NULL
    AND s2.value <> ''
    AND s2.updated_at > s1.updated_at
);

-- Step 2: Create unique partial index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_settings_category_key_unique
  ON system_settings(category, key)
  WHERE value IS NOT NULL AND value <> '';

-- Verification queries (commented out for production)
-- SELECT category, key, COUNT(*) as count
-- FROM system_settings
-- WHERE value IS NOT NULL AND value <> ''
-- GROUP BY category, key
-- HAVING COUNT(*) > 1;
