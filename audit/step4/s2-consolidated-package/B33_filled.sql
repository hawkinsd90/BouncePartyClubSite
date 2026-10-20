-- BPC-DEV-RECONCILIATION script for batch B33: 12 operation(s); generated from development-execution-manifest.csv; approval 386ffca2d22e210c0b548f75babeb3068ea27eb0594e7e771f468bb66101f872
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 278 THEN RAISE EXCEPTION 'ledger count differs from the pre-batch export'; END IF;
  -- op 1: 20260322210503 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260322210503') THEN RAISE EXCEPTION 'version already recorded: 20260322210503'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260409154545'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260322210503'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='validate_order_status_transition'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260322210503'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260322210503', 'fix_validate_order_status_transition_missing_column', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260322210503; rule_sha256=5a76c7209ca9bb94ea0802cfb74787f0e8a0304eff4236547ca9fb26aa9bc03a; basis=1 catalog objects must exist']);
  -- op 2: 20260322224107 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260322224107') THEN RAISE EXCEPTION 'version already recorded: 20260322224107'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260409154545'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260322224107'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='auto_update_order_status'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260322224107'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260322224107', 'fix_order_status_model_align_trigger_and_validator', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260322224107; rule_sha256=c5fa661a5520dcb7ccf723ae502e4c1792db57092320317c3ea2de61e7c73964; basis=1 catalog objects must exist']);
  -- op 3: 20260323035524 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260323035524') THEN RAISE EXCEPTION 'version already recorded: 20260323035524'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260323040745'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260323035524'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='record_cash_payment'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260323035524'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260323035524', 'add_record_cash_payment_rpc', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260323035524; rule_sha256=a21787ee4ef53e5f017a7c22727dc16963a40c099f51e3d8c5f0358f95e97501; basis=1 catalog objects must exist']);
  -- op 4: 20260323155019 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260323155019') THEN RAISE EXCEPTION 'version already recorded: 20260323155019'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260323163328'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260323155019'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='archived_at')) AND (EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_orders_archived_at')) AND (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='archived_at'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260323155019'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260323155019', 'add_order_archival_system', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260323155019; rule_sha256=c493ffe432ec1d6e8f40a7b55861af391832d4f53af214b0ff07f81ee3b98c06; basis=DO block with schema statements only (covered by catalog atoms)']);
  -- op 5: 20260323155222 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260323155222') THEN RAISE EXCEPTION 'version already recorded: 20260323155222'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260323164559'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260323155222'; END IF;
  IF NOT COALESCE(((true)), false) THEN RAISE EXCEPTION 'verification rule failed for 20260323155222'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260323155222', 'add_loyalty_fields_to_contacts', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260323155222; rule_sha256=dfba499e6f2920c456e5c60906785337cd97c5600b222586f2c15de2e2479731; basis=superseded by 20260323164559; its function body identity is verified by that version''s rule; this item needs the predece']);
  -- op 6: 20260323163432 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260323163432') THEN RAISE EXCEPTION 'version already recorded: 20260323163432'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260323164559'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260323163432'; END IF;
  IF NOT COALESCE(((true)), false) THEN RAISE EXCEPTION 'verification rule failed for 20260323163432'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260323163432', 'fix_loyalty_trigger_exclude_cancelled_orders', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260323163432; rule_sha256=dfba499e6f2920c456e5c60906785337cd97c5600b222586f2c15de2e2479731; basis=superseded by 20260323164559; its function body identity is verified by that version''s rule; this item needs the predece']);
  -- op 7: 20260323200908 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260323200908') THEN RAISE EXCEPTION 'version already recorded: 20260323200908'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260816222905'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260323200908'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='get_admin_analytics' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260323200908'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260323200908', 'add_admin_analytics_overview', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260323200908; rule_sha256=2139c83497fd375244c2783aa673457e10046a10b8b36a809f93e825844904c0; basis=1 catalog objects must exist']);
  -- op 8: 20260323210432 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260323210432') THEN RAISE EXCEPTION 'version already recorded: 20260323210432'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260816222905'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260323210432'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='get_admin_analytics' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260323210432'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260323210432', 'fix_get_admin_analytics_correct_schema', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260323210432; rule_sha256=2139c83497fd375244c2783aa673457e10046a10b8b36a809f93e825844904c0; basis=1 catalog objects must exist']);
  -- op 9: 20260323210519 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260323210519') THEN RAISE EXCEPTION 'version already recorded: 20260323210519'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260816222905'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260323210519'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='get_admin_analytics' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260323210519'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260323210519', 'fix_get_admin_analytics_lead_time_cast', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260323210519; rule_sha256=2139c83497fd375244c2783aa673457e10046a10b8b36a809f93e825844904c0; basis=1 catalog objects must exist']);
  -- op 10: 20260324175858 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260324175858') THEN RAISE EXCEPTION 'version already recorded: 20260324175858'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260324200626'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260324175858'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='log_permission_change'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260324175858'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260324175858', 'fix_log_permission_change_trigger_constraints', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260324175858; rule_sha256=6354d92c770e29e48c954a3460b8dd34d419810043aeee875107259a6ba7ab3b; basis=1 catalog objects must exist']);
  -- op 11: 20260324191543 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260324191543') THEN RAISE EXCEPTION 'version already recorded: 20260324191543'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260324191556'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260324191543'; END IF;
  IF NOT COALESCE(((NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='claim_order_for_approval'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260324191543'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260324191543', 'add_atomic_approve_order_rpc', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260324191543; rule_sha256=91d0de96b3b642a183b3bc0112acb621b67bc24092aa29ebdaf858506570eca8; basis=function claim_order_for_approval must be ABSENT (created and dropped by the chain); grants on it are not checked | not ']);
  -- op 12: 20260324193222 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260324193222') THEN RAISE EXCEPTION 'version already recorded: 20260324193222'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260326052438'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260324193222'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='assign_role_by_email')) AND (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='assign_role_by_email' AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))) AND (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='get_all_role_users' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260324193222'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260324193222', 'add_assign_role_by_email_and_get_all_role_users', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B33; version=20260324193222; rule_sha256=fee1e6bbcca723bdca690a179c8dc3fc9e63af0de3d6fc3c5b5187ee5d91e7cd; basis=3 catalog objects must exist']);
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 278 + 12 THEN RAISE EXCEPTION 'unexpected ledger count after the batch'; END IF;
END $bpc$;
