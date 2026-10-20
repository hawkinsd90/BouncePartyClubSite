-- BPC-DEV-EXECUTOR step 24/28; version 20261026120000; file 20261026120000_restrict_sequence_and_anon_table_privileges.sql; sha256_lf 00df3c9b0d6f0e7aca0352a9dcce93f8a9b5d4b2739e8c7eaa40a85274df5d58; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261026120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261026120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261025120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261026120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 23 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM 'bee7c6f06047a0b03ffeffd38b6ed69a' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261026120000 (expected bee7c6f06047a0b03ffeffd38b6ed69a, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261026120000_restrict_sequence_and_anon_table_privileges.sql
/*
  # Restrict sequence privileges and anonymous table privileges (Step 3B: SEC-014, SEC-039, SEC-037)

  Step 3B corrective migration. It belongs to the coordinated Step 4 Development rollout (and, after Development is proven and a release is
  approved, the separate Production release) and is applied only through the approved Step 4 mechanism, in version order, after the October
  block (20261025120000) and the earlier Step 3B files, together with the read-only pre/post checks in
  audit/security/step3b-verification-rules.json. It is never run ad hoc; the migration history records it only after it succeeded. Privilege changes only: no data, policy, table or
  function body is changed. Safe on Production and Development, and safe to run twice. It stops (SQLSTATE 42501) if an anonymous privilege would
  remain through a PUBLIC grant, rather than recording a partial result.

  ## 1. Sequences (SEC-014)
  Production grants `anon` USAGE and UPDATE (`setval`) on `receipt_number_seq` and `payments_ledger_sequence_seq` (verified read-only
  2026-10-17). The grants come from the hosted default privileges handing every new object to the API roles, and no earlier migration
  revokes them on EXISTING sequences (20261018120000 only changes the defaults for future objects). PostgREST does not expose sequences
  directly, so this is defence in depth, but a caller that reaches the database with the `anon` or `authenticated` role could renumber
  receipts or burn the ledger sequence.
    - anon: every privilege on every public sequence is removed. No anonymous flow uses a sequence: receipt numbers come from the
      SECURITY DEFINER function generate_receipt_number, and payments.ledger_sequence is filled by server-side payment functions.
    - authenticated: UPDATE (setval) is removed. USAGE/SELECT are kept so a signed-in staff session keeps working if any
      SECURITY INVOKER path ever evaluates a column default; the sequences cannot be reset or moved.
    - service_role is untouched.

  ## 2. Anonymous table privileges (SEC-039, defence in depth)
  Row level security is the real gate and no anonymous policy exists on the tables below, so anonymous access is already denied. The
  table-level privileges still exist (`anon` holds SELECT on admin_settings, which stores provider credentials, and on logs and
  conversations), which leaves a single missing policy between the public key and the data. Anonymous privileges are removed from
  every public table that has NO policy naming `anon` or `public`. Tables that DO have such a policy (the public catalog reads and the
  signup-consent insert) keep their grants, except for write privileges the policy does not use:
    - pending_signups_consent keeps INSERT only (its one anonymous policy is an INSERT policy).
  Nothing an anonymous visitor can do today changes: they can only reach rows a policy lets them see, and every such table is kept.
  Future tables are covered by the default privileges set in 20261018120000.

  ## 3. Unpinned SECURITY DEFINER search_path (SEC-037)
  `update_google_reviews_updated_at()` is the only SECURITY DEFINER function without a pinned search_path (verified on the replayed
  chain; Step 2 counted exactly one on both databases). It is a trigger function that only sets `updated_at`; pinning the path changes
  nothing it does.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Sequences
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Anonymous table privileges follow the policies
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND (p.roles && ARRAY['anon', 'public']::name[])
      )
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t.name);
  END LOOP;
END $$;

-- The one table whose only anonymous policy is an INSERT policy: remove the privileges that policy does not use.
DO $$
BEGIN
  IF to_regclass('public.pending_signups_consent') IS NOT NULL THEN
    REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pending_signups_consent FROM anon;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Pin the search_path of the one unpinned SECURITY DEFINER function
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.update_google_reviews_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.update_google_reviews_updated_at() SET search_path = public, pg_temp;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Postcondition (fail closed): no anonymous privilege may remain, whatever its source (a direct grant, a grant to PUBLIC, a role
--    membership). has_*_privilege() evaluates the EFFECTIVE privilege, so a grant to PUBLIC that the REVOKEs above cannot remove is
--    caught here and the transaction rolls back instead of recording a partial result.
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  remaining text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO remaining
  FROM (
    -- (OFFSET 0 keeps the planner from asking has_sequence_privilege about relations that are not sequences)
    SELECT 'sequence ' || c.relname AS name
    FROM (SELECT oid, relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' OFFSET 0) c
    WHERE has_sequence_privilege('anon', c.oid, 'USAGE') OR has_sequence_privilege('anon', c.oid, 'SELECT') OR has_sequence_privilege('anon', c.oid, 'UPDATE')
    UNION ALL
    SELECT 'sequence ' || c.relname
    FROM (SELECT oid, relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' OFFSET 0) c
    WHERE has_sequence_privilege('authenticated', c.oid, 'UPDATE')
    UNION ALL
    SELECT 'table ' || c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname AND (p.roles && ARRAY['anon', 'public']::name[])
      )
  ) x;

  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'anonymous privileges remain after the revokes (a grant to PUBLIC or an inherited role?): %', remaining
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

  IF fp_all IS DISTINCT FROM '430bd39c19e5babf1e44657a1b7f1416' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261026120000 (expected 430bd39c19e5babf1e44657a1b7f1416, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261026120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261026120000: rls-on-every-public-table'; END IF;
  IF NOT COALESCE((SELECT (NOT EXISTS (SELECT 1 FROM (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' OFFSET 0) c WHERE has_sequence_privilege('anon', c.oid, 'USAGE') OR has_sequence_privilege('anon', c.oid, 'UPDATE') OR has_sequence_privilege('authenticated', c.oid, 'UPDATE')) AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.roles && ARRAY['anon','public']::name[]))) AS effect_present), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261026120000: step3b-post-effect-present'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261026120000', 'restrict_sequence_and_anon_table_privileges', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-S3B; step=24/28; version=20261026120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=00df3c9b0d6f0e7aca0352a9dcce93f8a9b5d4b2739e8c7eaa40a85274df5d58', $bpcsql$/*
  # Restrict sequence privileges and anonymous table privileges (Step 3B: SEC-014, SEC-039, SEC-037)

  Step 3B corrective migration. It belongs to the coordinated Step 4 Development rollout (and, after Development is proven and a release is
  approved, the separate Production release) and is applied only through the approved Step 4 mechanism, in version order, after the October
  block (20261025120000) and the earlier Step 3B files, together with the read-only pre/post checks in
  audit/security/step3b-verification-rules.json. It is never run ad hoc; the migration history records it only after it succeeded. Privilege changes only: no data, policy, table or
  function body is changed. Safe on Production and Development, and safe to run twice. It stops (SQLSTATE 42501) if an anonymous privilege would
  remain through a PUBLIC grant, rather than recording a partial result.

  ## 1. Sequences (SEC-014)
  Production grants `anon` USAGE and UPDATE (`setval`) on `receipt_number_seq` and `payments_ledger_sequence_seq` (verified read-only
  2026-10-17). The grants come from the hosted default privileges handing every new object to the API roles, and no earlier migration
  revokes them on EXISTING sequences (20261018120000 only changes the defaults for future objects). PostgREST does not expose sequences
  directly, so this is defence in depth, but a caller that reaches the database with the `anon` or `authenticated` role could renumber
  receipts or burn the ledger sequence.
    - anon: every privilege on every public sequence is removed. No anonymous flow uses a sequence: receipt numbers come from the
      SECURITY DEFINER function generate_receipt_number, and payments.ledger_sequence is filled by server-side payment functions.
    - authenticated: UPDATE (setval) is removed. USAGE/SELECT are kept so a signed-in staff session keeps working if any
      SECURITY INVOKER path ever evaluates a column default; the sequences cannot be reset or moved.
    - service_role is untouched.

  ## 2. Anonymous table privileges (SEC-039, defence in depth)
  Row level security is the real gate and no anonymous policy exists on the tables below, so anonymous access is already denied. The
  table-level privileges still exist (`anon` holds SELECT on admin_settings, which stores provider credentials, and on logs and
  conversations), which leaves a single missing policy between the public key and the data. Anonymous privileges are removed from
  every public table that has NO policy naming `anon` or `public`. Tables that DO have such a policy (the public catalog reads and the
  signup-consent insert) keep their grants, except for write privileges the policy does not use:
    - pending_signups_consent keeps INSERT only (its one anonymous policy is an INSERT policy).
  Nothing an anonymous visitor can do today changes: they can only reach rows a policy lets them see, and every such table is kept.
  Future tables are covered by the default privileges set in 20261018120000.

  ## 3. Unpinned SECURITY DEFINER search_path (SEC-037)
  `update_google_reviews_updated_at()` is the only SECURITY DEFINER function without a pinned search_path (verified on the replayed
  chain; Step 2 counted exactly one on both databases). It is a trigger function that only sets `updated_at`; pinning the path changes
  nothing it does.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Sequences
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Anonymous table privileges follow the policies
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND (p.roles && ARRAY['anon', 'public']::name[])
      )
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t.name);
  END LOOP;
END $$;

-- The one table whose only anonymous policy is an INSERT policy: remove the privileges that policy does not use.
DO $$
BEGIN
  IF to_regclass('public.pending_signups_consent') IS NOT NULL THEN
    REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pending_signups_consent FROM anon;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Pin the search_path of the one unpinned SECURITY DEFINER function
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.update_google_reviews_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.update_google_reviews_updated_at() SET search_path = public, pg_temp;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Postcondition (fail closed): no anonymous privilege may remain, whatever its source (a direct grant, a grant to PUBLIC, a role
--    membership). has_*_privilege() evaluates the EFFECTIVE privilege, so a grant to PUBLIC that the REVOKEs above cannot remove is
--    caught here and the transaction rolls back instead of recording a partial result.
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  remaining text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO remaining
  FROM (
    -- (OFFSET 0 keeps the planner from asking has_sequence_privilege about relations that are not sequences)
    SELECT 'sequence ' || c.relname AS name
    FROM (SELECT oid, relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' OFFSET 0) c
    WHERE has_sequence_privilege('anon', c.oid, 'USAGE') OR has_sequence_privilege('anon', c.oid, 'SELECT') OR has_sequence_privilege('anon', c.oid, 'UPDATE')
    UNION ALL
    SELECT 'sequence ' || c.relname
    FROM (SELECT oid, relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' OFFSET 0) c
    WHERE has_sequence_privilege('authenticated', c.oid, 'UPDATE')
    UNION ALL
    SELECT 'table ' || c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname AND (p.roles && ARRAY['anon', 'public']::name[])
      )
  ) x;

  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'anonymous privileges remain after the revokes (a grant to PUBLIC or an inherited role?): %', remaining
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 329 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261026120000'; END IF;
END $bpcend$;
