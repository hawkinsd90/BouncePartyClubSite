-- BPC-DEV-RECONCILIATION REVERSAL for batch B15 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251002180149','20251130231633','20251222014723','20251222020729','20260119195140','20260311121119']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B15;%') <> 6 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251002180149','20251130231633','20251222014723','20251222020729','20260119195140','20260311121119']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B15;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 235 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
