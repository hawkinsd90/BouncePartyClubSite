-- BPC-DEV-EXECUTOR step 3/28; version 20261009120000; file 20261009120000_secure_customer_portal_links.sql; sha256_lf 58d4079aa323bf66f26efcc422cb9ec009c8175bba16323f4a93a2c546286b25; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261009120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261009120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261008120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261009120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 2 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM '9bd7915b86e5bc589d1b429582347c31' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261009120000 (expected 9bd7915b86e5bc589d1b429582347c31, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261009120000_secure_customer_portal_links.sql
/*
  # Secure customer portal links: canonical order-bound links

  Additive and safe for BOTH Dev and Production (written against a read-only comparison of the two). It reuses the
  existing public.invoice_links table as the single canonical customer-link store. It does NOT drop or change any
  invoice_links policy or grant, does not touch orders/customers RLS, and does not delete or rewrite data.

  ## What exists today (verified live on Dev and Production)
  - invoice_links(id, order_id, link_token text UNIQUE default 32 random bytes hex, customer_filled, deposit_cents,
    expires_at default now()+7 days, created_at, updated_at, short_code, link_type default 'invoice').
  - link_type values in use: 'invoice' (admin invoices) and 'portal_shortlink' (legacy 8-char short links, every row
    already expired). short_code has a partial UNIQUE index.
  - Trigger trg_sync_invoice_links_expires_at on orders rewrote expires_at for EVERY link of an order (expired ones
    included) to event_date + 3 days whenever event_date changed, which can bring an expired security token back to
    life when an order is rescheduled.
  - The Dev-only public.order_portal_links table (created by migration 20260722212750) is LEGACY: its only possible
    result is a UUID-only URL, Production has neither it nor create_order_short_link / resolve_portal_short_link.
    This migration does not read or build on it.

  ## 1. revoked_at
  invoice_links.revoked_at (timestamptz, nullable). Revocation is sticky and effective everywhere:
    - a BEFORE INSERT/UPDATE trigger never lets revoked_at be cleared once set, and forces expires_at <= revoked_at,
      so every existing validator that only checks "expires_at > now()" (the SQL token RPCs, the invoice_links
      "valid token" policies, the Edge Function validator) rejects a revoked link without being rewritten.
    - The Edge Function validator additionally checks revoked_at IS NULL explicitly.

  ## 2. One active canonical portal link per order
  Partial UNIQUE index on (order_id) WHERE link_type = 'portal' AND revoked_at IS NULL. Expired-but-unrevoked rows
  still occupy that slot, so the server helper retires an expired portal link (sets revoked_at) before minting its
  replacement. link_type 'portal' is a value, not a new table; no CHECK constraint is added so legacy values keep working.

  ## 3. Expiry rule for portal links
  expires_at = start of the day after (COALESCE(event_end_date, event_date) + 60 days), i.e. valid through the whole
  60th day after the event. If neither date exists the server helper uses issuance time + 60 days (documented
  fallback; the trigger leaves such a link alone until a date appears).

  ## 4. sync_invoice_links_expires_at (corrected)
  Fires when event_date OR event_end_date changes. Exact semantics:
    - ACTIVE portal links (not revoked, not yet expired) follow the new portal expiry rule.
    - Legacy/invoice links keep their previous rule (event_date + 3 days) but ONLY when event_date changed, and
      ONLY if they are currently active (not revoked, expires_at not null and still in the future).
    - Expired and revoked links are never touched, so a date change cannot resurrect them.
    - Order dates themselves are never modified.

  ## Not changed
  invoice_links policies and grants (core database access lockdown migration), orders/customers RLS (same migration), get_order_by_token and
  get_order_with_relations_by_token bodies (they honor revocation through expires_at), order_portal_links (deferred
  cleanup), create_order_short_link / create_portal_short_link / resolve_portal_short_link (legacy, no longer
  called by the application after this migration).
*/

-- 1. revoked_at -----------------------------------------------------------------------------------------------
ALTER TABLE public.invoice_links ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- 2. one active canonical portal link per order -----------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS invoice_links_one_active_portal_per_order
  ON public.invoice_links (order_id)
  WHERE link_type = 'portal' AND revoked_at IS NULL;

-- Resolver / validator lookups are by short_code (unique index exists) and link_token (unique constraint exists).

-- 3. portal expiry rule ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_link_expires_at(p_event_end_date date, p_event_date date)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN COALESCE(p_event_end_date, p_event_date) IS NULL THEN NULL
    ELSE ((COALESCE(p_event_end_date, p_event_date) + 61)::timestamp AT TIME ZONE 'UTC')
  END;
$$;

REVOKE ALL ON FUNCTION public.portal_link_expires_at(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_link_expires_at(date, date) TO service_role;

-- 4. revocation is sticky and implies expiry --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_links_enforce_revocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NOT NULL THEN
    NEW.revoked_at := OLD.revoked_at;
  END IF;
  IF NEW.revoked_at IS NOT NULL AND (NEW.expires_at IS NULL OR NEW.expires_at > NEW.revoked_at) THEN
    NEW.expires_at := NEW.revoked_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_links_enforce_revocation ON public.invoice_links;
CREATE TRIGGER trg_invoice_links_enforce_revocation
  BEFORE INSERT OR UPDATE ON public.invoice_links
  FOR EACH ROW
  EXECUTE FUNCTION public.invoice_links_enforce_revocation();

-- 5. corrected expiry sync ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_invoice_links_expires_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_portal_expiry timestamptz;
BEGIN
  IF NEW.event_date IS DISTINCT FROM OLD.event_date
     OR NEW.event_end_date IS DISTINCT FROM OLD.event_end_date THEN

    v_portal_expiry := public.portal_link_expires_at(NEW.event_end_date, NEW.event_date);

    IF v_portal_expiry IS NOT NULL THEN
      UPDATE public.invoice_links
         SET expires_at = v_portal_expiry,
             updated_at = now()
       WHERE order_id = NEW.id
         AND link_type = 'portal'
         AND revoked_at IS NULL
         AND expires_at > now();
    END IF;
  END IF;

  IF NEW.event_date IS DISTINCT FROM OLD.event_date AND NEW.event_date IS NOT NULL THEN
    UPDATE public.invoice_links
       SET expires_at = (NEW.event_date::date + interval '3 days'),
           updated_at = now()
     WHERE order_id = NEW.id
       AND link_type <> 'portal'
       AND revoked_at IS NULL
       AND expires_at IS NOT NULL
       AND expires_at > now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice_links_expires_at ON public.orders;
CREATE TRIGGER trg_sync_invoice_links_expires_at
  AFTER UPDATE OF event_date, event_end_date ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_invoice_links_expires_at();
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

  IF fp_all IS DISTINCT FROM '709544044bb6a57794cb7d8ef716eee7' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261009120000 (expected 709544044bb6a57794cb7d8ef716eee7, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261009120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261009120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261009120000', 'secure_customer_portal_links', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=3/28; version=20261009120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=58d4079aa323bf66f26efcc422cb9ec009c8175bba16323f4a93a2c546286b25', $bpcsql$/*
  # Secure customer portal links: canonical order-bound links

  Additive and safe for BOTH Dev and Production (written against a read-only comparison of the two). It reuses the
  existing public.invoice_links table as the single canonical customer-link store. It does NOT drop or change any
  invoice_links policy or grant, does not touch orders/customers RLS, and does not delete or rewrite data.

  ## What exists today (verified live on Dev and Production)
  - invoice_links(id, order_id, link_token text UNIQUE default 32 random bytes hex, customer_filled, deposit_cents,
    expires_at default now()+7 days, created_at, updated_at, short_code, link_type default 'invoice').
  - link_type values in use: 'invoice' (admin invoices) and 'portal_shortlink' (legacy 8-char short links, every row
    already expired). short_code has a partial UNIQUE index.
  - Trigger trg_sync_invoice_links_expires_at on orders rewrote expires_at for EVERY link of an order (expired ones
    included) to event_date + 3 days whenever event_date changed, which can bring an expired security token back to
    life when an order is rescheduled.
  - The Dev-only public.order_portal_links table (created by migration 20260722212750) is LEGACY: its only possible
    result is a UUID-only URL, Production has neither it nor create_order_short_link / resolve_portal_short_link.
    This migration does not read or build on it.

  ## 1. revoked_at
  invoice_links.revoked_at (timestamptz, nullable). Revocation is sticky and effective everywhere:
    - a BEFORE INSERT/UPDATE trigger never lets revoked_at be cleared once set, and forces expires_at <= revoked_at,
      so every existing validator that only checks "expires_at > now()" (the SQL token RPCs, the invoice_links
      "valid token" policies, the Edge Function validator) rejects a revoked link without being rewritten.
    - The Edge Function validator additionally checks revoked_at IS NULL explicitly.

  ## 2. One active canonical portal link per order
  Partial UNIQUE index on (order_id) WHERE link_type = 'portal' AND revoked_at IS NULL. Expired-but-unrevoked rows
  still occupy that slot, so the server helper retires an expired portal link (sets revoked_at) before minting its
  replacement. link_type 'portal' is a value, not a new table; no CHECK constraint is added so legacy values keep working.

  ## 3. Expiry rule for portal links
  expires_at = start of the day after (COALESCE(event_end_date, event_date) + 60 days), i.e. valid through the whole
  60th day after the event. If neither date exists the server helper uses issuance time + 60 days (documented
  fallback; the trigger leaves such a link alone until a date appears).

  ## 4. sync_invoice_links_expires_at (corrected)
  Fires when event_date OR event_end_date changes. Exact semantics:
    - ACTIVE portal links (not revoked, not yet expired) follow the new portal expiry rule.
    - Legacy/invoice links keep their previous rule (event_date + 3 days) but ONLY when event_date changed, and
      ONLY if they are currently active (not revoked, expires_at not null and still in the future).
    - Expired and revoked links are never touched, so a date change cannot resurrect them.
    - Order dates themselves are never modified.

  ## Not changed
  invoice_links policies and grants (core database access lockdown migration), orders/customers RLS (same migration), get_order_by_token and
  get_order_with_relations_by_token bodies (they honor revocation through expires_at), order_portal_links (deferred
  cleanup), create_order_short_link / create_portal_short_link / resolve_portal_short_link (legacy, no longer
  called by the application after this migration).
*/

-- 1. revoked_at -----------------------------------------------------------------------------------------------
ALTER TABLE public.invoice_links ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- 2. one active canonical portal link per order -----------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS invoice_links_one_active_portal_per_order
  ON public.invoice_links (order_id)
  WHERE link_type = 'portal' AND revoked_at IS NULL;

-- Resolver / validator lookups are by short_code (unique index exists) and link_token (unique constraint exists).

-- 3. portal expiry rule ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_link_expires_at(p_event_end_date date, p_event_date date)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN COALESCE(p_event_end_date, p_event_date) IS NULL THEN NULL
    ELSE ((COALESCE(p_event_end_date, p_event_date) + 61)::timestamp AT TIME ZONE 'UTC')
  END;
$$;

REVOKE ALL ON FUNCTION public.portal_link_expires_at(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_link_expires_at(date, date) TO service_role;

-- 4. revocation is sticky and implies expiry --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_links_enforce_revocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NOT NULL THEN
    NEW.revoked_at := OLD.revoked_at;
  END IF;
  IF NEW.revoked_at IS NOT NULL AND (NEW.expires_at IS NULL OR NEW.expires_at > NEW.revoked_at) THEN
    NEW.expires_at := NEW.revoked_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_links_enforce_revocation ON public.invoice_links;
CREATE TRIGGER trg_invoice_links_enforce_revocation
  BEFORE INSERT OR UPDATE ON public.invoice_links
  FOR EACH ROW
  EXECUTE FUNCTION public.invoice_links_enforce_revocation();

-- 5. corrected expiry sync ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_invoice_links_expires_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_portal_expiry timestamptz;
BEGIN
  IF NEW.event_date IS DISTINCT FROM OLD.event_date
     OR NEW.event_end_date IS DISTINCT FROM OLD.event_end_date THEN

    v_portal_expiry := public.portal_link_expires_at(NEW.event_end_date, NEW.event_date);

    IF v_portal_expiry IS NOT NULL THEN
      UPDATE public.invoice_links
         SET expires_at = v_portal_expiry,
             updated_at = now()
       WHERE order_id = NEW.id
         AND link_type = 'portal'
         AND revoked_at IS NULL
         AND expires_at > now();
    END IF;
  END IF;

  IF NEW.event_date IS DISTINCT FROM OLD.event_date AND NEW.event_date IS NOT NULL THEN
    UPDATE public.invoice_links
       SET expires_at = (NEW.event_date::date + interval '3 days'),
           updated_at = now()
     WHERE order_id = NEW.id
       AND link_type <> 'portal'
       AND revoked_at IS NULL
       AND expires_at IS NOT NULL
       AND expires_at > now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice_links_expires_at ON public.orders;
CREATE TRIGGER trg_sync_invoice_links_expires_at
  AFTER UPDATE OF event_date, event_end_date ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_invoice_links_expires_at();
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 308 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261009120000'; END IF;
END $bpcend$;
