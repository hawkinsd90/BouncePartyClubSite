-- BPC-DEV-RECONCILIATION REVERSAL for batch B13 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251003152224','20251003183947','20251007210840','20251231171420','20260126184412','20260203053948','20260325231020']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B13;%') <> 7 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251003152224','20251003183947','20251007210840','20251231171420','20260126184412','20260203053948','20260325231020']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B13;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 223 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
