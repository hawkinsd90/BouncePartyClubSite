-- BPC-DEV-RECONCILIATION script for batch B22: 1 operation(s); generated from development-execution-manifest.csv; approval 386ffca2d22e210c0b548f75babeb3068ea27eb0594e7e771f468bb66101f872
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 265 THEN RAISE EXCEPTION 'ledger count differs from the pre-batch export'; END IF;
  -- op 1: 20251003170350 (attestation)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20251003170350') THEN RAISE EXCEPTION 'version already recorded: 20251003170350'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@bouncepartyclub.com'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20251003170350'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20251003170350', '015_create_demo_admin_user', ARRAY['-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED; batch=B22; version=20251003170350; rule_sha256=fc153af607a94addf5f39e4fbdd63de9837d8f6d8cdb2702b50c5713bb29e617; attested_by=Owner of Bounce Party Club LLC (account hawkinsd90), decisions supplied by owner chat message; attested_at=2026-10-20T16:42:38Z; scope=The historical account exists. Both accounts that share the public password are currently banned. Neither password has been rotated. The bans expire on 2026-11-13. Credential remediation remains required. No historical migration SQL will execute.; not_proven=Credential remediation. Passwords are not rotated, the bans are time-limited to 2026-11-13, and Production has not been examined (SEC-005 stays CONTAINED, NOT PERMANENTLY REMEDIATED).; evidence_sha256=d81ac30d59531fc8deef69e64b6700dbb8f17f6d230925c34c5eac801f8ff9a3']);
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 265 + 1 THEN RAISE EXCEPTION 'unexpected ledger count after the batch'; END IF;
END $bpc$;
