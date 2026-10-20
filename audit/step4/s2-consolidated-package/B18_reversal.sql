-- BPC-DEV-RECONCILIATION REVERSAL for batch B18 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260324175546','20260324190039']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B18;%') <> 2 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260324175546','20260324190039']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B18;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 252 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
