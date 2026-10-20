-- BPC-DEV-RECONCILIATION REVERSAL for batch B33 (owner-approved use only)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260322210503','20260322224107','20260323035524','20260323155019','20260323155222','20260323163432','20260323200908','20260323210432','20260323210519','20260324175858','20260324191543','20260324193222']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B33;%') <> 12 THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260322210503','20260322224107','20260323035524','20260323155019','20260323155222','20260323163432','20260323200908','20260323210432','20260323210519','20260324175858','20260324191543','20260324193222']) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION%batch=B33;%';
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 278 THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;
END $bpc$;
