-- BPC-DEV-MIGRATION AUTH-18 ROLLBACK for 20261027120000 (owner-approved use only; run only if a post-check fails or the owner decides to revert)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-migration'));
ALTER TABLE public.pricing_rules DROP CONSTRAINT IF EXISTS pricing_rules_same_day_delivery_fee_days_valid;
ALTER TABLE public.pricing_rules DROP COLUMN IF EXISTS same_day_delivery_fee_days;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261027120000' AND statements[1] LIKE '-- BPC-DEV-MIGRATION applied by the guarded executor (AUTH-18)%';
