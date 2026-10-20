-- BPC-DEV-EXECUTOR step 9/28; version 20261014120000; file 20261014120000_protect_waiver_media_and_restrict_storage_access.sql; sha256_lf facabbd7b410ebd9d1a4372c5284bf6f4bd814c38c849a11daf7735b7979331f; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261014120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261013120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261014120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 8 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM '4736d7871bc1488f84bbadaefebb193a' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261014120000 (expected 4736d7871bc1488f84bbadaefebb193a, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261014120000_protect_waiver_media_and_restrict_storage_access.sql
/*
  # Protect waiver media and restrict Storage access

  Scope: signed waiver PDFs, signature images and paper-waiver scans become private (service role / signed URLs only), and the
  over-broad Storage write, delete and listing policies on the nine buckets listed below are replaced by a minimal set.
  This does NOT make customer lot / order photos or delivery / damage evidence private; see Not changed here.

  NOT APPLIED BY THIS CHANGE. Review, then apply manually (Dev first). Deploy the updated Edge Functions (get-waiver-status,
  generate-signed-waiver, save-signature, upload-physical-waiver) BEFORE applying this migration, and the new frontend right after it: those readers
  turn a stored waiver / signature reference into a short-lived signed URL, which is the only way to read the files once the
  buckets are private. Historical rows (full public URLs) keep working because the readers extract the object path.

  Why
    A live audit of the Dev Storage found that the legal documents were world-readable:
      - signed-waivers  (signed waiver PDFs: customer name, address, signature)       public bucket + public SELECT policy
      - signatures      (electronic signature images)                                  public bucket + public SELECT policy
    and that other policies on storage.objects were far broader than any caller needs, in the repository history and/or on Dev:
      - anonymous and signed-in INSERT into signed-waivers, signatures and public-assets;
      - signed-in SELECT of every signature and signed waiver ("Users can view own ..." only checked the bucket);
      - signed-in DELETE of every lot picture (any customer could delete anyone's photos);
      - SELECT on lot-pictures / public-assets for everybody, which lets anyone LIST every object name in those buckets
        (a public bucket serves objects by URL without any policy; a SELECT policy additionally enables listing);
      - signed-in read of order pictures through an email join on contacts.
    The Edge Functions write and read these objects with the service role, which bypasses Storage policies, so none of that
    access was needed.

  What this migration does
    1. signed-waivers and signatures (and physical-waivers, already private) are made private and get NO Storage policy at all:
       only the service role (Edge Functions) can write or read them. People reach them through get-waiver-status, which
       returns a 1-hour signed URL only to the order's token holder, the order's signed-in owner, or admin / master / crew.
    2. Every Storage policy that mentions one of the nine buckets below is dropped and replaced by an explicit minimal set:
         marketing buckets   unit-images, carousel-media, event-essentials-media
                             anonymous read (they are shown on the public website); Admin / Master write.
         public-assets       (logo and marketing files, and - historically - delivery / damage photos; see Not changed)
                             no listing for anonymous or signed-in customers; staff (admin / master / crew) upload;
                             Admin / Master list, replace and delete.
         lot-pictures        customers upload from the portal into "<order id>/<file>" only (image types and size are limited by
                             the bucket); no listing for anonymous or signed-in customers; only Admin / Master list and delete.
         order-pictures      customers upload from the portal into "<order id>/<file>" only; staff read; Admin / Master replace
                             and delete.
    3. Nothing is moved, deleted or rewritten: no objects, no bucket contents, no table rows.

  Not changed here (needs a separate, coordinated change; reported separately)
    - lot-pictures, order-pictures and public-assets stay PUBLIC buckets: the portal, the Admin screens and the delivery /
      damage proof photos still display them through permanent public URLs, and public-assets mixes marketing files with
      delivery / damage evidence, which cannot be separated without moving objects.
    - Customers still upload lot / order pictures straight from the browser (portal flow).
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Buckets that hold legal documents are private
-- ---------------------------------------------------------------------------------------------------------------------
UPDATE storage.buckets SET public = false WHERE id IN ('signed-waivers', 'signatures', 'physical-waivers');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Reset every Storage policy that mentions one of these buckets
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  buckets text[] := ARRAY[
    'signed-waivers', 'signatures', 'physical-waivers', 'lot-pictures', 'order-pictures', 'public-assets',
    'unit-images', 'carousel-media', 'event-essentials-media'
  ];
BEGIN
  FOR r IN
    SELECT p.policyname
    FROM pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
      AND EXISTS (
        SELECT 1 FROM unnest(buckets) b
        WHERE coalesce(p.qual, '') LIKE '%''' || b || '''%' OR coalesce(p.with_check, '') LIKE '%''' || b || '''%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The explicit policy set
-- ---------------------------------------------------------------------------------------------------------------------

-- Marketing buckets: shown to anonymous visitors, managed by Admin / Master.
CREATE POLICY "Public read marketing media" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id IN ('unit-images', 'carousel-media', 'event-essentials-media'));
CREATE POLICY "Admin and master manage marketing media" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id IN ('unit-images', 'carousel-media', 'event-essentials-media') AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id IN ('unit-images', 'carousel-media', 'event-essentials-media') AND (SELECT public.is_admin()));

-- public-assets: no listing policy (objects are served by URL because the bucket is public); staff upload, Admin / Master manage.
CREATE POLICY "Staff upload public assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'public-assets' AND (SELECT public.is_crew_or_admin()));
-- Postgres only lets a role UPDATE / DELETE rows it can also SELECT, so Admin / Master need a read policy for the buckets they manage.
CREATE POLICY "Admin and master read public assets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'public-assets' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master replace public assets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'public-assets' AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id = 'public-assets' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master delete public assets" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'public-assets' AND (SELECT public.is_admin()));

-- lot-pictures: customers upload into "<order id>/<file>" from the portal; only Admin / Master delete; nobody lists.
CREATE POLICY "Upload lot pictures into an order folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'lot-pictures' AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$');
CREATE POLICY "Admin and master read lot pictures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'lot-pictures' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master delete lot pictures" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lot-pictures' AND (SELECT public.is_admin()));

-- order-pictures: customers upload into "<order id>/<file>" from the portal; staff read; Admin / Master replace and delete.
CREATE POLICY "Upload order pictures into an order folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'order-pictures' AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$');
CREATE POLICY "Staff read order pictures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'order-pictures' AND (SELECT public.is_crew_or_admin()));
CREATE POLICY "Admin and master replace order pictures" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'order-pictures' AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id = 'order-pictures' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master delete order pictures" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'order-pictures' AND (SELECT public.is_admin()));

-- signed-waivers, signatures and physical-waivers intentionally have NO policy: service role only.
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

  IF fp_all IS DISTINCT FROM '66cc0143696685abd2e9f7834f42c2a3' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261014120000 (expected 66cc0143696685abd2e9f7834f42c2a3, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261014120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261014120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261014120000', 'protect_waiver_media_and_restrict_storage_access', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=9/28; version=20261014120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=facabbd7b410ebd9d1a4372c5284bf6f4bd814c38c849a11daf7735b7979331f', $bpcsql$/*
  # Protect waiver media and restrict Storage access

  Scope: signed waiver PDFs, signature images and paper-waiver scans become private (service role / signed URLs only), and the
  over-broad Storage write, delete and listing policies on the nine buckets listed below are replaced by a minimal set.
  This does NOT make customer lot / order photos or delivery / damage evidence private; see Not changed here.

  NOT APPLIED BY THIS CHANGE. Review, then apply manually (Dev first). Deploy the updated Edge Functions (get-waiver-status,
  generate-signed-waiver, save-signature, upload-physical-waiver) BEFORE applying this migration, and the new frontend right after it: those readers
  turn a stored waiver / signature reference into a short-lived signed URL, which is the only way to read the files once the
  buckets are private. Historical rows (full public URLs) keep working because the readers extract the object path.

  Why
    A live audit of the Dev Storage found that the legal documents were world-readable:
      - signed-waivers  (signed waiver PDFs: customer name, address, signature)       public bucket + public SELECT policy
      - signatures      (electronic signature images)                                  public bucket + public SELECT policy
    and that other policies on storage.objects were far broader than any caller needs, in the repository history and/or on Dev:
      - anonymous and signed-in INSERT into signed-waivers, signatures and public-assets;
      - signed-in SELECT of every signature and signed waiver ("Users can view own ..." only checked the bucket);
      - signed-in DELETE of every lot picture (any customer could delete anyone's photos);
      - SELECT on lot-pictures / public-assets for everybody, which lets anyone LIST every object name in those buckets
        (a public bucket serves objects by URL without any policy; a SELECT policy additionally enables listing);
      - signed-in read of order pictures through an email join on contacts.
    The Edge Functions write and read these objects with the service role, which bypasses Storage policies, so none of that
    access was needed.

  What this migration does
    1. signed-waivers and signatures (and physical-waivers, already private) are made private and get NO Storage policy at all:
       only the service role (Edge Functions) can write or read them. People reach them through get-waiver-status, which
       returns a 1-hour signed URL only to the order's token holder, the order's signed-in owner, or admin / master / crew.
    2. Every Storage policy that mentions one of the nine buckets below is dropped and replaced by an explicit minimal set:
         marketing buckets   unit-images, carousel-media, event-essentials-media
                             anonymous read (they are shown on the public website); Admin / Master write.
         public-assets       (logo and marketing files, and - historically - delivery / damage photos; see Not changed)
                             no listing for anonymous or signed-in customers; staff (admin / master / crew) upload;
                             Admin / Master list, replace and delete.
         lot-pictures        customers upload from the portal into "<order id>/<file>" only (image types and size are limited by
                             the bucket); no listing for anonymous or signed-in customers; only Admin / Master list and delete.
         order-pictures      customers upload from the portal into "<order id>/<file>" only; staff read; Admin / Master replace
                             and delete.
    3. Nothing is moved, deleted or rewritten: no objects, no bucket contents, no table rows.

  Not changed here (needs a separate, coordinated change; reported separately)
    - lot-pictures, order-pictures and public-assets stay PUBLIC buckets: the portal, the Admin screens and the delivery /
      damage proof photos still display them through permanent public URLs, and public-assets mixes marketing files with
      delivery / damage evidence, which cannot be separated without moving objects.
    - Customers still upload lot / order pictures straight from the browser (portal flow).
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Buckets that hold legal documents are private
-- ---------------------------------------------------------------------------------------------------------------------
UPDATE storage.buckets SET public = false WHERE id IN ('signed-waivers', 'signatures', 'physical-waivers');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Reset every Storage policy that mentions one of these buckets
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  buckets text[] := ARRAY[
    'signed-waivers', 'signatures', 'physical-waivers', 'lot-pictures', 'order-pictures', 'public-assets',
    'unit-images', 'carousel-media', 'event-essentials-media'
  ];
BEGIN
  FOR r IN
    SELECT p.policyname
    FROM pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
      AND EXISTS (
        SELECT 1 FROM unnest(buckets) b
        WHERE coalesce(p.qual, '') LIKE '%''' || b || '''%' OR coalesce(p.with_check, '') LIKE '%''' || b || '''%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The explicit policy set
-- ---------------------------------------------------------------------------------------------------------------------

-- Marketing buckets: shown to anonymous visitors, managed by Admin / Master.
CREATE POLICY "Public read marketing media" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id IN ('unit-images', 'carousel-media', 'event-essentials-media'));
CREATE POLICY "Admin and master manage marketing media" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id IN ('unit-images', 'carousel-media', 'event-essentials-media') AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id IN ('unit-images', 'carousel-media', 'event-essentials-media') AND (SELECT public.is_admin()));

-- public-assets: no listing policy (objects are served by URL because the bucket is public); staff upload, Admin / Master manage.
CREATE POLICY "Staff upload public assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'public-assets' AND (SELECT public.is_crew_or_admin()));
-- Postgres only lets a role UPDATE / DELETE rows it can also SELECT, so Admin / Master need a read policy for the buckets they manage.
CREATE POLICY "Admin and master read public assets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'public-assets' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master replace public assets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'public-assets' AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id = 'public-assets' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master delete public assets" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'public-assets' AND (SELECT public.is_admin()));

-- lot-pictures: customers upload into "<order id>/<file>" from the portal; only Admin / Master delete; nobody lists.
CREATE POLICY "Upload lot pictures into an order folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'lot-pictures' AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$');
CREATE POLICY "Admin and master read lot pictures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'lot-pictures' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master delete lot pictures" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lot-pictures' AND (SELECT public.is_admin()));

-- order-pictures: customers upload into "<order id>/<file>" from the portal; staff read; Admin / Master replace and delete.
CREATE POLICY "Upload order pictures into an order folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'order-pictures' AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$');
CREATE POLICY "Staff read order pictures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'order-pictures' AND (SELECT public.is_crew_or_admin()));
CREATE POLICY "Admin and master replace order pictures" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'order-pictures' AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id = 'order-pictures' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master delete order pictures" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'order-pictures' AND (SELECT public.is_admin()));

-- signed-waivers, signatures and physical-waivers intentionally have NO policy: service role only.
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 314 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261014120000'; END IF;
END $bpcend$;
