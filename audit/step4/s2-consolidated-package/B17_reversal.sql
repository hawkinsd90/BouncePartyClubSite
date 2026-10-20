-- BPC-DEV-RECONCILIATION REVERSAL for batch B17 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251231174711','20260224165424','20260318191352','20260331151647','20260415234700']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B17;%') <> 5 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251231174711','20260224165424','20260318191352','20260331151647','20260415234700']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B17;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 247 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
