-- Migration: 082_add_negative_keyword_matchtype.sql
-- Purpose: Add support for negative keyword match type configuration
-- Date: 2025-12-18
-- Description:
--   Google Ads API requires specifying match type for negative keywords (BROAD/PHRASE/EXACT).
--   Previously, all negative keywords were hardcoded to BROAD match, causing unintended filtering.
--   This migration adds a JSONB field to track match type for each negative keyword.
--
-- Example:
--   negative_keywords = ["or", "free", "how to"]
--   negative_keywords_match_type = {
--     "or": "EXACT",
--     "free": "EXACT",
--     "how to": "PHRASE"
--   }

BEGIN;

-- Add the new column
ALTER TABLE ad_creatives
ADD COLUMN negative_keywords_match_type JSONB DEFAULT '{}'::jsonb;

-- Initialize with default values for existing creatives
-- Strategy: Single-word negative keywords → EXACT, Multi-word phrases → PHRASE
-- Note: negative_keywords is stored as TEXT (JSON), not JSONB
UPDATE ad_creatives
SET negative_keywords_match_type = (
  SELECT jsonb_object_agg(
    kw,
    CASE
      WHEN kw ~ ' ' THEN 'PHRASE'  -- Contains space → PHRASE match
      ELSE 'EXACT'                   -- Single word → EXACT match
    END
  )
  FROM jsonb_array_elements_text(
    CASE
      WHEN negative_keywords IS NULL OR negative_keywords = '' THEN '[]'::jsonb
      ELSE negative_keywords::jsonb
    END
  ) AS kw
)
WHERE negative_keywords IS NOT NULL
  AND negative_keywords != ''
  AND negative_keywords != 'null'
  AND negative_keywords != '[]';

-- Add index for performance
CREATE INDEX idx_ad_creatives_negative_keywords_match_type
ON ad_creatives USING GIN (negative_keywords_match_type);

-- Add comment for documentation
COMMENT ON COLUMN ad_creatives.negative_keywords_match_type IS
'JSONB map of negative keywords to their match types (BROAD/PHRASE/EXACT).
Example: {"or": "EXACT", "how to": "PHRASE"}.
Prevents unintended filtering due to partial word matches.';

COMMIT;
