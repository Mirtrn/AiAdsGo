-- Backfill: Fix misclassified Honeywell brand records in 2026-02-13 batch
-- Scope: affected offers in this batch only
-- Generated at: 2026-02-13

BEGIN;

-- 1) Sanity check target rows
WITH target_ids AS (
  SELECT unnest(ARRAY[
    3471, 3473, 3475, 3476, 3477, 3479,
    3480, 3481, 3482, 3483, 3484, 3485
  ]::int[]) AS id
)
SELECT o.id, o.user_id, o.brand, o.offer_name, o.created_at, o.final_url
FROM offers o
JOIN target_ids t ON t.id = o.id
ORDER BY o.id;

-- 2) Main backfill on offers (brand only; keep offer_name unchanged to avoid unique-name collisions)
WITH target_ids AS (
  SELECT unnest(ARRAY[
    3471, 3473, 3475, 3476, 3477, 3479,
    3480, 3481, 3482, 3483, 3484, 3485
  ]::int[]) AS id
), updated AS (
  UPDATE offers o
  SET
    brand = 'Honeywell',
    scraped_data = CASE
      WHEN o.scraped_data IS NULL OR btrim(o.scraped_data) = '' THEN o.scraped_data
      ELSE jsonb_set(o.scraped_data::jsonb, '{brand}', to_jsonb('Honeywell'::text), true)::text
    END,
    updated_at = CURRENT_TIMESTAMP::text
  FROM target_ids t
  WHERE o.id = t.id
  RETURNING o.id, o.user_id, o.brand, o.offer_name, o.updated_at
)
SELECT * FROM updated ORDER BY id;

-- 3) Keep offer task snapshots consistent (result is jsonb string of JSON payload)
WITH target_ids AS (
  SELECT unnest(ARRAY[
    3471, 3473, 3475, 3476, 3477, 3479,
    3480, 3481, 3482, 3483, 3484, 3485
  ]::int[]) AS id
), updated_tasks AS (
  UPDATE offer_tasks t
  SET result = CASE
    WHEN t.result IS NULL OR jsonb_typeof(t.result) <> 'string' THEN t.result
    ELSE to_jsonb(
      jsonb_set(
        (t.result#>>'{}')::jsonb,
        '{brand}',
        to_jsonb('Honeywell'::text),
        true
      )::text
    )
  END,
  updated_at = CURRENT_TIMESTAMP
  WHERE t.offer_id IN (SELECT id FROM target_ids)
  RETURNING t.id, t.offer_id, t.updated_at
)
SELECT * FROM updated_tasks ORDER BY offer_id;

-- 4) Post-check
WITH target_ids AS (
  SELECT unnest(ARRAY[
    3471, 3473, 3475, 3476, 3477, 3479,
    3480, 3481, 3482, 3483, 3484, 3485
  ]::int[]) AS id
)
SELECT
  o.id,
  o.brand,
  o.offer_name,
  o.scraped_data::jsonb->>'brand' AS scraped_brand,
  (t.result#>>'{}')::jsonb->>'brand' AS task_result_brand
FROM offers o
LEFT JOIN offer_tasks t ON t.offer_id = o.id
WHERE o.id IN (SELECT id FROM target_ids)
ORDER BY o.id;

COMMIT;
