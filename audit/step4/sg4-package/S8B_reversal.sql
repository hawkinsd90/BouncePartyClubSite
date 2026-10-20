-- BPC-DEV-RECONCILIATION REVERSAL for batch S8B (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
DECLARE before_n bigint;
BEGIN
  SELECT count(*) INTO before_n FROM supabase_migrations.schema_migrations;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251207185927','20251207184549','20251003200318','20251207163822','20251207175214','20251207161003']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=S8B;%') <> 6 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251207185927','20251207184549','20251003200318','20251207163822','20251207175214','20251207161003']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=S8B;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> before_n - 6 THEN RAISE EXCEPTION 'ledger count after reversal is not the pre-reversal count minus the batch'; END IF;
END $bpc$;
