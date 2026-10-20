-- BPC-DEV-RECONCILIATION script for batch B18: 2 operation(s); generated from development-execution-manifest.csv; approval 386ffca2d22e210c0b548f75babeb3068ea27eb0594e7e771f468bb66101f872
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 252 THEN RAISE EXCEPTION 'ledger count differs from the pre-batch export'; END IF;
  -- op 1: 20260324175546 (attestation)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260324175546') THEN RAISE EXCEPTION 'version already recorded: 20260324175546'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='get_user_role')) AND (EXISTS (SELECT 1 FROM user_roles) AND NOT EXISTS (SELECT 1 FROM user_roles WHERE role != LOWER(role)))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260324175546'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260324175546', 'fix_get_user_role_case_sensitivity_v2', ARRAY['-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED; batch=B18; version=20260324175546; rule_sha256=679e3412bc4efc7e9c49dd93041b7f28ebd754b57cb8db691429c282c23af96a; attested_by=Owner of Bounce Party Club LLC (account hawkinsd90), decisions supplied by owner chat message; attested_at=2026-10-20T16:42:38Z; scope=Development state matches the intended outcome of this migration as observed read-only on 2026-10-20 (decision package entry D16). Recorded without executing the historical SQL.; not_proven=Historical SQL execution of this migration is not proven. Later application edits may have changed the data since.; evidence_sha256=d81ac30d59531fc8deef69e64b6700dbb8f17f6d230925c34c5eac801f8ff9a3']);
  -- op 2: 20260324190039 (attestation)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260324190039') THEN RAISE EXCEPTION 'version already recorded: 20260324190039'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM user_roles) AND NOT EXISTS (SELECT 1 FROM user_roles WHERE role != LOWER(role)))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260324190039'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260324190039', 'normalize_remaining_uppercase_roles', ARRAY['-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED; batch=B18; version=20260324190039; rule_sha256=78560f5cdb208a82b6772a26767303504ccb6d5ff203b1c9b9a1521737355c98; attested_by=Owner of Bounce Party Club LLC (account hawkinsd90), decisions supplied by owner chat message; attested_at=2026-10-20T16:42:38Z; scope=Development state matches the intended outcome of this migration as observed read-only on 2026-10-20 (decision package entry D17). Recorded without executing the historical SQL.; not_proven=Historical SQL execution of this migration is not proven. Later application edits may have changed the data since.; evidence_sha256=d81ac30d59531fc8deef69e64b6700dbb8f17f6d230925c34c5eac801f8ff9a3']);
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 252 + 2 THEN RAISE EXCEPTION 'unexpected ledger count after the batch'; END IF;
END $bpc$;
