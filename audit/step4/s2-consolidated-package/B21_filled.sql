-- BPC-DEV-RECONCILIATION script for batch B21: 1 operation(s); generated from development-execution-manifest.csv; approval 386ffca2d22e210c0b548f75babeb3068ea27eb0594e7e771f468bb66101f872
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 264 THEN RAISE EXCEPTION 'ledger count differs from the pre-batch export'; END IF;
  -- op 1: 20260323164559 (attestation)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260323164559') THEN RAISE EXCEPTION 'version already recorded: 20260323164559'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='update_contact_booking_stats' AND md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), E'--[^\n]*', '', 'g'), E'\\s+', '', 'g')) = '7c7137283b93eb4771425e9b139eab40'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260323164559'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260323164559', 'fix_total_spent_cents_include_custom_fees_discounts', ARRAY['-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED; batch=B21; version=20260323164559; rule_sha256=3f8711ace4f2243aeb9498bf270f238967c6030797d9edc385633a09c800b692; attested_by=Owner of Bounce Party Club LLC (account hawkinsd90), decisions supplied by owner chat message; attested_at=2026-10-20T16:42:38Z; scope=The historical migration''s updated function exists in Development. Its historical SQL execution is not proven. Current derived customer statistics are stale. The durable correction is pending at stage S12b. This attestation does not claim that current statistics are correct.; not_proven=Historical SQL execution of this migration, and correctness of current derived customer statistics (contacts.total_spent_cents and total_bookings), which stay stale until S12b.; evidence_sha256=d81ac30d59531fc8deef69e64b6700dbb8f17f6d230925c34c5eac801f8ff9a3']);
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 264 + 1 THEN RAISE EXCEPTION 'unexpected ledger count after the batch'; END IF;
END $bpc$;
