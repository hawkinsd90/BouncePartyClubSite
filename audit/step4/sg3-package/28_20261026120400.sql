-- BPC-DEV-EXECUTOR step 28/28; version 20261026120400; file 20261026120400_restrict_supabase_admin_default_privileges.sql; sha256_lf f9797ad211b39e65eaf1097d54ee2d3f1ae997bd6b85952f33b845e4273ffc63; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261026120400') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261026120400'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261026120300']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261026120400'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 27 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM 'f6c6f0b671d21b34703a0f0ad5848cb4' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261026120400 (expected f6c6f0b671d21b34703a0f0ad5848cb4, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261026120400_restrict_supabase_admin_default_privileges.sql
/*
  # Close the supabase_admin default privileges in schema public (Step 3B: SEC-015)

  Part of the coordinated Step 4 rollout (Development) and, later, the separately approved Production release. It is applied only
  through the approved Step 4 mechanism, in version order, after the October block and the four earlier Step 3B files; it is never run
  ad hoc, and the migration history records it only when the security outcome below is true. The read-only pre/post checks are in
  audit/security/step3b-verification-rules.json.

  ## Problem
  Production carries schema-level default privileges for the role `supabase_admin` in `public` (6 default ACL rows, verified read-only
  2026-10-17) that hand every NEW table, function and sequence created by `supabase_admin` (dashboard / SQL editor / platform tooling)
  to `anon` and `authenticated`. 20261018120000 closes only the defaults of the migration owner `postgres`. Development has no
  `public` defaults and must not receive Production's.

  ## Fix (fail closed)
  1. Postcondition: no default ACL for schema `public` owned by `supabase_admin` or `postgres` names `anon`, `authenticated` or PUBLIC.
  2. If it already holds (Development, a fresh database, or defaults closed beforehand) the file does nothing and passes.
  3. Otherwise it removes the `anon` / `authenticated` entries from the `supabase_admin` defaults for tables, sequences and functions.
  4. It then checks the postcondition again and RAISES (SQLSTATE 42501) if it does not hold, so the transaction rolls back and NO
     migration-history row is written. A privilege failure can therefore never be recorded as success.

  ## Step 4 gate (hosted capability is NOT verified)
  `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` needs superuser or membership in `supabase_admin`. Locally the migration operator
  is a superuser, so it succeeds on both replays; a non-superuser operator that is not a member is refused (reproduced locally). The
  hosted `postgres` role is not superuser and its membership is unverified. Before the Production run, and before the Development run if
  the read-only check below shows defaults, the owner must either confirm the hosted operator can do it or close the defaults once from
  the dashboard SQL editor as `supabase_admin` (same three statements as step 3, no new role). Check, read-only:
      SELECT pg_get_userbyid(defaclrole), defaclobjtype, defaclacl FROM pg_default_acl
      WHERE defaclnamespace = 'public'::regnamespace AND pg_get_userbyid(defaclrole) IN ('supabase_admin', 'postgres');
  Existing objects are not changed. Reversible by the opposite GRANT statements.
*/

DO $$
DECLARE
  leaked integer;
  attempt_error text;

  -- number of default ACL entries in schema public (owned by supabase_admin or postgres) that name anon, authenticated or PUBLIC
  entries_open CONSTANT text :=
    $q$SELECT count(*)
       FROM pg_default_acl d
       CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       WHERE d.defaclnamespace = 'public'::regnamespace
         AND pg_get_userbyid(d.defaclrole) IN ('supabase_admin', 'postgres')
         AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))$q$;
BEGIN
  EXECUTE entries_open INTO leaked;
  IF leaked = 0 THEN
    RAISE NOTICE 'default privileges in schema public already close anon and authenticated: nothing to do';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    BEGIN
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
    EXCEPTION WHEN insufficient_privilege THEN
      attempt_error := SQLERRM;
    END;
  END IF;

  EXECUTE entries_open INTO leaked;
  IF leaked > 0 THEN
    RAISE EXCEPTION 'default privileges in schema public still name anon, authenticated or PUBLIC (% entries)%. Close them as supabase_admin (see the header of this migration), then run this migration again.',
      leaked, CASE WHEN attempt_error IS NULL THEN '' ELSE ' because this role may not change them: ' || attempt_error END
      USING ERRCODE = 'insufficient_privilege';
  END IF;
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

  IF fp_all IS DISTINCT FROM 'f6c6f0b671d21b34703a0f0ad5848cb4' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261026120400 (expected f6c6f0b671d21b34703a0f0ad5848cb4, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261026120400 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261026120400: rls-on-every-public-table'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclnamespace = 'public'::regnamespace AND pg_get_userbyid(d.defaclrole) IN ('supabase_admin', 'postgres') AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))) AS effect_present), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261026120400: step3b-post-effect-present'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261026120400', 'restrict_supabase_admin_default_privileges', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-S3B; step=28/28; version=20261026120400; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=f9797ad211b39e65eaf1097d54ee2d3f1ae997bd6b85952f33b845e4273ffc63', $bpcsql$/*
  # Close the supabase_admin default privileges in schema public (Step 3B: SEC-015)

  Part of the coordinated Step 4 rollout (Development) and, later, the separately approved Production release. It is applied only
  through the approved Step 4 mechanism, in version order, after the October block and the four earlier Step 3B files; it is never run
  ad hoc, and the migration history records it only when the security outcome below is true. The read-only pre/post checks are in
  audit/security/step3b-verification-rules.json.

  ## Problem
  Production carries schema-level default privileges for the role `supabase_admin` in `public` (6 default ACL rows, verified read-only
  2026-10-17) that hand every NEW table, function and sequence created by `supabase_admin` (dashboard / SQL editor / platform tooling)
  to `anon` and `authenticated`. 20261018120000 closes only the defaults of the migration owner `postgres`. Development has no
  `public` defaults and must not receive Production's.

  ## Fix (fail closed)
  1. Postcondition: no default ACL for schema `public` owned by `supabase_admin` or `postgres` names `anon`, `authenticated` or PUBLIC.
  2. If it already holds (Development, a fresh database, or defaults closed beforehand) the file does nothing and passes.
  3. Otherwise it removes the `anon` / `authenticated` entries from the `supabase_admin` defaults for tables, sequences and functions.
  4. It then checks the postcondition again and RAISES (SQLSTATE 42501) if it does not hold, so the transaction rolls back and NO
     migration-history row is written. A privilege failure can therefore never be recorded as success.

  ## Step 4 gate (hosted capability is NOT verified)
  `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` needs superuser or membership in `supabase_admin`. Locally the migration operator
  is a superuser, so it succeeds on both replays; a non-superuser operator that is not a member is refused (reproduced locally). The
  hosted `postgres` role is not superuser and its membership is unverified. Before the Production run, and before the Development run if
  the read-only check below shows defaults, the owner must either confirm the hosted operator can do it or close the defaults once from
  the dashboard SQL editor as `supabase_admin` (same three statements as step 3, no new role). Check, read-only:
      SELECT pg_get_userbyid(defaclrole), defaclobjtype, defaclacl FROM pg_default_acl
      WHERE defaclnamespace = 'public'::regnamespace AND pg_get_userbyid(defaclrole) IN ('supabase_admin', 'postgres');
  Existing objects are not changed. Reversible by the opposite GRANT statements.
*/

DO $$
DECLARE
  leaked integer;
  attempt_error text;

  -- number of default ACL entries in schema public (owned by supabase_admin or postgres) that name anon, authenticated or PUBLIC
  entries_open CONSTANT text :=
    $q$SELECT count(*)
       FROM pg_default_acl d
       CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       WHERE d.defaclnamespace = 'public'::regnamespace
         AND pg_get_userbyid(d.defaclrole) IN ('supabase_admin', 'postgres')
         AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))$q$;
BEGIN
  EXECUTE entries_open INTO leaked;
  IF leaked = 0 THEN
    RAISE NOTICE 'default privileges in schema public already close anon and authenticated: nothing to do';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    BEGIN
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
    EXCEPTION WHEN insufficient_privilege THEN
      attempt_error := SQLERRM;
    END;
  END IF;

  EXECUTE entries_open INTO leaked;
  IF leaked > 0 THEN
    RAISE EXCEPTION 'default privileges in schema public still name anon, authenticated or PUBLIC (% entries)%. Close them as supabase_admin (see the header of this migration), then run this migration again.',
      leaked, CASE WHEN attempt_error IS NULL THEN '' ELSE ' because this role may not change them: ' || attempt_error END
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 333 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261026120400'; END IF;
END $bpcend$;
