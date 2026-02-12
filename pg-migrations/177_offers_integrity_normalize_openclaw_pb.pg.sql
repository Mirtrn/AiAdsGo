-- Normalize OpenClaw direct-write anomalies:
-- 1) Prevent offer_name containing PartnerBoost MID (e.g. *_PB_136624).
-- 2) Prevent scrape_status='completed' without scraped_data/scraped_at.
-- 3) Preserve PartnerBoost MID into dedicated columns for observability.

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS affiliate_platform TEXT;

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS affiliate_mid TEXT;

CREATE OR REPLACE FUNCTION autoads_generate_offer_name(
  p_user_id INTEGER,
  p_brand TEXT,
  p_target_country TEXT,
  p_exclude_offer_id INTEGER DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  existing_count INTEGER;
  seq INTEGER;
  attempts INTEGER := 100;
  proposed TEXT;
  fallback_suffix TEXT;
BEGIN
  IF p_brand IS NULL OR btrim(p_brand) = '' OR p_target_country IS NULL OR btrim(p_target_country) = '' THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO existing_count
  FROM offers
  WHERE user_id = p_user_id
    AND brand = p_brand
    AND target_country = p_target_country
    AND deleted_at IS NULL
    AND (p_exclude_offer_id IS NULL OR id <> p_exclude_offer_id);

  seq := COALESCE(existing_count, 0) + 1;

  WHILE attempts > 0 LOOP
    proposed := p_brand || '_' || p_target_country || '_' || lpad(seq::text, 2, '0');

    PERFORM 1
    FROM offers
    WHERE user_id = p_user_id
      AND offer_name = proposed
      AND (p_exclude_offer_id IS NULL OR id <> p_exclude_offer_id)
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN proposed;
    END IF;

    seq := seq + 1;
    attempts := attempts - 1;
  END LOOP;

  -- Fallback: deterministic enough, keeps `Brand_Country_*` format for readability.
  fallback_suffix := substr(md5(clock_timestamp()::text || random()::text), 1, 8);
  RETURN p_brand || '_' || p_target_country || '_' || fallback_suffix;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION autoads_offers_integrity_normalize() RETURNS TRIGGER AS $$
DECLARE
  pb_mid TEXT;
  generated_name TEXT;
BEGIN
  -- Offer naming normalization: PartnerBoost MID should not be embedded in offer_name.
  -- Example bad value: Soocas_US_PB_136624
  IF NEW.offer_name IS NOT NULL AND NEW.offer_name LIKE '%_PB_%' THEN
    pb_mid := substring(NEW.offer_name from '_PB_([0-9]+)$');
    IF pb_mid IS NOT NULL THEN
      NEW.affiliate_platform := COALESCE(NEW.affiliate_platform, 'PartnerBoost');
      NEW.affiliate_mid := COALESCE(NEW.affiliate_mid, pb_mid);
    END IF;

    generated_name := autoads_generate_offer_name(NEW.user_id, NEW.brand, NEW.target_country, NEW.id);
    IF generated_name IS NOT NULL THEN
      NEW.offer_name := generated_name;
    END IF;
  END IF;

  -- Scrape status integrity: completed implies scraped_data + scraped_at.
  IF NEW.scrape_status = 'completed' THEN
    IF NEW.scraped_at IS NULL OR btrim(NEW.scraped_at) = ''
      OR NEW.scraped_data IS NULL OR btrim(NEW.scraped_data) = '' OR NEW.scraped_data = 'null' THEN
      NEW.scrape_status := 'pending';
      IF NEW.scrape_error IS NULL OR btrim(NEW.scrape_error) = '' THEN
        NEW.scrape_error := 'integrity: completed without scraped_data';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_offers_integrity_normalize ON offers;

CREATE TRIGGER trigger_offers_integrity_normalize
BEFORE INSERT OR UPDATE ON offers
FOR EACH ROW
EXECUTE FUNCTION autoads_offers_integrity_normalize();

-- Backfill existing bad rows (safe/no-op if none).
UPDATE offers
SET
  affiliate_platform = COALESCE(affiliate_platform, 'PartnerBoost'),
  affiliate_mid = COALESCE(affiliate_mid, substring(offer_name from '_PB_([0-9]+)$'))
WHERE offer_name LIKE '%_PB_%';

UPDATE offers
SET offer_name = autoads_generate_offer_name(user_id, brand, target_country, id)
WHERE offer_name LIKE '%_PB_%';

UPDATE offers
SET
  scrape_status = 'pending',
  scrape_error = COALESCE(NULLIF(btrim(scrape_error), ''), 'integrity: completed without scraped_data')
WHERE scrape_status = 'completed'
  AND (
    scraped_at IS NULL OR btrim(scraped_at) = ''
    OR scraped_data IS NULL OR btrim(scraped_data) = '' OR scraped_data = 'null'
  );

