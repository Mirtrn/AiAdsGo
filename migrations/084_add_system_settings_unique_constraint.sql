-- Migration: Add unique constraint to system_settings
-- Purpose: Prevent duplicate (category, key) entries with non-empty values
-- Date: 2025-12-20

-- Step 1: Clean up duplicate records, keep only the latest one per (category, key)
DELETE FROM system_settings
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM system_settings
  WHERE value IS NOT NULL AND value <> ''
  GROUP BY category, key
  HAVING COUNT(*) > 0
)
AND value IS NOT NULL AND value <> '';

-- Step 2: Create unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_settings_category_key_unique
  ON system_settings(category, key)
  WHERE value IS NOT NULL AND value <> '';

-- Verification queries (commented out for production)
-- SELECT category, key, COUNT(*) as count
-- FROM system_settings
-- WHERE value IS NOT NULL AND value != ''
-- GROUP BY category, key
-- HAVING COUNT(*) > 1;
