-- BPC-DEV-MIGRATION AUTH-18 20261027120000 20261027120000_same_day_delivery_fee_days.sql; bound by the owner authorization that quotes this file's SHA-256
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-migration'));
DO $bpc$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'wrong database or role'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 376 THEN RAISE EXCEPTION 'ledger count differs from the verified ledger'; END IF;
  IF (SELECT encode(sha256(convert_to(string_agg(version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'\n'),'')), E'\n' ORDER BY version),'UTF8')),'hex') FROM supabase_migrations.schema_migrations) <> 'eea22f7960f9a2478e99a652afcb12db08a386af6af3b741181ee49dc860f4d0' THEN RAISE EXCEPTION 'ledger content differs from the verified ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261027120000') THEN RAISE EXCEPTION 'version already recorded'; END IF;
  IF NOT (has_schema_privilege('anon', 'public', 'USAGE') AND has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'S11 end state is not in force'; END IF;
  IF NOT COALESCE((NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pricing_rules' AND column_name='same_day_delivery_fee_days')), false) THEN RAISE EXCEPTION 'precondition 1 failed'; END IF;
  PERFORM set_config('bpc.anon_fn_before', ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')))::text, true);
  PERFORM set_config('bpc.anon_tbl_before', ((SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m') AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'))))::text, true);
END $bpc$;
-- ---- the reviewed migration, byte for byte ----
-- WP-14: the days of the week on which the same-day delivery fee applies become a pricing rule.
--
-- Until now the fee applied when the event date was today (America/Detroit) and the weekday was Monday to Friday, hard-coded in
-- application code. The admin chooses the days (0 = Sunday ... 6 = Saturday). The default reproduces the current behavior exactly
-- (Monday to Friday), so existing rows price as before. An empty list means the fee is never charged. Additive and idempotent.

ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS same_day_delivery_fee_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'::smallint[];

ALTER TABLE public.pricing_rules
  DROP CONSTRAINT IF EXISTS pricing_rules_same_day_delivery_fee_days_valid;

ALTER TABLE public.pricing_rules
  ADD CONSTRAINT pricing_rules_same_day_delivery_fee_days_valid
  CHECK (
    same_day_delivery_fee_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
    AND array_position(same_day_delivery_fee_days, NULL) IS NULL
  );

COMMENT ON COLUMN public.pricing_rules.same_day_delivery_fee_days IS
  'Days of the week (0 = Sunday ... 6 = Saturday) on which a same-day delivery fee applies when the event date is today in America/Detroit. Default Monday to Friday. Empty = never charged.';
-- ---- end of the reviewed migration ----
DO $bpc$
BEGIN
  IF NOT COALESCE((EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pricing_rules' AND column_name='same_day_delivery_fee_days')), false) THEN RAISE EXCEPTION 'postcondition 1 failed'; END IF;
  IF NOT COALESCE((EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pricing_rules'::regclass AND conname='pricing_rules_same_day_delivery_fee_days_valid')), false) THEN RAISE EXCEPTION 'postcondition 2 failed'; END IF;
  IF NOT COALESCE((NOT EXISTS (SELECT 1 FROM public.pricing_rules WHERE same_day_delivery_fee_days IS DISTINCT FROM '{1,2,3,4,5}'::smallint[])), false) THEN RAISE EXCEPTION 'postcondition 3 failed'; END IF;
  IF ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')))::text <> current_setting('bpc.anon_fn_before') THEN RAISE EXCEPTION 'the set of functions anon can execute changed'; END IF;
  IF ((SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m') AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'))))::text <> current_setting('bpc.anon_tbl_before') THEN RAISE EXCEPTION 'the set of tables anon can touch changed'; END IF;
END $bpc$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261027120000', 'same_day_delivery_fee_days', ARRAY[$bpcm$-- BPC-DEV-MIGRATION applied by the guarded executor (AUTH-18); version=20261027120000; file=20261027120000_same_day_delivery_fee_days.sql; file_sha256=5660702052254ce7538a00109fafb3de788b61b937a29c60233c8d802f8b39a7; the exact file text follows as statements[2]$bpcm$, $bpcsql$-- WP-14: the days of the week on which the same-day delivery fee applies become a pricing rule.
--
-- Until now the fee applied when the event date was today (America/Detroit) and the weekday was Monday to Friday, hard-coded in
-- application code. The admin chooses the days (0 = Sunday ... 6 = Saturday). The default reproduces the current behavior exactly
-- (Monday to Friday), so existing rows price as before. An empty list means the fee is never charged. Additive and idempotent.

ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS same_day_delivery_fee_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'::smallint[];

ALTER TABLE public.pricing_rules
  DROP CONSTRAINT IF EXISTS pricing_rules_same_day_delivery_fee_days_valid;

ALTER TABLE public.pricing_rules
  ADD CONSTRAINT pricing_rules_same_day_delivery_fee_days_valid
  CHECK (
    same_day_delivery_fee_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
    AND array_position(same_day_delivery_fee_days, NULL) IS NULL
  );

COMMENT ON COLUMN public.pricing_rules.same_day_delivery_fee_days IS
  'Days of the week (0 = Sunday ... 6 = Saturday) on which a same-day delivery fee applies when the event date is today in America/Detroit. Default Monday to Friday. Empty = never charged.';
$bpcsql$]);
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 377 THEN RAISE EXCEPTION 'unexpected ledger count after the migration'; END IF;
  IF (SELECT statements[2] FROM supabase_migrations.schema_migrations WHERE version = '20261027120000') <> $bpcsql$-- WP-14: the days of the week on which the same-day delivery fee applies become a pricing rule.
--
-- Until now the fee applied when the event date was today (America/Detroit) and the weekday was Monday to Friday, hard-coded in
-- application code. The admin chooses the days (0 = Sunday ... 6 = Saturday). The default reproduces the current behavior exactly
-- (Monday to Friday), so existing rows price as before. An empty list means the fee is never charged. Additive and idempotent.

ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS same_day_delivery_fee_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'::smallint[];

ALTER TABLE public.pricing_rules
  DROP CONSTRAINT IF EXISTS pricing_rules_same_day_delivery_fee_days_valid;

ALTER TABLE public.pricing_rules
  ADD CONSTRAINT pricing_rules_same_day_delivery_fee_days_valid
  CHECK (
    same_day_delivery_fee_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
    AND array_position(same_day_delivery_fee_days, NULL) IS NULL
  );

COMMENT ON COLUMN public.pricing_rules.same_day_delivery_fee_days IS
  'Days of the week (0 = Sunday ... 6 = Saturday) on which a same-day delivery fee applies when the event date is today in America/Detroit. Default Monday to Friday. Empty = never charged.';
$bpcsql$ THEN RAISE EXCEPTION 'stored SQL differs from the file'; END IF;
END $bpc$;
