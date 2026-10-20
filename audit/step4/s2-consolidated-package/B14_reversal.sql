-- BPC-DEV-RECONCILIATION REVERSAL for batch B14 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251003182356','20251008144308','20251205125907','20251216201450','20260126193254']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B14;%') <> 5 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251003182356','20251008144308','20251205125907','20251216201450','20260126193254']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B14;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 230 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
