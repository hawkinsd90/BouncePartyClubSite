-- BPC-DEV-EXECUTOR step 1/28; version 20261007120000; file 20261007120000_harden_payment_rpc_authorization.sql; sha256_lf 70cc32988bdabd5dc04af40a0bc7ef1d81e8ba6df3ab6de7ab9bcbb40d9cf71e; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261007120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261007120000'; END IF;
  IF false THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261007120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY[]::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[]::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM '07d2d5c96e142fef6a011bc1f9b30dec' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261007120000 (expected 07d2d5c96e142fef6a011bc1f9b30dec, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261007120000_harden_payment_rpc_authorization.sql
/*
  # Payment RPC authorization hardening

  Scope: function-level authorization only. This migration does NOT change table RLS policies or table grants
  (handled by the core database access lockdown migration): the open "Service role full access to ..." policies and anon table privileges are untouched.

  ## Why
  Internal money RPCs are SECURITY DEFINER and were executable by PUBLIC / anon / authenticated with no caller
  check inside the body. Anyone holding the public anon key could call them directly through PostgREST
  (/rest/v1/rpc/...), bypassing the Edge Functions that are supposed to be their only callers.

  ## Changes
  1. is_admin() recognises lowercase role values. Live roles are lowercase (master, customer, crew) while the
     function compared uppercase 'ADMIN'/'MASTER', so it returned false for every real admin. Dependents (verified
     in Dev and Production): payments policies "Admins can insert/update/view ... payments" and archive_old_orders().
     Crew and customer are NOT admin. Signature, SECURITY DEFINER and search_path are unchanged.
  2. Internal payment RPCs become service-role only (EXECUTE revoked from PUBLIC, anon, authenticated):
       record_cash_payment, record_check_payment           (callers: record-cash-payment / record-check-payment
                                                            Edge Functions, service-role client)
       apply_balance_payment_financials                    (callers: customer-balance-payment,
                                                            reconcile-balance-payment, stripe-webhook; service role)
       claim_balance_payment_financials                    (deprecated no-op stub; no callers)
       increment_order_refunded_cents                      (caller: stripe-refund, which now calls it with a
                                                            plain service-role client)
  3. update_pricing_rules (exists in Production only): no browser or function caller exists (admins edit pricing
     through the table). Service-role only. Guarded so the migration is a no-op where the function does not exist.
  4. find_order_id_by_prefix: its only caller is the admin UI (authenticated). It now returns NULL unless the
     caller is an admin/master, and EXECUTE is revoked from PUBLIC and anon.
  5. get_signature_status / order_has_valid_signature: no callers in the app, Edge Functions, policies or other
     functions. They returned signer name/email for any order UUID. Service-role only.

  ## Not changed (intentionally)
  - approve_order_changes: customer-scoped by invoice token; stays executable by anon/authenticated.
  - get_admin_users: its only browser caller is the anonymous /setup bootstrap page; deferred (handled by the administrative RPC exposure migration).
  - Table RLS and table grants: handled by the core database access lockdown migration.
*/

-- 1. is_admin(): lowercase-safe -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = auth.uid()
      AND lower(role) IN ('admin', 'master')
    LIMIT 1
  );
$$;

-- 2. Internal payment RPCs: service role only ------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.record_cash_payment(uuid, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_payment(uuid, integer, integer, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_check_payment(uuid, integer, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_check_payment(uuid, integer, integer, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_balance_payment_financials(text, uuid, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_balance_payment_financials(text, uuid, integer, integer, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.claim_balance_payment_financials(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_balance_payment_financials(text) TO service_role;

REVOKE ALL ON FUNCTION public.increment_order_refunded_cents(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_order_refunded_cents(uuid, integer) TO service_role;

-- 3. update_pricing_rules: service role only (function exists in Production only) --------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.update_pricing_rules(uuid,integer,integer,integer,integer,text[],integer,integer,integer,integer,boolean)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.update_pricing_rules(uuid,integer,integer,integer,integer,text[],integer,integer,integer,integer,boolean) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_pricing_rules(uuid,integer,integer,integer,integer,text[],integer,integer,integer,integer,boolean) TO service_role';
  END IF;
END
$$;

-- 4. find_order_id_by_prefix: admin/master only ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_order_id_by_prefix(p_prefix text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.id
  FROM orders o
  WHERE public.is_admin()
    AND o.id::text ILIKE (lower(p_prefix) || '%')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_order_id_by_prefix(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_order_id_by_prefix(text) TO authenticated, service_role;

-- 5. Signature helpers: service role only ------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_signature_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_signature_status(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.order_has_valid_signature(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_has_valid_signature(uuid) TO service_role;
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

  IF fp_all IS DISTINCT FROM '88d3b29c727a1e521634d94bf62c92ef' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261007120000 (expected 88d3b29c727a1e521634d94bf62c92ef, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261007120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261007120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261007120000', 'harden_payment_rpc_authorization', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=1/28; version=20261007120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=70cc32988bdabd5dc04af40a0bc7ef1d81e8ba6df3ab6de7ab9bcbb40d9cf71e', $bpcsql$/*
  # Payment RPC authorization hardening

  Scope: function-level authorization only. This migration does NOT change table RLS policies or table grants
  (handled by the core database access lockdown migration): the open "Service role full access to ..." policies and anon table privileges are untouched.

  ## Why
  Internal money RPCs are SECURITY DEFINER and were executable by PUBLIC / anon / authenticated with no caller
  check inside the body. Anyone holding the public anon key could call them directly through PostgREST
  (/rest/v1/rpc/...), bypassing the Edge Functions that are supposed to be their only callers.

  ## Changes
  1. is_admin() recognises lowercase role values. Live roles are lowercase (master, customer, crew) while the
     function compared uppercase 'ADMIN'/'MASTER', so it returned false for every real admin. Dependents (verified
     in Dev and Production): payments policies "Admins can insert/update/view ... payments" and archive_old_orders().
     Crew and customer are NOT admin. Signature, SECURITY DEFINER and search_path are unchanged.
  2. Internal payment RPCs become service-role only (EXECUTE revoked from PUBLIC, anon, authenticated):
       record_cash_payment, record_check_payment           (callers: record-cash-payment / record-check-payment
                                                            Edge Functions, service-role client)
       apply_balance_payment_financials                    (callers: customer-balance-payment,
                                                            reconcile-balance-payment, stripe-webhook; service role)
       claim_balance_payment_financials                    (deprecated no-op stub; no callers)
       increment_order_refunded_cents                      (caller: stripe-refund, which now calls it with a
                                                            plain service-role client)
  3. update_pricing_rules (exists in Production only): no browser or function caller exists (admins edit pricing
     through the table). Service-role only. Guarded so the migration is a no-op where the function does not exist.
  4. find_order_id_by_prefix: its only caller is the admin UI (authenticated). It now returns NULL unless the
     caller is an admin/master, and EXECUTE is revoked from PUBLIC and anon.
  5. get_signature_status / order_has_valid_signature: no callers in the app, Edge Functions, policies or other
     functions. They returned signer name/email for any order UUID. Service-role only.

  ## Not changed (intentionally)
  - approve_order_changes: customer-scoped by invoice token; stays executable by anon/authenticated.
  - get_admin_users: its only browser caller is the anonymous /setup bootstrap page; deferred (handled by the administrative RPC exposure migration).
  - Table RLS and table grants: handled by the core database access lockdown migration.
*/

-- 1. is_admin(): lowercase-safe -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = auth.uid()
      AND lower(role) IN ('admin', 'master')
    LIMIT 1
  );
$$;

-- 2. Internal payment RPCs: service role only ------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.record_cash_payment(uuid, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_payment(uuid, integer, integer, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_check_payment(uuid, integer, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_check_payment(uuid, integer, integer, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_balance_payment_financials(text, uuid, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_balance_payment_financials(text, uuid, integer, integer, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.claim_balance_payment_financials(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_balance_payment_financials(text) TO service_role;

REVOKE ALL ON FUNCTION public.increment_order_refunded_cents(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_order_refunded_cents(uuid, integer) TO service_role;

-- 3. update_pricing_rules: service role only (function exists in Production only) --------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.update_pricing_rules(uuid,integer,integer,integer,integer,text[],integer,integer,integer,integer,boolean)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.update_pricing_rules(uuid,integer,integer,integer,integer,text[],integer,integer,integer,integer,boolean) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_pricing_rules(uuid,integer,integer,integer,integer,text[],integer,integer,integer,integer,boolean) TO service_role';
  END IF;
END
$$;

-- 4. find_order_id_by_prefix: admin/master only ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_order_id_by_prefix(p_prefix text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.id
  FROM orders o
  WHERE public.is_admin()
    AND o.id::text ILIKE (lower(p_prefix) || '%')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_order_id_by_prefix(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_order_id_by_prefix(text) TO authenticated, service_role;

-- 5. Signature helpers: service role only ------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_signature_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_signature_status(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.order_has_valid_signature(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_has_valid_signature(uuid) TO service_role;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 306 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261007120000'; END IF;
END $bpcend$;
