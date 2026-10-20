-- BPC-DEV-EXECUTOR step 13/28; version 20261017120000; file 20261017120000_add_booking_confirmation_claim.sql; sha256_lf 10ca659f79b57d15dbfebac32ef9716eb2d427f8ba9bdf32d5a303764bbaf22a; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261017120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261017120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261016120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261017120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 12 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM '181501065d3c5a965f5d300c54f9fbd8' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261017120000 (expected 181501065d3c5a965f5d300c54f9fbd8, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261017120000_add_booking_confirmation_claim.sql
/*
  # Booking confirmation claim

  The complete-booking function sends the customer's booking confirmation. To keep a repeated request (a replay with the same
  completed Stripe session, or two requests at once) from sending it twice, it must claim the confirmation before sending.

  orders.booking_confirmation_sent already means "the confirmation was delivered" and must keep meaning exactly that. A claim
  that is only IN PROGRESS must never look like a delivered confirmation, and a crashed request must never leave an order
  marked as delivered. So the in-progress state is separate:

    unsent / idle        booking_confirmation_sent = false, claim_id IS NULL
    in progress          booking_confirmation_sent = false, claim_id = <random uuid>, claimed_at = <time of the claim>
    delivered            booking_confirmation_sent = true,  claim_id IS NULL
    failed / released    back to unsent / idle

  ## New columns (orders)
  - booking_confirmation_claim_id uuid         the claim owner (generated by the server, never by a browser)
  - booking_confirmation_claimed_at timestamptz when the claim was taken

  ## New functions (service role only)
  - claim_booking_confirmation(order, claim, stale_seconds) -> 'claimed' | 'already_sent' | 'busy' | 'invalid'
      Atomically takes the claim in ONE UPDATE. 'busy' means another request holds a claim that is not stale yet. A claim older
      than stale_seconds is treated as abandoned (the request that took it crashed) and is taken over. A draft or unknown order
      is 'invalid'.
  - finalize_booking_confirmation(order, claim) -> boolean
      Marks the confirmation delivered. Only the exact claim owner can: a different or stale claim id changes nothing.
  - release_booking_confirmation(order, claim) -> boolean
      Gives the claim up after a failed delivery. Only the exact claim owner can; it never clears a delivered confirmation.

  ## Stale timeout
  The caller passes 600 seconds. An Edge Function request is cut off well before 10 minutes (the platform wall-clock limit is
  400 seconds at most, and a confirmation is one email and one text), so a live request cannot still be working when its claim
  is taken over, while a crashed request only delays a retry by ten minutes.

  ## Access
  Execute is revoked from PUBLIC, anon and authenticated and granted to service_role only; the functions pin search_path.
  No other table, policy, grant or default privilege is touched.

  ## Residual (not solvable in the database)
  If the provider accepts a message and the function then crashes before it finalizes, the claim goes stale and a later retry
  sends the confirmation again. Exactly-once external delivery cannot be guaranteed across that crash.
*/

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS booking_confirmation_claim_id uuid,
  ADD COLUMN IF NOT EXISTS booking_confirmation_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_booking_confirmation(p_order_id uuid, p_claim_id uuid, p_stale_seconds integer DEFAULT 600)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_claimed uuid;
  v_status text;
  v_sent boolean;
BEGIN
  IF p_order_id IS NULL OR p_claim_id IS NULL OR p_stale_seconds IS NULL OR p_stale_seconds < 60 THEN
    RETURN 'invalid';
  END IF;

  -- One statement decides: the row lock makes concurrent callers take turns, and only one of them can satisfy the condition.
  UPDATE public.orders
  SET booking_confirmation_claim_id = p_claim_id,
      booking_confirmation_claimed_at = now()
  WHERE id = p_order_id
    AND status <> 'draft'
    AND COALESCE(booking_confirmation_sent, false) = false
    AND (
      booking_confirmation_claim_id IS NULL
      OR booking_confirmation_claimed_at IS NULL
      OR booking_confirmation_claimed_at < now() - make_interval(secs => p_stale_seconds)
    )
  RETURNING booking_confirmation_claim_id INTO v_claimed;

  IF v_claimed IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT status, COALESCE(booking_confirmation_sent, false) INTO v_status, v_sent
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND OR v_status = 'draft' THEN
    RETURN 'invalid';
  END IF;
  IF v_sent THEN
    RETURN 'already_sent';
  END IF;
  RETURN 'busy';
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_booking_confirmation(p_order_id uuid, p_claim_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_order_id IS NULL OR p_claim_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.orders
  SET booking_confirmation_sent = true,
      booking_confirmation_claim_id = NULL,
      booking_confirmation_claimed_at = NULL
  WHERE id = p_order_id
    AND booking_confirmation_claim_id = p_claim_id
    AND COALESCE(booking_confirmation_sent, false) = false;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_booking_confirmation(p_order_id uuid, p_claim_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_order_id IS NULL OR p_claim_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.orders
  SET booking_confirmation_claim_id = NULL,
      booking_confirmation_claimed_at = NULL
  WHERE id = p_order_id
    AND booking_confirmation_claim_id = p_claim_id
    AND COALESCE(booking_confirmation_sent, false) = false;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_booking_confirmation(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_booking_confirmation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_booking_confirmation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_booking_confirmation(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_booking_confirmation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_booking_confirmation(uuid, uuid) TO service_role;
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

  IF fp_all IS DISTINCT FROM '641a9afd001767d72d182a0297a299dc' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261017120000 (expected 641a9afd001767d72d182a0297a299dc, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261017120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261017120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261017120000', 'add_booking_confirmation_claim', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=13/28; version=20261017120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=10ca659f79b57d15dbfebac32ef9716eb2d427f8ba9bdf32d5a303764bbaf22a', $bpcsql$/*
  # Booking confirmation claim

  The complete-booking function sends the customer's booking confirmation. To keep a repeated request (a replay with the same
  completed Stripe session, or two requests at once) from sending it twice, it must claim the confirmation before sending.

  orders.booking_confirmation_sent already means "the confirmation was delivered" and must keep meaning exactly that. A claim
  that is only IN PROGRESS must never look like a delivered confirmation, and a crashed request must never leave an order
  marked as delivered. So the in-progress state is separate:

    unsent / idle        booking_confirmation_sent = false, claim_id IS NULL
    in progress          booking_confirmation_sent = false, claim_id = <random uuid>, claimed_at = <time of the claim>
    delivered            booking_confirmation_sent = true,  claim_id IS NULL
    failed / released    back to unsent / idle

  ## New columns (orders)
  - booking_confirmation_claim_id uuid         the claim owner (generated by the server, never by a browser)
  - booking_confirmation_claimed_at timestamptz when the claim was taken

  ## New functions (service role only)
  - claim_booking_confirmation(order, claim, stale_seconds) -> 'claimed' | 'already_sent' | 'busy' | 'invalid'
      Atomically takes the claim in ONE UPDATE. 'busy' means another request holds a claim that is not stale yet. A claim older
      than stale_seconds is treated as abandoned (the request that took it crashed) and is taken over. A draft or unknown order
      is 'invalid'.
  - finalize_booking_confirmation(order, claim) -> boolean
      Marks the confirmation delivered. Only the exact claim owner can: a different or stale claim id changes nothing.
  - release_booking_confirmation(order, claim) -> boolean
      Gives the claim up after a failed delivery. Only the exact claim owner can; it never clears a delivered confirmation.

  ## Stale timeout
  The caller passes 600 seconds. An Edge Function request is cut off well before 10 minutes (the platform wall-clock limit is
  400 seconds at most, and a confirmation is one email and one text), so a live request cannot still be working when its claim
  is taken over, while a crashed request only delays a retry by ten minutes.

  ## Access
  Execute is revoked from PUBLIC, anon and authenticated and granted to service_role only; the functions pin search_path.
  No other table, policy, grant or default privilege is touched.

  ## Residual (not solvable in the database)
  If the provider accepts a message and the function then crashes before it finalizes, the claim goes stale and a later retry
  sends the confirmation again. Exactly-once external delivery cannot be guaranteed across that crash.
*/

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS booking_confirmation_claim_id uuid,
  ADD COLUMN IF NOT EXISTS booking_confirmation_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_booking_confirmation(p_order_id uuid, p_claim_id uuid, p_stale_seconds integer DEFAULT 600)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_claimed uuid;
  v_status text;
  v_sent boolean;
BEGIN
  IF p_order_id IS NULL OR p_claim_id IS NULL OR p_stale_seconds IS NULL OR p_stale_seconds < 60 THEN
    RETURN 'invalid';
  END IF;

  -- One statement decides: the row lock makes concurrent callers take turns, and only one of them can satisfy the condition.
  UPDATE public.orders
  SET booking_confirmation_claim_id = p_claim_id,
      booking_confirmation_claimed_at = now()
  WHERE id = p_order_id
    AND status <> 'draft'
    AND COALESCE(booking_confirmation_sent, false) = false
    AND (
      booking_confirmation_claim_id IS NULL
      OR booking_confirmation_claimed_at IS NULL
      OR booking_confirmation_claimed_at < now() - make_interval(secs => p_stale_seconds)
    )
  RETURNING booking_confirmation_claim_id INTO v_claimed;

  IF v_claimed IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT status, COALESCE(booking_confirmation_sent, false) INTO v_status, v_sent
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND OR v_status = 'draft' THEN
    RETURN 'invalid';
  END IF;
  IF v_sent THEN
    RETURN 'already_sent';
  END IF;
  RETURN 'busy';
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_booking_confirmation(p_order_id uuid, p_claim_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_order_id IS NULL OR p_claim_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.orders
  SET booking_confirmation_sent = true,
      booking_confirmation_claim_id = NULL,
      booking_confirmation_claimed_at = NULL
  WHERE id = p_order_id
    AND booking_confirmation_claim_id = p_claim_id
    AND COALESCE(booking_confirmation_sent, false) = false;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_booking_confirmation(p_order_id uuid, p_claim_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_order_id IS NULL OR p_claim_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.orders
  SET booking_confirmation_claim_id = NULL,
      booking_confirmation_claimed_at = NULL
  WHERE id = p_order_id
    AND booking_confirmation_claim_id = p_claim_id
    AND COALESCE(booking_confirmation_sent, false) = false;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_booking_confirmation(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_booking_confirmation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_booking_confirmation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_booking_confirmation(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_booking_confirmation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_booking_confirmation(uuid, uuid) TO service_role;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 318 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261017120000'; END IF;
END $bpcend$;
