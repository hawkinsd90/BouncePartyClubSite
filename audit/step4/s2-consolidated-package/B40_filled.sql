-- BPC-DEV-RECONCILIATION script for batch B40: 12 operation(s); generated from development-execution-manifest.csv; approval 386ffca2d22e210c0b548f75babeb3068ea27eb0594e7e771f468bb66101f872
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 291 THEN RAISE EXCEPTION 'ledger count differs from the pre-batch export'; END IF;
  -- op 1: 20251002195922 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20251002195922') THEN RAISE EXCEPTION 'version already recorded: 20251002195922'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251209115445'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20251002195922'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='check_unit_availability'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20251002195922'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20251002195922', '007_add_availability_check_function', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20251002195922; rule_sha256=e3d25a4b527875f54a0e767039de8ff542c7b7a324a1a12bc40d9395e2597472; basis=1 catalog objects must exist']);
  -- op 2: 20251003164124 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20251003164124') THEN RAISE EXCEPTION 'version already recorded: 20251003164124'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251209115445'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20251003164124'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='get_admin_users'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20251003164124'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20251003164124', '20251003220000_014_add_admin_check_function', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20251003164124; rule_sha256=34c23dad606a77239784bfa5537c3e7b20b467ea08781128b0071b5be9c7ba6a; basis=1 catalog objects must exist']);
  -- op 3: 20251007214737 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20251007214737') THEN RAISE EXCEPTION 'version already recorded: 20251007214737'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251209115445'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20251007214737'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='check_unit_availability'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20251007214737'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20251007214737', '023_update_availability_check_for_date_range', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20251007214737; rule_sha256=e3d25a4b527875f54a0e767039de8ff542c7b7a324a1a12bc40d9395e2597472; basis=1 catalog objects must exist']);
  -- op 4: 20251007215413 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20251007215413') THEN RAISE EXCEPTION 'version already recorded: 20251007215413'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251209115445'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20251007215413'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='check_unit_availability'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20251007215413'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20251007215413', '024_fix_availability_check_nested_aggregate', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20251007215413; rule_sha256=e3d25a4b527875f54a0e767039de8ff542c7b7a324a1a12bc40d9395e2597472; basis=1 catalog objects must exist']);
  -- op 5: 20251007215603 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20251007215603') THEN RAISE EXCEPTION 'version already recorded: 20251007215603'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251209115445'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20251007215603'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='check_unit_availability'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20251007215603'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20251007215603', '025_fix_availability_ambiguous_columns', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20251007215603; rule_sha256=e3d25a4b527875f54a0e767039de8ff542c7b7a324a1a12bc40d9395e2597472; basis=1 catalog objects must exist']);
  -- op 6: 20251207175802 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20251207175802') THEN RAISE EXCEPTION 'version already recorded: 20251207175802'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20251207182041','20251207182057'])) <> 2 THEN RAISE EXCEPTION 'predecessor not recorded for 20251207175802'; END IF;
  IF NOT COALESCE(((true)), false) THEN RAISE EXCEPTION 'verification rule failed for 20251207175802'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20251207175802', 'add_user_roles_read_policies', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20251207175802; rule_sha256=dfba499e6f2920c456e5c60906785337cd97c5600b222586f2c15de2e2479731; basis=every statement is superseded by a predecessor (recorded first) or is a no-op; no catalog object of its own remains to c']);
  -- op 7: 20251221223055 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20251221223055') THEN RAISE EXCEPTION 'version already recorded: 20251221223055'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260322224107'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20251221223055'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.task_status') AND tgname='trigger_auto_update_order_status' AND NOT tgisinternal))), false) THEN RAISE EXCEPTION 'verification rule failed for 20251221223055'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20251221223055', 'add_auto_order_status_progression', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20251221223055; rule_sha256=b1fd72abed294f539b4ac5df25ab259e65b3e36b143eb66a84fde14ce970851b; basis=1 catalog objects must exist']);
  -- op 8: 20260322203342 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260322203342') THEN RAISE EXCEPTION 'version already recorded: 20260322203342'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260322224107'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260322203342'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='auto_update_order_status'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260322203342'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260322203342', 'fix_auto_update_order_status_trigger_security', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20260322203342; rule_sha256=c5fa661a5520dcb7ccf723ae502e4c1792db57092320317c3ea2de61e7c73964; basis=1 catalog objects must exist']);
  -- op 9: 20260322204401 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260322204401') THEN RAISE EXCEPTION 'version already recorded: 20260322204401'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260322224107'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260322204401'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='auto_update_order_status'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260322204401'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260322204401', 'fix_auto_update_order_status_valid_transitions', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20260322204401; rule_sha256=c5fa661a5520dcb7ccf723ae502e4c1792db57092320317c3ea2de61e7c73964; basis=1 catalog objects must exist']);
  -- op 10: 20260322204444 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260322204444') THEN RAISE EXCEPTION 'version already recorded: 20260322204444'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260322224107'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260322204444'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='auto_update_order_status'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260322204444'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260322204444', 'fix_auto_update_order_status_trigger_correct_columns', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20260322204444; rule_sha256=c5fa661a5520dcb7ccf723ae502e4c1792db57092320317c3ea2de61e7c73964; basis=1 catalog objects must exist']);
  -- op 11: 20260322205212 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260322205212') THEN RAISE EXCEPTION 'version already recorded: 20260322205212'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260322224107'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260322205212'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='auto_update_order_status'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260322205212'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260322205212', 'fix_auto_update_order_status_confirmed_to_setup_in_progress', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20260322205212; rule_sha256=c5fa661a5520dcb7ccf723ae502e4c1792db57092320317c3ea2de61e7c73964; basis=1 catalog objects must exist']);
  -- op 12: 20260322223521 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260322223521') THEN RAISE EXCEPTION 'version already recorded: 20260322223521'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20260322224107'])) <> 1 THEN RAISE EXCEPTION 'predecessor not recorded for 20260322223521'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='auto_update_order_status'))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260322223521'; END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260322223521', 'fix_auto_update_order_status_use_in_progress', ARRAY['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=B40; version=20260322223521; rule_sha256=c5fa661a5520dcb7ccf723ae502e4c1792db57092320317c3ea2de61e7c73964; basis=1 catalog objects must exist']);
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 291 + 12 THEN RAISE EXCEPTION 'unexpected ledger count after the batch'; END IF;
END $bpc$;
