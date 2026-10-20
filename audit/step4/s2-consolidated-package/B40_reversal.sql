-- BPC-DEV-RECONCILIATION REVERSAL for batch B40 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251002195922','20251003164124','20251007214737','20251007215413','20251007215603','20251207175802','20251221223055','20260322203342','20260322204401','20260322204444','20260322205212','20260322223521']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B40;%') <> 12 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251002195922','20251003164124','20251007214737','20251007215413','20251007215603','20251207175802','20251221223055','20260322203342','20260322204401','20260322204444','20260322205212','20260322223521']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B40;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 291 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
