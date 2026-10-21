-- BPC-DEV-RECONCILIATION REVERSAL for AUTH-16 (owner-approved use only): deletes exactly the four AUTH-16 rows
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
DECLARE before_n bigint;
BEGIN
  SELECT count(*) INTO before_n FROM supabase_migrations.schema_migrations;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251002210020','20251207160232','20260324051459','20260324154955']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%run=AUTH-16%') <> 4 THEN RAISE EXCEPTION 'AUTH-16 rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251002210020','20251207160232','20260324051459','20260324154955']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%run=AUTH-16%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> before_n - 4 THEN RAISE EXCEPTION 'ledger count after reversal is not the pre-reversal count minus 4'; END IF;
END $bpc$;
