-- BPC-DEV-MIGRATION AUTH-18 ROLLBACK for 20261027150000 (owner-approved use only; run only if a post-check fails or the owner decides to revert)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-migration'));
DELETE FROM public.admin_settings WHERE key IN ('require_start_mileage','require_delivery_photo','require_pickup_photo');
-- the previous get_public_business_settings() body is the one in supabase/migrations/20260820165646_add_how_did_you_hear_enabled_setting.sql (re-run its CREATE OR REPLACE FUNCTION block)
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261027150000' AND statements[1] LIKE '-- BPC-DEV-MIGRATION applied by the guarded executor (AUTH-18)%';
