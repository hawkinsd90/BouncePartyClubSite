'use strict';
// Catalog fingerprint used by the exact-version migration executor (Step 4A.1, D-01).
//
// A fingerprint is a set of per-category MD5 digests of the security- and schema-relevant catalog state of a database: functions (body hash, owner,
// SECURITY DEFINER, config, ACL), relations (kind, owner, RLS flags, ACL), columns (type, nullability, default, column ACL), constraints, indexes,
// triggers, policies (public and storage), schema ACLs, default privileges, bucket rows, publications, extensions and the non-internal triggers on auth.users.
// It is READ-ONLY SQL: it runs unchanged on a local scratch database and (later, under separate approval) on hosted Development, so the executor can require
// "post-state equals the rehearsed post-state" inside the same transaction that would record a migration.
//
// Everything is evaluated with search_path = pg_catalog so that deparsed expressions (defaults, policy text, constraint definitions) do not depend on the session.
// Platform-managed state that a schema-only local restore cannot reproduce is excluded: default privileges outside `public`/global, the supabase_vault extension, and extension versions (they differ between PostgreSQL 17 and 18 builds).
// ACL aggregates are ordered by role NAME (never by oid) so that two clusters compare equal.
// NOT NULL constraints (pg_constraint contype 'n', PostgreSQL 18 only) are excluded so that PostgreSQL 17 (hosted) and 18 (local) agree.

const ROWS = `
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
`;

// one row per category: (k, digest, n)
const DIGEST_ROWS = `SELECT k, md5(string_agg(v, E'\\n' ORDER BY v)) AS d, count(*) AS n FROM (${ROWS}) f GROUP BY k ORDER BY k`;

// a single boolean-free text: the digest of the digests (used inside the executor's transaction)
const DIGEST_ALL = `SELECT md5(string_agg(k||':'||d||':'||n, ',' ORDER BY k)) FROM (${DIGEST_ROWS}) z`;

// standalone read-only statement for the capture and comparison tooling (a local psql -c, or later a read-only hosted call)
const READ_ONLY_STATEMENT = `SET LOCAL search_path = pg_catalog; ${DIGEST_ROWS};`;

// the PL/pgSQL fragment embedded in the executor's DO blocks: leaves fp (jsonb of category digests) and fp_all (text) set; search_path is restored afterwards
const PLPGSQL_COMPUTE = `
  old_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT jsonb_object_agg(k, d||'/'||n), md5(string_agg(k||':'||d||':'||n, ',' ORDER BY k)) INTO fp, fp_all FROM (${DIGEST_ROWS}) z;
  PERFORM set_config('search_path', old_sp, true);
`;

module.exports = { ROWS, DIGEST_ROWS, DIGEST_ALL, READ_ONLY_STATEMENT, PLPGSQL_COMPUTE };
