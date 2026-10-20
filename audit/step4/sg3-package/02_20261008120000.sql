-- BPC-DEV-EXECUTOR step 2/28; version 20261008120000; file 20261008120000_restrict_role_and_admin_rpc_exposure.sql; sha256_lf ebd3f4b40a07d6064b44851f425fb0717276512df64dc7ae8f30a42b93e14a48; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261008120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261008120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM '88d3b29c727a1e521634d94bf62c92ef' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261008120000 (expected 88d3b29c727a1e521634d94bf62c92ef, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261008120000_restrict_role_and_admin_rpc_exposure.sql
/*
  # Role and administrative RPC exposure hotfixes

  Scope: small, independent fixes. This migration does NOT touch customer booking, the customer portal, invoice
  links, orders RLS, or any payment RPC authorization object, and it does not depend on the payment RPC authorization migration being applied first. It is safe
  to apply to BOTH Dev and Production (it was written against a read-only comparison of the two).

  ## 1. user_roles: remove the public "service role" policy and anonymous table access
  Dev carries `"Service role full access to user_roles" FOR ALL TO public USING (true) WITH CHECK (true)` (created by
  the original core schema; Production already lacks it). With it, anyone holding the public anon key could read,
  insert, update or delete role rows, i.e. grant themselves master. The policy is dropped idempotently, and the
  anon role loses all table privileges (no anonymous code path reads or writes user_roles).
  The restrictive policies already present in both environments are intentionally NOT recreated or changed:
    - own-row SELECT for authenticated users,
    - admin/master can read all roles,
    - master can insert/update/delete any role,
    - admin can insert/update/delete only role = 'crew' rows.
  service_role bypasses RLS and keeps its grants. Customers and crew have no INSERT/UPDATE/DELETE policy.

  ## 2. Administrative SECURITY DEFINER functions (before: executable by PUBLIC/anon in both environments)
    get_admin_users()            -> service_role only. Callers: the /setup page (removed in this batch) and the
                                    create-admin-user Edge Function (service role). No staff UI calls it.
    check_expiring_cards()       -> service_role only. No caller anywhere (it returns customer emails).
    get_user_creation_logs(text) -> service_role only. No caller anywhere.
    cleanup_old_rate_limits()    -> service_role only. No caller anywhere (it deletes rate-limit rows).
    get_admin_analytics(ts, ts)  -> admin/master (checked inside the function, lowercase-safe) and service_role.
                                    The only caller is the admin analytics screen. The existing body is preserved
                                    byte for byte by renaming it to get_admin_analytics_impl (service_role only) and
                                    putting an authorization wrapper under the old name and signature. Dev and
                                    Production bodies differ today, so the body is not re-stated here.
  EXECUTE is revoked from PUBLIC, anon and authenticated (not just anon), then granted to exactly the intended
  roles. search_path is pinned to "public, pg_temp" where the function relied on public (get_admin_users and
  get_user_creation_logs already use an empty search_path).

  ## Not changed
  Customer/booking/portal paths, orders and invoice_links RLS, the payment RPC authorization objects, get_all_role_users and
  assign_role_by_email (they already check the caller), and the other analytics RPCs (deferred).
*/

-- 1. user_roles ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access to user_roles" ON public.user_roles;

REVOKE ALL ON TABLE public.user_roles FROM anon;

-- 2a. get_admin_users: service role only -------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_admin_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_users() TO service_role;

-- 2b. check_expiring_cards: service role only --------------------------------------------------------------
ALTER FUNCTION public.check_expiring_cards() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.check_expiring_cards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_expiring_cards() TO service_role;

-- 2c. get_user_creation_logs: service role only ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_user_creation_logs(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_creation_logs(text) TO service_role;

-- 2d. cleanup_old_rate_limits: service role only -----------------------------------------------------------
ALTER FUNCTION public.cleanup_old_rate_limits() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.cleanup_old_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_rate_limits() TO service_role;

-- 2e. get_admin_analytics: admin/master (checked inside) and service role ----------------------------------
-- Keep the existing body untouched by renaming it; only do so once (idempotent).
DO $$
BEGIN
  IF to_regprocedure('public.get_admin_analytics_impl(timestamptz,timestamptz)') IS NULL
     AND to_regprocedure('public.get_admin_analytics(timestamptz,timestamptz)') IS NOT NULL THEN
    ALTER FUNCTION public.get_admin_analytics(timestamptz, timestamptz) RENAME TO get_admin_analytics_impl;
  END IF;
END
$$;

ALTER FUNCTION public.get_admin_analytics_impl(timestamptz, timestamptz) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_admin_analytics_impl(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_impl(timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_analytics(
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    coalesce(auth.role(), '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND lower(ur.role) IN ('admin', 'master')
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN public.get_admin_analytics_impl(p_start, p_end);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_analytics(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics(timestamptz, timestamptz) TO authenticated, service_role;
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

  IF fp_all IS DISTINCT FROM '9bd7915b86e5bc589d1b429582347c31' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261008120000 (expected 9bd7915b86e5bc589d1b429582347c31, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261008120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261008120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261008120000', 'restrict_role_and_admin_rpc_exposure', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=2/28; version=20261008120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=ebd3f4b40a07d6064b44851f425fb0717276512df64dc7ae8f30a42b93e14a48', $bpcsql$/*
  # Role and administrative RPC exposure hotfixes

  Scope: small, independent fixes. This migration does NOT touch customer booking, the customer portal, invoice
  links, orders RLS, or any payment RPC authorization object, and it does not depend on the payment RPC authorization migration being applied first. It is safe
  to apply to BOTH Dev and Production (it was written against a read-only comparison of the two).

  ## 1. user_roles: remove the public "service role" policy and anonymous table access
  Dev carries `"Service role full access to user_roles" FOR ALL TO public USING (true) WITH CHECK (true)` (created by
  the original core schema; Production already lacks it). With it, anyone holding the public anon key could read,
  insert, update or delete role rows, i.e. grant themselves master. The policy is dropped idempotently, and the
  anon role loses all table privileges (no anonymous code path reads or writes user_roles).
  The restrictive policies already present in both environments are intentionally NOT recreated or changed:
    - own-row SELECT for authenticated users,
    - admin/master can read all roles,
    - master can insert/update/delete any role,
    - admin can insert/update/delete only role = 'crew' rows.
  service_role bypasses RLS and keeps its grants. Customers and crew have no INSERT/UPDATE/DELETE policy.

  ## 2. Administrative SECURITY DEFINER functions (before: executable by PUBLIC/anon in both environments)
    get_admin_users()            -> service_role only. Callers: the /setup page (removed in this batch) and the
                                    create-admin-user Edge Function (service role). No staff UI calls it.
    check_expiring_cards()       -> service_role only. No caller anywhere (it returns customer emails).
    get_user_creation_logs(text) -> service_role only. No caller anywhere.
    cleanup_old_rate_limits()    -> service_role only. No caller anywhere (it deletes rate-limit rows).
    get_admin_analytics(ts, ts)  -> admin/master (checked inside the function, lowercase-safe) and service_role.
                                    The only caller is the admin analytics screen. The existing body is preserved
                                    byte for byte by renaming it to get_admin_analytics_impl (service_role only) and
                                    putting an authorization wrapper under the old name and signature. Dev and
                                    Production bodies differ today, so the body is not re-stated here.
  EXECUTE is revoked from PUBLIC, anon and authenticated (not just anon), then granted to exactly the intended
  roles. search_path is pinned to "public, pg_temp" where the function relied on public (get_admin_users and
  get_user_creation_logs already use an empty search_path).

  ## Not changed
  Customer/booking/portal paths, orders and invoice_links RLS, the payment RPC authorization objects, get_all_role_users and
  assign_role_by_email (they already check the caller), and the other analytics RPCs (deferred).
*/

-- 1. user_roles ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access to user_roles" ON public.user_roles;

REVOKE ALL ON TABLE public.user_roles FROM anon;

-- 2a. get_admin_users: service role only -------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_admin_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_users() TO service_role;

-- 2b. check_expiring_cards: service role only --------------------------------------------------------------
ALTER FUNCTION public.check_expiring_cards() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.check_expiring_cards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_expiring_cards() TO service_role;

-- 2c. get_user_creation_logs: service role only ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_user_creation_logs(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_creation_logs(text) TO service_role;

-- 2d. cleanup_old_rate_limits: service role only -----------------------------------------------------------
ALTER FUNCTION public.cleanup_old_rate_limits() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.cleanup_old_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_rate_limits() TO service_role;

-- 2e. get_admin_analytics: admin/master (checked inside) and service role ----------------------------------
-- Keep the existing body untouched by renaming it; only do so once (idempotent).
DO $$
BEGIN
  IF to_regprocedure('public.get_admin_analytics_impl(timestamptz,timestamptz)') IS NULL
     AND to_regprocedure('public.get_admin_analytics(timestamptz,timestamptz)') IS NOT NULL THEN
    ALTER FUNCTION public.get_admin_analytics(timestamptz, timestamptz) RENAME TO get_admin_analytics_impl;
  END IF;
END
$$;

ALTER FUNCTION public.get_admin_analytics_impl(timestamptz, timestamptz) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_admin_analytics_impl(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_impl(timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_analytics(
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    coalesce(auth.role(), '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND lower(ur.role) IN ('admin', 'master')
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN public.get_admin_analytics_impl(p_start, p_end);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_analytics(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics(timestamptz, timestamptz) TO authenticated, service_role;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 307 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261008120000'; END IF;
END $bpcend$;
