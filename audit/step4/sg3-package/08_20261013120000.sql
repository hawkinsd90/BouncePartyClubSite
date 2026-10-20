-- BPC-DEV-EXECUTOR step 8/28; version 20261013120000; file 20261013120000_restrict_remaining_public_database_access.sql; sha256_lf a68824b6076ced053b78bdf209f12fe79912d5403b3354b24e5091d2cc9aaff7; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261013120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261013120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261012120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261013120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 7 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
  SELECT count(*), encode(sha256(convert_to(coalesce(string_agg(version, E'\n' ORDER BY version), ''), 'UTF8')), 'hex') INTO v_n, v_h FROM supabase_migrations.schema_migrations WHERE version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]);
  IF v_n <> 305 OR v_h <> '76025b5b681008ec5b0239c57be1f54fd7bbed3a3f70fa1384698afcc6476c59' THEN RAISE EXCEPTION 'BPC-EXECUTOR: ledger outside the package differs from the approved export (% rows, hash %)', v_n, v_h; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: schema containment is not in force'; END IF;

  old_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT jsonb_object_agg(k, d||'/'||n), md5(string_agg(k||':'||d||':'||n, ',' ORDER BY k)) INTO fp, fp_all FROM (SELECT k, md5(string_agg(v, E'\n' ORDER BY v)) AS d, count(*) AS n FROM (
SELECT 'fn' AS k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||p.prokind::text||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||p.proleakproof||'|'||pg_get_userbyid(p.proowner)||'|'||p.prorettype::regtype::text||'|'||coalesce(p.proconfig::text,'')||'|'||md5(p.prosrc)||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '') AS v
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'rel', n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||c.relpersistence::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public') AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
UNION ALL
SELECT 'col', c.relname||'.'||a.attname||'|'||format_type(a.atttypid, a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin, d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text||'|'||
  coalesce((SELECT string_agg(x.privilege_type||':'||CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, ',' ORDER BY x.privilege_type, CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END) FROM aclexplode(a.attacl) x), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'con', conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
UNION ALL
SELECT 'idx', schemaname||'.'||tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'trg', tgrelid::regclass::text||'|'||tgname||'|'||tgenabled::text||'|'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid::regclass::text LIKE 'public.%' OR tgrelid::regclass::text IN ('auth.users','storage.objects','storage.buckets') OR tgrelid::regclass::text NOT LIKE '%.%')
UNION ALL
SELECT 'pol', schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') FROM pg_policies WHERE schemaname IN ('public','storage')
UNION ALL
SELECT 'nsp', nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(coalesce(nspacl, acldefault('n', nspowner))) a), '')
FROM pg_namespace WHERE nspname IN ('public','storage')
UNION ALL
SELECT 'dacl', pg_get_userbyid(defaclrole)||'|'||coalesce(defaclnamespace::regnamespace::text,'global')||'|'||defaclobjtype::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(defaclacl) a), '') FROM pg_default_acl WHERE defaclnamespace = 0 OR defaclnamespace = 'public'::regnamespace
UNION ALL
SELECT 'bkt', id||'|'||public||'|'||coalesce(file_size_limit::text,'null')||'|'||coalesce(allowed_mime_types::text,'null') FROM storage.buckets
UNION ALL
SELECT 'pub', pubname||'|'||schemaname||'.'||tablename FROM pg_publication_tables
UNION ALL
SELECT 'ext', extname||'|'||extnamespace::regnamespace::text FROM pg_extension WHERE extname <> 'supabase_vault'
) f GROUP BY k ORDER BY k) z;
  PERFORM set_config('search_path', old_sp, true);

  IF fp_all IS DISTINCT FROM '45a937c7786943e768b63870aa9c86ca' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261013120000 (expected 45a937c7786943e768b63870aa9c86ca, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261013120000_restrict_remaining_public_database_access.sql
/*
  # Restrict remaining public database access

  NOT APPLIED BY THIS CHANGE. Review, then apply manually (Dev first), after the core database access lockdown.

  Why
    After the payment RPC authorization, administrative exposure, portal link, public booking and core database access
    migrations, a live audit of the Dev database still found anonymous access that no active caller needs:

    1. Tables
       - public.stripe_webhook_events had an anonymous INSERT policy. Only the Stripe webhook Edge Function writes it, through
         the service role (supabase/functions/_shared/webhook-idempotency.ts). Because that function skips any event id whose
         row already says "succeeded" or "processing", an anonymous caller who could insert a row for a real event id could
         suppress that Stripe event. Anonymous and signed-in write access is removed; the service role (which bypasses RLS)
         and the Admin read policy are unchanged.
       - public.billing_addresses is created by migration 20260501173826 (add_billing_addresses_table); no application code reads
         or writes it. It had anonymous and authenticated INSERT policies with `true`. Those are removed and the Admin read policy is
         kept. The block is skipped when the table does not exist, so a clean replay is unaffected.

    2. Functions. The privilege model describes both the EXECUTE grant and the authorization inside the function:
       - Trigger functions never need EXECUTE for a trigger to fire (PostgreSQL checks it only when the trigger is created), so
         PUBLIC / anon / authenticated EXECUTE is removed from every trigger function in the public schema.
       - SERVICE ROLE ONLY (called only by Edge Functions through the service role, or by nobody): PUBLIC, anon and authenticated
         EXECUTE is removed; service_role keeps it.
           check_rate_limit, record_notification_failure, record_notification_success, user_has_role, get_user_highest_role,
           assign_user_role, remove_user_role, generate_receipt_group_id
         check_rate_limit and record_notification_failure/success accept caller-chosen values and perform writes with no
         caller check, so an anonymous caller could block other callers' rate-limit keys or flood and flip the notification
         system status. user_has_role / get_user_highest_role answer for any caller-supplied user id.
         generate_receipt_group_id has no caller at all (the browser uses crypto.randomUUID()).
       - AUTHENTICATED SESSION HELPERS (get_user_role, is_admin): every signed-in session needs them (RLS policies call them).
         PUBLIC and anon EXECUTE is removed; authenticated and service_role keep it.
       - AUTHENTICATED ENTRYPOINT - INTERNAL ADMIN CHECK: granted to authenticated and service_role, but the function itself
         rejects anyone who is not Admin / Master (or staff where noted) before reading privileged data or changing anything.
         PUBLIC and anon EXECUTE is removed. Every function in this group was read and checked; two did not have a check and get
         one here (section 2): generate_invoice_number and generate_receipt_number. The sequence behind receipt numbers is no
         longer consumable by ordinary customers.
       - AUTHENTICATED ENTRYPOINT - CALLER SCOPED: get_unresolved_failures_count had no caller check. It becomes SECURITY INVOKER so
         the notification_failures Admin-only read policy decides what the caller can count (a non-admin gets zeros) instead of
         any signed-in user seeing the counts.
       - PUBLIC API (an anonymous visitor really calls them: availability checks and the public site settings / menu): PUBLIC
         EXECUTE is replaced by explicit anon, authenticated and service_role EXECUTE.

    3. Table privileges
       - TRUNCATE, TRIGGER and REFERENCES are removed from anon and authenticated on every public table, and anon INSERT /
         UPDATE / DELETE is removed on every public table that has no anon / PUBLIC write policy. Row level security already denied
         those writes, so this only removes unused privileges (TRUNCATE ignores row level security).

  Not changed here: Crew order access, Storage, default privileges for future functions, schema drift.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.stripe_webhook_events') IS NULL THEN
    RAISE NOTICE 'public.stripe_webhook_events does not exist, skipped';
  ELSE
    FOR r IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'stripe_webhook_events' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.stripe_webhook_events', r.policyname);
    END LOOP;
    REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.stripe_webhook_events FROM authenticated;
  END IF;

  IF to_regclass('public.billing_addresses') IS NULL THEN
    RAISE NOTICE 'public.billing_addresses does not exist, skipped';
  ELSE
    FOR r IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'billing_addresses' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.billing_addresses', r.policyname);
    END LOOP;
    REVOKE ALL ON TABLE public.billing_addresses FROM anon;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.billing_addresses FROM authenticated;
  END IF;
END $$;

-- Table privileges that no API caller can use. TRUNCATE, TRIGGER and REFERENCES are never needed by anon or authenticated (and
-- TRUNCATE ignores row level security). Write privileges for anon are kept only on tables that have an anon / PUBLIC write
-- policy (site_events and pending_signups_consent today); everywhere else row level security already denied them, so this
-- changes no behaviour. SELECT grants (public catalog reads) are untouched.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated', t.relname);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.relname AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        AND (p.roles && ARRAY['anon', 'public']::name[])
    ) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon', t.relname);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Number generators: add the caller check they were missing (signature, return value, format and sequence unchanged)
--    Allowed callers: Admin / Master users (the Admin screens), the service role (Edge Functions) and the database superusers
--    (the SQL editor / migrations). Everyone else is rejected before anything is read or the sequence is touched.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  new_number text;
  year_prefix text;
  next_num integer;
BEGIN
  IF NOT (
    public.is_admin()
    OR COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    OR (COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = '' AND session_user IN ('postgres', 'supabase_admin'))
  ) THEN
    RAISE EXCEPTION 'Permission denied: only admin or master users can generate invoice numbers' USING ERRCODE = '42501';
  END IF;

  year_prefix := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-';

  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '\d+$') AS integer)), 0) + 1
  INTO next_num
  FROM public.invoices
  WHERE invoice_number LIKE year_prefix || '%';

  new_number := year_prefix || LPAD(next_num::text, 4, '0');

  RETURN new_number;
END;
$$;

-- transaction_receipts.receipt_number defaults to this function. Only Admin / Master users (browser receipts) and the service role
-- (Edge Functions) ever insert receipts, so only they may consume a receipt number.
CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num integer;
  receipt_num text;
BEGIN
  IF NOT (
    public.is_admin()
    OR COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    OR (COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = '' AND session_user IN ('postgres', 'supabase_admin'))
  ) THEN
    RAISE EXCEPTION 'Permission denied: only admin or master users can generate receipt numbers' USING ERRCODE = '42501';
  END IF;

  next_num := nextval('receipt_number_seq');
  receipt_num := 'RCP-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(next_num::text, 5, '0');
  RETURN receipt_num;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Function EXECUTE grants (looked up by name so signature drift between environments cannot make this fail)
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  -- Backend only: the service role (Edge Functions) or nobody.
  server_only text[] := ARRAY[
    'check_rate_limit', 'record_notification_failure', 'record_notification_success',
    'user_has_role', 'get_user_highest_role', 'assign_user_role', 'remove_user_role', 'generate_receipt_group_id'
  ];
  -- Every signed-in session needs these (RLS policies and the Admin / Crew screens call them for the caller's own identity).
  session_helpers text[] := ARRAY['get_user_role', 'is_admin'];
  -- Granted to every signed-in session, but the function itself rejects anyone who is not Admin / Master (or staff where noted)
  -- before it reads privileged data or changes anything.
  internal_admin_check text[] := ARRAY[
    'get_all_role_users', 'assign_role_by_email',
    'get_booking_source_analytics', 'get_booking_sources_analytics', 'get_delivery_timing_analytics',
    'save_inventory_product', 'save_inventory_product_v2', 'save_product_bundle', 'save_product_bundle_v2', 'save_product_category',
    'save_menu_group', 'reorder_menu_group', 'reorder_product_categories',
    'generate_invoice_number', 'generate_receipt_number', 'find_order_id_by_prefix', 'create_order_short_link'
  ];
  -- Runs as the caller, so row level security decides what the caller can see (a non-admin gets zeros).
  caller_scoped text[] := ARRAY['get_unresolved_failures_count'];
  public_api text[] := ARRAY[
    'check_date_blackout', 'check_unit_availability', 'check_product_availability',
    'get_public_business_settings', 'get_public_nav_menu_groups'
  ];
BEGIN
  -- Trigger functions: nothing calls them directly.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (server_only)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (session_helpers || internal_admin_check || caller_scoped)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (public_api)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', r.sig);
  END LOOP;

  -- The unresolved-failure count runs as the caller so the Admin-only read policy on notification_failures applies.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'get_unresolved_failures_count'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', r.sig);
  END LOOP;
END $$;
;
DO $bpcpost$
DECLARE fp jsonb; fp_all text; old_sp text;
BEGIN

  old_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT jsonb_object_agg(k, d||'/'||n), md5(string_agg(k||':'||d||':'||n, ',' ORDER BY k)) INTO fp, fp_all FROM (SELECT k, md5(string_agg(v, E'\n' ORDER BY v)) AS d, count(*) AS n FROM (
SELECT 'fn' AS k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||p.prokind::text||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||p.proleakproof||'|'||pg_get_userbyid(p.proowner)||'|'||p.prorettype::regtype::text||'|'||coalesce(p.proconfig::text,'')||'|'||md5(p.prosrc)||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '') AS v
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'rel', n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||c.relpersistence::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public') AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
UNION ALL
SELECT 'col', c.relname||'.'||a.attname||'|'||format_type(a.atttypid, a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin, d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text||'|'||
  coalesce((SELECT string_agg(x.privilege_type||':'||CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, ',' ORDER BY x.privilege_type, CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END) FROM aclexplode(a.attacl) x), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'con', conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
UNION ALL
SELECT 'idx', schemaname||'.'||tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'trg', tgrelid::regclass::text||'|'||tgname||'|'||tgenabled::text||'|'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid::regclass::text LIKE 'public.%' OR tgrelid::regclass::text IN ('auth.users','storage.objects','storage.buckets') OR tgrelid::regclass::text NOT LIKE '%.%')
UNION ALL
SELECT 'pol', schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') FROM pg_policies WHERE schemaname IN ('public','storage')
UNION ALL
SELECT 'nsp', nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(coalesce(nspacl, acldefault('n', nspowner))) a), '')
FROM pg_namespace WHERE nspname IN ('public','storage')
UNION ALL
SELECT 'dacl', pg_get_userbyid(defaclrole)||'|'||coalesce(defaclnamespace::regnamespace::text,'global')||'|'||defaclobjtype::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(defaclacl) a), '') FROM pg_default_acl WHERE defaclnamespace = 0 OR defaclnamespace = 'public'::regnamespace
UNION ALL
SELECT 'bkt', id||'|'||public||'|'||coalesce(file_size_limit::text,'null')||'|'||coalesce(allowed_mime_types::text,'null') FROM storage.buckets
UNION ALL
SELECT 'pub', pubname||'|'||schemaname||'.'||tablename FROM pg_publication_tables
UNION ALL
SELECT 'ext', extname||'|'||extnamespace::regnamespace::text FROM pg_extension WHERE extname <> 'supabase_vault'
) f GROUP BY k ORDER BY k) z;
  PERFORM set_config('search_path', old_sp, true);

  IF fp_all IS DISTINCT FROM '4736d7871bc1488f84bbadaefebb193a' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261013120000 (expected 4736d7871bc1488f84bbadaefebb193a, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261013120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261013120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261013120000', 'restrict_remaining_public_database_access', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=8/28; version=20261013120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=a68824b6076ced053b78bdf209f12fe79912d5403b3354b24e5091d2cc9aaff7', $bpcsql$/*
  # Restrict remaining public database access

  NOT APPLIED BY THIS CHANGE. Review, then apply manually (Dev first), after the core database access lockdown.

  Why
    After the payment RPC authorization, administrative exposure, portal link, public booking and core database access
    migrations, a live audit of the Dev database still found anonymous access that no active caller needs:

    1. Tables
       - public.stripe_webhook_events had an anonymous INSERT policy. Only the Stripe webhook Edge Function writes it, through
         the service role (supabase/functions/_shared/webhook-idempotency.ts). Because that function skips any event id whose
         row already says "succeeded" or "processing", an anonymous caller who could insert a row for a real event id could
         suppress that Stripe event. Anonymous and signed-in write access is removed; the service role (which bypasses RLS)
         and the Admin read policy are unchanged.
       - public.billing_addresses is created by migration 20260501173826 (add_billing_addresses_table); no application code reads
         or writes it. It had anonymous and authenticated INSERT policies with `true`. Those are removed and the Admin read policy is
         kept. The block is skipped when the table does not exist, so a clean replay is unaffected.

    2. Functions. The privilege model describes both the EXECUTE grant and the authorization inside the function:
       - Trigger functions never need EXECUTE for a trigger to fire (PostgreSQL checks it only when the trigger is created), so
         PUBLIC / anon / authenticated EXECUTE is removed from every trigger function in the public schema.
       - SERVICE ROLE ONLY (called only by Edge Functions through the service role, or by nobody): PUBLIC, anon and authenticated
         EXECUTE is removed; service_role keeps it.
           check_rate_limit, record_notification_failure, record_notification_success, user_has_role, get_user_highest_role,
           assign_user_role, remove_user_role, generate_receipt_group_id
         check_rate_limit and record_notification_failure/success accept caller-chosen values and perform writes with no
         caller check, so an anonymous caller could block other callers' rate-limit keys or flood and flip the notification
         system status. user_has_role / get_user_highest_role answer for any caller-supplied user id.
         generate_receipt_group_id has no caller at all (the browser uses crypto.randomUUID()).
       - AUTHENTICATED SESSION HELPERS (get_user_role, is_admin): every signed-in session needs them (RLS policies call them).
         PUBLIC and anon EXECUTE is removed; authenticated and service_role keep it.
       - AUTHENTICATED ENTRYPOINT - INTERNAL ADMIN CHECK: granted to authenticated and service_role, but the function itself
         rejects anyone who is not Admin / Master (or staff where noted) before reading privileged data or changing anything.
         PUBLIC and anon EXECUTE is removed. Every function in this group was read and checked; two did not have a check and get
         one here (section 2): generate_invoice_number and generate_receipt_number. The sequence behind receipt numbers is no
         longer consumable by ordinary customers.
       - AUTHENTICATED ENTRYPOINT - CALLER SCOPED: get_unresolved_failures_count had no caller check. It becomes SECURITY INVOKER so
         the notification_failures Admin-only read policy decides what the caller can count (a non-admin gets zeros) instead of
         any signed-in user seeing the counts.
       - PUBLIC API (an anonymous visitor really calls them: availability checks and the public site settings / menu): PUBLIC
         EXECUTE is replaced by explicit anon, authenticated and service_role EXECUTE.

    3. Table privileges
       - TRUNCATE, TRIGGER and REFERENCES are removed from anon and authenticated on every public table, and anon INSERT /
         UPDATE / DELETE is removed on every public table that has no anon / PUBLIC write policy. Row level security already denied
         those writes, so this only removes unused privileges (TRUNCATE ignores row level security).

  Not changed here: Crew order access, Storage, default privileges for future functions, schema drift.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.stripe_webhook_events') IS NULL THEN
    RAISE NOTICE 'public.stripe_webhook_events does not exist, skipped';
  ELSE
    FOR r IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'stripe_webhook_events' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.stripe_webhook_events', r.policyname);
    END LOOP;
    REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.stripe_webhook_events FROM authenticated;
  END IF;

  IF to_regclass('public.billing_addresses') IS NULL THEN
    RAISE NOTICE 'public.billing_addresses does not exist, skipped';
  ELSE
    FOR r IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'billing_addresses' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.billing_addresses', r.policyname);
    END LOOP;
    REVOKE ALL ON TABLE public.billing_addresses FROM anon;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.billing_addresses FROM authenticated;
  END IF;
END $$;

-- Table privileges that no API caller can use. TRUNCATE, TRIGGER and REFERENCES are never needed by anon or authenticated (and
-- TRUNCATE ignores row level security). Write privileges for anon are kept only on tables that have an anon / PUBLIC write
-- policy (site_events and pending_signups_consent today); everywhere else row level security already denied them, so this
-- changes no behaviour. SELECT grants (public catalog reads) are untouched.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated', t.relname);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.relname AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        AND (p.roles && ARRAY['anon', 'public']::name[])
    ) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon', t.relname);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Number generators: add the caller check they were missing (signature, return value, format and sequence unchanged)
--    Allowed callers: Admin / Master users (the Admin screens), the service role (Edge Functions) and the database superusers
--    (the SQL editor / migrations). Everyone else is rejected before anything is read or the sequence is touched.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  new_number text;
  year_prefix text;
  next_num integer;
BEGIN
  IF NOT (
    public.is_admin()
    OR COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    OR (COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = '' AND session_user IN ('postgres', 'supabase_admin'))
  ) THEN
    RAISE EXCEPTION 'Permission denied: only admin or master users can generate invoice numbers' USING ERRCODE = '42501';
  END IF;

  year_prefix := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-';

  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '\d+$') AS integer)), 0) + 1
  INTO next_num
  FROM public.invoices
  WHERE invoice_number LIKE year_prefix || '%';

  new_number := year_prefix || LPAD(next_num::text, 4, '0');

  RETURN new_number;
END;
$$;

-- transaction_receipts.receipt_number defaults to this function. Only Admin / Master users (browser receipts) and the service role
-- (Edge Functions) ever insert receipts, so only they may consume a receipt number.
CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num integer;
  receipt_num text;
BEGIN
  IF NOT (
    public.is_admin()
    OR COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    OR (COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = '' AND session_user IN ('postgres', 'supabase_admin'))
  ) THEN
    RAISE EXCEPTION 'Permission denied: only admin or master users can generate receipt numbers' USING ERRCODE = '42501';
  END IF;

  next_num := nextval('receipt_number_seq');
  receipt_num := 'RCP-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(next_num::text, 5, '0');
  RETURN receipt_num;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Function EXECUTE grants (looked up by name so signature drift between environments cannot make this fail)
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  -- Backend only: the service role (Edge Functions) or nobody.
  server_only text[] := ARRAY[
    'check_rate_limit', 'record_notification_failure', 'record_notification_success',
    'user_has_role', 'get_user_highest_role', 'assign_user_role', 'remove_user_role', 'generate_receipt_group_id'
  ];
  -- Every signed-in session needs these (RLS policies and the Admin / Crew screens call them for the caller's own identity).
  session_helpers text[] := ARRAY['get_user_role', 'is_admin'];
  -- Granted to every signed-in session, but the function itself rejects anyone who is not Admin / Master (or staff where noted)
  -- before it reads privileged data or changes anything.
  internal_admin_check text[] := ARRAY[
    'get_all_role_users', 'assign_role_by_email',
    'get_booking_source_analytics', 'get_booking_sources_analytics', 'get_delivery_timing_analytics',
    'save_inventory_product', 'save_inventory_product_v2', 'save_product_bundle', 'save_product_bundle_v2', 'save_product_category',
    'save_menu_group', 'reorder_menu_group', 'reorder_product_categories',
    'generate_invoice_number', 'generate_receipt_number', 'find_order_id_by_prefix', 'create_order_short_link'
  ];
  -- Runs as the caller, so row level security decides what the caller can see (a non-admin gets zeros).
  caller_scoped text[] := ARRAY['get_unresolved_failures_count'];
  public_api text[] := ARRAY[
    'check_date_blackout', 'check_unit_availability', 'check_product_availability',
    'get_public_business_settings', 'get_public_nav_menu_groups'
  ];
BEGIN
  -- Trigger functions: nothing calls them directly.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (server_only)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (session_helpers || internal_admin_check || caller_scoped)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (public_api)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', r.sig);
  END LOOP;

  -- The unresolved-failure count runs as the caller so the Admin-only read policy on notification_failures applies.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'get_unresolved_failures_count'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', r.sig);
  END LOOP;
END $$;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 313 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261013120000'; END IF;
END $bpcend$;
