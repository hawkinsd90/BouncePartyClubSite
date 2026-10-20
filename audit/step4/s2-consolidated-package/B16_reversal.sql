-- BPC-DEV-RECONCILIATION REVERSAL for batch B16 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251007220415','20251007221227','20251007221817','20251130191333','20260816221636','20260928172217']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B16;%') <> 6 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251007220415','20251007221227','20251007221817','20251130191333','20260816221636','20260928172217']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B16;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 241 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
