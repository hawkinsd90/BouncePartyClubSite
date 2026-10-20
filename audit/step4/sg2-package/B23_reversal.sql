-- BPC-DEV-RECONCILIATION REVERSAL for batch B23 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260325231044']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B23;%') <> 1 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260325231044']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B23;%';
  UPDATE storage.buckets SET file_size_limit = NULL WHERE id = 'carousel-media'; -- restores the values recorded by the pre-batch read (both NULL at capture)
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 304 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
