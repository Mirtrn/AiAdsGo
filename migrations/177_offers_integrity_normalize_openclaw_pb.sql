-- Schema parity with PostgreSQL migration 177:
-- Store affiliate platform + external MID on offers (optional).

ALTER TABLE offers ADD COLUMN affiliate_platform TEXT;
ALTER TABLE offers ADD COLUMN affiliate_mid TEXT;

