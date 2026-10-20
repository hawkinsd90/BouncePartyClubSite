-- BPC-DEV-RECONCILIATION REVERSAL for batch B19 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251209133113','20260120203953','20260125170305','20260302131311','20260305205811','20260311191611','20260314213726','20260314215031']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B19;%') <> 8 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251209133113','20260120203953','20260125170305','20260302131311','20260305205811','20260311191611','20260314213726','20260314215031']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B19;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 254 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
