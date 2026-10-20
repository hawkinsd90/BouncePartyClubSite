-- BPC-DEV-RECONCILIATION REVERSAL for batch B37 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251221225000']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B37;%') <> 1 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251221225000']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B37;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 290 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
